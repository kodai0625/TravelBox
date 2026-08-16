/* ============================================================
 *  Pack Board — 画面の組み立て
 *
 *  【このアプリの決めごと】
 *  ・データは端末の中（localStorage）だけに置きます。
 *    サーバーはありません。機内でも山の中でも動きます。
 *    そのかわり、端末を変えると引き継げません。
 *  ・**消す操作は必ず取り消せるようにします。**
 *    持ち物の登録は積み上げるものなので、誤って消したときに
 *    やり直せないと、また一から入れ直すことになります。
 * ============================================================ */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** 並べ替えや削除で番号がずれないよう、項目ごとに変わらない名札を付けます */
let seq = 0;
const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

const state = {
  lists: [],
  activeId: null,
  editing: false,     // 編集モード（消す・並べ替えるボタンを出す）
  undo: null,         // 直前に消したもの。取り消しに使います
};

const catName = (id) => (CATEGORIES.find((c) => c.id === id) || {}).name || 'そのほか';

/* ------------------------------------------------------------
 *  保存と読み込み
 * ---------------------------------------------------------- */
function save() {
  try {
    localStorage.setItem(APP.storageKey, JSON.stringify({
      lists: state.lists, activeId: state.activeId,
    }));
  } catch (e) {
    toast('保存できませんでした。端末の空き容量を確かめてください。');
  }
}

function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(APP.storageKey) || 'null'); }
  catch (e) { raw = null; }

  if (raw && Array.isArray(raw.lists) && raw.lists.length) {
    state.lists = raw.lists;
    state.activeId = raw.activeId || raw.lists[0].id;
    // 保存したデータに知らない分類があっても落ちないようにします
    state.lists.forEach((l) => l.items.forEach((it) => {
      if (!CATEGORIES.some((c) => c.id === it.cat)) it.cat = 'other';
    }));
    return;
  }

  // はじめて開いたとき。config.js の種からリストを作ります。
  state.lists = SEEDS.map((s) => ({
    id: newId(),
    name: s.name,
    items: s.items.map(([cat, name, note]) => ({
      id: newId(), cat, name, note: note || '', done: false,
    })),
  }));
  state.activeId = state.lists[0].id;
  save();
}

const activeList = () => state.lists.find((l) => l.id === state.activeId) || state.lists[0];

/* ------------------------------------------------------------
 *  短い知らせ（更新ボタンと同じ見た目）
 * ---------------------------------------------------------- */
function toast(text, undoLabel, onUndo) {
  document.querySelectorAll('.toast').forEach((e) => e.remove());
  const el = document.createElement('p');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.append(text);
  if (undoLabel) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast__btn';
    b.textContent = undoLabel;
    b.addEventListener('click', () => { onUndo(); el.remove(); });
    el.append(b);
  }
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-on'));
  // 取り消せる知らせは長めに出します。押す時間が要るためです。
  setTimeout(() => {
    el.classList.remove('is-on');
    setTimeout(() => el.remove(), 400);
  }, undoLabel ? 8000 : 3200);
}

/* ------------------------------------------------------------
 *  リストの切り替え
 * ---------------------------------------------------------- */
function renderTabs() {
  const l = activeList();
  $('listChips').innerHTML = state.lists.map((x) => {
    const left = x.items.filter((i) => !i.done).length;
    return `<button type="button" class="chip${x.id === l.id ? ' is-active' : ''}"
      data-list="${esc(x.id)}">${esc(x.name)}<span class="chip__n">${
      left ? left : '済'}</span></button>`;
  }).join('')
    + `<button type="button" class="chip chip--add" id="addListBtn">＋ リストを作る</button>`;
}

/* ------------------------------------------------------------
 *  進みぐあい
 * ---------------------------------------------------------- */
function renderProgress() {
  const l = activeList();
  const done = l.items.filter((i) => i.done).length;
  const all = l.items.length;
  const pct = all ? Math.round((done / all) * 100) : 0;
  const left = all - done;

  $('progress').innerHTML = `
    <p class="prog__head">
      <span class="prog__name">${esc(l.name)}</span>
      <span class="prog__count">${done} / ${all}</span>
    </p>
    <div class="prog__bar"><i style="width:${pct}%"></i></div>
    <p class="prog__msg">${all === 0
      ? '持ち物をまだ登録していません。下から足してください。'
      : (left === 0
        ? '<b>全部入れました。</b>行ってらっしゃい。'
        : `あと <b>${left}</b> 個です`)}</p>`;
}

/* ------------------------------------------------------------
 *  持ち物の一覧
 *
 *  分類ごとにまとめます。上から順に見れば、大事なものから
 *  確認できる並びにしています（config.js の CATEGORIES の順）。
 * ---------------------------------------------------------- */
