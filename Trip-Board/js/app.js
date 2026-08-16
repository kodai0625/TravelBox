/* ============================================================
 *  画面の組み立て
 * ============================================================ */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** 詳細パネルの見出し。その項目のしるしを左に添えます。
 *  しるしの形は index.html の <symbol id="i-○○"> にあります。 */
const sec = (icon, text) =>
  `<h3 class="sec"><svg class="sec__i" aria-hidden="true">
     <use href="#i-${icon}"/></svg>${text}</h3>`;

/** [5,6,9,10] を「5〜6月・9〜10月」のように書く。
 *  build_seasons.py の runs()＋label() と同じことを JS 側でします。
 *  12月と1月がつながる場合もひとまとまりにします（例：11〜2月）。 */
function monthRange(months) {
  const ms = [...new Set(months)].sort((a, b) => a - b);
  if (!ms.length) return '';
  if (ms.length === 12) return '一年中';
  const groups = [];
  let start = ms[0], prev = ms[0];
  for (const m of ms.slice(1)) {
    if (m === prev + 1) { prev = m; continue; }
    groups.push([start, prev]);
    start = prev = m;
  }
  groups.push([start, prev]);
  // 12月と1月が両方あるなら、年をまたいでつなげます
  if (groups.length > 1 && groups[0][0] === 1 && groups[groups.length - 1][1] === 12) {
    const first = groups.shift();
    const last = groups.pop();
    groups.push([last[0], first[1]]);
  }
  return groups.map(([a, b]) => (a === b ? `${a}月` : `${a}〜${b}月`)).join('・');
}

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月',
                '7月', '8月', '9月', '10月', '11月', '12月'];

const state = {
  tab: 'search',
  month: 0,            // 0 は「指定なし」
  query: '',
  regions: new Set(),
  conds: new Set(),
  sort: 'score',
  tableRegion: '',
  compare: [],
  compareMonth: 0,
  sheetCode: null,
  sheetCity: 0,
};

/* ------------------------------------------------------------
 *  保存（選んだ月と、比較に入れた国だけを覚えます）
 * ---------------------------------------------------------- */
function save() {
  try {
    localStorage.setItem(APP.storageKey + ':state', JSON.stringify({
      month: state.month, compare: state.compare, compareMonth: state.compareMonth,
    }));
  } catch (e) { /* 保存できなくても動きます */ }
}
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem(APP.storageKey + ':state') || '{}');
    if (typeof s.month === 'number') state.month = s.month;
    if (typeof s.compareMonth === 'number') state.compareMonth = s.compareMonth;
    if (Array.isArray(s.compare)) {
      // 以前は国コードだけで持っていました（"TH"）。
      // いまは都市の番号まで持つので（"TH:0"）、古い形は代表都市に読み替えます。
      state.compare = s.compare
        .map((k) => (String(k).includes(':') ? k : `${k}:0`))
        .map((k) => (openPick(k) ? openPick(k).key : null))
        .filter(Boolean)
        .slice(0, APP.compareMax);
    }
  } catch (e) { /* 壊れていたら初期値のまま */ }
}

/* ------------------------------------------------------------
 *  明暗の切り替え
 * ---------------------------------------------------------- */
function setupTheme() {
  const btn = $('themeBtn');
  const key = APP.storageKey + ':theme';
  const order = ['auto', 'light', 'dark'];
  const label = { auto: '自動', light: '明', dark: '暗' };

  const apply = (pref) => {
    const dark = pref === 'dark'
      || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    btn.textContent = label[pref];
  };

  let pref = localStorage.getItem(key) || 'auto';
  apply(pref);
  btn.addEventListener('click', () => {
    pref = order[(order.indexOf(pref) + 1) % order.length];
    try { localStorage.setItem(key, pref); } catch (e) { /* 無視 */ }
    apply(pref);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => apply(pref));
}

/* ------------------------------------------------------------
 *  ヘッダーの高さを測る
 *
 *  一覧表と比較表の見出し行を「ヘッダーのすぐ下」で止めるために、
 *  実際の高さを測って CSS に渡します。タイトルが折り返す幅では
 *  高さが変わるので、決め打ちの数値にはできません。
 * ---------------------------------------------------------- */
function trackHeaderHeight() {
  const head = document.querySelector('.app-header');
  const set = () => {
    document.documentElement.style.setProperty(
      '--header-h', head.offsetHeight + 'px');
  };
  set();
  if (window.ResizeObserver) new ResizeObserver(set).observe(head);
  window.addEventListener('orientationchange', () => setTimeout(set, 200));
}

/* ------------------------------------------------------------
 *  タブ
 * ---------------------------------------------------------- */
function setupTabs() {
  $('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tabs__btn');
    if (!btn) return;
    state.tab = btn.dataset.tab;
    document.querySelectorAll('.tabs__btn').forEach((b) =>
      b.classList.toggle('is-active', b === btn));
    // ★ 名前を決め打ちで並べていたので、タブを1つ足したときに
    //   ここを直し忘れて「押しても中身が出ない」が起きました。
    //   タブの側から取るようにして、足すたびに直す場所を減らします。
    document.querySelectorAll('.tabs__btn').forEach((b) => {
      const id = 'view' + b.dataset.tab.charAt(0).toUpperCase()
                 + b.dataset.tab.slice(1);
      const view = document.getElementById(id);
      if (view) view.classList.toggle('is-hidden', b !== btn);
    });
    window.scrollTo(0, 0);
    render();
  });
  $('homeBtn').addEventListener('click', () => {
    document.querySelector('.tabs__btn').click();
  });
}

/* ------------------------------------------------------------
 *  月のチップ（探す／比較 で共用）
 * ---------------------------------------------------------- */
function monthChipsHTML(selected) {
  const one = (v, text) =>
    `<button type="button" class="chip${selected === v ? ' is-active' : ''}"
       data-month="${v}">${text}</button>`;
  return one(0, '指定なし') + MONTHS.map((m, i) => one(i + 1, m)).join('');
}

function setupMonthChips(el, get, set) {
  el.innerHTML = monthChipsHTML(get());
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    set(+b.dataset.month);
    el.innerHTML = monthChipsHTML(get());
    save();
    render();
  });
}

/* ------------------------------------------------------------
 *  絞り込み
 * ---------------------------------------------------------- */
