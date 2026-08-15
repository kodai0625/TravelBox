/* ============================================================
 *  世界地図（canvas に直接描く）
 *
 *  地図ライブラリは使っていません。外部のCDNに頼ると機内や
 *  電波の悪い場所で開けなくなるためです。陸地の輪郭データ
 *  （data/worldmap.json）と空港の座標だけで描いています。
 *
 *  投影は正距円筒図法（経度・緯度をそのまま縦横に置く方式）。
 *  ただし「出発地の経度を画面の中心」に置いています。
 *  そうしないと、日本発アメリカ行きのように太平洋をまたぐ路線が
 *  画面の右端で切れて左端から現れる、という見づらい絵になります。
 * ============================================================ */

const FBMap = {
  canvas: null,
  ctx: null,
  land: [],
  centerLon: 140,   // 画面中央に置く経度。出発地が決まると そこに合わせる
  scale: 1,         // 拡大率
  tx: 0, ty: 0,     // 平行移動（画面ピクセル）
  origin: null,     // 出発地の空港
  dests: [],        // 表示する就航先
  onSelect: null,   // 空港がタップされたときに呼ぶ
  selected: '',     // タップで選ばれている就航先
  _ready: false,
};

/* 経度を「中心からの相対」に直す。-180〜180 の範囲に収める */
function relLon(lon, center) {
  let d = lon - center;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/* 世界座標（-180〜180, -90〜90）を画面ピクセルに変換 */
FBMap.project = function project(lon, lat) {
  const m = this;
  const w = m.baseW;
  const x = (relLon(lon, m.centerLon) + 180) / 360 * w;
  const y = (90 - lat) / 180 * (w / 2);
  return [x * m.scale + m.tx, y * m.scale + m.ty];
};

/* 画面ピクセルから経度・緯度に戻す（タップ位置の判定に使う） */
FBMap.unproject = function unproject(px, py) {
  const m = this;
  const w = m.baseW;
  const x = (px - m.tx) / m.scale;
  const y = (py - m.ty) / m.scale;
  return [x / w * 360 - 180 + m.centerLon, 90 - y / (w / 2) * 180];
};

/* 2地点を結ぶ大圏経路（地球儀上の最短経路）を、途中の点も含めて返す。
   まっすぐな直線で結ぶと、実際の飛行経路とかけ離れた絵になります。
   東京→ロンドンはシベリア上空を通る弧を描くのが正しい姿です。 */
function greatCircle(lon1, lat1, lon2, lat2, steps) {
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const φ1 = lat1 * rad, λ1 = lon1 * rad;
  const φ2 = lat2 * rad, λ2 = lon2 * rad;

  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));

  if (!isFinite(d) || d < 1e-6) return [[lon1, lat1], [lon2, lat2]];

  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    pts.push([Math.atan2(y, x) * deg, Math.atan2(z, Math.hypot(x, y)) * deg]);
  }
  return pts;
}

/* 地図に出す空港の名札。「NGO 名古屋」のようにコードと日本語名を並べる。
   コードだけだと覚えていない空港が読み取れず、日本語だけだと
   航空券の画面と突き合わせられないので、両方出しています。 */
function mapLabel(a) {
  if (!a) return '';
  const ja = a.cityJa || a.nameJa || a.city || '';
  // 長い名前は地図が読めなくなるので詰める
  const short = ja.length > 9 ? ja.slice(0, 8) + '…' : ja;
  return short ? `${a.iata} ${short}` : a.iata;
}

/* 点の並びを線として描く。地図の継ぎ目（中心の裏側）をまたぐところで
   線を切らないと、画面を横切る長い直線が現れてしまいます。 */
FBMap.strokePath = function strokePath(pts) {
  const ctx = this.ctx;
  let prevRel = null;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const [lon, lat] = pts[i];
    const rel = relLon(lon, this.centerLon);
    const [x, y] = this.project(lon, lat);
    if (prevRel === null || Math.abs(rel - prevRel) > 180) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
    prevRel = rel;
  }
  ctx.stroke();
};

/* ------------------------------------------------------------
 *  描画
 * ---------------------------------------------------------- */