function renderItems() {
  const l = activeList();
  if (!l.items.length) {
    $('items').innerHTML = `<p class="empty">
      <svg class="empty__i" aria-hidden="true"><use href="#i-case"/></svg>
      まだ何も登録されていません。<br>下の「持ち物を足す」から入れてください。</p>`;
    return;
  }

  const rows = CATEGORIES.map((c) => {
    const items = l.items.filter((i) => i.cat === c.id);
    if (!items.length) return '';
    const done = items.filter((i) => i.done).length;
    return `<section class="group">
      <h2 class="group__head">${esc(c.name)}
        <span class="group__n">${done}/${items.length}</span></h2>
      <ul class="items">${items.map(itemRow).join('')}</ul>
    </section>`;
  }).join('');

  $('items').innerHTML = rows;
}

function itemRow(it) {
  return `<li class="item${it.done ? ' is-done' : ''}" data-item="${esc(it.id)}">
    <button type="button" class="item__check" aria-pressed="${it.done}"
      aria-label="${esc(it.name)}をカバンに入れた">
      <svg class="item__tick" aria-hidden="true"><use href="#i-check"/></svg>
    </button>
    <span class="item__body">
      <span class="item__name">${esc(it.name)}</span>
      ${it.note ? `<span class="item__note">${esc(it.note)}</span>` : ''}
    </span>
    ${state.editing ? `
      <button type="button" class="item__edit" data-edit="${esc(it.id)}"
        aria-label="${esc(it.name)}を直す">直す</button>
      <button type="button" class="item__del" data-del="${esc(it.id)}"
        aria-label="${esc(it.name)}を消す">
        <svg aria-hidden="true"><use href="#i-trash"/></svg>
      </button>` : ''}
  </li>`;
}

function render() {
  renderTabs();
  renderProgress();
  renderItems();
  $('editBtn').textContent = state.editing ? '編集をやめる' : '編集';
  $('editBtn').classList.toggle('is-on', state.editing);
  document.body.classList.toggle('is-editing', state.editing);
}

/* ------------------------------------------------------------
 *  持ち物を足す・直す
 * ---------------------------------------------------------- */
function openItemForm(id) {
  const l = activeList();
  const it = id ? l.items.find((x) => x.id === id) : null;
  $('formTitle').textContent = it ? '持ち物を直す' : '持ち物を足す';
  $('fName').value = it ? it.name : '';
  $('fNote').value = it ? it.note : '';
  $('fCat').innerHTML = CATEGORIES.map((c) =>
    `<option value="${c.id}"${it && it.cat === c.id ? ' selected' : ''}>${esc(c.name)}</option>`
  ).join('');
  if (!it) $('fCat').value = 'other';
  $('itemForm').dataset.editing = it ? it.id : '';
  $('itemForm').classList.remove('is-hidden');
  $('formBackdrop').classList.remove('is-hidden');
  document.body.classList.add('is-locked');
  setTimeout(() => $('fName').focus(), 50);
}

function closeItemForm() {
  $('itemForm').classList.add('is-hidden');
  $('formBackdrop').classList.add('is-hidden');
  document.body.classList.remove('is-locked');
}

function submitItemForm() {
  const name = $('fName').value.trim();
  if (!name) { toast('名前を入れてください'); $('fName').focus(); return; }
  const l = activeList();
  const id = $('itemForm').dataset.editing;

  if (id) {
    const it = l.items.find((x) => x.id === id);
    if (it) { it.name = name; it.note = $('fNote').value.trim(); it.cat = $('fCat').value; }
  } else {
    if (l.items.length >= APP.maxItems) {
      toast(`1つのリストに入れられるのは ${APP.maxItems} 個までです`);
      return;
    }
    l.items.push({ id: newId(), cat: $('fCat').value, name,
                   note: $('fNote').value.trim(), done: false });
  }
  save(); closeItemForm(); render();
}

/* ------------------------------------------------------------
 *  消す（必ず取り消せるようにします）
 * ---------------------------------------------------------- */
function removeItem(id) {
  const l = activeList();
  const i = l.items.findIndex((x) => x.id === id);
  if (i < 0) return;
  const [gone] = l.items.splice(i, 1);
  save(); render();
  toast(`「${gone.name}」を消しました`, '元に戻す', () => {
    l.items.splice(i, 0, gone);
    save(); render();
  });
}

