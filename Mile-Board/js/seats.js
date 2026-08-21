/* ============================================================
 *  空席メモ
 *
 *  このアプリは ANA のサーバーに一度もつなぎません。それは変えません。
 *  かわりに、自分の目で見た空席のようすを、ここに書き留めておきます。
 *
 *  なぜ要るのか。
 *    ANAの画面は「1つの路線・1つの日・1つのクラス」ずつしか見られません。
 *    周遊は区間が3つ4つになるので、調べているうちに
 *    「さっきの区間、いつが空いてたんだっけ」で分からなくなります。
 *    それを1枚にまとめて持っておくための道具です。
 *
 *  印は ANA の「国際線特典カレンダー」と同じ4つにしてあります。
 *  自分で○×を決めるより、見たままを写せるほうが間違えません。
 *
 *  ★保存はこの端末の中だけです。どこにも送りません。
 *    公開する側にも一切出しません（ANAの空席データを配ることになるためです）。
 * ============================================================ */

/* 印。ANA公式のカレンダーの凡例に合わせています。 */
const SEAT_MARKS = {
  '':   { sign: '',  name: 'まだ調べていない' },
  'oo': { sign: '◎', name: '十分空席あり' },
  'o':  { sign: '○', name: '空席あり' },
  't':  { sign: '△', name: '残席わずか・空席待ち' },
  'x':  { sign: '−', name: '利用いただけない' },
};
const MARK_ORDER = ['', 'oo', 'o', 't', 'x'];

/* クラス。★提携航空会社特典では、プレミアムエコノミーは使えません（公式）。 */
const SEAT_CLASSES = [
  { key: 'Y',  label: 'エコノミー',   short: 'Y'  },
  { key: 'PY', label: 'プレエコ',     short: 'PY', anaOnly: true },
  { key: 'C',  label: 'ビジネス',     short: 'C'  },
  { key: 'F',  label: 'ファースト',   short: 'F'  },
];

const SEAT_AWARDS = {
  partner: { label: '提携航空会社特典', desc: 'スターアライアンス便・提携各社便' },
  ana:     { label: 'ANA特典',         desc: 'ANA運航便だけ' },
};

/* いま画面に出しているメモの条件。 */
const seats = {
  award: 'partner',
  from: '',
  to: '',
  month: '',        // 'YYYY-MM'
  countries: {},    // プルダウンで選んだ国を覚えておくところ
  bulkClass: 'Y',
  bulkMark: 'o',
};

/* 書き留めたものぜんぶ。key → { award, from, to, month, cells, updated } */
let SEAT_DATA = { v: 1, notes: {} };

/* ------------------------------------------------------------
 *  保存と読み込み
 * ---------------------------------------------------------- */
function seatsStoreKey() { return APP.storageKey + ':seats'; }
function seatsPrefKey()  { return APP.storageKey + ':seats-pref'; }

function seatsLoad() {
  try {
    const s = JSON.parse(localStorage.getItem(seatsStoreKey()) || 'null');
    if (s && s.notes) SEAT_DATA = s;
  } catch (e) {}
  try {
    const p = JSON.parse(localStorage.getItem(seatsPrefKey()) || 'null');
    if (p) Object.assign(seats, p);
  } catch (e) {}
  if (!seats.month) seats.month = monthKey(new Date());
  if (!seats.countries) seats.countries = {};
}

function seatsSave() {
  try { localStorage.setItem(seatsStoreKey(), JSON.stringify(SEAT_DATA)); } catch (e) {}
}
function seatsSavePref() {
  try {
    localStorage.setItem(seatsPrefKey(), JSON.stringify({
      award: seats.award, from: seats.from, to: seats.to, month: seats.month,
      countries: seats.countries, bulkClass: seats.bulkClass, bulkMark: seats.bulkMark,
    }));
  } catch (e) {}
}

/* ------------------------------------------------------------
 *  日付まわりの小道具
 * ---------------------------------------------------------- */
