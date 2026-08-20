/* ============================================================
 *  きまりの判定
 *
 *  画面のことは一切知りません。旅程を渡すと、
 *  「組めるかどうか」と「必要マイル数」を返すだけの部品です。
 *  画面を作る処理は app.js にあります。
 *
 *  もとにしたきまり：
 *    ANA公式「提携航空会社特典航空券 ご利用条件」
 *    https://www.ana.co.jp/ja/jp/guide/amc/award/tk/usage/
 * ============================================================ */

const MB = {
  miles: {},      // "1-A|7" → { Y:55000, C:115000, F:190000 }（往復）
  milesOneway: {},
  zones: {},      // 空港コード → ゾーン番号
  countryZone: {},
  labels: {},     // ゾーン番号 → 「欧州・ロシア2」
  cities: {},     // 国コード → { zone, cities:{ 都市名:[空港コード…] } }
  segments: {},   // "CDG-SIN" → ["SQ"]
  airlineNames: {},
  cityIndex: {},  // 都市名 → { country, zone, iata:[…] }
};

/* 旅程の形。画面のボタンと合わせてあります。 */
const MODES = {
  roundtrip: { label: '往復',        desc: '出発地へ帰ってくる' },
  openjaw:   { label: 'オープンジョー', desc: '行きの到着地と帰りの出発地が別' },
  oneway:    { label: '片道',        desc: '帰りは組まない' },
};

/* 都市名からその都市のことを引く。知らない都市なら null。 */
function cityInfo(name) {
  return MB.cityIndex[name] || null;
}

function isJapan(name) {
  const c = cityInfo(name);
  return !!c && c.zone === '1';
}

/* 2つの都市のあいだを飛んでいる会社を返す。
   都市に空港が複数あるので（東京なら羽田と成田）、
   すべての組み合わせを調べて、見つかった会社をまとめます。 */
function airlinesBetween(a, b) {
  const A = cityInfo(a), B = cityInfo(b);
  if (!A || !B) return [];
  const found = new Set();
  for (const x of A.iata) {
    for (const y of B.iata) {
      (MB.segments[[x, y].sort().join('-')] || []).forEach((c) => found.add(c));
    }
  }
  return [...found].sort();
}

/* 必要マイル数を引く。fromZone は日本発なら '1-A' か '1-B'、海外発ならゾーン番号。 */
function milesFor(fromZone, destZone, oneway) {
  const table = oneway ? MB.milesOneway : MB.miles;
  // 表は「日本⇔欧州」のように片側からしか載っていないことがあるので、
  // 見つからなければ逆からも引きます。
  return table[`${fromZone}|${destZone}`] || table[`${destZone}|${fromZone}`] || null;
}

/* 搭乗日から、その旅程のシーズンを決める。
   シーズンの区切りは行き先によって3組に分かれているので、
   目的地のゾーンから、どの組の暦を見るかを選びます。
   日が入っていない、または暦の載っていない年なら null です。 */
function seasonOf(date, destZone) {
  if (!date || !MB.ana) return null;
  const group = MB.ana.zoneGroup[destZone];
  const year = date.slice(0, 4);
  const cal = group && MB.ana.calendar[group] && MB.ana.calendar[group][year];
  if (!cal) return null;
  for (const key of ['L', 'R', 'H']) {
    for (const [from, to] of cal[key]) {
      if (date >= from && date <= to) return key;
    }
  }
  return null;
}

/* ANA運航便だけで組めるか、組めるならいくらか。

   この特典には2つの表があります。
     ・スタアラ便が1便でも入る → 提携航空会社特典航空券（シーズンなし）
     ・ANA運航便だけ           → ANA国際線特典航空券（シーズンあり）
   どちらが安いかは、シーズンと行き先でひっくり返ります。
   ハイシーズンの欧州ビジネスだと、スタアラ便を混ぜたほうが
   59,000マイルも安くなります。 */
function anaOnlyPlan(segments, destZone, fromZone, date, oneway) {
  if (fromZone !== '1' && !String(fromZone).startsWith('1-')) return null;  // 日本発だけ
  const flights = segments.filter((s) => !s.gap);
  if (!flights.length) return null;

  const noAna = flights.filter((s) => !s.airlines.includes('NH'));
  const season = seasonOf(date, destZone);
  const table = oneway ? MB.ana.milesOneway : MB.ana.miles;
  const row = table[`1|${destZone}`];
  const order = { L: 0, R: 1, H: 2 };

  let miles = null;
  if (row && season) {
    miles = {};
    for (const [cls, v] of Object.entries(row)) {
      if (v[order[season]] != null) miles[cls] = v[order[season]];
    }
  }
  return {
    possible: noAna.length === 0,
    noAna: noAna.map((s) => `${s.from}→${s.to}`),
    season,
    seasonName: season ? MB.ana.seasonNames[season] : '',
    miles,
    hasChart: !!row,
  };
}

