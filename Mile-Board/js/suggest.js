/* ============================================================
 *  行き方をこちらから出す
 *
 *  目的地を選んだあと、「どこを経由できるんだっけ」を
 *  いちいち思い出さなくて済むように、
 *  成り立つ道すじをこちらから並べます。
 *
 *  やっていることは道さがしです。
 *    ・区間のデータから「街と街のつながり」の地図を作る
 *    ・出発地から目的地まで、実際に便がある道だけをたどる
 *    ・きまりに合わないものは judge() で落とす
 *
 *  ですので「表にある組み合わせを引く」のではなく、
 *  そのとき持っている路線データの上で、本当に飛べる道を出します。
 * ============================================================ */

/* 2つの街のあいだの、だいたいの距離（km）。
   地球を丸いものとして計算します（大圏距離）。 */
function distanceKm(a, b) {
  const A = cityInfo(a), B = cityInfo(b);
  if (!A || !B || A.lat == null || B.lat == null) return 0;
  const R = 6371, rad = Math.PI / 180;
  const dLat = (B.lat - A.lat) * rad;
  const dLon = (B.lon - A.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(A.lat * rad) * Math.cos(B.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* 道すじの長さ（乗り継ぎをぜんぶ足した距離）。 */
function pathKm(cities) {
  let sum = 0;
  for (let i = 0; i < cities.length - 1; i++) sum += distanceKm(cities[i], cities[i + 1]);
  return sum;
}

/* ★どれだけ遠回りか。1.0 なら直行と同じ、2.0 なら倍の距離です。
   これを見ないと「東京→オークランド→ニューヨーク→パリ」のような、
   きまりの上は通るけれど誰も乗らない道が出てきます。

   ただし、近い行き先ほど遠回りの率は大きく出ます。
   東京→シドニーをバンコク経由にすると、それだけで1.5倍を超えます。
   そこで、まず厳しく探して、足りなければ少しずつゆるめます。 */
const DETOUR_STEPS = [1.5, 1.9, 2.5];

function detour(start, legs, goal) {
  const direct = distanceKm(start, goal);
  if (!direct) return 1;
  return pathKm([start, ...legs, goal]) / direct;
}

/* 街と街のつながり。都市名 → その街から直行便がある街の集合。 */
let CITY_GRAPH = null;

function buildCityGraph() {
  if (CITY_GRAPH) return CITY_GRAPH;
  // 空港コード → 都市名 の逆引きを先に作ります
  const cityOf = {};
  for (const [name, info] of Object.entries(MB.cityIndex)) {
    info.iata.forEach((i) => { cityOf[i] = name; });
  }
  const g = new Map();
  const link = (a, b) => {
    if (!g.has(a)) g.set(a, new Set());
    g.get(a).add(b);
  };
  for (const key of Object.keys(MB.segments)) {
    const [x, y] = key.split('-');
    const a = cityOf[x], b = cityOf[y];
    if (!a || !b || a === b) continue;
    link(a, b);
    link(b, a);
  }
  CITY_GRAPH = g;
  return g;
}

function neighbours(city) {
  return buildCityGraph().get(city) || new Set();
}

/* 乗継地に選んでよい街をしぼる。
   ・目的地より必要マイル数が多い地域は選べません（公式のきまり）
   ・日本語の名前が付いている街だけにします。
     もとの空港データに日本語名があるのは主要都市だけなので、
     ここを絞ると「知らない小さな町」が候補に出てこなくなります。 */
function transitCandidates(fromZone, destZone, oneway) {
  const destMiles = milesFor(fromZone, destZone, oneway);
  const okZone = new Map();
  const allowed = (zone) => {
    if (okZone.has(zone)) return okZone.get(zone);
    let ok = false;
    if (zone === '1') ok = true;                       // 日本国内はいつでもよい
    else if (destMiles) {
      const m = milesFor(fromZone, zone, oneway);
      ok = !!m && m.Y <= destMiles.Y;
    }
    okZone.set(zone, ok);
    return ok;
  };
  const ja = /[ぁ-んァ-ヶ一-龠]/;
  const list = [];
  for (const [name, info] of Object.entries(MB.cityIndex)) {
    if (!ja.test(name)) continue;
    if (!allowed(info.zone)) continue;
    if (!neighbours(name).size) continue;
    list.push(name);
  }
  return new Set(list);
}

/* 片道ぶんの道すじをさがす。
   start から goal まで、乗継を最大 maxTransit 個はさんで行ける道を集めます。 */
function findLegs(start, goal, cand, maxTransit, avoid, limit, maxDetour) {
  const found = [];
  const seen = new Set();
  const goalNb = neighbours(goal);
  const startNb = neighbours(start);

  const push = (path) => {
    const key = path.join('>');
    if (seen.has(key)) return false;
    seen.add(key);
    found.push(path);
    return true;
  };
  const usable = (c) => cand.has(c) && !avoid.has(c) && c !== goal && c !== start;

  /* ★深いほうから先にさがします。
     浅いほう（乗継なし・1つ）から集めると、上限に先に当たってしまい、
     いちばん出したい「2都市を回る案」までたどり着けません。 */

  // 乗継2つ
  if (maxTransit >= 2) {
    let n = 0;
    for (const t1 of startNb) {
      if (n >= limit * 3) break;
      if (!usable(t1)) continue;
      for (const t2 of neighbours(t1)) {
        if (!usable(t2) || t2 === t1) continue;
        if (!goalNb.has(t2)) continue;
        if (detour(start, [t1, t2], goal) > maxDetour) continue;
        if (push([t1, t2])) n++;
        if (n >= limit * 3) break;
      }
    }
  }

  // 乗継1つ
  if (maxTransit >= 1) {
    let n = 0;
    for (const t1 of startNb) {
      if (n >= limit * 2) break;
      if (!usable(t1) || !goalNb.has(t1)) continue;
      if (detour(start, [t1], goal) > maxDetour) continue;
      if (push([t1])) n++;
    }
  }

  // 乗継なし
  if (startNb.has(goal)) push([]);

  return found;
}

/* 並べ替えの物差し。
   周遊が目当てなので寄れる街が多いほうを上に、
   同じ数なら遠回りの少ないほうを上にします。 */
function legScore(leg, start, goal) {
  const fg = leg.filter((c) => !isJapan(c)).length;
  return fg * 100 + leg.length * 10 - detour(start, leg, goal) * 3;
}

/* 行き方の案を作ります。 */
function suggestRoutes(trip, count) {
  const fromC = cityInfo(trip.from), destC = cityInfo(trip.dest);
  if (!fromC || !destC) return [];
  const oneway = trip.mode === 'oneway';
  const openjaw = trip.mode === 'openjaw';
  if (openjaw) return [];      // オープンジョーは帰りの出発地を自分で決めるので出しません

  const maxT = Math.min(2, RULE.transitSlots);   // 海外は片道2都市まで
  const cand = transitCandidates(fromC.zone === '1' ? '1-B' : fromC.zone,
                                 destC.zone, oneway);
  const fixed = new Set([trip.from, trip.dest, trip.to].filter(Boolean));

  const plans = [];
  const usedFirst = new Set();   // 最初の乗継地がかぶらないようにして、変化をつけます

  /* まず厳しい遠回り率で探し、足りなければゆるめて探し直します。 */
  for (const maxDetour of DETOUR_STEPS) {
    if (plans.length >= count) break;

    const outs = findLegs(trip.from, trip.dest, cand, maxT, fixed, count, maxDetour)
      .sort((a, b) => legScore(b, trip.from, trip.dest) - legScore(a, trip.from, trip.dest));

    for (const out of outs) {
      if (plans.length >= count) break;
      if (out.length && usedFirst.has(out[0])) continue;

      let back = [];
      if (!oneway) {
        const avoid = new Set([...fixed, ...out]);
        const backs = findLegs(trip.dest, trip.to, cand, maxT, avoid, count, maxDetour)
          .sort((a, b) => legScore(b, trip.dest, trip.to) - legScore(a, trip.dest, trip.to));
        if (!backs.length) continue;
        back = backs[0];
      }

      // 24時間以上とまる街は、海外の乗継地の中からいちばん遠いものにします
      const foreign = [...out, ...back].filter((c) => !isJapan(c));
      let stopover = '';
      if (foreign.length) {
        stopover = foreign.reduce((best, c) => {
          const m = milesFor('1-B', cityInfo(c).zone, oneway);
          const bm = best ? milesFor('1-B', cityInfo(best).zone, oneway) : null;
          return (!bm || (m && m.Y > bm.Y)) ? c : best;
        }, '');
      }

      const cand2 = Object.assign({}, trip, {
        out: [...out, ...Array(RULE.transitSlots - out.length).fill('')],
        back: [...back, ...Array(RULE.transitSlots - back.length).fill('')],
        stopover,
      });
      const r = judge(cand2);
      if (!r.ok) continue;        // きまりに合わないものはここで落ちます

      // 同じ道すじを二度出さない
      const key = [...out, '|', ...back].join('>');
      if (plans.some((p) => [...p.out, '|', ...p.back].join('>') === key)) continue;

      if (out.length) usedFirst.add(out[0]);
      const km = Math.round(pathKm([trip.from, ...out, trip.dest, ...back, trip.to]));
      const direct = Math.round(distanceKm(trip.from, trip.dest) * (oneway ? 1 : 2));
      plans.push({
        out, back, stopover,
        miles: r.miles,
        cities: [...out, ...back].length,
        segCount: r.segCount,
        zone: r.fromZone,
        km,
        // 直行で往復したときの何倍か。1.6を超えたら「遠回り」と出します
        detour: direct ? km / direct : 1,
      });
    }
  }
  return plans;
}
