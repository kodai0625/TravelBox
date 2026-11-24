/* ============================================================
 *  ANA国内線特典航空券（2026-11-24 から）
 *
 *  出発地も目的地も日本のときは、提携航空会社特典航空券ではなく
 *  「ANA国内線特典航空券」という別の商品になります。きまりも必要マイル数も別物です。
 *  判定（rules.js の judge）は、そのときこちらの judgeDomestic に任せます。
 *
 *  もとにしたのは ANA 公式の3ページです（2026年5月19日搭乗分からの決まり）。
 *    ご利用条件           https://www.ana.co.jp/ja/jp/guide/amc/award/domestic/usage/
 *    シーズン・必要マイル https://www.ana.co.jp/ja/jp/guide/amc/award/domestic/terms/
 *    お申し込み方法       https://www.ana.co.jp/ja/jp/guide/amc/award/domestic/reservation/
 *  データ（data/domestic.json）は tools/build_domestic.py が公式ページから作り、検算しています。
 *
 *  入れてあるきまり
 *    ・直行（1区間）は、路線ごとに決まった距離の段（4段）× シーズン（L・R・H）
 *    ・乗り継ぎ（2区間）は、ANA が決めた組（発着地・経由地・発着地）だけ。値は組ごとに1つ
 *      （区間ごとの足し算ではありません）。24時間以内、途中降機なし、行き・帰り各1回まで
 *    ・往復は行きと帰りの足し算（割引なし）。出発地と最終帰着地は同じ都市
 *    ・オープンジョーは、地上を移動する距離が、行き・帰りの長いほうより短いこと
 *    ・シーズンは、行き・帰りそれぞれの最初の区間の搭乗日で決まる
 *    ・予約は搭乗日の355日前の午前9時（日本時間）から、搭乗の前日まで。空席待ちはできない
 *    ・座席はエコノミーだけ（プレミアムクラスの特典はない）
 * ============================================================ */

const DOM_SEASON_NAME = { L: 'ローシーズン', R: 'レギュラーシーズン', H: 'ハイシーズン' };
const DOM_LINKS = {
  terms: 'https://www.ana.co.jp/ja/jp/guide/amc/award/domestic/terms/',
  usage: 'https://www.ana.co.jp/ja/jp/guide/amc/award/domestic/usage/',
};

/* data.js が読み込んだあとに1回だけ呼び、引きやすい形を作ります。 */
function domPrepare(d) {
  const nb = new Map();
  const add = (a, b) => { if (!nb.has(a)) nb.set(a, new Set()); nb.get(a).add(b); };
  for (const k of Object.keys(d.direct)) { const [a, b] = k.split('|'); add(a, b); add(b, a); }
  const via = new Map();      // 'A|B'（並べ替えたもの）→ 経由地の集合
  const ends = new Map();     // 都市 → 乗り継ぎで行ける先の集合
  for (const k of Object.keys(d.connect)) {
    const [x, v, y] = k.split('|');
    const key = `${x}|${y}`;
    if (!via.has(key)) via.set(key, new Set());
    via.get(key).add(v);
    if (!ends.has(x)) ends.set(x, new Set());
    if (!ends.has(y)) ends.set(y, new Set());
    ends.get(x).add(y); ends.get(y).add(x);
  }
  return Object.assign(d, { nb, via, ends });
}

function domOn() { return !!MB.dom; }
function domCity(name) { return (MB.dom && MB.dom.cities[name]) || null; }
function domDirect(a, b) { return MB.dom.direct[[a, b].sort().join('|')] || null; }
function domConnect(a, v, b) {
  const [x, y] = [a, b].sort();
  return MB.dom.connect[`${x}|${v}|${y}`] || null;
}
function domVias(a, b) { return MB.dom.via.get([a, b].sort().join('|')) || new Set(); }
function domBand(key) { return MB.dom.bands.find((b) => b.key === key) || null; }
function domSeason(d) {
  if (!d || !MB.dom) return null;
  for (const k of ['L', 'R', 'H']) {
    for (const [a, b] of MB.dom.seasons[k]) if (d >= a && d <= b) return k;
  }
  return null;
}

