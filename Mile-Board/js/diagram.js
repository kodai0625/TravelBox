/* ============================================================
 *  旅程の図
 *
 *  文字の並びだと、どこで折り返してどこに長くとまるのかが
 *  ぱっと見て分かりません。そこで輪の形に描きます。
 *
 *  ・左のはしが 出発地／帰着地（四角）
 *  ・右のはしが 目的地（いちばん大きい丸）
 *  ・上の弧が行き、下の弧が帰り
 *  ・24時間以上とまる街は二重の丸
 *  ・丸の色はゾーン（日本・アジア・欧州…）
 *
 *  アプリのアイコンと同じ考え方の形にしてあります。
 * ============================================================ */

/* ゾーンごとの色。design.css の --z1 …と対になっています。 */
const ZONE_CLASS = {
  '1': 'z-jp', '2': 'z-kr', '3': 'z-as1', '4': 'z-as2', '5': 'z-hi',
  '6': 'z-na', '7': 'z-eu', '8': 'z-af', '9': 'z-la', '10': 'z-oc',
};

function zoneClass(city) {
  const c = cityInfo(city);
  return (c && ZONE_CLASS[c.zone]) || 'z-un';
}

/* 弧の上に点を並べたときの座標を返す。
   left→right へ、上（dir=-1）か下（dir=1）にふくらませます。 */
function arcPoints(n, dir, box) {
  const { x0, x1, cy, lift } = box;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    // 真ん中がいちばん高くなる山なりの形
    const h = Math.sin(t * Math.PI) * lift;
    pts.push([x0 + (x1 - x0) * t, cy + dir * h]);
  }
  return pts;
}

/* 旅程の図を作って返します（SVGの文字列）。 */
function drawItinerary(r, trip) {
  if (!r || !r.ready) return '';

  const oneway = trip.mode === 'oneway';
  const openjaw = trip.mode === 'openjaw';
  const out = (trip.out || []).filter(Boolean);
  const back = oneway ? [] : (trip.back || []).filter(Boolean);
  const ret = openjaw ? trip.ret : trip.dest;

  // 行きの並び：出発地 → 乗継 → 目的地
  const goRow = [trip.from, ...out, trip.dest];
  // 帰りの並び：帰りの出発地 → 乗継 → 帰着地
  const backRow = oneway ? [] : [ret, ...back, trip.to];

  const W = 560;
  const lift = 52;
  const cy = oneway ? 62 : 92;
  const H = oneway ? 124 : 184;
  const box = { x0: 62, x1: W - 62, cy, lift };

  const go = arcPoints(goRow.length, oneway ? 0 : -1, box);
  const bk = backRow.length ? arcPoints(backRow.length, 1, box) : [];
  /* 帰りは右から左へ進みます。座標は左から右に並んでいるので、
     並びのほうを反転させて重ねます。
       backRowR[0]        = 帰着地       … いちばん左
       backRowR[さいご]   = 帰りの出発地 … いちばん右（目的地の下） */
  const backRowR = [...backRow].reverse();

  const parts = [];
  const line = (a, b, dashed) =>
    `<path d="M${a[0].toFixed(1)} ${a[1].toFixed(1)} L${b[0].toFixed(1)} ${b[1].toFixed(1)}"` +
    ` class="dg-line${dashed ? ' dg-line-gap' : ''}"/>`;

  for (let i = 0; i < go.length - 1; i++) parts.push(line(go[i], go[i + 1]));
  for (let i = 0; i < bk.length - 1; i++) parts.push(line(bk[i], bk[i + 1]));

  if (bk.length) {
    // 目的地と「帰りの出発地」をつなぐ。
    // オープンジョーは自分で移動するので、点線にします。
    parts.push(line(go[go.length - 1], bk[bk.length - 1], openjaw));
    // 出発地と帰着地をつなぐ（同じ都市ならつなぎません）
    if (trip.from !== trip.to) parts.push(line(go[0], bk[0], false));
  }

  /* 点と名前 */
  const node = (pt, city, kind, labelBelow) => {
    const [x, y] = pt;
    const cls = `dg-node ${zoneClass(city)}${kind ? ' ' + kind : ''}`;
    const rr = kind === 'dg-dest' ? 13 : 8;
    const shape = kind === 'dg-home'
      ? `<rect x="${(x - 9).toFixed(1)}" y="${(y - 9).toFixed(1)}" width="18" height="18" rx="5" class="${cls}"/>`
      : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rr}" class="${cls}"/>`;
    const ring = kind === 'dg-stop'
      ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" class="dg-ring"/>` : '';
    const ty = labelBelow ? y + 27 : y - 17;
    return ring + shape +
      `<text x="${x.toFixed(1)}" y="${ty.toFixed(1)}" class="dg-label">${city}</text>`;
  };

  const kindOf = (city, isEnd) => {
    if (city === trip.dest) return 'dg-dest';
    if (isEnd) return 'dg-home';
    if (city === trip.stopover) return 'dg-stop';
    return '';
  };

  goRow.forEach((c, i) => {
    const isEnd = i === 0;
    parts.push(node(go[i], c, kindOf(c, isEnd), false));
  });
  backRowR.forEach((c, i) => {
    const isEnd = i === 0;                      // いちばん左が帰着地
    // 目的地は上の弧でもう描いてあります（オープンジョー以外は同じ点）
    if (!openjaw && i === bk.length - 1) return;
    // 出発地と帰着地が同じなら、重ねずに1つだけ描きます
    if (isEnd && trip.from === trip.to) return;
    parts.push(node(bk[i], c, kindOf(c, isEnd), true));
  });

  const legend = oneway ? '片道' : (openjaw ? '上が行き／下が帰り（点線は自分で移動）' : '上が行き／下が帰り');

  return `<svg viewBox="0 0 ${W} ${H}" class="dg" role="img" aria-label="旅程の図">` +
         parts.join('') +
         `<text x="${W - 6}" y="${H - 5}" class="dg-legend">${legend}</text></svg>`;
}
