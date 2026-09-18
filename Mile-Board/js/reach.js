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
 *                          （1社だけで組むときは、その会社の便だけ）
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

/* その目的地のときに、乗継地として使えるゾーンか。
   判定（rules.js）のうち、ゾーンだけで決まる3つをここでも見ます。
     ・乗換地の必要マイル数が、目的地を上回らない（上の zoneAllowedAsTransit）
     ・乗換地から目的地までが、出発地から目的地までを上回らない
     ・乗換地は、出発地のエリアか目的地のエリアの中
   ★ここが判定より甘いと「行ける」と出したのに組めない、が起きます。
     エティハド航空で東京からロンドンを出していたのがそれでした
     （アブダビは中東で、欧州より必要マイル数が多いので乗り継げません）。 */
function transitZoneOk(zone, fromZone, destZone, oneway) {
  return !transitZoneWhy(zone, fromZone, destZone, oneway);
}

/* 乗り継げない理由。乗り継げるなら空文字。
     dearer … 目的地より必要マイル数が多い地域
     over   … そこから目的地までが、出発地から目的地までより高い
     area   … 出発地とも目的地とも別のエリア
   画面で「なぜ出てこないのか」を言うのにも使います。 */
function transitZoneWhy(zone, fromZone, destZone, oneway) {
  if (zone === '1') return '';                 // 日本国内はいつでもよい
  if (!zoneAllowedAsTransit(zone, fromZone, destZone, oneway)) return 'dearer';
  const destMiles = milesFor(fromZone, destZone, oneway);
  if (destMiles && zone !== destZone) {
    const m = milesFor(zone, destZone, oneway);
    if (m && m.Y > destMiles.Y) return 'over';
  }
  const fromArea = areaOf(String(fromZone).startsWith('1') ? '1' : fromZone);
  const area = areaOf(zone);
  if (area && area !== fromArea && area !== areaOf(destZone)) return 'area';
  return '';
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
function allowedTransits(trip, leg, index, keepUsed) {
  const fromC = cityInfo(trip.from), destC = cityInfo(trip.dest);
  if (!fromC || !destC) return null;           // まだ決まっていないので絞りません

  const oneway = trip.mode === 'oneway';
  const fromZone = fromC.zone === '1' ? '1-B' : fromC.zone;
  const chain = legChain(trip, leg);
  if (!chain.length) return null;

  const at = index + 1;                        // chain の先頭は出発地なので1つずれます
  const { prev, next } = neighboursInChain(chain, at);
  if (!prev) return null;

  /* 外すのは、同じ向きの道すじにもう入っている街だけです（その区間の最初と最後も含む）。
     判定のきまり4と同じで、行きと帰りで同じ街を乗り継ぐのは組めます
     （東京⇒ハノイ⇒パリ／パリ⇒ハノイ⇒東京）。
     ★以前は旅程ぜんぶで使った街を外していたので、行きにハノイを入れると
       帰りにハノイを選べませんでした。1社で組むと拠点が1つのことが多く、困ります。 */
  /* keepUsed のときは外しません。プルダウンで「ハノイ（行きの乗継1）」のように
     選べない形で見せて、国ごと消えないようにするためです（makePicker）。 */
  const used = keepUsed ? new Set() : new Set(chain.filter((c, i) => c && i !== at));
  const carrier = trip.carrier || '';
  const prevNb = neighbours(prev, carrier);
  const nextNb = next ? neighbours(next, carrier) : null;

  const out = new Set();
  for (const c of prevNb) {
    if (used.has(c)) continue;
    const info = cityInfo(c);
    if (!info) continue;
    if (nextNb && !nextNb.has(c)) continue;    // その先へ飛べない街は外します
    if (!transitZoneOk(info.zone, fromZone, destC.zone, oneway)) continue;
    if (next && !detourOk(prev, c, next)) continue;
    out.add(c);
  }
  return out;
}

/* 遠回りしすぎないか。
   倍率だけで見ると、ブリュッセル→パリ（260km）のような短い区間では
   何を挟んでも倍率が跳ね上がり、候補が0件になってしまいます。
   そこで「倍率がゆるい」か「増えるぶんが1,500kmまで」のどちらかで通します。 */
function detourOk(prev, c, next) {
  const direct = distanceKm(prev, next);
  const via = pathKm([prev, c, next]);
  return !direct || via / direct <= 2.2 || via - direct <= 1500;
}

/* 乗継の欄で、便はつながっているのに、きまりで外した街とその理由。
   「フィリピンしか出てこない」のように見えたとき、
   こわれているのではなく、きまりのせいだと画面で言えるようにします。 */
function transitBlocked(trip, leg, index) {
  const fromC = cityInfo(trip.from), destC = cityInfo(trip.dest);
  if (!fromC || !destC) return [];
  const oneway = trip.mode === 'oneway';
  const fromZone = fromC.zone === '1' ? '1-B' : fromC.zone;
  const chain = legChain(trip, leg);
  if (!chain.length) return [];
  const { prev, next } = neighboursInChain(chain, index + 1);
  if (!prev) return [];
  const carrier = trip.carrier || '';
  const nextNb = next ? neighbours(next, carrier) : null;
  const out = [];
  for (const c of neighbours(prev, carrier)) {
    const info = cityInfo(c);
    if (!info || isJapan(c) || (nextNb && !nextNb.has(c))) continue;
    // 遠回りで誰も乗らない街（東京→ストックホルム→バンコクなど）まで挙げても仕方がないので外します
    if (next && !detourOk(prev, c, next)) continue;
    const why = transitZoneWhy(info.zone, fromZone, destC.zone, oneway);
    if (why) out.push({ city: c, why, km: next ? pathKm([prev, c, next]) : distanceKm(prev, c) });
  }
  return out.sort((a, b) => a.km - b.km);     // 近い道すじのものから
}

/* start から、乗り継ぎ hops 回までで行ける街をぜんぶ集める。
   直行だけを見ると「東京から直行便のある60都市」しか出てこず、
   乗り継げば行ける街が候補から消えてしまいます。
   pass を渡すと、途中で乗り継ぐ街はそれに合うものだけにします（行き着く先は問いません）。 */
function reachableWithin(start, hops, carrier, pass) {
  const seen = new Set([start]);
  let edge = [start];
  for (let i = 0; i < hops && edge.length; i++) {
    const nextEdge = [];
    for (const c of edge) {
      for (const n of neighbours(c, carrier)) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (!pass || pass(n)) nextEdge.push(n);
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
function allowedDestinations(trip, keepUsed) {
  const fromC = cityInfo(trip.from);
  if (!fromC) return null;

  const oneway = trip.mode === 'oneway';
  const fromZone = fromC.zone === '1' ? '1-B' : fromC.zone;
  const outCities = trip.out.filter(Boolean);
  const last = outCities.length ? outCities[outCities.length - 1] : trip.from;
  // keepUsed のときは外しません（乗継と同じ理由です）
  const used = keepUsed ? new Set() : citiesInUse(trip, trip.dest);

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
  const carrier = trip.carrier || '';
  const reach = reachableWithin(last, hops, carrier);

  // 帰りも同じように、乗り継いで戻れるかを見ます
  const backFixed = trip.back.filter(Boolean);
  const backNext = backFixed.length ? backFixed[0] : trip.to;
  const backHops = Math.min(3, trip.back.filter((v) => !v).length + 1);

  const needForeign = fromC.zone === '1' &&
    ![...outCities, ...backFixed].some((c) => c && !isJapan(c));

  /* 使える乗継地は目的地のゾーンで変わるので、ゾーンごとに探し直します。
     ゾーンは10ほどしかないので、ここは速いままです。 */
  const byZone = new Map();
  const reachFor = (zone) => {
    if (byZone.has(zone)) return byZone.get(zone);
    const pass = (n) => {
      const i = cityInfo(n);
      return !!i && transitZoneOk(i.zone, fromZone, zone, oneway);
    };
    const r = {
      pass,
      out: reachableWithin(last, hops, carrier, pass),
      back: (!oneway && backNext) ? reachableWithin(backNext, backHops, carrier, pass) : null,
    };
    byZone.set(zone, r);
    return r;
  };

  /* 直行の往復（Zone 1-A）に設定の無い地域（アフリカ・中東、中南米）は、
     行きか帰りのどちらかで、海外で乗り継がないと組めません。
     直行でしか行けない街を出すと「行けると出たのに組めない」になります
     （エティハド航空で東京→アブダビを出していたのがそれでした）。
     すでに海外の乗継地を選んでいれば、この心配はありません。

     乗り継ぎは片道で多くても2回（枠の数から）なので、道を並べて数えます。
     ★途中で目的地そのものや出発地・帰着地は通れません（きまり）。
       これを見ないと「東京→アブダビ→カイロ→アブダビ」を道として数えてしまいます。 */
  const foreignIndex = (start, h, r) => {
    const ok = (n) => n !== trip.from && n !== trip.to && r.pass(n);
    const one = new Set();   // 1回目の乗継地のうち海外のもの
    const two = new Map();   // 2回目の乗継地 → そこへ来られる1回目の乗継地（2つまで覚えます）
    if (h < 2) return { one, two };
    for (const x1 of neighbours(start, carrier)) {
      if (!ok(x1)) continue;
      if (!isJapan(x1)) one.add(x1);
      if (h < 3) continue;
      for (const x2 of neighbours(x1, carrier)) {
        if (x2 === start || !ok(x2)) continue;
        if (isJapan(x1) && isJapan(x2)) continue;     // どちらかは海外でないといけません
        const list = two.get(x2) || [];
        if (list.length < 2 && !list.includes(x1)) { list.push(x1); two.set(x2, list); }
      }
    }
    return { one, two };
  };
  // c のとなりの街から逆にたどって、海外の乗り継ぎを通って来られるかを見ます
  const reachesVia = (idx, c) => {
    for (const x of neighbours(c, carrier)) {
      if (idx.one.has(x)) return true;                      // x で1回乗り継いで c へ
      const pre = idx.two.get(x);
      if (pre && pre.some((x1) => x1 !== c)) return true;   // x1 → x と2回乗り継いで c へ
    }
    return false;
  };
  const viaForeignOk = (c, r) => {
    if (!r.fo) {
      r.fo = foreignIndex(last, hops, r);
      r.fb = (!oneway && backNext) ? foreignIndex(backNext, backHops, r) : null;
    }
    return reachesVia(r.fo, c) || (!!r.fb && reachesVia(r.fb, c));
  };

  const out = new Set();
  for (const c of reach) {
    if (used.has(c)) continue;
    const info = cityInfo(c);
    /* 出発地と同じ国は選べません（判定の「目的地は出発地と別の国」と同じ）。
       ★以前は同じゾーンをまるごと外していたので、
         フランクフルト→ローマのような欧州の中の旅程が出てきませんでした。 */
    if (!info || (info.zone === fromC.zone && info.country === fromC.country)) continue;
    const m = milesFor(fromZone, info.zone, oneway);
    if (!m || m.Y < floor) continue;
    const r = reachFor(info.zone);
    if (!r.out.has(c)) continue;
    if (r.back && !r.back.has(c)) continue;
    if (needForeign && !milesFor('1-A', info.zone, oneway) && !viaForeignOk(c, r)) continue;
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