/* 旅程が国内線特典になるか（出発地も目的地も日本） */
function isDomesticTrip(t) {
  return domOn() && !!t.from && !!t.dest && isJapan(t.from) && isJapan(t.dest);
}

/* 予約を受け付けてもらえる期間（区間の搭乗日ごと）。
   公式：「ご搭乗日の355日前（ご出発日含まず）午前9時（日本時間）からご搭乗前日まで」 */
function domBooking(dateStr) {
  if (!dateStr) return null;
  const day = new Date(`${dateStr}T00:00:00+09:00`);
  if (isNaN(day)) return null;
  const opens = new Date(day.getTime() - BOOKING.openDaysBefore * DAY_MS + BOOKING.openHourJst * 3600000);
  const closes = day;    // 前日いっぱいまで
  const now = new Date();
  return { opens, closes, state: now < opens ? 'early' : (now >= closes ? 'late' : 'open') };
}

const kmToMi = (km) => km / 1.609344;

/* ------------------------------------------------------------
 *  判定
 * ---------------------------------------------------------- */
function judgeDomestic(trip) {
  const errors = [], notes = [];
  const mode = trip.mode || 'roundtrip';
  const oneway = mode === 'oneway', openjaw = mode === 'openjaw';
  const out = (trip.out || []).filter(Boolean);
  const back = oneway ? [] : (trip.back || []).filter(Boolean);
  const { from, dest } = trip;
  const to = oneway ? '' : trip.to;
  const ret = openjaw ? (trip.ret || '') : dest;
  const outLeg = [from, ...out, dest];
  const backLeg = oneway ? [] : [ret, ...back, to];
  const all = [...outLeg, ...backLeg].filter(Boolean);

  /* 1. 日本の中だけ */
  const abroad = [...new Set(all.filter((c) => !isJapan(c)))];
  if (abroad.length) {
    errors.push(`国内線特典航空券は日本国内だけで使えます。${abroad.join('・')} は日本の外です。` +
                '海外へ行くときは、目的地を海外の都市にしてください。');
  }
  /* 2. ANA国内線特典の路線に出てくる空港か */
  const notDom = [...new Set(all.filter((c) => isJapan(c) && !domCity(c)))];
  if (notDom.length) {
    errors.push(`${notDom.join('・')} は、ANA国内線特典航空券の路線の一覧に出てこない空港です。`);
  }
  /* 3. 目的地 */
  if (from === dest) errors.push('目的地は出発地と別の都市にしてください。');
  /* 4. 往復は出発地と最終帰着地が同じ都市（公式） */
  if (!oneway && to && to !== from) {
    errors.push(`国内線特典の往復は、出発地と最終帰着地を同じ都市にしてください（今 ${from} と ${to}）。`);
  }
  /* 5. 乗り継ぎは行き・帰り各1回まで（公式） */
  if (out.length > 1) errors.push(`国内線特典の乗り継ぎは、行き・帰りそれぞれ1回までです（行きが今${out.length}回）。`);
  if (back.length > 1) errors.push(`国内線特典の乗り継ぎは、行き・帰りそれぞれ1回までです（帰りが今${back.length}回）。`);
  if (!oneway && trip.date && trip.dateBack && trip.dateBack < trip.date) {
    errors.push('帰りの搭乗日が、行きの搭乗日より前になっています。');
  }
  /* 6. 途中降機はできない */
  if (trip.stopover) {
    notes.push('国内線特典では、乗り継ぐ街で24時間を超えてとまる（途中降機）ことはできません。「24時間以上とまる街」は数えていません。');
  }

  /* 7. 行き・帰りそれぞれの段 */
  const ready = !abroad.length && !notDom.length;
  const legBand = (leg, name) => {
    if (!ready || leg.length < 2 || leg.length > 3) return null;
    if (leg.length === 2) {
      const k = domDirect(leg[0], leg[1]);
      if (!k) {
        const v = [...domVias(leg[0], leg[1])];
        errors.push(`${name}${leg[0]}–${leg[1]} は、ANA国内線特典の直行の路線にありません。` +
                    (v.length ? `乗り継ぎで行くなら、乗継地は ${v.join('・')} です。` : ''));
      }
      return k;
    }
    const k = domConnect(leg[0], leg[1], leg[2]);
    if (!k) {
      const v = [...domVias(leg[0], leg[2])];
      errors.push(`${name}${leg.join('→')} は、ANA が決めた乗り継ぎの組にありません。` +
                  '国内線特典の乗り継ぎは、決められた組だけ使えます。' +
                  (v.length ? `${leg[0]}–${leg[2]} の乗継地は ${v.join('・')} です。`
                            : (domDirect(leg[0], leg[2]) ? `${leg[0]}–${leg[2]} は直行便で行けます。` : '')));
    }
    return k;
  };
  const outBand = legBand(outLeg, oneway ? '' : '行きの ');
  const backBand = oneway ? null : legBand(backLeg, '帰りの ');

  /* 8. オープンジョー：地上の移動が、行き・帰りの長いほうの距離より短いこと（公式）。
        公式の距離は TPM（運賃計算に使う距離）ですが、ここでは都市の位置からの目安で見ます。 */
  if (openjaw && ret) {
    if (ret === dest) {
      errors.push('オープンジョーは、行きの到着地と帰りの出発地を別の都市にしてください。');
    } else if (ready) {
      const ground = distanceKm(dest, ret), longer = Math.max(pathKm(outLeg), pathKm(backLeg));
      if (ground >= longer) {
        errors.push(`${dest} から ${ret} への地上の移動（約${Math.round(kmToMi(ground))}マイル）が、` +
                    `行き・帰りの長い方（約${Math.round(kmToMi(longer))}マイル）より長いので、往復になりません（公式のきまり）。`);
      } else {
        notes.push(`${dest} から ${ret} へは自分で移動します（特典に含まれません）。` +
                   '地上の移動は、行き・帰りの長い方の飛行距離より短いことが条件です（ここでは距離を目安で見ています）。');
      }
    }
  }

  /* 9. 必要マイル数（エコノミーだけ） */
  const bands = [outBand, backBand].filter(Boolean);
  const need = oneway ? 1 : 2;
  const bySeason = bands.length === need
    ? Object.fromEntries(['L', 'R', 'H'].map((s) => [s, bands.reduce((n, k) => n + domBand(k).miles[s], 0)]))
    : null;
  const sOut = domSeason(trip.date);
  const sBack = oneway ? null : domSeason(trip.dateBack || trip.date);
  let miles = null;
  if (bySeason && sOut && (oneway || sBack)) {
    miles = { Y: domBand(outBand).miles[sOut] + (oneway ? 0 : domBand(backBand).miles[sBack]) };
  }
  const range = MB.dom.meta.seasonRange;
  if (trip.date && !sOut) notes.push(`行きの搭乗日のシーズンは、ANA公式にまだ出ていません（載っているのは ${range[0]} 〜 ${range[1]}）。`);
  if (!oneway && trip.dateBack && !sBack) notes.push('帰りの搭乗日のシーズンは、ANA公式にまだ出ていません。');

  /* 10. 予約を受け付けてもらえる期間（区間の搭乗日ごと） */
  const bOut = domBooking(trip.date);
  const bBack = oneway ? null : domBooking(trip.dateBack || '');
  if (bOut) {
    if (bOut.state === 'early') notes.push(`行きの予約が始まるのは ${jstText(bOut.opens, true)}（日本時間）です。`);
    else if (bOut.state === 'late') notes.push('行きの搭乗日の前日を過ぎたので、もう予約できません。');
    if (bBack && bBack.state === 'early' && bOut.state === 'open') {
      notes.push(`帰りの予約が始まるのは ${jstText(bBack.opens, true)}（日本時間）です。` +
                 '往復をまとめて取るならそれまで待つか、行きと帰りを別々に取ります（公式）。');
    }
  }
  if (bOut && bOut.state === 'open' && (!bBack || bBack.state === 'open')) {
    notes.push('今予約できる期間です（搭乗日の355日前の午前9時から、搭乗の前日まで）。');
  }
  notes.push('国内線特典は空席待ちができません。全区間の席が取れていることが要ります。');

  /* 11. 区間 */
  const segments = [];
  const push = (leg) => {
    for (let i = 0; i < leg.length - 1; i++) {
      const b = leg[i + 1];
      const stay = i + 1 < leg.length - 1 ? '24時間以内' : (b === dest ? '目的地' : '');
      segments.push({ from: leg[i], to: b, stay, airlines: ['NH'] });
    }
  };
  push(outLeg);
  if (openjaw && ret && ret !== dest) segments.push({ from: dest, to: ret, stay: '', airlines: [], gap: true });
  push(backLeg);

  return {
    ready: true, ok: !errors.length, mode, domestic: true,
    errors, notes,
    fromZone: '国内', isJapanOrigin: true, destZone: '1', destLabel: '日本',
    miles, milesNote: '', milesBase: null, anaOnly: null,
    domMiles: bySeason, domSeasons: { out: sOut, back: sBack }, domBands: { out: outBand, back: backBand },
    segments, segCount: segments.filter((s) => !s.gap).length,
    booking: bOut,
    transit: { out: { jp: out.length, fg: 0 }, back: { jp: back.length, fg: 0 } },
  };
}

