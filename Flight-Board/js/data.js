/* ============================================================
 *  データの読み込みと検索
 *  JSONを読んで、検索しやすい形に組み直すところまでを担当します。
 *  画面を作る処理は app.js にあります。
 * ============================================================ */

const FB = {
  airports: [],      // 空港の配列
  airportByIata: {}, // IATAコード → 空港
  airlines: [],      // 航空会社の配列
  airlineByIata: {},
  alliances: {},     // アライアンスの基本情報
  meta: {},
};

/* 国コード（JP）を日本語の国名（日本）に変える。
   Intl.DisplayNames はブラウザに元から入っている機能なので、
   国名のデータを自前で持たなくて済みます。 */
const countryName = (() => {
  let dn = null;
  try {
    dn = new Intl.DisplayNames(['ja'], { type: 'region' });
  } catch (e) {
    dn = null; // 古いブラウザ。そのときは国コードをそのまま出す
  }
  const cache = {};
  return (code) => {
    if (!code) return '';
    if (cache[code] !== undefined) return cache[code];
    let out = code;
    try { out = (dn && dn.of(code)) || code; } catch (e) { out = code; }
    return (cache[code] = out);
  };
})();

/* 検索用に文字列をそろえる。
   ・大文字小文字をなくす
   ・全角英数を半角にする（スマホで「ＮＧＯ」と入ってしまうことがあるため）
   ・カタカナをひらがなに寄せる（「ハネダ」でも「はねだ」でも当たるように） */
function normalizeQuery(s) {
  if (!s) return '';
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .trim();
}

async function fetchJson(path, optional) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) {
    if (optional) return null;
    throw new Error(`${path} を読み込めませんでした（${res.status}）`);
  }
  return res.json();
}

/* 配列で持っているデータを、名前付きのオブジェクトに直す。
   JSONは容量を抑えるために ["NGO","RJGG",...] の形で持っているので、
   fields の並び順を使ってプログラムから読みやすい形に戻しています。 */
function toObjects(fields, rows) {
  return rows.map((row) => {
    const o = {};
    fields.forEach((f, i) => { o[f] = row[i]; });
    return o;
  });
}