FBMap.draw = function draw() {
  const m = this;
  if (!m.ctx || !m._ready) return;

  const ctx = m.ctx;
  const W = m.cssW, H = m.cssH;
  const css = getComputedStyle(document.documentElement);
  const col = (name, fallback) => (css.getPropertyValue(name) || fallback).trim();

  ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // 海
  ctx.fillStyle = col('--map-sea', '#dbe6f0');
  ctx.fillRect(0, 0, W, H);

  // 陸
  ctx.fillStyle = col('--map-land', '#f2f4f6');
  ctx.strokeStyle = col('--map-coast', '#c9d2dc');
  ctx.lineWidth = 0.6;
  for (const ring of m.land) {
    ctx.beginPath();
    let prevRel = null;
    for (let i = 0; i < ring.length; i += 2) {
      const lon = ring[i], lat = ring[i + 1];
      const rel = relLon(lon, m.centerLon);
      const [x, y] = m.project(lon, lat);
      if (prevRel === null || Math.abs(rel - prevRel) > 180) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      prevRel = rel;
    }
    ctx.fill();
    ctx.stroke();
  }

  // 背景の空港（薄い点）。拡大するほど小さい空港も出す
  const showSize = m.scale > 3.2 ? 'S' : m.scale > 1.8 ? 'M' : 'L';
  const rank = { L: 0, M: 1, S: 2 };
  ctx.fillStyle = col('--map-dot', 'rgba(120,135,150,.45)');
  ctx.beginPath();
  for (const a of (m.airports || [])) {
    if (rank[a.size] > rank[showSize]) continue;
    const [x, y] = m.project(a.lon, a.lat);
    if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
    ctx.moveTo(x + 1.4, y);
    ctx.arc(x, y, 1.4, 0, Math.PI * 2);
  }
  ctx.fill();

  // 路線
  if (m.origin && m.dests.length) {
    const accent = col('--accent', '#3d8bfd');
    ctx.strokeStyle = accent;
    ctx.globalAlpha = m.dests.length > 80 ? 0.28 : 0.5;
    ctx.lineWidth = 1.1;
    for (const d of m.dests) {
      if (!d.airport) continue;
      m.strokePath(greatCircle(m.origin.lon, m.origin.lat,
                               d.airport.lon, d.airport.lat, 48));
    }
    ctx.globalAlpha = 1;

    // 選んだ就航先だけ、その路線を濃く描き直す
    const sel = m.dests.find((d) => d.dest === m.selected);
    if (sel && sel.airport) {
      ctx.strokeStyle = col('--map-origin', '#e8590c');
      ctx.lineWidth = 2.4;
      m.strokePath(greatCircle(m.origin.lon, m.origin.lat,
                               sel.airport.lon, sel.airport.lat, 48));
    }

    // 就航先の点
    for (const d of m.dests) {
      if (!d.airport) continue;
      const on = d.dest === m.selected;
      const [x, y] = m.project(d.airport.lon, d.airport.lat);
      ctx.fillStyle = on ? col('--map-origin', '#e8590c') : accent;
      ctx.beginPath();
      ctx.arc(x, y, on ? 5.5 : 3.2, 0, Math.PI * 2);
      ctx.fill();
      if (on) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  // 出発地
  if (m.origin) {
    const [x, y] = m.project(m.origin.lon, m.origin.lat);
    ctx.fillStyle = col('--map-origin', '#e8590c');
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = col('--text', '#1c1f26');
    ctx.font = '700 12px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(mapLabel(m.origin), x, y - 11);
  }

  // 就航先の名札。名前が長いぶん重なりやすいので、
  // すでに置いた名札と近すぎるものは間引きます。
  // 選んでいる就航先だけは、重なっても必ず出します。
  if (m.scale > 1.6 && m.dests.length) {
    ctx.font = '600 10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    const placed = [];
    const draw = (d, strong) => {
      if (!d.airport) return;
      const [x, y] = m.project(d.airport.lon, d.airport.lat);
      if (x < 0 || x > W || y < 0 || y > H) return;
      const text = mapLabel(d.airport);
      const half = ctx.measureText(text).width / 2 + 6;
      if (!strong && placed.some((p) =>
          Math.abs(p[0] - x) < p[2] + half && Math.abs(p[1] - y) < 13)) return;
      placed.push([x, y, half]);
      ctx.fillStyle = strong ? col('--map-origin', '#e8590c') : col('--text-sub', '#6b7280');
      ctx.fillText(text, x, y - (strong ? 10 : 7));
    };
    const sel = m.dests.find((d) => d.dest === m.selected);
    if (sel) draw(sel, true);
    for (const d of m.dests) if (d !== sel) draw(d, false);
  }
};

/* ------------------------------------------------------------
 *  表示範囲の調整
 * ---------------------------------------------------------- */

/* 出発地と就航先が全部入るように拡大率と位置を決める */
FBMap.fit = function fit() {
  const m = this;
  if (!m.cssW) return;

  const pts = [];
  if (m.origin) pts.push([m.origin.lon, m.origin.lat]);
  m.dests.forEach((d) => { if (d.airport) pts.push([d.airport.lon, d.airport.lat]); });

  if (!pts.length) {
    m.scale = m.cssW / m.baseW;
    m.tx = 0;
    m.ty = (m.cssH - (m.baseW / 2) * m.scale) / 2;
    return;
  }

  // 中心の経度を出発地に合わせてから範囲を測る
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [lon, lat] of pts) {
    const x = (relLon(lon, m.centerLon) + 180) / 360 * m.baseW;
    const y = (90 - lat) / 180 * (m.baseW / 2);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }

  const pad = 40;
  const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
  m.scale = Math.min((m.cssW - pad * 2) / w, (m.cssH - pad * 2) / h);
  m.scale = Math.max(0.35, Math.min(m.scale, 14));
  m.tx = m.cssW / 2 - (minX + maxX) / 2 * m.scale;
  m.ty = m.cssH / 2 - (minY + maxY) / 2 * m.scale;
};

FBMap.resize = function resize() {
  const m = this;
  if (!m.canvas) return;
  const rect = m.canvas.getBoundingClientRect();
  if (!rect.width) return;
  m.dpr = window.devicePixelRatio || 1;
  m.cssW = rect.width;
  m.cssH = rect.height;
  m.canvas.width = Math.round(rect.width * m.dpr);
  m.canvas.height = Math.round(rect.height * m.dpr);
  m.baseW = 1000;   // 世界地図1周ぶんの基準幅（拡大率1のときの横幅）
  m.draw();
};

/* ------------------------------------------------------------
 *  操作（ドラッグで移動、ピンチとホイールで拡大）
 * ---------------------------------------------------------- */
FBMap.bind = function bind() {
  const m = this;
  const c = m.canvas;
  const pointers = new Map();
  let last = null, pinch = null, moved = 0;

  const pos = (e) => {
    const r = c.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  c.addEventListener('pointerdown', (e) => {
    c.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, pos(e));
    moved = 0;
    if (pointers.size === 1) last = pos(e);
    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      pinch = { d: Math.hypot(p1[0] - p2[0], p1[1] - p2[1]), scale: m.scale };
      last = null;
    }
  });

  c.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, pos(e));

    if (pointers.size === 2 && pinch) {
      const [p1, p2] = [...pointers.values()];
      const d = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
      const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
      m.zoomAt(mid, pinch.scale * (d / pinch.d) / m.scale);
      moved += 10;
      return;
    }

    if (last) {
      const p = pos(e);
      m.tx += p[0] - last[0];
      m.ty += p[1] - last[1];
      moved += Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]);
      last = p;
      m.draw();
    }
  });

  const up = (e) => {
    // 指をほとんど動かしていなければ「タップ」とみなして空港を選ぶ
    if (moved < 6 && pointers.size === 1) m.pick(pos(e));
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    last = pointers.size === 1 ? [...pointers.values()][0] : null;
  };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinch = null; });

  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    m.zoomAt(pos(e), Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
};