function setupFilters() {
  $('regionChips').innerHTML = DB.regions.map((r) =>
    `<button type="button" class="chip" data-region="${esc(r)}">${esc(r)}</button>`).join('');

  $('regionChips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const r = b.dataset.region;
    if (state.regions.has(r)) state.regions.delete(r); else state.regions.add(r);
    b.classList.toggle('is-active');
    render();
  });

  $('condChips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const c = b.dataset.cond;
    if (state.conds.has(c)) state.conds.delete(c); else state.conds.add(c);
    b.classList.toggle('is-active');
    render();
  });

  $('filterToggle').addEventListener('click', () => {
    const p = $('filterPanel');
    const open = p.classList.toggle('is-hidden');
    $('filterToggle').setAttribute('aria-expanded', String(!open));
  });

  $('sortSel').addEventListener('change', (e) => {
    state.sort = e.target.value;
    // 並びは3つのタブで共通なので、いま見ていないタブも作り直します
    renderTable();
    renderClock();
    render();
  });

  const input = $('countrySearch');
  const clear = $('countryClear');
  input.addEventListener('input', () => {
    state.query = input.value;
    clear.classList.toggle('is-hidden', !input.value);
    render();
  });
  clear.addEventListener('click', () => {
    input.value = ''; state.query = '';
    clear.classList.add('is-hidden');
    input.focus(); render();
  });

  // 一覧表の地域チップ
  $('tableRegionChips').innerHTML =
    `<button type="button" class="chip is-active" data-region="">すべて</button>`
    + DB.regions.map((r) =>
      `<button type="button" class="chip" data-region="${esc(r)}">${esc(r)}</button>`).join('');
  $('tableRegionChips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.tableRegion = b.dataset.region;
    $('tableRegionChips').querySelectorAll('.chip').forEach((x) =>
      x.classList.toggle('is-active', x === b));
    renderTable();
  });
}

/* ------------------------------------------------------------
 *  絞り込みの適用と並べ替え
 * ---------------------------------------------------------- */
function filtered() {
  const now = new Date();
  return DB.countries.filter((c) => {
    if (!matches(c, state.query)) return false;
    if (state.regions.size && !state.regions.has(c.region)) return false;
    if (state.conds.has('direct') && !c.direct) return false;
    if (state.conds.has('safe') && safetyOf(c.code)) return false;
    if (state.conds.has('cheap')) {
      const p = eatLevelOf(c.code);   // 外食と宿泊で見ます
      if (p === null || p >= 100) return false;
    }
    if (state.conds.has('near')) {
      const h = Math.abs(hoursFromJapan(c.cities[0].tz, now));
      if (h > APP.nearHours) return false;
    }
    if (state.conds.has('nostorm') && state.month
        && isStormMonth(c.code, state.month, 0, true)) return false;
    return true;
  });
}

/** 過ごしやすさが同点のときの決め方。
 *  同じ100点でも「直行便があって、危険情報が出ていなくて、時差が小さい」
 *  ほうが実際には行きやすいので、その順に前へ出します。 */
function easeKey(c, now) {
  const sf = safetyOf(c.code);
  return [
    c.direct ? 0 : 1,
    sf ? sf.max : 0,
    Math.abs(hoursFromJapan(c.cities[0].tz, now)),
  ];
}

/** 全タブで共通の並び順。
 *  探す・一覧表・時差でばらばらだと、同じ国を探し直すことになるので、
 *  「探す」タブの並び（初期値＝天気の良さ）を3つのタブで共有します。 */
function orderedCountries() {
  return sorted(DB.countries.slice());
}

function sorted(list) {
  const now = new Date();
  const arr = list.slice();
  if (state.sort === 'score') {
    arr.sort((a, b) => {
      const d = (scoreOf(b.code, state.month) || 0) - (scoreOf(a.code, state.month) || 0);
      if (d) return d;
      const ka = easeKey(a, now), kb = easeKey(b, now);
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] !== kb[i]) return ka[i] - kb[i];
      }
      return a.ja.localeCompare(b.ja, 'ja');
    });
  } else if (state.sort === 'price') {
    arr.sort((a, b) => {
      const pa = eatLevelOf(a.code), pb = eatLevelOf(b.code);
      if (pa === null && pb === null) return a.ja.localeCompare(b.ja, 'ja');
      if (pa === null) return 1;
      if (pb === null) return -1;
      return pa - pb;
    });
  } else if (state.sort === 'tz') {
    arr.sort((a, b) => Math.abs(hoursFromJapan(a.cities[0].tz, now))
                     - Math.abs(hoursFromJapan(b.cities[0].tz, now)));
  } else {
    arr.sort((a, b) => a.ja.localeCompare(b.ja, 'ja'));
  }
  return arr;
}

/* ------------------------------------------------------------
 *  探す
 * ---------------------------------------------------------- */
function priceBadge(code) {
  // 旅行の支出でいちばん大きいのは外食と宿泊なので、札にはそれを出します。
  // 無い国だけ、経済全体の物価水準で代わりにします。
  const p = DB.prices[code];
  if (!p) return '<span class="tag">物価 —</span>';
  const v = typeof p.eat === 'number' ? p.eat
    : (typeof p.level === 'number' ? p.level : null);
  if (v === null) return '<span class="tag">物価 —</span>';
  const cls = v < 60 ? 'tag--cheap' : v < 100 ? 'tag--mid' : 'tag--pricey';
  const what = typeof p.eat === 'number' ? '外食' : '物価';
  return `<span class="tag ${cls}">${what} ${v}</span>`;
}

function safetyBadge(code) {
  const s = safetyOf(code);
  if (!s) return '<span class="tag tag--safe">危険情報なし</span>';
  const label = s.base === s.max ? `レベル${s.base}`
    : `レベル${s.base}／一部${s.max}`;
  return `<span class="tag tag--lv${s.max}">${label}</span>`;
}

