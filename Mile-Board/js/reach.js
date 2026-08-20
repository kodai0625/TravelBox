/* ============================================================
 *  行ける先だけを出す
 *
 *  ここまでのつくりは「好きに選ばせて、あとから判定する」でした。
 *  そうすると、選んでみて初めて×が出るので、
 *  「じゃあどこなら行けるの」が分かりません。
 *
 *  この部品は逆をやります。
 *  いま入っている旅程から、その欄に入れられる街だけを先に出します。
 *
 *    出発地と目的地が決まっている → その間に挟める街
 *    出発地と乗継地が決まっている → そこから行ける目的地
 *
 *  見るのは3つです。
 *    ① 便があるか       … 路線データのつながり
 *    ② きまりに合うか   … 目的地より必要マイル数が多い地域は挟めない
 *    ③ 遠回りしすぎないか … 都市の位置から
 * ============================================================ */

/* その旅程で、乗継地に選んでよいゾーンかどうか。 */
function zoneAllowedAsTransit(zone, fromZone, destZone, oneway) {
  if (zone === '1') return true;               // 日本国内はいつでもよい
  const destMiles = milesFor(fromZone, destZone, oneway);
  if (!destMiles) return true;                 // 目的地が決まっていないときは通す
  const m = milesFor(fromZone, zone, oneway);
  return !!m && m.Y <= destMiles.Y;
}

/* 旅程の「行き」「帰り」の並びを、空欄も含めて取り出す。 */
function legChain(trip, leg) {
  const oneway = trip.mode === 'oneway';
  const openjaw = trip.mode === 'openjaw';
  if (leg === 'out') return [trip.from, ...trip.out, trip.dest];
  if (oneway) return [];
  return [openjaw ? trip.ret : trip.dest, ...trip.back, trip.to];
}

/* 指定した欄の、ひとつ前とひとつ後ろの「決まっている街」をさがす。 */
function neighboursInChain(chain, at) {
  let prev = '', next = '';
  for (let i = at - 1; i >= 0; i--) if (chain[i]) { prev = chain[i]; break; }
  for (let i = at + 1; i < chain.length; i++) if (chain[i]) { next = chain[i]; break; }
  return { prev, next };
}

/* いま旅程で使われている街。 */
function citiesInUse(trip, except) {
  const list = [trip.from, trip.dest, ...trip.out];
  if (trip.mode !== 'oneway') list.push(trip.to, ...trip.back);
  if (trip.mode === 'openjaw') list.push(trip.ret);
  return new Set(list.filter((c) => c && c !== except));
}

/* ------------------------------------------------------------
 *  乗継の欄に入れられる街
 *  leg は 'out'（行き）か 'back'（帰り）、index は何番目の乗継か。
 * ---------------------------------------------------------- */
function allowedTransits(trip, leg, index) {
  const fromC = cityInfo(trip.from), destC = cityInfo(trip.dest);
  if (!fromC || !destC) return null;           // まだ決まっていないので絞りません

  const oneway = trip.mode === 'oneway';
  const fromZone = fromC.zone === '1' ? '1-B' : fromC.zone;
  const chain = legChain(trip, leg);
  if (!chain.length) return null;

  const at = index + 1;                        // chain の先頭は出発地なので1つずれます
  const self = chain[at];
  const { prev, next } = neighboursInChain(chain, at);
  if (!prev) return null;

  const used = citiesInUse(trip, self);
  const prevNb = neighbours(prev);
  const nextNb = next ? neighbours(next) : null;

  const out = new Set();
  for (const c of prevNb) {
    if (used.has(c)) continue;
    const info = cityInfo(c);
    if (!info) continue;
    if (nextNb && !nextNb.has(c)) continue;    // その先へ飛べない街は外します
    if (!zoneAllowedAsTransit(info.zone, fromZone, destC.zone, oneway)) continue;
    /* 遠回りの見かた。
       倍率だけで見ると、ブリュッセル→パリ（260km）のような短い区間では
       何を挟んでも倍率が跳ね上がり、候補が0件になってしまいます。
       そこで「倍率がゆるい」か「増えるぶんが1,500kmまで」のどちらかで通します。 */
    if (next) {
      const direct = distanceKm(prev, next);
      const via = pathKm([prev, c, next]);
      const ratioOk = !direct || via / direct <= 2.2;
      const addOk = via - direct <= 1500;
      if (!ratioOk && !addOk) continue;
    }
    out.add(c);
  }
  return out;
}

