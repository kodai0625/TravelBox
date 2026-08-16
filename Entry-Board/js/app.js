/* ============================================================
 *  Entry Board — 画面の組み立て
 *
 *  このアプリのいちばんの役目は「偽サイトで金を払わせない」ことです。
 *  ですから、どの手続きにも**料金を必ず出します**。
 *  無料と書いてあるものにお金を求められたら、そこは偽サイトです。
 *
 *  リンクは data/entry.json のものだけを使います。
 *  そのURLは組み立てのときに、政府ドメインかどうかを機械で確かめています
 *  （tools/check_entry_urls.py）。★画面側で URL を組み立てないでください。
 * ============================================================ */

const $ = (id) => document.getElementById(id);

const DB = { entry: {}, meta: {}, list: [] };
const state = { query: '', filter: '' };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 太字（**…**）だけを通します。データに書いた強調をそのまま出すためです */
const emph = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

/* ------------------------------------------------------------
 *  読み込み
 * ---------------------------------------------------------- */
async function loadAll() {
  const res = await fetch(DATA_FILES.entry, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${DATA_FILES.entry} が読めません（${res.status}）`);
  const data = await res.json();
  DB.entry = data.entry;
  DB.meta = data.meta;
  // 並びは Trip Board と同じエリア順にします。
  // 2つのアプリを行き来したときに、同じ場所に同じ国があるようにするためです。
  DB.list = Object.keys(DB.entry).map((code) => ({ code, ...DB.entry[code] }));
}

/* ------------------------------------------------------------
 *  探す
 *  ひらがな・カタカナ・英語のどれでも引けるようにします。
 * ---------------------------------------------------------- */
function kataToHira(s) {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function matches(c, query) {
  const q = kataToHira(query).toLowerCase().trim();
  if (!q) return true;
  if (!c._search) {
    const raw = `${c.name} ${c.en} ${c.code} ${c.region}`;
    c._search = `${raw} ${kataToHira(raw)}`.toLowerCase();
  }
  return q.split(/\s+/).every((w) => c._search.includes(w));
}

/* ------------------------------------------------------------
 *  部品
 * ---------------------------------------------------------- */
function hostOf(url) {
  const m = /^https?:\/\/([^/]+)/.exec(url);
  return m ? m[1] : url;
}

/** 公式サイトへのボタン。
 *  ホスト名をわざと出しています。押す前に「政府のドメインか」を
 *  自分の目でも確かめられるようにするためです。 */
function officialLink(url, label) {
  return `<a class="gov" href="${esc(url)}" target="_blank" rel="noopener">
    <span class="gov__body">
      <span class="gov__label">${esc(label)}</span>
      <span class="gov__url">${esc(hostOf(url))}</span>
    </span>
    <svg class="gov__i" aria-hidden="true"><use href="#i-external"/></svg>
  </a>`;
}

/** 料金の札。無料は緑。ここがこのアプリの肝です */
function feeTag(fee) {
  if (!fee) return '';
  const free = fee.indexOf('無料') === 0;
  return `<span class="fee${free ? ' fee--free' : ''}">${esc(fee)}</span>`;
}

/** 一覧の行に出す短いしるし */
function tags(c) {
  const out = [];
  out.push(c.card
    ? '<span class="etag etag--card">電子入国書</span>'
    : '<span class="etag etag--dim">電子入国書なし</span>');
  if (c.visa.need === '要る') out.push('<span class="etag etag--visa">ビザが要る</span>');
  else if (c.visa.need === '現地で取れる') out.push('<span class="etag etag--onsite">現地でビザ</span>');
  const n = (c.other || []).length;
  if (n) out.push(`<span class="etag etag--other">申請 ${n}</span>`);
  return out.join('');
}

/** 手続きの中身 */
function procsHTML(c) {
  const out = [];

  if (c.card) {
    const k = c.card;
    out.push(`<div class="proc proc--card">
      <p class="proc__head"><span class="proc__kind">電子入国書</span>
        ${esc(k.name)} ${feeTag(k.fee)}</p>
      <p class="proc__when">出せるのは ${esc(k.when)}</p>
      ${k.note ? `<p class="proc__note">${emph(k.note)}</p>` : ''}
      ${officialLink(k.url, '公式サイトを開く')}
    </div>`);
  } else if (c.nocard_note) {
    out.push(`<div class="proc proc--none">
      <p class="proc__head"><span class="proc__kind proc__kind--none">電子入国書</span>
        なし</p>
      <p class="proc__note">${emph(c.nocard_note)}</p>
    </div>`);
  }

  const v = c.visa;
  const cls = v.need === '不要' ? 'proc--ok'
            : v.need === '要る' ? 'proc--need' : 'proc--onsite';
  out.push(`<div class="proc ${cls}">
    <p class="proc__head"><span class="proc__kind">ビザ</span>
      ${esc(v.need)}${v.stay ? `<span class="proc__stay">${esc(v.stay)}</span>` : ''}
      ${feeTag(v.fee)}</p>
    ${v.note ? `<p class="proc__note">${emph(v.note)}</p>` : ''}
    ${v.url ? officialLink(v.url, '公式サイトを開く') : ''}
  </div>`);

  (c.other || []).forEach((o) => {
    out.push(`<div class="proc proc--other">
      <p class="proc__head"><span class="proc__kind">そのほか</span>
        ${esc(o.name)} ${feeTag(o.fee)}</p>
      ${o.when ? `<p class="proc__when">${esc(o.when)}</p>` : ''}
      ${o.note ? `<p class="proc__note">${emph(o.note)}</p>` : ''}
      ${officialLink(o.url, '公式サイトを開く')}
    </div>`);
  });

  return out.join('');
}

/* ------------------------------------------------------------
 *  一覧
 * ---------------------------------------------------------- */
function render() {
  const q = state.query.trim();
  const rows = DB.list.filter((c) => {
    if (!matches(c, q)) return false;
    if (state.filter === 'card') return !!c.card;
    if (state.filter === 'visa') return c.visa.need !== '不要';
    if (state.filter === 'todo') {
      return !!c.card || c.visa.need !== '不要' || (c.other || []).length > 0;
    }
    return true;
  });

  const row = (c) => `<li class="list__item" data-code="${c.code}">
    <div class="list__body">
      <p class="list__name">${c.flag} ${esc(c.name)}</p>
      <p class="etags">${tags(c)}</p>
    </div>
    <span class="list__chev" aria-hidden="true">›</span>
  </li>`;

  if (!rows.length) {
    $('list').innerHTML = `<li class="empty">
      <svg class="empty__i" aria-hidden="true"><use href="#i-search"/></svg>
      見つかりませんでした。</li>`;
    return;
  }

  // 絞り込んでいるときは件数が減るので、エリアで分けずに一列で並べます
  if (q || state.filter) {
    $('list').innerHTML = rows.map(row).join('');
    return;
  }

  const html = [];
  (DB.meta.regions || []).forEach((region) => {
    const inRegion = rows.filter((c) => c.region === region);
    if (!inRegion.length) return;
    html.push(`<li class="list__group">
      <svg class="list__group-i" aria-hidden="true"><use href="#i-pin"/></svg>
      ${esc(region)}
      <span class="list__group-n">${inRegion.length}</span></li>`);
    inRegion.forEach((c) => html.push(row(c)));
  });
  $('list').innerHTML = html.join('');
}

function openSheet(code) {
  const c = DB.entry[code];
  if (!c) return;
  $('sheetTitle').innerHTML = `${c.flag} ${esc(c.name)}`;
  $('sheetBody').innerHTML =
    `<div class="procs">${procsHTML(c)}</div>
     <p class="proc__caution">入国の決まりは国が随時変えます。
       <strong>出発の前に、かならず上の公式サイトで最新を確かめてください。</strong></p>`;
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

/* ------------------------------------------------------------
 *  出典
 * ---------------------------------------------------------- */
function renderSources() {
  const el = document.createElement('footer');
  el.className = 'sources';
  el.innerHTML = '<p class="sources__head">話の出どころ</p><ul>'
    + SOURCES.map((s) => `<li>${esc(s.name)} … <a href="${esc(s.url)}"
        target="_blank" rel="noopener">${esc(s.by)}</a></li>`).join('')
    + `</ul><p class="sources__note">${emph(DB.meta.note || '')}</p>`;
  document.querySelector('.page').appendChild(el);
}

/* ------------------------------------------------------------
 *  明暗
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
 *  起動
 * ---------------------------------------------------------- */
async function boot() {
  setupTheme();
  try {
    await loadAll();
  } catch (e) {
    $('loading').classList.add('is-hidden');
    $('loadError').classList.remove('is-hidden');
    $('loadErrorText').textContent =
      'データを読み込めませんでした。通信を確かめて開き直してください。（' + e.message + '）';
    return;
  }

  $('warnText').innerHTML = emph(DB.meta.warning || '');

  // 日本に帰るときの手続き。行き先ではないので上に別枠で出します
  const j = DB.meta.japan;
  if (j) {
    $('japan').innerHTML = `<p class="vjw__head">
        帰りの日本で使うもの ${feeTag(j.fee)}</p>
      <p class="vjw__name">${esc(j.name)}</p>
      <p class="vjw__note">${emph(j.note)}</p>
      ${officialLink(j.url, '公式サイトを開く')}`;
  }

  $('filterChips').innerHTML = FILTERS.map((f, i) =>
    `<button type="button" class="chip${i === 0 ? ' is-active' : ''}"
       data-filter="${f.id}">${esc(f.name)}</button>`).join('');
  $('filterChips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.filter = b.dataset.filter;
    $('filterChips').querySelectorAll('.chip').forEach((x) =>
      x.classList.toggle('is-active', x === b));
    render();
  });

  const input = $('search');
  const clear = $('searchClear');
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

  $('list').addEventListener('click', (e) => {
    const li = e.target.closest('[data-code]');
    if (li) openSheet(li.dataset.code);
  });
  $('sheetClose').addEventListener('click', closeSheet);
  $('sheetBackdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('sheet').classList.contains('is-hidden')) closeSheet();
  });
  $('homeBtn').addEventListener('click', () => window.scrollTo(0, 0));

  $('loading').classList.add('is-hidden');
  $('view').classList.remove('is-hidden');
  render();
  renderSources();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