/* そのゾーンがどのエリアに属するか。 */
function areaOf(zone) {
  for (const [area, list] of Object.entries(AREAS)) {
    if (list.includes(zone)) return area;
  }
  return null;
}

/* 2つの都市が「同じ国」とみなせるか。
   公式のきまりで、いくつかの国はまとめて1つの国として扱われます。 */
function sameCountry(a, b, allInEurope) {
  if (!a || !b) return false;
  if (a.country === b.country) return true;
  // アメリカ合衆国とカナダは同一国とみなします
  if (SAME_COUNTRY.usCanada.includes(a.country) &&
      SAME_COUNTRY.usCanada.includes(b.country)) return true;
  // ヨーロッパも同一国とみなします。
  // ただし「ヨーロッパ内だけで完結する旅程」のときは、この扱いは使えません。
  if (a.zone === '7' && b.zone === '7' && !allInEurope) return true;
  return false;
}

/* ------------------------------------------------------------
 *  本体
 *
 *  trip = {
 *    mode:  'roundtrip' | 'openjaw' | 'oneway',
 *    from:  '東京',            出発地
 *    out:   ['台北','', ''],   往路の乗継地（空文字は未指定）
 *    dest:  'パリ',            目的地（＝往路の到着地）
 *    ret:   'ミラノ',          復路の出発地。オープンジョーのときだけ使う
 *    back:  ['バンコク','',''],復路の乗継地
 *    to:    '東京',            帰着地
 *    stopover: 'バンコク',     24時間以上とまる都市（目的地以外に1つ）
 *  }
 * ---------------------------------------------------------- */
