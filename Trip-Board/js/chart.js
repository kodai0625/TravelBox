/* ============================================================
 *  気候のグラフ
 *
 *  棒が降水量、2本の線が日中の最高気温と朝の最低気温です。
 *  外部の描画ライブラリは使わず、SVG を組み立てています。
 *  そのほうが軽く、明暗の切り替えにも色の変数だけで追従できます。
 * ============================================================ */

const CHART = {
  w: 360, h: 190,
  padL: 30, padR: 32, padT: 14, padB: 34,
};

function niceCeil(v) {
  // 目盛りの上限を、切りのよい数に切り上げます
  if (v <= 0) return 1;
  const step = v > 400 ? 100 : v > 150 ? 50 : v > 60 ? 20 : 10;
  return Math.ceil(v / step) * step;
}

/**
 * 月別の気候をSVGにする
 * @param {object} m  climate.json の1都市ぶん
 * @param {number} highlight 強調する月（1〜12、無ければ0）
 */
function climateChart(m, highlight) {
  const { w, h, padL, padR, padT, padB } = CHART;
  const iw = w - padL - padR;
  const ih = h - padT - padB;
  const bw = iw / 12;

  const temps = [].concat(m.tmax, m.tmin).filter((v) => v !== null);
  let tMax = Math.ceil(Math.max(...temps) / 5) * 5;
  let tMin = Math.floor(Math.min(...temps) / 5) * 5;
  if (tMax - tMin < 20) tMax = tMin + 20;          // 変化が小さい国でも潰れないように
  const pMax = niceCeil(Math.max(...m.p.filter((v) => v !== null)));

  const xOf = (i) => padL + bw * i;
  const yT = (v) => padT + ih - ((v - tMin) / (tMax - tMin)) * ih;
  const yP = (v) => padT + ih - (v / pMax) * ih;

  const parts = [];

  // --- 横の目盛り線 ---
  for (let k = 0; k <= 4; k++) {
    const y = padT + (ih / 4) * k;
    const t = Math.round(tMax - ((tMax - tMin) / 4) * k);
    parts.push(`<line class="ch-grid" x1="${padL}" y1="${y}" x2="${padL + iw}" y2="${y}"/>`);
    parts.push(`<text class="ch-axis" x="${padL - 5}" y="${y + 3}" text-anchor="end">${t}</text>`);
    parts.push(`<text class="ch-axis ch-axis--p" x="${padL + iw + 5}" y="${y + 3}">${Math.round(pMax - (pMax / 4) * k)}</text>`);
  }

  // --- 降水の棒 ---
  m.p.forEach((v, i) => {
    if (v === null) return;
    const x = xOf(i) + bw * 0.18;
    const y = yP(v);
    const bh = Math.max(1, padT + ih - y);
    const cls = highlight === i + 1 ? 'ch-bar ch-bar--on' : 'ch-bar';
    parts.push(`<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" `
             + `width="${(bw * 0.64).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5"/>`);
  });

  // --- 気温の線 ---
  const line = (arr, cls) => {
    const pts = arr.map((v, i) => (v === null ? null
      : `${(xOf(i) + bw / 2).toFixed(1)},${yT(v).toFixed(1)}`))
      .filter(Boolean).join(' ');
    parts.push(`<polyline class="${cls}" points="${pts}"/>`);
    arr.forEach((v, i) => {
      if (v === null) return;
      parts.push(`<circle class="${cls}-dot" cx="${(xOf(i) + bw / 2).toFixed(1)}" `
               + `cy="${yT(v).toFixed(1)}" r="${highlight === i + 1 ? 3.2 : 2}"/>`);
    });
  };
  line(m.tmax, 'ch-hi');
  line(m.tmin, 'ch-lo');

  // --- 月の名前 ---
  for (let i = 0; i < 12; i++) {
    const cls = highlight === i + 1 ? 'ch-month ch-month--on' : 'ch-month';
    parts.push(`<text class="${cls}" x="${(xOf(i) + bw / 2).toFixed(1)}" `
             + `y="${h - padB + 14}" text-anchor="middle">${i + 1}</text>`);
  }

  parts.push(`<text class="ch-unit" x="${padL - 5}" y="${padT - 4}" text-anchor="end">℃</text>`);
  parts.push(`<text class="ch-unit" x="${padL + iw + 5}" y="${padT - 4}">mm</text>`);

  const svg = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img"
    aria-label="月別の気温と降水量">${parts.join('')}</svg>`;

  // グラフの下に凡例。線が2本と棒が1つあり、
  // どれが何なのかは色を見ただけでは分かりません。
  const legend = `<p class="chart-legend">
    <span class="chart-legend__item"><i class="cl cl--hi"></i>日中の最高気温</span>
    <span class="chart-legend__item"><i class="cl cl--lo"></i>朝の最低気温</span>
    <span class="chart-legend__item"><i class="cl cl--bar"></i>降水量（右の目盛り・mm）</span>
  </p>`;

  return svg + legend;
}

/**
 * 12か月の帯（一覧表と詳細パネルの両方で使います）
 *
 * マスの色と記号は**天気だけ**を表します。
 * 気温は別の情報なので、マスの下の細い帯で添えています。
 *   赤い帯 … 著しく暑い月
 *   青い帯 … 著しく寒い月
 * 上の点は台風・サイクロンの季節です。
 *
 * @param {object} s  seasons.json の1都市ぶん
 * @param {number} highlight 強調する月
 */
function monthStrip(s, highlight) {
  return s.grades.map((g, i) => {
    const rank = { '◎': 4, '○': 3, '△': 2, '✕': 1 }[g];
    const flags = [];
    if (s.hot[i]) flags.push('is-hot');
    if (s.cold[i]) flags.push('is-cold');
    if (s.storm && s.storm.months.includes(i + 1)) flags.push('is-storm');
    if (highlight === i + 1) flags.push('is-on');
    // 調べた内容で1段上げた月。測った値そのままではないので、
    // マスの左下に小さな印を付けて区別できるようにします。
    const up = s.lifted && s.lifted[i + 1];
    if (up) flags.push('is-lifted');

    const tip = [`${i + 1}月 天気${g}（${s.scores[i]}点・雨${s.wet[i]}日）`];
    if (up) tip.push(`雨季の変わり目なので ${up.from} から ${up.to} に上げています`);
    if (s.hot[i]) tip.push('著しく暑い');
    if (s.cold[i]) tip.push('著しく寒い');

    return `<td class="cell cell--${rank} ${flags.join(' ')}" data-month="${i + 1}"
      title="${tip.join('／')}">${g}</td>`;
  }).join('');
}

/**
 * 帯の下に出す月の番号。選んでいる月は塗りつぶして示します。
 * マスの枠線だけだと、◎のマス（濃い藍の塗り）に埋もれて見えないためです。
 */
function monthLabels(highlight) {
  return Array.from({ length: 12 }, (_, i) =>
    `<td class="${highlight === i + 1 ? 'is-on' : ''}">${i + 1}</td>`).join('');
}