FB.load = async function load() {
  const [ap, apJa, al, ac, cb, aw, pr] = await Promise.all([
    fetchJson(DATA_FILES.airports),
    fetchJson(DATA_FILES.airportsJa, true), // 無くても動くので optional
    fetchJson(DATA_FILES.airlines),
    fetchJson(DATA_FILES.aircraft),
    fetchJson(DATA_FILES.cabins, true),     // 無くても動くので optional
    fetchJson(DATA_FILES.awards, true),     // 無くても動くので optional
    fetchJson(DATA_FILES.products, true),   // 無くても動くので optional
  ]);

  // ---- 空港 ----
  const jaNames = (apJa && apJa.names) || {};
  FB.airports = toObjects(ap.fields, ap.airports);
  FB.airports.forEach((a) => {
    const ja = jaNames[a.iata];
    a.nameJa = ja ? ja[0] : '';
    a.cityJa = ja ? ja[1] : '';
    a.countryJa = countryName(a.country);
    // 検索でひっかける対象をあらかじめ1本の文字列にしておくと、
    // 4,000件を毎回まわしても十分速い
    a.q = normalizeQuery([a.iata, a.icao, a.name, a.city,
                          a.nameJa, a.cityJa, a.countryJa].join(' '));
    FB.airportByIata[a.iata] = a;
  });

  // ---- 航空会社 ----
  FB.airlines = toObjects(al.fields, al.airlines);
  FB.alliances = al.alliances || {};
  FB.airlines.forEach((a) => {
    a.countryJa = countryName(a.country);
    a.q = normalizeQuery([a.iata, a.icao, a.name, a.nameEn, a.countryJa].join(' '));
    FB.airlineByIata[a.iata] = a;
  });

  // ---- 機材 ----
  FB.aircraft = toObjects(ac.fields, ac.aircraft);
  FB.aircraftCategories = ac.categories || {};
  FB.aircraftStatuses = ac.statuses || {};
  FB.hauls = ac.hauls || {};
  FB.haulHints = ac.haulHints || {};
  FB.aircraft.forEach((a) => {
    a.categoryJa = FB.aircraftCategories[a.category] || '';
    a.statusJa = FB.aircraftStatuses[a.status] || '';
    a.q = normalizeQuery([a.icao, a.maker, a.model, a.categoryJa].join(' '));
    FB.aircraftByIcao = FB.aircraftByIcao || {};
    FB.aircraftByIcao[a.icao] = a;
  });

  // ---- 各社の座席仕様 ----
  // 「どの会社がこの機材をどんな座席で飛ばしているか」を機材側から引けるように、
  // 会社ごとの艦隊表を機材ごとに並べ替えた索引を作る
  FB.cabins = (cb && cb.cabins) || {};
  FB.cabinClasses = (cb && cb.classes) || {};
  FB.cabinOrder = (cb && cb.order) || ['F', 'J', 'W', 'Y'];
  FB.seatTypes = (cb && cb.seatTypes) || {};
  FB.seatMarks = (cb && cb.seatMarks) || {};
  FB.cabinsByAircraft = {};
  for (const code in FB.cabins) {
    for (const row of FB.cabins[code].fleet) {
      (FB.cabinsByAircraft[row.icao] || (FB.cabinsByAircraft[row.icao] = []))
        .push(Object.assign({ airline: code }, row));
    }
  }
  // 保有機数の多い順にしておくと、主力の会社が上に来る
  for (const icao in FB.cabinsByAircraft) {
    FB.cabinsByAircraft[icao].sort((a, b) => b.count - a.count);
  }

  // ---- 特別な座席・設備 ----
  // 「THE Room に乗りたい」から旅程を決める人のための表です。
  // 座席仕様（何席あるか）とは別の層で、製品名と特徴を持っています。
  FB.products = (pr && pr.products) || [];
  FB.productMeta = (pr && pr.meta) || {};
  FB.productsByAircraft = {};
  FB.products.forEach((p) => {
    p.airlineJa = () => (FB.airlineByIata[p.airline] || {}).name || p.airline;
    p.q = normalizeQuery([p.name, p.airline, p.routes, p.note,
      (FB.airlineByIata[p.airline] || {}).name,
      (FB.airlineByIata[p.airline] || {}).nameEn,
      ...p.ac.map((c) => {
        const a = FB.aircraftByIcao[c];
        return a ? `${c} ${a.maker} ${a.model}` : c;
      })].filter(Boolean).join(' '));
    p.ac.forEach((c) => {
      (FB.productsByAircraft[c] || (FB.productsByAircraft[c] = [])).push(p);
    });
  });

  // ---- 特典航空券のリンク ----
  FB.awardPrograms = (aw && aw.programs) || [];
  FB.awardMeta = (aw && aw.meta) || {};
  FB.awardByAirline = {};
  FB.awardPrograms.forEach((p) => { FB.awardByAirline[p.airline] = p; });

  FB.meta = { airports: ap.meta, airlines: al.meta, aircraft: ac.meta,
              cabins: cb && cb.meta, awards: aw && aw.meta,
              products: pr && pr.meta };
  return FB;
};

/* ------------------------------------------------------------
 *  検索
 *  並び順は「コードがぴったり一致 → 前方一致 → 途中に含む」の順。
 *  NGO と打ったら中部国際空港が必ず一番上に来てほしいので。
 * ---------------------------------------------------------- */

/* 検索語から「当たり判定」を作る。
   英字は単語の先頭だけを見ます。そうしないと NGO で Flamingo や
   Congonhas まで拾ってしまい、目当ての空港が埋もれるためです。
   日本語は単語の区切りが無いので、こちらは途中一致のままにします。 */
function makeMatcher(q) {
  if (!q) return null;
  if (!/^[a-z0-9 ]+$/.test(q)) {
    return (item) => item.q.includes(q);
  }
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?:^|[^a-z0-9])' + safe);
  return (item) => re.test(item.q);
}

function scoreMatch(item, code, q, matcher) {
  if (!q) return 0;                       // 検索語なし＝全件（並びは呼び出し側で決める）
  if (code === q.toUpperCase()) return 3; // コードがぴったり
  if (item.q.startsWith(q)) return 2;     // 頭から一致
  if (matcher(item)) return 1;            // 単語の先頭（日本語なら途中でも）に一致
  return -1;                              // 一致しない
}