function judge(trip) {
  const errors = [];   // これがあると組めません
  const notes = [];    // 組めるけれど知っておいてほしいこと

  const mode = trip.mode || 'roundtrip';
  const oneway = mode === 'oneway';
  const openjaw = mode === 'openjaw';

  const out = (trip.out || []).filter(Boolean);
  const back = oneway ? [] : (trip.back || []).filter(Boolean);
  const { from, dest } = trip;
  const to = oneway ? '' : trip.to;
  const ret = openjaw ? (trip.ret || '') : dest;   // 復路の出発地

  /* --- まず、そろっているか --- */
  if (!from) errors.push('出発地を選んでください。');
  if (!dest) errors.push('目的地を選んでください。');
  if (!oneway && !to) errors.push('帰着地を選んでください。');
  if (openjaw && !ret) errors.push('帰りの出発地を選んでください。');
  if (errors.length) return { ok: false, errors, notes, ready: false, mode };

  const fromC = cityInfo(from), destC = cityInfo(dest);
  const toC = oneway ? null : cityInfo(to);
  const retC = cityInfo(ret);
  if (!fromC || !destC || (!oneway && !toC) || !retC) {
    errors.push('この特典で乗れる会社が就航していない都市が入っています。');
    return { ok: false, errors, notes, ready: false, mode };
  }

  /* 旅程ぜんぶの都市。オープンジョーは目的地と帰りの出発地が別なので、
     地上を移動するぶんは区間としてつなぎません。 */
  const outLeg = [from, ...out, dest];
  const backLeg = oneway ? [] : [ret, ...back, to];
  const all = [...outLeg, ...backLeg];

  /* --- 1. 出発地と帰着地は同じ国 --- */
  //  ヨーロッパ内だけで完結する旅程のときは、ヨーロッパをひとまとめにできません
  const allInEurope = all.every((c) => (cityInfo(c) || {}).zone === '7');
  if (!oneway && from !== to && !sameCountry(fromC, toC, allInEurope)) {
    errors.push(`出発地の ${from} と帰着地の ${to} は別の国です。出発地と帰着地は同じ国にしてください。`);
  }

  /* --- 2. 目的地は出発地と別のところ --- */
  if (destC.zone === fromC.zone && destC.country === fromC.country) {
    errors.push('目的地は、出発地と別の国にしてください。');
  }

  /* --- 3. オープンジョーは同じエリアの中だけ --- */
  if (openjaw) {
    if (ret === dest) {
      errors.push('オープンジョーは、行きの到着地と帰りの出発地を別の都市にしてください。');
    } else if (areaOf(destC.zone) !== areaOf(retC.zone)) {
      errors.push(`${dest}（${MB.labels[destC.zone]}）と ${ret}（${MB.labels[retC.zone]}）は別のエリアです。行きの到着地と帰りの出発地は同じエリアの中にしてください。`);
    }
  }

  /* --- 4. 同じ都市を2回使わない --- */
  const seen = new Map();
  all.forEach((c) => seen.set(c, (seen.get(c) || 0) + 1));
  const allowTwice = (c) => (c === from && c === to ? 2 : (!openjaw && c === dest ? 2 : 1));
  const dup = [...seen.entries()].filter(([c, n]) => n > allowTwice(c)).map(([c]) => c);
  if (dup.length) {
    errors.push(`${dup.join('・')} が旅程の中で重なっています。乗継地は出発地・目的地・帰着地と別の都市にしてください。`);
  }

  /* --- 5. 続けて同じ都市に降りていないか --- */
  for (const leg of [outLeg, backLeg]) {
    for (let i = 0; i < leg.length - 1; i++) {
      if (leg[i] && leg[i] === leg[i + 1]) {
        errors.push(`${leg[i]} が続けて並んでいます。`);
        break;
      }
    }
  }

  /* --- 6. 乗り換えの回数 --- */
  //  日本国内で往路・復路 各2回まで、日本以外で往路・復路 各2回まで
  const count = (list) => ({
    jp: list.filter(isJapan).length,
    fg: list.filter((c) => c && !isJapan(c)).length,
  });
  const oc = count(out), bc = count(back);
  const dirName = { out: oneway ? '' : '往路の', back: '復路の' };
  if (oc.jp > RULE.maxJapanTransit) errors.push(`${dirName.out}日本国内の乗り継ぎは${RULE.maxJapanTransit}回までです（いま${oc.jp}回）。`);
  if (bc.jp > RULE.maxJapanTransit) errors.push(`${dirName.back}日本国内の乗り継ぎは${RULE.maxJapanTransit}回までです（いま${bc.jp}回）。`);
  if (oc.fg > RULE.maxForeignTransit) errors.push(`${dirName.out}海外の乗り継ぎは${RULE.maxForeignTransit}都市までです（いま${oc.fg}都市）。`);
  if (bc.fg > RULE.maxForeignTransit) errors.push(`${dirName.back}海外の乗り継ぎは${RULE.maxForeignTransit}都市までです（いま${bc.fg}都市）。`);

  /* --- 7. 区間の数 --- */
  const segCount = (outLeg.length - 1) + Math.max(0, backLeg.length - 1);
  if (segCount > RULE.maxSegments) {
    errors.push(`区間が${segCount}になりました。ANAの予約画面は${RULE.maxSegments}区間までです。`);
  }

  /* --- 8. どの表を引くか --- */
  //  日本発だけ Zone 1-A / 1-B に分かれます。
  //  海外で乗り継がない旅程が 1-A、海外で乗り継ぐ周遊は 1-B。混ぜて使えません（公式）。
  const foreignTransit = oc.fg + bc.fg;
  const fromZone = fromC.zone === '1'
    ? (foreignTransit > 0 ? '1-B' : '1-A')
    : fromC.zone;
  const isJapanOrigin = fromC.zone === '1';

  /* --- 9. 必要マイル数 --- */
  //  往路の到着地と復路の出発地でゾーンが違うときは、
  //  それぞれのゾーンの必要マイル数の半分ずつを足します（公式）。
  let miles = null, milesNote = '';
  const half = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v / 2]));
  const destMiles = milesFor(fromZone, destC.zone, oneway);

  if (openjaw && retC.zone !== destC.zone) {
    const retMiles = milesFor(fromZone, retC.zone, oneway);
    if (destMiles && retMiles) {
      const a = half(destMiles), b = half(retMiles);
      miles = {};
      for (const k of Object.keys(a)) {
        if (b[k] != null) miles[k] = Math.round(a[k] + b[k]);
      }
      milesNote = `${MB.labels[destC.zone]}の半分と、${MB.labels[retC.zone]}の半分を足しています。`;
    }
  } else {
    miles = destMiles;
  }

  if (!miles) {
    if (fromZone === '1-A') {
      errors.push(`${MB.labels[destC.zone]}へは直行の往復では設定がありません。海外での乗り継ぎを1つ以上入れてください。`);
    } else {
      errors.push(`${MB.labels[fromC.zone]}発 ${MB.labels[destC.zone]}行きの必要マイル数は、公式のチャートに設定がありません。`);
    }
  }

  /* --- 10. 目的地がいちばん遠いか --- */
  //  公式のきまり：乗り換え地点の必要マイル数が、目的地を上回ってはいけません。
  if (destMiles) {
    const farther = [];
    [...out, ...back].forEach((c) => {
      const info = cityInfo(c);
      if (!info || info.zone === fromC.zone) return;
      const m = milesFor(fromZone, info.zone, oneway);
      if (m && m.Y > destMiles.Y) farther.push(`${c}（${MB.labels[info.zone]}）`);
    });
    if (farther.length) {
      errors.push(`${farther.join('・')} は目的地の ${dest} より必要マイル数が多い地域です。目的地はいちばん必要マイル数が多い都市にしてください。`);
    }
  }

  /* --- 11. 途中降機（24時間を超える滞在） --- */
  const stopover = oneway ? '' : (trip.stopover || '');
  if (oneway && trip.stopover) {
    notes.push('片道の旅程では途中降機（24時間を超える滞在）はできません。');
  }
  if (stopover) {
    if (!out.includes(stopover) && !back.includes(stopover)) {
      errors.push(`${stopover} は乗継地に入っていません。`);
    } else if (isJapanOrigin && isJapan(stopover)) {
      errors.push('日本国内での途中降機（24時間を超える滞在）はできません。');
    }
  }

  /* --- 12. 知らせ --- */
  if (!oneway && from !== to) {
    notes.push('出発地と帰着地が違います。ANAの画面では「複数都市」で入力してください。');
  }
  if (openjaw) {
    notes.push(`${dest} から ${ret} へは、ご自身で移動してください（この区間は特典に含まれません）。`);
  }
  if (!isJapanOrigin) {
    notes.push(`海外発の旅程です。必要マイル数は「${MB.labels[fromC.zone]}発着」のチャートで見ています。`);
  }

  /* --- できあがり --- */
  const segments = buildSegments(outLeg, backLeg, dest, ret, stopover, openjaw);
  const unknown = segments.filter((s) => !s.gap && !s.airlines.length);
  if (unknown.length) {
    notes.push(`${unknown.map((s) => `${s.from}→${s.to}`).join('・')} は、この特典で乗れる会社の直行便が見つかりませんでした。乗り継ぎが必要か、路線データに載っていない可能性があります。`);
  }

  /* ANA運航便だけで組んだ場合との見くらべ */
  const anaOnly = anaOnlyPlan(segments, destC.zone, fromZone, trip.date, oneway);

  return {
    ok: errors.length === 0,
    ready: true,
    mode,
    anaOnly,
    errors,
    notes,
    fromZone,
    isJapanOrigin,
    destZone: destC.zone,
    destLabel: MB.labels[destC.zone],
    miles,
    milesNote,
    // 周遊にしたことでいくら増えたか（日本発のときだけ）
    milesBase: isJapanOrigin && foreignTransit > 0 && !openjaw
      ? milesFor('1-A', destC.zone, oneway) : null,
    segments,
    segCount,
    transit: { out: oc, back: bc },
  };
}

/* 旅程を区間に切り分けて、区間ごとの就航会社と滞在時間の目安をつける。 */
function buildSegments(outLeg, backLeg, dest, ret, stopover, openjaw) {
  const list = [];

  const push = (leg) => {
    for (let i = 0; i < leg.length - 1; i++) {
      const a = leg[i], b = leg[i + 1];
      let stay = '';
      if (i + 1 < leg.length - 1) {
        stay = b === stopover ? '24時間以上' : '24時間以内';
      } else if (b === dest) {
        stay = '目的地';
      }
      list.push({ from: a, to: b, stay, airlines: airlinesBetween(a, b) });
    }
  };

  push(outLeg);
  // オープンジョーは、目的地から帰りの出発地まで自分で移動します
  if (openjaw && backLeg.length) {
    list.push({ from: dest, to: ret, stay: '', airlines: [], gap: true });
  }
  push(backLeg);
  return list;
}

/* 会社コード（NH）を日本語（ANA）にする。 */
function airlineName(code) {
  return MB.airlineNames[code] || code;
}
