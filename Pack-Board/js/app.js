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
  cats: [],           // 分類。あとから足せるので、端末の中に保存します
  activeId: null,
  editing: false,     // 編集モード（消す・並べ替えるボタンを出す）
  undo: null,         // 直前に消したもの。取り消しに使います
};

const catName = (id) => (state.cats.find((c) => c.id === id) || {}).name || 'そのほか';

/** どの分類にも入らなくなった持ち物の行き先。
 *  分類を消したときに持ち物まで消えないようにするための受け皿です。 */
function fallbackCat() {
  const other = state.cats.find((c) => c.id === 'other');
  return (other || state.cats[state.cats.length - 1] || { id: 'other' }).id;
}

/* ------------------------------------------------------------
 *  保存と読み込み
 * ---------------------------------------------------------- */
function save() {
  try {
    localStorage.setItem(APP.storageKey, JSON.stringify({
      lists: state.lists, cats: state.cats, activeId: state.activeId,
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
    // ★分類を端末に持つようにする前の保存データには cats がありません。
    //   そのときは config.js の分類を写して、そのまま使えるようにします。
    state.cats = Array.isArray(raw.cats) && raw.cats.length
      ? raw.cats : CATEGORIES.map((c) => ({ ...c }));
    // ★しるしを付ける前に保存した分類には icon がありません。
    //   はじめからある分類は、名前が合うものからしるしを補います。
    //   これをしないと、7つとも荷札のしるしになってしまいます。
    state.cats.forEach((c) => {
      if (c.icon) return;
      const seed = CATEGORIES.find((x) => x.id === c.id);
      if (seed && seed.icon) c.icon = seed.icon;
    });
    state.activeId = raw.activeId || raw.lists[0].id;
    // 保存したデータに知らない分類があっても落ちないようにします
    state.lists.forEach((l) => l.items.forEach((it) => {
      if (!state.cats.some((c) => c.id === it.cat)) it.cat = fallbackCat();
    }));
    return;
  }

  // はじめて開いたとき。config.js の種からリストを作ります。
  state.cats = CATEGORIES.map((c) => ({ ...c }));
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

  // 輪の周の長さ。半径から出しておくと、CSS と数字がずれません
  const R = 26;
  const C = 2 * Math.PI * R;

  $('progress').innerHTML = `
    <div class="prog__ring" role="img"
         aria-label="${all} 個のうち ${done} 個を入れました">
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle class="prog__track" cx="32" cy="32" r="${R}"/>
        <circle class="prog__fill" cx="32" cy="32" r="${R}"
          stroke-dasharray="${C.toFixed(1)}"
          stroke-dashoffset="${(C * (1 - pct / 100)).toFixed(1)}"/>
      </svg>
      <span class="prog__pct">${pct}<i>%</i></span>
    </div>
    <div class="prog__body">
      <p class="prog__head">
        <span class="prog__name">${esc(l.name)}</span>
        <span class="prog__count">${done} / ${all}</span>
      </p>
      <p class="prog__msg">${all === 0
        ? '持ち物をまだ登録していません。下から足してください。'
        : (left === 0
          ? '<b>全部入れました。</b>行ってらっしゃい。'
          : `あと <b>${left}</b> 個です`)}</p>
    </div>`;
}

/* ------------------------------------------------------------
 *  持ち物の一覧
 *
 *  分類ごとにまとめます。上から順に見れば、大事なものから
 *  確認できる並びにしています（config.js の CATEGORIES の順）。
 * ---------------------------------------------------------- */
function renderItems() {
  const l = activeList();

  // 空の分類も出します。作ったばかりの分類が消えて見えると、
  // 足せたのかどうか分からなくなるためです。
  const rows = state.cats.map((c) => {
    const items = l.items.filter((i) => i.cat === c.id);
    const done = items.filter((i) => i.done).length;
    // 自分で足した分類には荷札のしるしを付けます
    const icon = c.icon || 'tag';
    return `<section class="group" data-cat="${esc(c.id)}">
      <h2 class="group__head">
        <svg class="group__i" aria-hidden="true"><use href="#i-c-${esc(icon)}"/></svg>
        <span class="group__name">${esc(c.name)}</span>
        <span class="group__n">${done}/${items.length}</span>
        ${state.editing ? `<button type="button" class="group__del"
          data-catdel="${esc(c.id)}" aria-label="${esc(c.name)}を消す">
          <svg aria-hidden="true"><use href="#i-trash"/></svg></button>` : ''}
      </h2>
      <ul class="items">${items.map(itemRow).join('')}</ul>
      <button type="button" class="group__add" data-catadd="${esc(c.id)}"
        aria-label="${esc(c.name)}に持ち物を足す">＋ ここに足す</button>
    </section>`;
  }).join('');

  $('items').innerHTML = rows
    + `<button type="button" class="catadd" id="addCatBtn">＋ 分類を足す</button>`
    + `<p class="catnote">分類は<strong>ぜんぶのリストで共通</strong>です。`
    + `ここで足すと、ほかのリストにも同じ分類が出ます。</p>`;
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
/** id を渡すと直す、渡さなければ足す。
 *  cat を渡すと、その分類をはじめから選んだ状態で開きます
 *  （各分類の下の「＋ ○○に足す」から呼ばれます）。 */
function openItemForm(id, cat) {
  const l = activeList();
  const it = id ? l.items.find((x) => x.id === id) : null;
  $('formTitle').textContent = it ? '持ち物を直す' : '持ち物を足す';
  $('fName').value = it ? it.name : '';
  $('fNote').value = it ? it.note : '';
  $('fCat').innerHTML = state.cats.map((c) =>
    `<option value="${c.id}"${it && it.cat === c.id ? ' selected' : ''}>${esc(c.name)}</option>`
  ).join('');
  // 足すときの分類。「＋ ○○に足す」から来たらその分類、
  // ふつうの「持ち物を足す」からなら受け皿の分類にします
  if (!it) $('fCat').value = cat && state.cats.some((c) => c.id === cat)
    ? cat : fallbackCat();
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

/**
 * 見本（config.js の SEEDS）にあって、いまのリストに無いものを足します。
 *
 * 見本は「はじめて開いたときに一度だけ写す種」なので、あとから見本を
 * 増やしても、すでに使っている端末には届きません。それを届ける道です。
 *
 * ★消したものが勝手に戻ってこないよう、**押したときだけ**足します。
 *   自動で足すと、いらないから消したものが毎回よみがえります。
 */
function addFromSeed() {
  const l = activeList();
  const seed = SEEDS.find((s) => s.name === l.name);
  if (!seed) {
    toast(`「${l.name}」に合う見本がありません（見本：`
      + SEEDS.map((s) => s.name).join('／') + '）');
    return;
  }
  // 同じ名前のものは足しません。書きかたのゆれ（空白・大文字小文字）は同じとみなします
  const key = (s) => s.replace(/[\s　]/g, '').toLowerCase();
  const have = new Set(l.items.map((it) => key(it.name)));
  const missing = seed.items.filter(([, name]) => !have.has(key(name)));

  if (!missing.length) { toast('足りないものはありませんでした'); return; }
  if (l.items.length + missing.length > APP.maxItems) {
    toast(`1つのリストは ${APP.maxItems} 個までです`);
    return;
  }

  const added = missing.map(([cat, name, note]) => ({
    id: newId(), cat, name, note: note || '', done: false,
  }));
  l.items.push(...added);
  save(); render();

  const ids = new Set(added.map((it) => it.id));
  toast(`${added.length} 個足しました`, '元に戻す', () => {
    l.items = l.items.filter((it) => !ids.has(it.id));
    save(); render();
  });
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
 *  分類の操作（あとから足す・消す）
 * ---------------------------------------------------------- */
function addCategory() {
  const name = prompt('分類の名前（例：カメラまわり、子どもの物）');
  if (name === null) return;
  const t = name.trim();
  if (!t) return;
  if (state.cats.some((c) => c.name === t)) {
    toast(`「${t}」はもうあります`);
    return;
  }
  const c = { id: 'c' + newId(), name: t, icon: 'tag' };
  state.cats.push(c);
  save(); render();
  // 作った分類まで画面を送ります。下に足されるので、そのままだと見えません
  const el = document.querySelector(`[data-cat="${c.id}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast(`「${t}」を作りました`, '元に戻す', () => {
    state.cats = state.cats.filter((x) => x.id !== c.id);
    save(); render();
  });
}

/**
 * 分類を消します。
 * ★中の持ち物は消しません。受け皿の分類（そのほか）へ移します。
 *   分類を整理しただけで持ち物まで消えると、取り返しがつかないためです。
 */
function removeCategory(id) {
  if (state.cats.length <= 1) {
    toast('最後の1つは消せません');
    return;
  }
  const i = state.cats.findIndex((c) => c.id === id);
  if (i < 0) return;
  const [gone] = state.cats.splice(i, 1);
  const to = fallbackCat();
  // どの持ち物を動かしたか覚えておきます（取り消しのため）
  const moved = [];
  state.lists.forEach((l) => l.items.forEach((it) => {
    if (it.cat === id) { moved.push(it); it.cat = to; }
  }));
  save(); render();
  const what = moved.length ? `${moved.length} 個は「${catName(to)}」に移しました` : '';
  toast(`分類「${gone.name}」を消しました。${what}`, '元に戻す', () => {
    state.cats.splice(i, 0, gone);
    moved.forEach((it) => { it.cat = id; });
    save(); render();
  });
}

/* ------------------------------------------------------------
 *  ほかのリストから持ってくる
 *
 *  ★同じ名前のものは足しません（飛ばします）。
 *    「海外旅行」と「国内旅行」はパスポート以外がかなり重なるので、
 *    重ねて足すと同じ行が2つ並び、確かめるときに数が合わなくなります。
 *    持ち物リストは「数えて確かめる道具」なので、重複はそれ自体が害です。
 *    見本から足すとき（addFromSeed）と同じ決まりに揃えています。
 * ---------------------------------------------------------- */
function copyFromList(fromId) {
  const from = state.lists.find((l) => l.id === fromId);
  const to = activeList();
  if (!from || !to || from.id === to.id) return;

  const key = (x) => x.replace(/[\s　]/g, '').toLowerCase();
  const have = new Set(to.items.map((it) => key(it.name)));
  const missing = from.items.filter((it) => !have.has(key(it.name)));

  if (!missing.length) {
    toast(`「${from.name}」から足すものはありませんでした`);
    return;
  }
  if (to.items.length + missing.length > APP.maxItems) {
    toast(`1つのリストは ${APP.maxItems} 個までです`);
    return;
  }

  // 分類がこの端末に無いときは受け皿へ。チェックは外した状態で入れます
  const added = missing.map((it) => ({
    ...it, id: newId(), done: false,
    cat: state.cats.some((c) => c.id === it.cat) ? it.cat : fallbackCat(),
  }));
  to.items.push(...added);
  save(); render();

  const ids = new Set(added.map((it) => it.id));
  toast(`「${from.name}」から ${added.length} 個持ってきました`, '元に戻す', () => {
    to.items = to.items.filter((it) => !ids.has(it.id));
    save(); render();
  });
}

/** 「持ってくる」の選び先を作り直します */
function renderCopyFrom() {
  const to = activeList();
  const others = state.lists.filter((l) => l.id !== to.id);
  const sel = $('copyFromSel');
  const btn = $('copyFromBtn');
  if (!others.length) {
    sel.innerHTML = '<option>ほかにリストがありません</option>';
    sel.disabled = btn.disabled = true;
    return;
  }
  sel.disabled = btn.disabled = false;
  sel.innerHTML = others.map((l) =>
    `<option value="${esc(l.id)}">${esc(l.name)}（${l.items.length}）</option>`).join('');
}

/* ------------------------------------------------------------
 *  長押しで並べ替える
 *
 *  ★分類をまたいだ移動はしません。分類は「忘れたときの困りかた」で
 *    分けてあるので、またいで動かすと意味が変わってしまいます。
 *    動かせるのは同じ分類の中だけです。
 *
 *  ★長押し中に文字が選ばれてしまうのを止めます。
 *    iPhone では長押しで選択と虫めがねが出るので、
 *    CSS（user-select / touch-action）と preventDefault の両方が要ります。
 * ---------------------------------------------------------- */
const HOLD_MS = 420;      // これ以上押したら並べ替えに入る
const HOLD_SLOP = 10;     // これ以上ずれたら「押した」ではなく「なぞった」

const drag = { li: null, timer: null, from: null, active: false, y: 0 };

function cancelHold() {
  clearTimeout(drag.timer);
  drag.timer = null;
  if (!drag.active) drag.li = null;
}

function startDrag(li) {
  drag.active = true;
  drag.li = li;
  li.classList.add('is-dragging');
  document.body.classList.add('is-reordering');
  if (navigator.vibrate) navigator.vibrate(12);   // 入ったことを手に伝えます
}

function endDrag() {
  if (!drag.active) { cancelHold(); return; }
  const li = drag.li;
  drag.active = false;
  drag.li = null;
  document.body.classList.remove('is-reordering');
  if (li) li.classList.remove('is-dragging');
  commitOrder();
}

/**
 * 画面の並びを、そのまま持ち物の並びに写します。
 * 画面のほうを直してから写すので、分類ごとの順番がそのまま保存されます。
 */
function commitOrder() {
  const l = activeList();
  const order = [...document.querySelectorAll('#items .item')]
    .map((el) => el.dataset.item);
  const byId = new Map(l.items.map((it) => [it.id, it]));
  const next = order.map((id) => byId.get(id)).filter(Boolean);
  // 画面に出ていないものが万一あっても落とさないようにします
  l.items.forEach((it) => { if (!order.includes(it.id)) next.push(it); });
  l.items = next;
  save();
  renderProgress();
  renderTabs();
}

function setupReorder() {
  const items = $('items');

  items.addEventListener('pointerdown', (e) => {
    // ボタンの上から始まった押しは、並べ替えではありません
    if (e.target.closest('button')) return;
    const li = e.target.closest('.item');
    if (!li) return;
    drag.li = li;
    drag.y = e.clientY;
    drag.timer = setTimeout(() => startDrag(li), HOLD_MS);
  });

  items.addEventListener('pointermove', (e) => {
    if (!drag.active) {
      // まだ長押しになっていない間に動いたら、なぞる操作とみなして取り消します
      if (drag.timer && Math.abs(e.clientY - drag.y) > HOLD_SLOP) cancelHold();
      return;
    }
    e.preventDefault();      // 画面が一緒に動かないようにします

    const li = drag.li;
    const list = li.parentElement;          // 同じ分類の中だけを見ます
    const others = [...list.querySelectorAll('.item')].filter((x) => x !== li);
    for (const x of others) {
      const r = x.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (e.clientY < mid && x.compareDocumentPosition(li)
          & Node.DOCUMENT_POSITION_FOLLOWING) {
        list.insertBefore(li, x);
        return;
      }
      if (e.clientY > mid && x.compareDocumentPosition(li)
          & Node.DOCUMENT_POSITION_PRECEDING) {
        list.insertBefore(li, x.nextSibling);
        return;
      }
    }
  }, { passive: false });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) =>
    items.addEventListener(n, endDrag));

  // 長押しで出るiOSのメニューと、指でなぞったときの選択を止めます
  items.addEventListener('contextmenu', (e) => {
    if (drag.active || drag.timer) e.preventDefault();
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
    renderCopyFrom();
    window.scrollTo(0, 0);
  });

  // ---- 持ち物のチェックと編集 ----
  $('items').addEventListener('click', (e) => {
    // 並べ替えを終えた直後の指離しをクリックと取り違えないようにします
    if (document.body.classList.contains('is-reordering')) return;
    if (e.target.closest('#addCatBtn')) { addCategory(); return; }
    const catAdd = e.target.closest('[data-catadd]');
    if (catAdd) { openItemForm('', catAdd.dataset.catadd); return; }
    const catDel = e.target.closest('[data-catdel]');
    if (catDel) { removeCategory(catDel.dataset.catdel); return; }
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
  $('seedBtn').addEventListener('click', addFromSeed);
  $('copyFromBtn').addEventListener('click', () => copyFromList($('copyFromSel').value));
  setupReorder();
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
  renderCopyFrom();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