/* start から、乗り継ぎ hops 回までで行ける街をぜんぶ集める。
   直行だけを見ると「東京から直行便のある60都市」しか出てこず、
   乗り継げば行ける街が候補から消えてしまいます。 */
function reachableWithin(start, hops) {
  const seen = new Set([start]);
  let edge = [start];
  for (let i = 0; i < hops && edge.length; i++) {
    const nextEdge = [];
    for (const c of edge) {
      for (const n of neighbours(c)) {
        if (seen.has(n)) continue;
        seen.add(n);
        nextEdge.push(n);
      }
    }
    edge = nextEdge;
  }
  seen.delete(start);
  return seen;
}

/* ------------------------------------------------------------
 *  目的地の欄に入れられる街
 *  出発地と、行きの乗継地から、たどり着ける先を出します。
 * ---------------------------------------------------------- */
function allowedDestinations(trip) {
  const fromC = cityInfo(trip.from);
  if (!fromC) return null;

  const oneway = trip.mode === 'oneway';
  const fromZone = fromC.zone === '1' ? '1-B' : fromC.zone;
  const outCities = trip.out.filter(Boolean);
  const last = outCities.length ? outCities[outCities.length - 1] : trip.from;
  const used = citiesInUse(trip, trip.dest);

  /* 乗継地の中でいちばん必要マイル数が多い地域。
     目的地はこれ以上でないといけません（公式のきまり）。 */
  let floor = 0;
  for (const c of outCities.concat(trip.back.filter(Boolean))) {
    const info = cityInfo(c);
    if (!info || info.zone === '1') continue;
    const m = milesFor(fromZone, info.zone, oneway);
    if (m && m.Y > floor) floor = m.Y;
  }

  /* 空いている乗継の枠のぶんだけ、乗り継いで行ける先まで見ます。
     枠が全部空いていれば「乗り継ぎ2回まで」で届く街が候補です。 */
  const freeSlots = trip.out.filter((v) => !v).length;
  const hops = Math.min(3, freeSlots + 1);
  const reach = reachableWithin(last, hops);

  // 帰りも同じように、乗り継いで戻れるかを見ます
  const backFixed = trip.back.filter(Boolean);
  const backNext = backFixed.length ? backFixed[0] : trip.to;
  const backFree = trip.back.filter((v) => !v).length;
  const backReach = (!oneway && backNext)
    ? reachableWithin(backNext, Math.min(3, backFree + 1)) : null;

  const out = new Set();
  for (const c of reach) {
    if (used.has(c)) continue;
    const info = cityInfo(c);
    if (!info || info.zone === fromC.zone) continue;
    const m = milesFor(fromZone, info.zone, oneway);
    if (!m || m.Y < floor) continue;
    if (backReach && !backReach.has(c)) continue;
    out.add(c);
  }
  return out;
}

/* 街の集合を、選びやすい順に並べて返す。
   日本語名のもの（＝主要都市）が先、そのなかでは近い順です。 */
function sortCities(set, near) {
  const ja = /[ぁ-んァ-ヶ一-龠]/;
  return [...set].sort((a, b) => {
    const ja1 = ja.test(a) ? 0 : 1, ja2 = ja.test(b) ? 0 : 1;
    if (ja1 !== ja2) return ja1 - ja2;
    if (near) return distanceKm(near, a) - distanceKm(near, b);
    return a.localeCompare(b, 'ja');
  });
}