/* ある点を動かさないまま拡大・縮小する */
FBMap.zoomAt = function zoomAt(p, factor) {
  const m = this;
  const next = Math.max(0.3, Math.min(m.scale * factor, 40));
  const k = next / m.scale;
  m.tx = p[0] - (p[0] - m.tx) * k;
  m.ty = p[1] - (p[1] - m.ty) * k;
  m.scale = next;
  m.draw();
};

/* タップされた位置にいちばん近い空港を探す。
   選べるのは出発地と就航先だけです。地図に薄く出ている他の空港は
   その路線と関係がないので、掴んでしまわないよう対象外にしています。 */
FBMap.pick = function pick(p) {
  const m = this;
  if (!m.onSelect) return;

  let best = null, bestD = 22;   // 22px 以内なら当たり
  const consider = (a) => {
    if (!a) return;
    const [x, y] = m.project(a.lon, a.lat);
    const d = Math.hypot(x - p[0], y - p[1]);
    if (d < bestD) { bestD = d; best = a; }
  };

  m.dests.forEach((d) => consider(d.airport));
  if (m.origin) consider(m.origin);

  m.selected = best ? best.iata : '';
  m.draw();
  m.onSelect(m.selected);
};

/* ------------------------------------------------------------
 *  外から使う入口
 * ---------------------------------------------------------- */
FBMap.init = function init(canvas, land, airports, onSelect) {
  this.canvas = canvas;
  this.ctx = canvas.getContext('2d');
  this.land = land || [];
  this.airports = airports || [];
  this.onSelect = onSelect;
  this._ready = true;
  this.bind();
  this.resize();
};

FBMap.show = function show(origin, dests, refit) {
  const changed = !this.origin || !origin || this.origin.iata !== origin.iata;
  this.origin = origin || null;
  this.dests = dests || [];
  // 出発地が変わったり、選んでいた就航先が絞り込みで消えたら選択を解除する
  if (changed || !this.dests.some((d) => d.dest === this.selected)) this.selected = '';
  if (origin) this.centerLon = origin.lon;
  if (refit) this.fit();
  this.draw();
};