FB.searchAirports = function searchAirports(query, filter) {
  const q = normalizeQuery(query);
  const matcher = makeMatcher(q);
  const f = filter || {};
  const hits = [];

  for (const a of FB.airports) {
    if (f.size && a.size !== f.size) continue;
    if (f.country && a.country !== f.country) continue;
    const s = scoreMatch(a, a.iata, q, matcher);
    if (s < 0) continue;
    hits.push([s, a]);
  }

  // 同じ点数どうしは「規模が大きい順 → コード順」。
  // 検索語が無いときも、いきなり小さな離島空港が並ばないようにする狙い。
  const sizeRank = { L: 0, M: 1, S: 2 };
  hits.sort((x, y) =>
    y[0] - x[0] ||
    sizeRank[x[1].size] - sizeRank[y[1].size] ||
    x[1].iata.localeCompare(y[1].iata));

  return hits.map((h) => h[1]);
};

FB.searchAirlines = function searchAirlines(query, filter) {
  const q = normalizeQuery(query);
  const matcher = makeMatcher(q);
  const f = filter || {};
  const hits = [];

  for (const a of FB.airlines) {
    if (f.alliance === 'none' && a.alliance) continue;
    if (f.alliance && f.alliance !== 'none' && a.alliance !== f.alliance) continue;
    const s = scoreMatch(a, a.iata, q, matcher);
    if (s < 0) continue;
    hits.push([s, a]);
  }

  // 同点なら、アライアンス加盟社を先に、そのあと日本語名の五十音順
  hits.sort((x, y) =>
    y[0] - x[0] ||
    (x[1].alliance ? 0 : 1) - (y[1].alliance ? 0 : 1) ||
    x[1].name.localeCompare(y[1].name, 'ja'));

  return hits.map((h) => h[1]);
};

/* ------------------------------------------------------------
 *  就航路線
 *  routes.json は他のファイルより大きいので、最初の画面が出てから
 *  裏で読み込みます。読み終わるまでは routesReady が false です。
 * ---------------------------------------------------------- */
FB.routesReady = false;
FB.routesError = '';

FB.loadRoutes = async function loadRoutes() {
  if (FB.routesReady) return true;
  let data;
  try {
    // 地図の陸地データも同じタイミングで読む。どちらも最初の画面には
    // 要らないので、表示が出てから裏でまとめて取りに行きます。
    const [routes, world] = await Promise.all([
      fetchJson(DATA_FILES.routes),
      fetchJson(DATA_FILES.worldmap, true),
    ]);
    data = routes;
    FB.land = (world && world.land) || [];
  } catch (e) {
    FB.routesError = '路線データを読み込めませんでした。tools/build_routes.py を実行してください。';
    return false;
  }

  FB.routeAirlines = data.airlines;   // 航空会社名（routes の中では番号で参照している）
  FB.routeCodes = data.codes;         // 同じ並びのIATAコード。空文字なら航空会社マスタに未収録
  FB.routeMeta = data.meta;
  FB.routesFrom = data.routes;

  // 「この空港に来ている便」を引けるように、逆向きの索引を作る。
  // Wikipedia は空港ごとに就航先を書いているので、両方向を合わせないと
  // 片側の記事にしか載っていない路線を取りこぼします。
  const to = {};
  for (const origin in data.routes) {
    for (const [ai, dest, state] of data.routes[origin]) {
      (to[dest] || (to[dest] = [])).push([ai, origin, state]);
    }
  }
  FB.routesTo = to;

  FB.routesReady = true;
  return true;
};

/* 状態の強さ。同じ路線が両方向で違う状態で載っていたら、強いほうを採る */
const STATE_RANK = { scheduled: 5, seasonal: 4, charter: 3, future: 2, ending: 1, suspended: 0 };