/* ------------------------------------------------------------
 *  行けるところだけ出す（国内線）
 * ---------------------------------------------------------- */

/* 日本発で、目的地に入れられる日本の街 */
function domDestinations(trip) {
  if (!domOn() || !isJapan(trip.from) || !domCity(trip.from) || trip.carrier) return new Set();
  const out = (trip.out || []).filter(Boolean);
  const back = trip.mode === 'oneway' ? [] : (trip.back || []).filter(Boolean);
  if (out.length > 1 || back.length > 1 || [...out, ...back].some((c) => !isJapan(c))) return new Set();
  let cand;
  if (out.length) {
    cand = new Set([...(MB.dom.ends.get(trip.from) || [])].filter((b) => domConnect(trip.from, out[0], b)));
  } else {
    cand = new Set([...(MB.dom.nb.get(trip.from) || []), ...(MB.dom.ends.get(trip.from) || [])]);
  }
  // 帰りに乗継地が決まっていれば、その組で帰れる街だけ
  if (back.length && trip.to) {
    cand = new Set([...cand].filter((c) => domConnect(c, back[0], trip.to)));
  }
  cand.delete(trip.from);
  return cand;
}

/* 国内線の旅程で、乗継の欄に入れられる街（決められた組の経由地だけ） */
function domTransits(trip, leg, index) {
  if (index > 0) return new Set();          // 国内線特典の乗り継ぎは各1回まで
  const a = leg === 'out' ? trip.from : (trip.mode === 'openjaw' ? trip.ret : trip.dest);
  const b = leg === 'out' ? trip.dest : trip.to;
  if (!a || !b) return null;
  return new Set(domVias(a, b));
}