/** 一覧の1行 */
function searchRow(c, now) {
  const s = seasonOf(c.code);
  const sc = scoreOf(c.code, state.month);
  const g = state.month && s ? s.grades[state.month - 1] : '';
  const rank = { '◎': 4, '○': 3, '△': 2, '✕': 1 }[g] || 0;
  const h = hoursFromJapan(c.cities[0].tz, now);
  const storm = state.month && isStormMonth(c.code, state.month);
  const rain = state.month && s && s.rainy.includes(state.month);

  // 月を選んでいないときは、12か月の平均を同じ ◎○△✕ に直して出します。
  // 数字を出していたころは「何点満点の何の点数か」が画面から分からず、
  // 月を選んだときと見た目も揃いませんでした。
  const g2 = state.month ? g : gradeOf(sc);
  const rank2 = state.month ? rank
    : ({ '◎': 4, '○': 3, '△': 2, '✕': 1 }[g2] || 0);
  const mark = g2
    ? `<span class="mark mark--${rank2}">${g2}</span>`
    : '<span class="mark mark--none">—</span>';

  // 台風は「国の一部だけ」のことがあるので、そう書き分けます
  const stormWord = storm
    ? (s.storm.partial ? '・一部で台風の季節' : '・台風の季節') : '';
  // 気温は天気とは別の情報なので、点数のあとに言葉で添えます
  const tempWord = state.month && s
    ? (s.hot[state.month - 1] ? '・著しく暑い' : '')
      + (s.cold[state.month - 1] ? '・著しく寒い' : '')
    : '';
  const sub = state.month
    ? `${s ? `雨${s.wet[state.month - 1]}日` : ''}${rain ? '・雨季' : ''}`
      + `${stormWord}${tempWord}`
    : (s ? `${s.relative ? '勧められる時期' : '天気が良い'} ${s.best_label}` : '');

  // エリアごとに分けているときは、行にエリア名を重ねて書きません
  const place = grouping() ? esc(c.cities[0].ja)
    : `${esc(c.region)}・${esc(c.cities[0].ja)}`;

  return `<li class="list__item" data-code="${c.code}">
    ${mark}
    <div class="list__body">
      <p class="list__name">${c.flag} ${esc(c.ja)}
        ${c.direct ? '<span class="badge badge--direct">直行便</span>' : ''}</p>
      <p class="list__sub">${place}${sub ? '　' + esc(sub) : ''}</p>
      <p class="list__tags">${priceBadge(c.code)}${safetyBadge(c.code)}
        <span class="tag">${formatDiff(h)}</span></p>
    </div>
    <span class="list__chev" aria-hidden="true">›</span>
  </li>`;
}

/** エリアごとに分けて出すかどうか。
 *  何も絞っていないときだけ分けます。80件を一列で見るより、
 *  「東南アジアの中ではどこか」を見比べるほうが実際の使い方に近いためです。
 *  絞り込みや検索をしているときは件数が減るので、分けずに順位で並べます。 */
function grouping() {
  return !state.regions.size && !state.conds.size && !state.query.trim();
}

function renderSearch() {
  const list = sorted(filtered());
  const now = new Date();

  $('filterCount').textContent = state.regions.size + state.conds.size || '';
  $('filterCount').classList.toggle('is-hidden',
    !(state.regions.size + state.conds.size));

  const head = state.month
    ? `${MONTHS[state.month - 1]}に行くなら ${list.length} の国・地域`
    : `${list.length} の国・地域　印は天気の12か月平均です`;
  $('searchCount').textContent = head + (grouping()
    ? '　エリアごとに、天気が良い順で並べています'
    : (state.month
        ? '（同点なら、直行便がある・危険情報が出ていない・時差が小さい順）' : ''));

  if (!list.length) {
    $('searchList').innerHTML =
      '<li class="empty"><svg class="empty__i" aria-hidden="true"><use href="#i-search"/></svg>条件に当てはまる国がありません。絞り込みを緩めてみてください。</li>';
    return;
  }

  if (!grouping()) {
    $('searchList').innerHTML = list.map((c) => searchRow(c, now)).join('');
    return;
  }

  // エリアの並びは countries.json の順（東アジアから遠い順）。
  // エリアの中は、いま選んでいる並べ方のままです。
  const html = [];
  DB.regions.forEach((region) => {
    const inRegion = list.filter((c) => c.region === region);
    if (!inRegion.length) return;
    html.push(`<li class="list__group">
      <svg class="list__group-i" aria-hidden="true"><use href="#i-pin"/></svg>
      ${esc(region)}
      <span class="list__group-n">${inRegion.length}</span></li>`);
    inRegion.forEach((c) => html.push(searchRow(c, now)));
  });
  $('searchList').innerHTML = html.join('');
}

/* ------------------------------------------------------------
 *  一覧表
 * ---------------------------------------------------------- */
function renderTable() {
  const list = orderedCountries().filter((c) =>
    !state.tableRegion || c.region === state.tableRegion);

  // 地域の区切りごとに月の番号を出し直します。
  // 表を横に動かせるようにしてあると、上に貼り付く見出しが使えないためです。
  const groupRow = (label) =>
    `<tr class="matrix__group"><th class="matrix__name">${esc(label)}</th>`
    + MONTHS.map((m, i) => `<td class="matrix__mnum">${i + 1}</td>`).join('')
    + '</tr>';

  // 探すタブと同じで、エリアの並びは countries.json の順です。
  // 中身の並びだけが「探す」タブの選択に従います。
  const byRegion = [];
  DB.regions.forEach((rg) => {
    const inR = list.filter((c) => c.region === rg);
    if (inR.length) byRegion.push(...inR);
  });

  let last = null;
  const rows = byRegion.map((c) => {
    const s = seasonOf(c.code);
    let out = '';
    const region = state.tableRegion || c.region;
    if (region !== last) {
      last = region;
      out += groupRow(region);
    }
    if (!s) {
      out += `<tr data-code="${c.code}"><th class="matrix__name">${c.flag} ${esc(c.ja)}</th>`
           + `<td colspan="12" class="cell cell--na">気候データがありません</td></tr>`;
      return out;
    }
    // 「天気が良い時期」は列をやめて国名の下に置きます。
    // 縦画面で横に流れないよう、幅を12か月ぶんに使うためです。
    const best = s.best_label === 'どの月も同じくらい雨' ? 'どの月も同程度' : s.best_label;
    out += `<tr data-code="${c.code}">`
      + `<th class="matrix__name"><span class="matrix__ja">${c.flag} ${esc(c.ja)}</span>`
      + `<span class="matrix__best2">${esc(best)}</span></th>`
      + monthStrip(s, state.month)
      + '</tr>';
    return out;
  }).join('');

  $('matrix').innerHTML = `<tbody>${rows}</tbody>`;
}


/* ------------------------------------------------------------
 *  航空券の高い時期・安い時期
 *
 *  値段そのものは持ちません。航空券は予約の時期・曜日・空席で毎日変わり、
 *  「5月なら何円」と言える数字はどこにもないからです。
 *  ここで出すのは上がり下がりの傾向だけです。
 *
 *  効き方の大きい順に並べています。
 *    1. 日本の休みの並び（行き先を問わず同じ。ふだんの2〜3倍になる）
 *    2. 行き先じたいの人気（国ごとに違う）
 *  1のほうが強いので先に出します。
 * ---------------------------------------------------------- */