function removeList(id) {
  if (state.lists.length <= 1) {
    toast('最後の1つは消せません。名前を変えて使ってください。');
    return;
  }
  const i = state.lists.findIndex((x) => x.id === id);
  if (i < 0) return;
  const [gone] = state.lists.splice(i, 1);
  if (state.activeId === id) state.activeId = state.lists[0].id;
  save(); render();
  toast(`リスト「${gone.name}」を消しました`, '元に戻す', () => {
    state.lists.splice(i, 0, gone);
    state.activeId = gone.id;
    save(); render();
  });
}

/* ------------------------------------------------------------
 *  リストの操作
 * ---------------------------------------------------------- */
function addList() {
  if (state.lists.length >= APP.maxLists) {
    toast(`リストは ${APP.maxLists} 個までです`);
    return;
  }
  const name = prompt('リストの名前（例：ハワイ、冬の出張）');
  if (name === null) return;
  const t = name.trim();
  if (!t) return;
  const l = { id: newId(), name: t, items: [] };
  state.lists.push(l);
  state.activeId = l.id;
  save(); render();
  toast(`「${t}」を作りました。持ち物を足してください。`);
}

function renameList() {
  const l = activeList();
  const name = prompt('リストの名前', l.name);
  if (name === null) return;
  const t = name.trim();
  if (!t) return;
  l.name = t;
  save(); render();
}

function copyList() {
  if (state.lists.length >= APP.maxLists) {
    toast(`リストは ${APP.maxLists} 個までです`);
    return;
  }
  const l = activeList();
  const copy = {
    id: newId(),
    name: l.name + 'のうつし',
    // うつした先ではチェックを外します。前の旅行の跡が残ると紛らわしいためです
    items: l.items.map((it) => ({ ...it, id: newId(), done: false })),
  };
  state.lists.push(copy);
  state.activeId = copy.id;
  save(); render();
  toast(`「${copy.name}」を作りました`);
}

/** 次の旅行にそなえてチェックだけ外します。項目は消しません。 */
function resetChecks() {
  const l = activeList();
  const before = l.items.filter((i) => i.done).map((i) => i.id);
  if (!before.length) { toast('チェックはまだ付いていません'); return; }
  l.items.forEach((i) => { i.done = false; });
  save(); render();
  toast(`${before.length} 個のチェックを外しました`, '元に戻す', () => {
    l.items.forEach((i) => { if (before.includes(i.id)) i.done = true; });
    save(); render();
  });
}

/* ------------------------------------------------------------
 *  組み立て
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

function init() {
  setupTheme();
  load();
  render();

  // ---- リストの切り替え ----
  $('listChips').addEventListener('click', (e) => {
    if (e.target.closest('#addListBtn')) { addList(); return; }
    const b = e.target.closest('[data-list]');
    if (!b) return;
    state.activeId = b.dataset.list;
    save(); render();
    window.scrollTo(0, 0);
  });

  // ---- 持ち物のチェックと編集 ----
  $('items').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { removeItem(del.dataset.del); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) { openItemForm(ed.dataset.edit); return; }
    const li = e.target.closest('[data-item]');
    if (!li) return;
    const it = activeList().items.find((x) => x.id === li.dataset.item);
    if (!it) return;
    it.done = !it.done;
    save();
    // 1件の切り替えで画面全部を作り直すと、押した場所が飛びます。
    // そこで、変わったところだけを直します。
    //   その行 ／ 上の進みぐあい ／ リストの残り数 ／ **その分類の数**
    // 最後のひとつを忘れていて、見出しの数だけ古いままになっていました。
    li.classList.toggle('is-done', it.done);
    li.querySelector('.item__check').setAttribute('aria-pressed', String(it.done));
    const group = li.closest('.group');
    if (group) {
      const items = [...group.querySelectorAll('.item')];
      group.querySelector('.group__n').textContent =
        `${items.filter((x) => x.classList.contains('is-done')).length}/${items.length}`;
    }
    renderProgress();
    renderTabs();
  });

  // ---- ボタン ----
  $('addItemBtn').addEventListener('click', () => openItemForm(''));
  $('editBtn').addEventListener('click', () => { state.editing = !state.editing; render(); });
  $('resetBtn').addEventListener('click', resetChecks);
  $('renameBtn').addEventListener('click', renameList);
  $('copyBtn').addEventListener('click', copyList);
  $('delListBtn').addEventListener('click', () => removeList(state.activeId));

  // ---- 入力欄 ----
  $('formSave').addEventListener('click', submitItemForm);
  $('formCancel').addEventListener('click', closeItemForm);
  $('formBackdrop').addEventListener('click', closeItemForm);
  $('fName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitItemForm(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('itemForm').classList.contains('is-hidden')) closeItemForm();
  });

  $('homeBtn').addEventListener('click', () => window.scrollTo(0, 0));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
