/* ============================================================
 *  データの読み込み
 *  4つのJSONを読んで、引きやすい形に組み直すところまで担当します。
 * ============================================================ */

async function fetchJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} を読み込めませんでした（${res.status}）`);
  return res.json();
}

/* 国コード（JP）を日本語の国名（日本）に変える。
   Intl.DisplayNames はブラウザに元から入っている機能なので、
   国名のデータを自前で持たなくて済みます。 */
const countryName = (() => {
  let dn = null;
  try { dn = new Intl.DisplayNames(['ja'], { type: 'region' }); } catch (e) { dn = null; }
  const cache = {};
  return (code) => {
    if (cache[code] !== undefined) return cache[code];
    let out = code;
    try { out = (dn && dn.of(code)) || code; } catch (e) { out = code; }
    return (cache[code] = out);
  };
})();

async function loadAll() {
  const [miles, zones, cities, segments, ana] = await Promise.all([
    fetchJson(DATA_FILES.miles),
    fetchJson(DATA_FILES.zones),
    fetchJson(DATA_FILES.cities),
    fetchJson(DATA_FILES.segments),
    fetchJson(DATA_FILES.milesAna),
  ]);

  /* ANA運航便だけで組んだときの表。こちらはシーズンで変わります。 */
  MB.ana = {
    miles: ana.miles,
    milesOneway: ana.milesOneway || {},
    zoneGroup: ana.zoneGroup,
    calendar: ana.calendar,
    seasonNames: ana.meta.seasons,
  };

  MB.miles = miles.miles;
  MB.milesOneway = miles.milesOneway || {};
  MB.upgradeDiff = miles.upgradeDiff || {};
  MB.zones = zones.airports;
  MB.countryZone = zones.countries;
  MB.labels = zones.labels;
  MB.cities = cities.countries;
  MB.regionOrder = cities.regionOrder || [];
  MB.segments = segments.segments;
  MB.airlineNames = segments.meta.airlines || {};
  MB.starCodes = new Set(segments.meta.star || []);
  MB.partnerOnly = new Set(segments.meta.partnerOnly || []);
  /* 吉祥航空はスターアライアンスの「コネクティングパートナー」で、
     加盟社と組み合わせて使えます。単独運航しばりの9社とは別あつかいです。 */
  MB.connecting = new Set(segments.meta.connecting || []);
  MB.ending = segments.meta.ending || {};

  /* 都市名から一発で引ける索引を作る。
     同じ都市名が別の国にあることがあるので（例：サンティアゴ）、
     先に見つかったほうを採り、あとから来たものには国名を付けて別の項目にします。 */
  /* 都市のゾーンの決めかた。
     ★国のゾーンをそのまま当ててはいけません。
       アメリカは ハワイ（Zone 5）と本土（Zone 6）に分かれ、
       ロシアは 沿海地方（2）・ウラル以東（4）・以西（7）の3つに分かれます。
       空港ごとの正しいゾーンは zones.json のほうに入っているので、そちらから決めます。
       ここを国のゾーンで済ませていたころは、ホノルルが北米あつかいになり、
       必要マイル数が 43,000 のところ 55,000 と出ていました。 */
  const zoneOfCity = (iata, fallback) => {
    const count = {};
    iata.forEach((i) => {
      const z = MB.zones[i];
      if (z) count[z] = (count[z] || 0) + 1;
    });
    const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : fallback;
  };

  MB.cityIndex = {};
  MB.countryList = [];
  for (const [cc, info] of Object.entries(MB.cities)) {
    const jaCountry = countryName(cc);
    MB.countryList.push({ code: cc, name: jaCountry, zone: info.zone, region: info.region });
    for (const [row, ] of Object.entries(info.cities).map((e) => [e, 0])) {
      const [name, packed] = row;
      /* 形は [ 空港コード…, 緯度, 経度 ]。うしろの2つが位置です。 */
      const lon = packed[packed.length - 1];
      const lat = packed[packed.length - 2];
      const iata = packed.slice(0, -2);
      const key = MB.cityIndex[name] ? `${name}（${jaCountry}）` : name;
      MB.cityIndex[key] = { name: key, country: cc, countryName: jaCountry,
                            zone: zoneOfCity(iata, info.zone), iata, lat, lon };
      info.cities[name] = packed;    // もとの形は残しておく
      if (key !== name) info.cities[key] = packed;
      if (key !== name) delete info.cities[name];
    }
  }

  /* 国はエリアごとにまとめて並べます。
     エリアの順は data/cities.json の regionOrder（日本→東アジア→…）。
     同じエリアの中は五十音順です。 */
  const regionRank = (r) => {
    const i = MB.regionOrder.indexOf(r);
    return i < 0 ? 99 : i;
  };
  // 漢字ではじまる国名は、読みに置き換えてから並べます（COUNTRY_KANA）
  const kana = (n) => COUNTRY_KANA[n] || n;
  MB.countryList.sort((a, b) => {
    const r = regionRank(a.region) - regionRank(b.region);
    return r !== 0 ? r : kana(a.name).localeCompare(kana(b.name), 'ja');
  });

  return {
    milesSource: miles.meta.source,
    zoneSource: zones.meta.source,
    routeSource: segments.meta.source,
  };
}

/* 選べる都市の一覧を作る。
   used に入っている都市は、もう使われているので外します。 */
function cityOptions({ japanOnly = false, overseasOnly = false, used = [], only = null } = {}) {
  const groups = [];
  for (const c of MB.countryList) {
    if (japanOnly && c.code !== 'JP') continue;
    if (overseasOnly && c.code === 'JP') continue;
    /* 並び順は data/cities.json に書かれている順（五十音順）をそのまま使います。
       ここで並べ直すと、せっかくそろえた順がこわれます。
       日本だけ、よく使う空港を先頭に引き上げます。 */
    let names = Object.keys(MB.cities[c.code].cities).filter((n) => !used.includes(n));
    // only が渡されているときは、そこに入っている街だけにします
    if (only) names = names.filter((n) => only.has(n));
    if (c.code === 'JP') {
      const first = APP.japanFirst.filter((n) => names.includes(n));
      names = [...first, ...names.filter((n) => !first.includes(n))];
    }
    if (names.length) {
      groups.push({ label: c.name, zone: c.zone, region: c.region, cities: names });
    }
  }
  return groups;
}