function fareBlock(code, s) {
  const f = DB.fares[code];
  if (!f) return '';
  const meta = DB.fareMeta || {};
  const jp = meta.jp || {};

  const peak = new Set(f.peak);
  const cheap = new Set(f.cheap);

  // 天気が良くて、しかも安い月。いちばん知りたいのはここなので、
  // 別の印を立てて目立たせます。データから導いたもので、手書きではありません。
  const sweet = [];
  const cells = MONTHS.map((label, i) => {
    const m = i + 1;
    let kind = 'mid';
    if (peak.has(m)) kind = 'high';
    else if (cheap.has(m)) kind = 'low';
    const good = s && (s.grades[i] === '◎' || s.grades[i] === '○');
    const isSweet = kind === 'low' && good;
    if (isSweet) sweet.push(m);
    const tip = [`${m}月`,
      kind === 'high' ? '高くなりやすい' : (kind === 'low' ? '安くなりやすい' : 'ふつう')];
    if (isSweet) tip.push('天気も良いので狙い目');
    return `<td class="fare fare--${kind}${isSweet ? ' is-sweet' : ''}"
      title="${tip.join('／')}">${kind === 'high' ? '高' : (kind === 'low' ? '安' : '')}</td>`;
  }).join('');

  const rows = [];
  rows.push(`<table class="fare-strip"><tr>${cells}</tr>
    <tr class="strip__labels">${monthLabels(state.month)}</tr></table>`);

  rows.push(`<p class="fare-legend">
    <span class="fare-legend__i fare--high"></span>高くなりやすい
    <span class="fare-legend__i fare--low"></span>安くなりやすい
    <span class="fare-legend__i fare--low is-sweet"></span>安くて天気も良い</p>`);

  if (sweet.length) {
    rows.push(`<p class="fare-sweet"><b>狙い目は ${
      esc(monthRange(sweet))}</b>　安いのに天気は◎か○の月です。</p>`);
  }
  if (f.note) {
    rows.push(`<p class="fare-note">${
      esc(f.note).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>`);
  }
  if (f.lunar && meta.lunar) {
    rows.push(`<p class="fare-warn"><b>旧正月</b>　${esc(meta.lunar.when)}<br>${
      esc(meta.lunar.note)}</p>`);
  }

  // 日本側の山。行き先に関係なく同じなので、たたんで置きます。
  const li = (x) => `<li><b>${esc(x.name)}</b>　${esc(x.when)}<br>
    <span class="fare-jp__note">${esc(x.note)}</span></li>`;
  rows.push(`<details class="fare-jp">
    <summary class="fare-jp__head">日本発ならどこへ行っても上がる時期</summary>
    <div class="fare-jp__body">
      <p class="fare-jp__lead">${esc(jp.note || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>
      <p class="fare-jp__label">とくに高い</p>
      <ul class="fare-jp__list">${(jp.high || []).map(li).join('')}</ul>
      <p class="fare-jp__label">やや高い</p>
      <ul class="fare-jp__list">${(jp.mid || []).map(li).join('')}</ul>
      <p class="fare-jp__label">安いことが多い</p>
      <ul class="fare-jp__list">${(jp.low || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    </div>
  </details>`);

  rows.push(`<p class="fineprint">${
    esc(meta.note || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>`);

  return sec('fare', '航空券の高い時期・安い時期') + rows.join('');
}

/* ------------------------------------------------------------
 *  比較
 *
 *  並べる単位は「国」でも「都市」でもかまいません。
 *  中では どちらも "国コード:都市の番号" という同じ形で持っています。
 *
 *    TH:0 … タイ（代表都市のバンコク）。画面には「タイ」と出ます
 *    VN:1 … ベトナムのホーチミン。画面には「ホーチミン」と出ます
 *
 *  こうすると「タイとホーチミンとクアラルンプール」のような
 *  混ざった並べ方が、特別扱いなしにそのまま作れます。
 *  気候は都市ごとに違い、物価と治安は国のものなので、
 *  同じ国の都市を2つ並べると気候の行だけが変わります。
 * ---------------------------------------------------------- */

/** "TH:1" を { c: 国, i: 都市の番号, city: 都市 } に開く */
function openPick(key) {
  const [code, i] = String(key).split(':');
  const c = DB.byCode[code];
  if (!c) return null;
  const n = Math.min(+i || 0, c.cities.length - 1);
  return { key: `${code}:${n}`, c, i: n, city: c.cities[n] };
}

/** 画面に出す名前。代表都市なら国名、それ以外なら都市名を主役にします。
 *
 *  ただし同じ国を2つ以上並べているとき（ハノイ・ホーチミン・ダナン）は、
 *  代表都市も都市名で出します。「ベトナム・ホーチミン・ダナン」と並ぶと
 *  1つめだけ違う種類のものに見えてしまうためです。 */
function pickName(p, cityFirst) {
  return (p.i === 0 && !cityFirst) ? p.c.ja : p.city.ja;
}
function pickSub(p, cityFirst) {
  return (p.i === 0 && !cityFirst) ? p.city.ja : p.c.ja;
}

/** その国が2回以上並んでいるか */
function dupCodes(picked) {
  const n = {};
  picked.forEach((p) => { n[p.c.code] = (n[p.c.code] || 0) + 1; });
  return new Set(Object.keys(n).filter((k) => n[k] > 1));
}

/** 入力された文字から、足せる候補（国と都市）を作る */
function compareCandidates(q) {
  const nq = kataToHira(q).toLowerCase().trim();
  if (!nq) return [];
  const hit = (s) => kataToHira(String(s || '')).toLowerCase().includes(nq);

  const out = [];
  DB.countries.forEach((c) => {
    // 国の名前で当たったときは、その国の都市を全部出します。
    // 「ベトナム」と入れて ハノイ・ホーチミン・ダナン を選べるようにするためです。
    const byCountry = hit(c.ja) || hit(c.en) || hit(c.code);
    c.cities.forEach((city, i) => {
      if (!byCountry && !hit(city.ja) && !hit(city.en)) return;
      const key = `${c.code}:${i}`;
      if (state.compare.includes(key)) return;
      out.push({ key, flag: c.flag, main: i === 0 ? c.ja : city.ja,
                 sub: i === 0 ? `${c.region}・${city.ja}` : c.ja });
    });
  });
  return out.slice(0, 10);
}