/* ある空港から行ける先を、就航先ごとにまとめて返す */
FB.destinationsFrom = function destinationsFrom(iata) {
  if (!FB.routesReady) return [];
  const byDest = new Map();

  const add = (dest, ai, state) => {
    if (dest === iata) return;
    let m = byDest.get(dest);
    if (!m) byDest.set(dest, (m = new Map()));
    const prev = m.get(ai);
    if (prev === undefined || STATE_RANK[state] > STATE_RANK[prev]) m.set(ai, state);
  };

  for (const [ai, dest, state] of (FB.routesFrom[iata] || [])) add(dest, ai, state);
  for (const [ai, origin, state] of (FB.routesTo[iata] || [])) add(origin, ai, state);

  const out = [];
  for (const [dest, m] of byDest) {
    out.push({
      dest,
      airport: FB.airportByIata[dest] || null,
      airlines: [...m].map(([ai, state]) => ({
        name: FB.routeAirlines[ai],
        code: FB.routeCodes[ai],
        state,
      })).sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  // 就航会社が多い順。ハブ路線が上に来たほうが実感に合う
  out.sort((a, b) => b.airlines.length - a.airlines.length ||
                     a.dest.localeCompare(b.dest));
  return out;
};

/* ------------------------------------------------------------
 *  距離とエリア
 * ---------------------------------------------------------- */

/* 2地点間の距離（km）。地球を球とみなした大圏距離（実際の飛行経路の長さ）。
   座標は空港マスタに入っているので、追加のデータなしで出せます。 */
FB.distanceKm = function distanceKm(a, b) {
  if (!a || !b) return 0;
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
};

/* 距離帯。おおよその飛行時間で分けています（巡航 約850km/h ＋ 離着陸）。
   「週末で行ける範囲か」を見るのが主な用途なので、細かさより分かりやすさ優先。 */
const BANDS = [
  { key: 'short',  label: '短距離', hint: '〜約3時間', max: 2000 },
  { key: 'medium', label: '中距離', hint: '約3〜7時間', max: 5500 },
  { key: 'long',   label: '長距離', hint: '約7時間〜', max: Infinity },
];
FB.bands = BANDS;

FB.bandOf = function bandOf(km) {
  return BANDS.find((b) => km <= b.max).key;
};

/* エリアの並び順。出発地から近いエリアを先に出したいので、
   固定の順番ではなく「そのエリアで一番近い就航先までの距離」で並べます。
   名古屋発なら東アジアが先、ロンドン発ならヨーロッパが先、と自然に変わります。 */
function regionOrderKey(items) {
  return Math.min(...items.map((d) => d.km));
}

/* ------------------------------------------------------------
 *  就航先の絞り込みとまとめ
 * ---------------------------------------------------------- */

/* 就航先に距離とエリアの情報を足す（絞り込みと並べ替えの下ごしらえ） */
FB.decorateDestinations = function decorateDestinations(dests, originIata) {
  const origin = FB.airportByIata[originIata];
  dests.forEach((d) => {
    d.km = FB.distanceKm(origin, d.airport);
    d.band = FB.bandOf(d.km);
    d.isDomestic = !!(origin && d.airport && d.airport.country === origin.country);
    // 運航会社からアライアンスとLCCの情報を引く。
    // 航空会社マスタに無い会社は判定できないので、その路線は
    // アライアンス・LCCの絞り込みでは対象外になります。
    d.alliances = new Set();
    d.hasLcc = false;
    d.hasFsc = false;
    d.airlines.forEach((x) => {
      const al = x.code ? FB.airlineByIata[x.code] : null;
      if (!al) return;
      if (al.alliance) d.alliances.add(al.alliance);
      if (al.lcc) d.hasLcc = true; else d.hasFsc = true;
    });
  });
  return dests;
};

/* 就航先が属する「まとまり」を決める。
   エリアの件数表示・絞り込み・見出しのまとめは、必ずこの1か所を通します。
   別々に判定していたときは、日本の空港が「国内」と「東アジア」の
   両方に数えられて、件数と実際の表示が食い違いました。 */
FB.areaKeyOf = function areaKeyOf(d, originIata) {
  const origin = FB.airportByIata[originIata];
  const fromJapan = origin && origin.country === 'JP';
  if (d.isDomestic) return '__domestic';
  if (!fromJapan && d.airport && d.airport.country === 'JP') return '__japan';
  return (d.airport && d.airport.region) || 'その他';
};

FB.areaLabelOf = function areaLabelOf(key, originIata) {
  const origin = FB.airportByIata[originIata];
  const fromJapan = origin && origin.country === 'JP';
  if (key === '__domestic') return fromJapan ? '国内線' : `${origin ? origin.countryJa : ''}国内線`;
  if (key === '__japan') return '日本行き';
  return key;
};

FB.filterDestinations = function filterDestinations(dests, filter, originIata) {
  const f = filter || {};
  return dests.filter((d) => {
    if (f.area && FB.areaKeyOf(d, originIata) !== f.area) return false;
    if (f.band && d.band !== f.band) return false;
    if (f.alliance && !d.alliances.has(f.alliance)) return false;
    if (f.carrier === 'lcc' && !d.hasLcc) return false;
    if (f.carrier === 'fsc' && !d.hasFsc) return false;
    return true;
  });
};

/* 就航先をエリアごとにまとめる。
   出発地の国＝「国内線」を先頭に、海外に出るときは日本行きを次に置きます
   （海外から日本へ帰る便を探すのがいちばん多い使い方なので）。 */
FB.groupDestinations = function groupDestinations(dests, originIata) {
  const buckets = new Map();
  dests.forEach((d) => {
    const key = FB.areaKeyOf(d, originIata);
    if (!buckets.has(key)) {
      buckets.set(key, { key, label: FB.areaLabelOf(key, originIata), items: [] });
    }
    buckets.get(key).items.push(d);
  });

  const groups = [...buckets.values()];
  groups.forEach((g) => {
    g.items.sort((a, b) => b.airlines.length - a.airlines.length || a.km - b.km);
    g.near = regionOrderKey(g.items);
  });

  // 国内線 → 日本行き → あとは就航先が多いエリア順。
  // 「近い順」も試しましたが、1件だけのエリアが間に挟まって読みにくいので、
  // 選択肢の多いエリアから見せる並びにしています（同数なら近い順）。
  const rank = (g) => (g.key === '__domestic' ? -2 : g.key === '__japan' ? -1 : 0);
  groups.sort((a, b) => rank(a) - rank(b) ||
                        b.items.length - a.items.length ||
                        a.near - b.near);
  return groups;
};

/* 絞り込みの選択肢を、いま出ている就航先から作る。
   就航先が1つも無いエリアのボタンは押しても意味がないので出しません。 */
FB.areaOptions = function areaOptions(dests, originIata) {
  const counts = new Map();
  dests.forEach((d) => {
    const k = FB.areaKeyOf(d, originIata);
    counts.set(k, (counts.get(k) || 0) + 1);
  });

  const rank = (k) => (k === '__domestic' ? -2 : k === '__japan' ? -1 : 0);
  return [...counts.entries()]
    .map(([k, n]) => ({
      key: k,
      label: FB.areaLabelOf(k, originIata).replace('線', ''),
      count: n,
    }))
    .sort((a, b) => rank(a.key) - rank(b.key) || b.count - a.count);
};

/* 2空港のあいだに直行便があるか。運航している会社の一覧を返す */
FB.directBetween = function directBetween(from, to) {
  if (!FB.routesReady) return [];
  const m = new Map();
  const scan = (rows, want) => {
    for (const row of (rows || [])) {
      if (row[1] !== want) continue;
      const prev = m.get(row[0]);
      if (prev === undefined || STATE_RANK[row[2]] > STATE_RANK[prev]) m.set(row[0], row[2]);
    }
  };
  scan(FB.routesFrom[from], to);
  scan(FB.routesFrom[to], from);

  return [...m].map(([ai, state]) => ({
    name: FB.routeAirlines[ai],
    code: FB.routeCodes[ai],
    state,
  })).sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state] ||
                     a.name.localeCompare(b.name));
};

FB.searchAircraft = function searchAircraft(query, filter) {
  const q = normalizeQuery(query);
  const matcher = makeMatcher(q);
  const f = filter || {};
  const hits = [];

  for (const a of FB.aircraft) {
    if (f.cat && a.category !== f.cat) continue;
    if (f.status && a.status !== f.status) continue;
    const s = scoreMatch(a, a.icao, q, matcher);
    if (s < 0) continue;
    hits.push([s, a]);
  }

  // 同点なら、生産中を先に、そのあと新しい機体から
  hits.sort((x, y) =>
    y[0] - x[0] ||
    (x[1].status === 'prod' ? 0 : 1) - (y[1].status === 'prod' ? 0 : 1) ||
    y[1].firstFlight - x[1].firstFlight);

  return hits.map((h) => h[1]);
};

/* あるアライアンスの加盟社を、国名の五十音順で返す */
FB.membersOf = function membersOf(key) {
  return FB.airlines
    .filter((a) => a.alliance === key)
    .sort((a, b) => a.countryJa.localeCompare(b.countryJa, 'ja') ||
                    a.name.localeCompare(b.name, 'ja'));
};