/* 道さがし（国内線）：直行と、決められた乗継地をそのまま並べます */
function domSuggest(trip) {
  const a = trip.from, b = trip.dest;
  const oneway = trip.mode === 'oneway';
  const opts = [];
  if (domDirect(a, b)) opts.push([]);
  for (const v of domVias(a, b)) opts.push([v]);
  const plans = [];
  for (const o of opts) {
    const t = Object.assign({}, trip, {
      out: [...o, '', '', ''].slice(0, RULE.transitSlots),
      back: oneway ? ['', '', ''] : [...[...o].reverse(), '', '', ''].slice(0, RULE.transitSlots),
      stopover: '',
    });
    const r = judgeDomestic(t);
    if (!r.ok) continue;
    const path = oneway ? [a, ...o, b] : [a, ...o, b, ...[...o].reverse(), trip.to || a];
    const km = Math.round(pathKm(path));
    const direct = Math.round(distanceKm(a, b) * (oneway ? 1 : 2));
    plans.push({
      out: o, back: oneway ? [] : [...o].reverse(), stopover: '',
      miles: null, domMiles: r.domMiles,
      cities: o.length * (oneway ? 1 : 2), segCount: r.segCount, zone: '国内',
      km, detour: direct ? km / direct : 1,
    });
  }
  return plans;
}