function setupCompare() {
  const input = $('compareSearch');
  const clear = $('compareClear');
  const sug = $('compareSuggest');

  const close = () => sug.classList.add('is-hidden');

  input.addEventListener('input', () => {
    clear.classList.toggle('is-hidden', !input.value);
    const hits = compareCandidates(input.value);
    if (!hits.length) { close(); return; }
    sug.innerHTML = hits.map((h) =>
      `<li class="suggest__item" data-key="${h.key}">
         ${h.flag} ${esc(h.main)}
         <span class="suggest__sub">${esc(h.sub)}</span></li>`).join('');
    sug.classList.remove('is-hidden');
  });

  clear.addEventListener('click', () => {
    input.value = ''; clear.classList.add('is-hidden'); close();
  });

  sug.addEventListener('click', (e) => {
    const li = e.target.closest('.suggest__item');
    if (!li) return;
    if (state.compare.length >= APP.compareMax) state.compare.shift();
    state.compare.push(li.dataset.key);
    input.value = ''; clear.classList.add('is-hidden'); close();
    save(); renderCompare();
  });

  $('picked').addEventListener('click', (e) => {
    const b = e.target.closest('.pick__x');
    if (!b) return;
    state.compare = state.compare.filter((k) => k !== b.dataset.key);
    save(); renderCompare();
  });
}

function renderCompare() {
  const picked = state.compare.map(openPick).filter(Boolean);

  const dup = dupCodes(picked);
  const cityFirst = (p) => dup.has(p.c.code);

  $('picked').innerHTML = picked.length
    ? picked.map((p) => `<span class="pick">${p.c.flag} ${esc(pickName(p, cityFirst(p)))}
        <span class="pick__sub">${esc(pickSub(p, cityFirst(p)))}</span>
        <button type="button" class="pick__x" data-key="${p.key}" aria-label="外す">✕</button>
      </span>`).join('')
    : '<p class="hint">上の欄から国か都市を足してください。'
      + '国名を入れると、その国の都市も候補に出ます。</p>';

  if (!picked.length) { $('compareTable').innerHTML = ''; return; }

  const now = new Date();
  const M = state.compareMonth;

  const rows = [];
  const add = (label, fn, kind) => {
    rows.push(`<tr><th>${label}${kind === 'country'
      ? '<span class="compare__unit">国</span>' : ''}</th>`
      + picked.map((p) => `<td>${fn(p)}</td>`).join('') + '</tr>');
  };

  // ---- 国で決まるもの ----
  add('地域', (p) => esc(p.c.region), 'country');
  add('直行便', (p) => (p.c.direct ? 'あり' : 'なし（乗継）'), 'country');

  // ---- 都市で変わるもの ----
  add(M ? `${MONTHS[M - 1]}の天気` : '通年で天気が最も良い月', (p) => {
    const s = seasonOf(p.c.code, p.i);
    if (!s) return '—';
    if (!M) return `${Math.max(...s.scores)}点`;
    return `<span class="mark mark--${{ '◎': 4, '○': 3, '△': 2, '✕': 1 }[s.grades[M - 1]]}">`
         + `${s.grades[M - 1]}</span> ${s.scores[M - 1]}点`;
  });

  if (M) {
    add(`${MONTHS[M - 1]}の雨`, (p) => {
      const m = climateOf(p.c.code, p.i);
      const s = seasonOf(p.c.code, p.i);
      if (!m || !s) return '—';
      return `${s.wet[M - 1]}日・${m.p[M - 1]}mm`
        + (s.rainy.includes(M) ? '<br><span class="warn">雨季</span>' : '');
    });
    add(`${MONTHS[M - 1]}の気温`, (p) => {
      const m = climateOf(p.c.code, p.i);
      const s = seasonOf(p.c.code, p.i);
      if (!m) return '—';
      const mark = s && s.hot[M - 1] ? '<br><span class="warn">著しく暑い</span>'
        : (s && s.cold[M - 1] ? '<br><span class="cool">著しく寒い</span>' : '');
      return `${m.tmax[M - 1]}／${m.tmin[M - 1]}℃${mark}`;
    });
    add(`${MONTHS[M - 1]}の体感`, (p) => {
      const m = climateOf(p.c.code, p.i);
      return m && m.at[M - 1] !== null ? `${m.at[M - 1]}℃` : '—';
    });
  }

  add('天気が良い時期', (p) => {
    const s = seasonOf(p.c.code, p.i);
    if (!s) return '—';
    return esc(s.best_label)
      + (s.best_weak ? '<br><span class="src">比較的まし</span>' : '');
  });
  add('雨が多い時期', (p) => {
    const s = seasonOf(p.c.code, p.i);
    return s && s.worst.length ? esc(s.worst_label) : 'とくになし';
  });
  add('著しく暑い月', (p) => {
    const s = seasonOf(p.c.code, p.i);
    return s && s.hot.some(Boolean) ? esc(s.hot_label) : 'なし';
  });
  add('著しく寒い月', (p) => {
    const s = seasonOf(p.c.code, p.i);
    return s && s.cold.some(Boolean) ? esc(s.cold_label) : 'なし';
  });
  add('雨季', (p) => {
    const s = seasonOf(p.c.code, p.i);
    return s && s.rainy.length ? esc(s.rainy_label) : 'はっきりした雨季なし';
  });
  add('台風など', (p) => {
    const s = seasonOf(p.c.code, p.i);
    if (!s || !s.storm) return 'なし';
    return esc(s.storm.label)
      + (s.storm.partial ? '<br><span class="src">一部の地域だけ</span>' : '');
  }, 'country');

  // ---- ふたたび国で決まるもの ----
  (DB.meta.prices.categories || []).forEach((cat) => {
    add(`${cat.ja}（日本=100）`, (p) => {
      const x = DB.prices[p.c.code];
      return x && typeof x[cat.key] === 'number' ? `${x[cat.key]}` : '—';
    }, 'country');
  });
  add('経済全体の物価', (p) => {
    const x = DB.prices[p.c.code];
    return x && typeof x.level === 'number' ? `${x.level}` : '—';
  }, 'country');
  add('危険情報', (p) => {
    const s = safetyOf(p.c.code);
    if (!s) return 'なし';
    return s.base === s.max ? `レベル${s.base}`
      : `レベル${s.base}<br>一部レベル${s.max}`;
  }, 'country');

  // ---- 都市ごと ----
  add('日本との時差', (p) => formatDiff(hoursFromJapan(p.city.tz, now)));
  add('現地の今', (p) => esc(localTime(p.city.tz, now)));

  $('compareTable').innerHTML =
    `<thead><tr><th></th>${picked.map((p) =>
      `<th>${p.c.flag}<br>${esc(pickName(p, cityFirst(p)))}
       <span class="compare__city">${esc(pickSub(p, cityFirst(p)))}</span></th>`).join('')}</tr></thead>`
    + `<tbody>${rows.join('')}</tbody>`;

  // 同じ国の都市を並べているときは、どの行が国のものかを断っておきます
  const multi = dup.size > 0;
  $('compareNote').innerHTML = multi
    ? '同じ国の都市を並べています。「国」と付いた行は国ぜんたいの数字なので、'
      + '都市が違っても同じ値になります。'
    : '';
  $('compareNote').classList.toggle('is-hidden', !multi);
}