function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthShift(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return monthKey(d);
}
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${y}年${m}月`;
}
function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function weekdayOf(key, day) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, day).getDay();   // 0=日
}
const WEEK_JA = ['日', '月', '火', '水', '木', '金', '土'];

function nowSec() { return Math.floor(Date.now() / 1000); }

/* 何日前に調べたものか。古いほど画面で薄くします。 */
function seatAge(atSec) {
  if (!atSec) return null;
  const days = (nowSec() - atSec) / 86400;
  return {
    days,
    tier: days < 1 ? 'fresh' : (days < 7 ? 'aging' : 'stale'),
    text: days < 1 / 24 ? 'さっき'
        : days < 1 ? `${Math.floor(days * 24)}時間前`
        : `${Math.floor(days)}日前`,
  };
}

/* ------------------------------------------------------------
 *  メモの出し入れ
 * ---------------------------------------------------------- */
function seatNoteKey(award, from, to, month) {
  return `${award}|${from}>${to}|${month}`;
}

/* いま選んでいる条件のメモ。create=true なら無ければ作ります。 */
function seatNote(create) {
  if (!seats.from || !seats.to || !seats.month) return null;
  const key = seatNoteKey(seats.award, seats.from, seats.to, seats.month);
  let n = SEAT_DATA.notes[key];
  if (!n && create) {
    n = SEAT_DATA.notes[key] = {
      award: seats.award, from: seats.from, to: seats.to,
      month: seats.month, cells: {}, updated: nowSec(),
    };
  }
  return n || null;
}

function seatCell(note, day, cls) {
  if (!note) return null;
  return note.cells[`${day}:${cls}`] || null;   // [mark, atSec]
}

function seatSet(day, cls, mark) {
  const n = seatNote(true);
  if (!n) return;
  const k = `${day}:${cls}`;
  if (!mark) delete n.cells[k];
  else n.cells[k] = [mark, nowSec()];
  n.updated = nowSec();
  seatsSave();
}

function seatCycle(day, cls) {
  const n = seatNote(false);
  const cur = seatCell(n, day, cls);
  const i = MARK_ORDER.indexOf(cur ? cur[0] : '');
  seatSet(day, cls, MARK_ORDER[(i + 1) % MARK_ORDER.length]);
}

/* この特典で使えるクラスだけ返します。 */
function seatClasses(award) {
  return SEAT_CLASSES.filter((c) => !(c.anaOnly && award !== 'ana'));
}

/* ------------------------------------------------------------
 *  旅程の画面から引くところ
 *  「この区間、この日は調べてあるか」を返します。
 * ---------------------------------------------------------- */
function seatLookup(from, to, dateStr, award) {
  if (!from || !to || !dateStr) return null;
  const [y, m, d] = dateStr.split('-');
  if (!y || !m || !d) return null;
  const month = `${y}-${m}`;
  const day = String(Number(d));
  const key = seatNoteKey(award || seats.award, from, to, month);
  const n = SEAT_DATA.notes[key];
  if (!n) return null;
  const out = { marks: {}, at: 0, any: false };
  for (const c of seatClasses(n.award)) {
    const cell = n.cells[`${day}:${c.key}`];
    if (!cell) continue;
    out.marks[c.key] = cell[0];
    out.at = Math.max(out.at, cell[1] || 0);
    out.any = true;
  }
  return out.any ? out : null;
}

/* ------------------------------------------------------------
 *  画面を描く
 * ---------------------------------------------------------- */
function renderSeats() {
  renderSeatHead();
  renderSeatGrid();
  renderSeatList();
  seatsSavePref();
}

/* 特典種別・路線・月をえらぶところ */
function renderSeatHead() {
  // 特典種別
  const aw = $('seatAward');
  aw.innerHTML = '';
  for (const [key, a] of Object.entries(SEAT_AWARDS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mode' + (seats.award === key ? ' on' : '');
    b.setAttribute('aria-pressed', String(seats.award === key));
    b.innerHTML = `<span class="mode-name">${a.label}</span><span class="mode-desc">${a.desc}</span>`;
    b.addEventListener('click', () => { seats.award = key; renderSeats(); });
    aw.appendChild(b);
  }

  // 路線
  $('seatFrom').replaceChildren(makePicker({
    key: 'sFrom', value: seats.from, mem: seats.countries, onSave: seatsSavePref,
    placeholder: '出発する都市',
    onChange: (v) => { seats.from = v; renderSeats(); },
  }));
  $('seatTo').replaceChildren(makePicker({
    key: 'sTo', value: seats.to, mem: seats.countries, onSave: seatsSavePref,
    placeholder: '到着する都市',
    onChange: (v) => { seats.to = v; renderSeats(); },
  }));

  $('seatMonthLabel').textContent = monthLabel(seats.month);

  // いま旅程に入っている区間へ、押すだけで移れるようにします
  const box = $('seatLegs');
  const r = judge(trip);
  const segs = (r.ready && r.segments ? r.segments : []).filter((s) => !s.gap);
  box.innerHTML = '';
  if (!segs.length) { box.hidden = true; return; }
  box.hidden = false;
  const head = document.createElement('span');
  head.className = 'reach-head';
  head.textContent = 'いまの旅程の区間：';
  box.appendChild(head);
  /* 行きの区間は行きの搭乗日の月、帰りの区間は帰りの搭乗日の月に移ります。
     押したのに8月のままだった、を避けるためです。 */
  const outCount = (trip.out || []).filter(Boolean).length + 1;
  segs.forEach((s, i) => {
    const date = (i < outCount) ? trip.date : (trip.dateBack || trip.date);
    const b = document.createElement('button');
    b.type = 'button';
    const on = s.from === seats.from && s.to === seats.to;
    b.className = 'chip chip-reach' + (on ? ' on' : '');
    b.textContent = `${s.from}→${s.to}`;
    b.addEventListener('click', () => {
      seats.from = s.from; seats.to = s.to;
      if (date) seats.month = date.slice(0, 7);
      seats.countries = {};
      renderSeats();
    });
    box.appendChild(b);
  });
}

/* マス目 */
function renderSeatGrid() {
  const wrap = $('seatGrid');
  const info = $('seatInfo');
  const tools = $('seatTools');

  if (!seats.from || !seats.to) {
    wrap.innerHTML = '';
    info.textContent = '出発地と到着地を選ぶと、その月のマス目が出ます。';
    tools.hidden = true;
    return;
  }
  if (seats.from === seats.to) {
    wrap.innerHTML = '';
    info.textContent = '出発地と到着地が同じです。';
    tools.hidden = true;
    return;
  }
  tools.hidden = false;

  const note = seatNote(false);
  const classes = seatClasses(seats.award);
  const days = daysInMonth(seats.month);

  /* 見出しの行 */
  const rows = [
    `<div class="sg-row sg-head">` +
    `<div class="sg-day">日</div>` +
    classes.map((c) => `<div class="sg-cell sg-cls">${c.short}<span>${c.label}</span></div>`).join('') +
    `</div>`,
  ];

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const todayDay = today.getDate();

  for (let d = 1; d <= days; d++) {
    const w = weekdayOf(seats.month, d);
    const past = seats.month < todayKey || (seats.month === todayKey && d < todayDay);
    const cells = classes.map((c) => {
      const cell = seatCell(note, d, c.key);
      const mark = cell ? cell[0] : '';
      const age = cell ? seatAge(cell[1]) : null;
      const cls = ['sg-cell', 'sg-mark', mark ? 'm-' + mark : 'm-none'];
      if (age) cls.push('age-' + age.tier);
      const title = mark
        ? `${SEAT_MARKS[mark].name}（${age ? age.text : ''}に記録）`
        : 'まだ調べていない';
      return `<button type="button" class="${cls.join(' ')}" data-day="${d}" data-cls="${c.key}"` +
             ` title="${title}" aria-label="${d}日 ${c.label} ${title}">` +
             `${SEAT_MARKS[mark].sign || '·'}</button>`;
    }).join('');
    rows.push(
      `<div class="sg-row${past ? ' sg-past' : ''}">` +
      `<div class="sg-day w${w}">${d}<span>${WEEK_JA[w]}</span></div>${cells}</div>`);
  }

  wrap.innerHTML = `<div class="sg" style="--cols:${classes.length}">${rows.join('')}</div>`;
  wrap.querySelectorAll('.sg-mark').forEach((b) => {
    b.addEventListener('click', () => {
      seatCycle(Number(b.dataset.day), b.dataset.cls);
      renderSeatGrid();
      renderSeatList();
      renderItinerary(judge(trip));   // 旅程の図の印もそろえます
    });
  });

  /* この月の要約 */
  if (!note || !Object.keys(note.cells).length) {
    info.textContent = 'マスを押すと ◎ → ○ → △ → − と変わります。もう一度押すと空に戻ります。';
  } else {
    const per = classes.map((c) => {
      let open = 0, seen = 0;
      for (let d = 1; d <= days; d++) {
        const cell = seatCell(note, d, c.key);
        if (!cell) continue;
        seen++;
        if (cell[0] === 'oo' || cell[0] === 'o') open++;
      }
      return seen ? `${c.label} ${open}/${seen}日` : '';
    }).filter(Boolean).join('　');
    const age = seatAge(note.updated);
    info.innerHTML = `空きのあった日：${per}` +
      (age ? `<br>最後に書き足したのは ${age.text}です。` +
        (age.tier === 'stale' ? '<b class="sg-stale">1週間以上たっています。もう当てになりません。</b>' : '') : '');
  }

  /* まとめて入れるところ */
  const bc = $('bulkClass');
  bc.innerHTML = '';
  classes.forEach((c) => {
    const o = new Option(c.label, c.key);
    if (c.key === seats.bulkClass) o.selected = true;
    bc.appendChild(o);
  });
  if (!classes.some((c) => c.key === seats.bulkClass)) seats.bulkClass = classes[0].key;

  const bm = $('bulkMark');
  bm.innerHTML = '';
  MARK_ORDER.filter(Boolean).forEach((m) => {
    const o = new Option(`${SEAT_MARKS[m].sign}　${SEAT_MARKS[m].name}`, m);
    if (m === seats.bulkMark) o.selected = true;
    bm.appendChild(o);
  });
}

/* 書き留めてあるものの一覧 */
function renderSeatList() {
  const box = $('seatList');
  const all = Object.entries(SEAT_DATA.notes)
    .filter(([, n]) => Object.keys(n.cells).length)
    .sort((a, b) => (b[1].updated || 0) - (a[1].updated || 0));

  if (!all.length) {
    box.innerHTML = '<p class="hint">まだ何も書き留めていません。</p>';
    return;
  }
  box.innerHTML = all.slice(0, 40).map(([key, n]) => {
    const age = seatAge(n.updated);
    const days = daysInMonth(n.month);
    let open = 0;
    for (const [k, v] of Object.entries(n.cells)) {
      if (v[0] === 'oo' || v[0] === 'o') open++;
    }
    const on = n.award === seats.award && n.from === seats.from &&
               n.to === seats.to && n.month === seats.month;
    return `<div class="snote${on ? ' on' : ''}">
      <button type="button" class="snote-main" data-key="${key}">
        <span class="snote-route">${n.from} → ${n.to}</span>
        <span class="snote-sub">${monthLabel(n.month)}　${SEAT_AWARDS[n.award].label}</span>
        <span class="snote-sub2">空きのあったマス ${open}　最後の記録 ${age ? age.text : '—'}${
          age && age.tier === 'stale' ? '（古い）' : ''}</span>
      </button>
      <button type="button" class="snote-del" data-del="${key}" aria-label="この記録を消す">消す</button>
    </div>`;
  }).join('') + (all.length > 40 ? `<p class="hint">ほかに${all.length - 40}件あります。</p>` : '');

  box.querySelectorAll('.snote-main').forEach((b) => {
    b.addEventListener('click', () => {
      const n = SEAT_DATA.notes[b.dataset.key];
      if (!n) return;
      Object.assign(seats, { award: n.award, from: n.from, to: n.to, month: n.month });
      seats.countries = {};
      renderSeats();
      $('seatGrid').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  box.querySelectorAll('.snote-del').forEach((b) => {
    b.addEventListener('click', () => {
      const n = SEAT_DATA.notes[b.dataset.del];
      if (!n) return;
      if (!confirm(`${n.from} → ${n.to}（${monthLabel(n.month)}）の記録を消します。よろしいですか。`)) return;
      delete SEAT_DATA.notes[b.dataset.del];
      seatsSave();
      renderSeats();
    });
  });
}

/* ------------------------------------------------------------
 *  書き出し
 * ---------------------------------------------------------- */
function seatsAsText() {
  const n = seatNote(false);
  if (!n) return '';
  const classes = seatClasses(n.award);
  const days = daysInMonth(n.month);
  const lines = [
    `${n.from} → ${n.to}　${monthLabel(n.month)}　${SEAT_AWARDS[n.award].label}`,
    `（自分で調べて書き留めたものです。ANAの画面で必ず確かめてください）`,
    '',
    ['日', ...classes.map((c) => c.short)].join('\t'),
  ];
  for (let d = 1; d <= days; d++) {
    const row = classes.map((c) => {
      const cell = seatCell(n, d, c.key);
      return cell ? SEAT_MARKS[cell[0]].sign : '';
    });
    if (row.every((x) => !x)) continue;
    lines.push([`${d}(${WEEK_JA[weekdayOf(n.month, d)]})`, ...row].join('\t'));
  }
  const age = seatAge(n.updated);
  lines.push('', `最後に書き足したのは ${age ? age.text : '—'}です。`);
  return lines.join('\n');
}