/* ------------------------------------------------------------
 *  時差
 * ---------------------------------------------------------- */
let clockTimer = null;

function setupClock() {
  const input = $('clockSearch');
  const clear = $('clockClear');
  input.addEventListener('input', () => {
    clear.classList.toggle('is-hidden', !input.value);
    renderClock();
  });
  clear.addEventListener('click', () => {
    input.value = ''; clear.classList.add('is-hidden'); renderClock();
  });
}

function renderClock() {
  const now = new Date();
  const q = $('clockSearch').value.trim();

  $('nowJapan').innerHTML =
    `<span class="now__label">${APP.homeName}</span>
     <span class="now__time">${esc(localTime(APP.homeTz, now))}</span>`;

  const rows = [];
  orderedCountries().forEach((c) => {
    if (!matches(c, q)) return;
    c.cities.forEach((city, i) => {
      // 同じ国でタイムゾーンが同じ都市は、代表だけ出します
      if (i > 0 && c.cities.slice(0, i).some((x) => x.tz === city.tz)) return;
      rows.push({ c, city, h: hoursFromJapan(city.tz, now) });
    });
  });

  const row = ({ c, city, h }) => {
    const shift = dayShift(city.tz, now);
    const day = shift === 0 ? '' : shift > 0 ? '<span class="daymark">翌日</span>'
                                             : '<span class="daymark">前日</span>';
    return `<li class="list__item" data-code="${c.code}">
      <span class="clock__diff">${formatDiff(h)}</span>
      <div class="list__body">
        <p class="list__name">${c.flag} ${esc(c.ja)}
          <span class="list__city">${esc(city.ja)}</span></p>
        <p class="list__sub">${esc(city.tz)}</p>
      </div>
      <span class="clock__time">${esc(localTime(city.tz, now))}${day}</span>
    </li>`;
  };

  if (!rows.length) {
    $('clockList').innerHTML = '<li class="empty"><svg class="empty__i" aria-hidden="true"><use href="#i-search"/></svg>見つかりませんでした。</li>';
    return;
  }

  // 探すタブと同じで、絞っていないときだけエリアで分けます。
  // 絞り込んだときは件数が減るので、時差の順に一列で並べたほうが読めます。
  if (q) {
    rows.sort((a, b) => a.h - b.h || a.c.ja.localeCompare(b.c.ja, 'ja'));
    $('clockList').innerHTML = rows.map(row).join('');
    return;
  }

  // 並びは探すタブと共有。エリアの中の国順が3つのタブで揃います。
  const html = [];
  DB.regions.forEach((region) => {
    const inRegion = rows.filter((x) => x.c.region === region);
    if (!inRegion.length) return;
    html.push(`<li class="list__group">
      <svg class="list__group-i" aria-hidden="true"><use href="#i-pin"/></svg>
      ${esc(region)}
      <span class="list__group-n">${inRegion.length}</span></li>`);
    inRegion.forEach((x) => html.push(row(x)));
  });
  $('clockList').innerHTML = html.join('');
}

/* ------------------------------------------------------------
 *  詳細パネル
 * ---------------------------------------------------------- */
function openSheet(code, cityIndex) {
  const c = DB.byCode[code];
  if (!c) return;
  state.sheetCode = code;
  state.sheetCity = cityIndex || 0;

  $('sheetTitle').innerHTML = `${c.flag} ${esc(c.ja)}`;
  $('sheetBody').innerHTML = sheetHTML(c, state.sheetCity);
  $('sheet').classList.remove('is-hidden');
  $('sheetBackdrop').classList.remove('is-hidden');
  document.body.classList.add('is-locked');
  $('sheetBody').scrollTop = 0;
}

function closeSheet() {
  $('sheet').classList.add('is-hidden');
  $('sheetBackdrop').classList.add('is-hidden');
  document.body.classList.remove('is-locked');
}

function sheetHTML(c, ci) {
  const city = c.cities[ci];
  const m = climateOf(c.code, ci);
  const s = seasonOf(c.code, ci);
  const now = new Date();
  const M = state.month;
  const out = [];

  // ---- 見出しの下の要約 ----
  out.push(`<p class="sheet__lead">${esc(c.region)}・${esc(c.en)}
    ${c.direct ? '<span class="badge badge--direct">日本から直行便</span>'
               : '<span class="badge">乗り継ぎ</span>'}</p>`);

  const g = DB.guide[c.code];
  if (g && g.tips) out.push(`<p class="sheet__tips">${esc(g.tips)}</p>`);

  // ---- 都市の切り替え ----
  if (c.cities.length > 1) {
    out.push(`<div class="chips chips--city">` + c.cities.map((x, i) =>
      `<button type="button" class="chip${i === ci ? ' is-active' : ''}"
         data-city="${i}">${esc(x.ja)}</button>`).join('') + `</div>`);
  }

  // ---- 季節 ----
  out.push(sec('sun', 'いつ行くか'));
  if (m && s) {
    out.push(M
      ? `<p class="strip__caption">選んでいる月　<b>${MONTHS[M - 1]}</b>
         <span class="strip__caption-sub">「探す」タブの「いつ行く」で変えられます</span></p>`
      : '<p class="strip__caption strip__caption--none">'
        + '「探す」タブで月を選ぶと、その月に印が付きます</p>');
    out.push(`<table class="strip"><tr>${monthStrip(s, M)}</tr>
      <tr class="strip__labels">${monthLabels(M)}</tr></table>`);
    out.push(climateChart(m, M));

    // 実測だけでは「いつ行けばいいのか」が分からない国に、人が勧めている時期を添えます。
    // 機械の判定とは出どころが違うので、はっきり枠を分けて出します。
    const rec = DB.season[c.code];
    if (rec) {
      out.push(`<div class="rec">
        <p class="rec__head">一般に勧められている時期　<b>${esc(rec.when)}</b></p>
        <p class="rec__text">${esc(rec.text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>
        <p class="rec__src">${esc(DB.meta.guide.season_note)}</p>
      </div>`);
    }

    // 調べた内容で上げた月があれば、どの月をどう上げたのかを出します。
    // 印だけ付けて理由を書かないと、測った値と区別が付きません。
    const up = Object.keys(s.lifted || {});
    if (up.length) {
      const list = up.map(Number).sort((a, b) => a - b)
        .map((m) => `${m}月 ${s.lifted[m].from}→${s.lifted[m].to}`).join('　');
      out.push(`<div class="lift">
        <p class="lift__head"><i class="sw sw--lifted"></i>雨季の変わり目として上げた月　<b>${esc(list)}</b></p>
        <p class="lift__text">${esc(s.lifted_text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>
        <p class="lift__src">雨の実測だけだと、雨季の終わりかけまで一律に✕になります。
          旅行ガイドや旅行会社が「行ける時期」として挙げている月を、
          隣に良い月がある場合にかぎって1段上げています。上げるだけで、下げることはありません。</p>
      </div>`);
    }

    out.push('<p class="sec-note">◎○△✕ は天気（雨の少なさ）だけを表します。'
      + '暑さ寒さはマスの下の帯（<i class="sw sw--hot"></i>暑い '
      + '<i class="sw sw--cold"></i>寒い）で別に示しています。'
      + (s.relative ? '<br><b>この国は年中雨が多いので、'
        + '◎○△✕ はこの国の中での相対評価です。</b>'
        + '◎は上の「一般に勧められている時期」、'
        + '✕はこの国のなかでも特に雨の日が多い月です。' : '') + '</p>');

    out.push('<dl class="kv">');
    out.push(`<dt>${s.relative ? '勧められている時期（◎）' : '天気が良い時期'}</dt>
      <dd class="good">${esc(s.best_label)}</dd>`);
    out.push(`<dt>${s.relative ? '特に雨が多い時期' : '雨が多い時期'}</dt><dd>${s.worst.length
      ? `<span class="bad">${esc(s.worst_label)}</span>` : 'とくにありません'}</dd>`);
    out.push(`<dt>雨季</dt><dd>${s.rainy.length
      ? esc(s.rainy_label) : 'はっきりした雨季はありません'}</dd>`);
    out.push(`<dt>著しく暑い月</dt><dd>${s.hot.some(Boolean)
      ? `<span class="bad">${esc(s.hot_label)}</span>` : 'ありません'}</dd>`);
    out.push(`<dt>著しく寒い月</dt><dd>${s.cold.some(Boolean)
      ? `<span class="cool">${esc(s.cold_label)}</span>` : 'ありません'}</dd>`);
    if (s.storm) {
      out.push(`<dt>台風など</dt><dd><span class="bad">${esc(s.storm.label)}</span>
        ${s.storm.partial ? '<b>（国の一部だけ）</b>' : ''}
        ${esc(s.storm.text)}</dd>`);
    }
    if (s.notes.length) {
      out.push(`<dt>まとめ</dt><dd>${s.notes.map(esc).join('<br>')}</dd>`);
    }
    out.push('</dl>');

    if (M) {
      const r = s.reasons[M - 1];
      const why = Object.keys(r).length
        ? Object.entries(r).map(([k, v]) => `${k} −${v}`).join('、')
        : '引かれた点はありません';
      const temp = [];
      if (s.hot[M - 1]) temp.push('<span class="bad">著しく暑い月です</span>');
      if (s.cold[M - 1]) temp.push('<span class="cool">著しく寒い月です</span>');
      out.push(`<p class="why"><b>${MONTHS[M - 1]}の天気は ${s.scores[M - 1]}点</b>
        （${esc(why)}）<br>
        雨の日 ${s.wet[M - 1]}日／降水 ${m.p[M - 1]}mm<br>
        最高 ${m.tmax[M - 1]}℃／最低 ${m.tmin[M - 1]}℃／体感の最高 ${m.at[M - 1]}℃／
        湿度 ${m.rh[M - 1]}％${temp.length ? '<br>' + temp.join('　') : ''}</p>`);
    }
    out.push(`<p class="src">気温と降水は ${esc(DB.meta.climate.period)}の平均（${esc(city.ja)}）。
      出典は ${esc(DB.meta.climate.source)}。雨の日数は Open-Meteo（ERA5）の
      2016〜2025年から、1日1mm以上降った日を数えたものです。<br>
      どちらも格子で世界を覆ったデータなので、都市部の気温は気象台の観測値より
      0.5〜1℃低めに出ます。雨の日数は、ごく弱い雨まで拾うぶん実際より多めに出ます。
      月どうしを見比べる用途には十分ですが、絶対値をそのまま信じる数字ではありません。</p>`);
  } else {
    out.push('<p class="hint">この都市の気候データがありません。</p>');
  }

  // ---- 物価 ----
  out.push(fareBlock(c.code, s));

  out.push(sec('coin', '物価'));
  const p = DB.prices[c.code];
  const cats = DB.meta.prices.categories || [];
  if (p && cats.some((x) => typeof p[x.key] === 'number')) {
    out.push('<p class="sec-note">日本を100としたときの値です。'
      + '旅行者が実際に払うものに近い順に並べています。</p>');
    out.push('<div class="prices">' + cats.map((x) => {
      const v = p[x.key];
      if (typeof v !== 'number') return '';
      const word = v < 50 ? 'かなり安い' : v < 80 ? '安い'
        : v < 110 ? '日本と同じくらい' : v < 150 ? '高い' : 'かなり高い';
      const cls = v < 60 ? 'is-cheap' : v < 110 ? 'is-mid' : 'is-pricey';
      // 棒の長さ。200を上限にして、日本(100)が真ん中に来るようにします
      const w = Math.min(100, v / 2);
      return `<span class="prices__name">${esc(x.ja)}</span>
        <span class="prices__bar"><i class="${cls}" style="width:${w}%"></i></span>
        <span class="prices__n">${v}</span>
        <span class="prices__w">${word}</span>`;
    }).join('') + '</div>');

    if (typeof p.level === 'number') {
      out.push(`<dl class="kv"><dt>経済全体の物価水準（参考）</dt>
        <dd>${p.level}　<span class="src">家賃や医療費まで含む平均です。
        その国の暮らしの水準を表しますが、旅行の予算とはずれます</span></dd></dl>`);
    }
    out.push(`<p class="src">出典は${esc(DB.meta.prices.category_source)}。
      日本の値で割り直して100にしています。<br>
      以前はビッグマックの値段を出していましたが、旅行者の実感と正反対の数字が
      出ることが分かったのでやめました（タイはビッグマックだと日本より3割高く、
      外食全体では日本の3割です）。</p>`);
  } else if (p && p.note) {
    out.push(`<p class="note">${esc(p.note)}</p>`);
  } else {
    out.push('<p class="hint">データがありません。</p>');
  }

  // ---- 治安 ----
  out.push(sec('shield', '治安（外務省の危険情報）'));
  const sf = safetyOf(c.code);
  if (sf) {
    out.push(`<p class="lv lv--${sf.max}">
      ${sf.base === sf.max ? `レベル${sf.base}`
        : `全体はレベル${sf.base}、一部地域はレベル${sf.max}`}</p>`);
    out.push('<ul class="areas">' + sf.areas.map((a) =>
      `<li><span class="lvtag lvtag--${a.level}">レベル${a.level}</span>
       ${esc(DB.meta.safety.levels[a.level])}<br>
       <span class="areas__where">${esc(a.area)}</span></li>`).join('') + '</ul>');
    out.push(`<p class="src"><a href="${esc(sf.url)}" target="_blank" rel="noopener">
      外務省のこの国のページを開く</a>　（${esc(DB.meta.safety.updated)}時点）</p>`);
  } else {
    out.push('<p class="lv lv--0">危険情報は出ていません</p>');
    out.push(`<p class="src">「安全である」という意味ではなく、
      外務省が特段の注意喚起をしていないという意味です。
      <a href="${esc(DB.meta.safety.source_url)}" target="_blank" rel="noopener">一覧を見る</a></p>`);
  }

  // ---- 時差 ----
  out.push(sec('clock', '時差'));
  out.push('<dl class="kv">');
  // 同じタイムゾーンの都市はまとめます（ベトナムのように国内が1つの国が多いため）
  const zones = new Map();
  c.cities.forEach((x) => {
    if (!zones.has(x.tz)) zones.set(x.tz, []);
    zones.get(x.tz).push(x.ja);
  });
  zones.forEach((names, tz) => {
    const h = hoursFromJapan(tz, now);
    const shift = dayShift(tz, now);
    out.push(`<dt>${esc(names.join('・'))}</dt><dd><b>${formatDiff(h)}</b>
      いま ${esc(localTime(tz, now))}
      ${shift ? `（日本の${shift > 0 ? '翌日' : '前日'}）` : ''}
      <span class="src">${esc(tz)}</span></dd>`);
  });
  out.push('</dl>');
  if (zones.size > 1) {
    out.push(`<p class="src">この国には時間帯が ${zones.size} つあります。`
      + '行き先によって日本との差が変わります。</p>');
  }
  out.push(`<p class="src">端末が持つIANAのデータで、開いた瞬間に計算しています。
    サマータイムの切り替えも自動で反映されます。</p>`);

  // ---- 行事 ----
  out.push(sec('flag', '季節の行事'));
  if (g && g.events.length) {
    out.push('<ul class="events">' + g.events.map((e) => {
      const hit = M && e.months.includes(M);
      return `<li class="event${hit ? ' is-hit' : ''}">
        <p class="event__head">
          <span class="event__mark event__mark--${e.impact}">${
            e.impact === 'high' ? '要注意' : '見どころ'}</span>
          <b>${esc(e.name)}</b></p>
        <p class="event__when">${esc(e.when)}</p>
        <p class="event__text">${esc(e.text)}</p></li>`;
    }).join('') + '</ul>');
  } else {
    out.push('<p class="hint">記載がありません。</p>');
  }

  // ---- ルール ----
  out.push(sec('book', 'この国独自のルール'));
  if (g && g.rules.length) {
    out.push('<ul class="rules">' + g.rules.map((r) =>
      `<li class="rule"><b>${esc(r.title)}</b><br>${esc(r.text)}</li>`).join('') + '</ul>');
  } else {
    out.push('<p class="hint">記載がありません。</p>');
  }
  out.push(`<p class="caution">${esc(DB.meta.guide.caution)}</p>`);

  return out.join('');
}

/* ------------------------------------------------------------
 *  クリックの受け口
 * ---------------------------------------------------------- */
function setupSheet() {
  const open = (e) => {
    const row = e.target.closest('[data-code]');
    if (!row) return;
    openSheet(row.dataset.code, 0);
  };
  $('searchList').addEventListener('click', open);
  $('matrix').addEventListener('click', open);
  $('clockList').addEventListener('click', open);

  $('sheetClose').addEventListener('click', closeSheet);
  $('sheetBackdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });

  // 詳細パネルの中の都市切り替え
  $('sheetBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-city]');
    if (!b) return;
    state.sheetCity = +b.dataset.city;
    $('sheetBody').innerHTML = sheetHTML(DB.byCode[state.sheetCode], state.sheetCity);
  });
}


/* ------------------------------------------------------------
 *  出典
 * ---------------------------------------------------------- */
function renderSources() {
  const el = document.createElement('footer');
  el.className = 'sources';
  el.innerHTML = '<p class="sources__head">数字の出どころ</p><ul>'
    + SOURCES.map((s) => `<li>${esc(s.name)} … <a href="${esc(s.url)}"
        target="_blank" rel="noopener">${esc(s.by)}</a></li>`).join('')
    + '</ul>';
  document.querySelector('.page').appendChild(el);
}

/* ------------------------------------------------------------
 *  描き直し
 * ---------------------------------------------------------- */
function render() {
  if (state.tab === 'search') renderSearch();
  else if (state.tab === 'table') renderTable();
  else if (state.tab === 'compare') renderCompare();
  else if (state.tab === 'clock') renderClock();
}

/* ------------------------------------------------------------
 *  起動
 * ---------------------------------------------------------- */
async function boot() {
  setupTheme();
  try {
    await loadAll();
  } catch (err) {
    $('loading').classList.add('is-hidden');
    $('loadError').classList.remove('is-hidden');
    $('loadErrorText').textContent =
      `${err.message}　index.html を直接開くとこうなります。`
      + 'README の「Mac で確認する」の手順で、簡易サーバー越しに開いてください。';
    return;
  }

  restore();
  trackHeaderHeight();
  setupTabs();
  setupFilters();
  setupCompare();
  setupClock();
  setupSheet();
  setupMonthChips($('monthChips'), () => state.month, (v) => { state.month = v; });
  setupMonthChips($('compareMonthChips'), () => state.compareMonth,
    (v) => { state.compareMonth = v; });
  renderSources();

  $('loading').classList.add('is-hidden');
  $('viewSearch').classList.remove('is-hidden');
  render();

  // 時計は1分ごとに直します
  clockTimer = setInterval(() => {
    if (state.tab === 'clock') renderClock();
  }, 60000);
}

boot();
