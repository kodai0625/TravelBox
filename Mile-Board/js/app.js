/* ============================================================
 *  画面
 *  入力の受け付けと、結果の描き出しを担当します。
 *  きまりの判定そのものは rules.js にあります。
 * ============================================================ */

/* いま画面に入っている旅程。ここだけが「本当の値」です。 */
const trip = {
  mode: 'roundtrip',   // roundtrip（往復）/ openjaw（オープンジョー）/ oneway（片道）
  from: '',
  out: ['', '', ''],
  dest: '',
  ret: '',             // 帰りの出発地。オープンジョーのときだけ使います
  back: ['', '', ''],
  to: '',
  stopover: '',
};

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------
 *  部品：国と都市の2段プルダウン
 * ---------------------------------------------------------- */
function makePicker({ value, japanOnly, overseasOnly, used, placeholder, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'picker';

  const groups = cityOptions({ japanOnly, overseasOnly, used });

  /* 日本の中から選ぶときは、国を選ぶ意味がないので都市の1段だけにします。 */
  if (japanOnly) {
    wrap.classList.add('picker-single');
    const only = document.createElement('select');
    only.className = 'sel';
    only.appendChild(new Option(placeholder || '空港を選ぶ', ''));
    const names = groups[0] ? groups[0].cities : [];
    (names.includes(value) || !value ? names : [value, ...names]).forEach((n) => {
      const o = new Option(n, n);
      if (n === value) o.selected = true;
      only.appendChild(o);
    });
    only.addEventListener('change', () => onChange(only.value));
    wrap.appendChild(only);
    return wrap;
  }

  const country = document.createElement('select');
  const city = document.createElement('select');
  country.className = city.className = 'sel';

  // いま選ばれている都市が、どの国のものか探す
  const current = value ? cityInfo(value) : null;
  const currentCountry = current ? current.countryName : '';

  country.appendChild(new Option(japanOnly ? '空港を選ぶ' : '国・地域を選ぶ', ''));
  groups.forEach((g) => {
    const o = new Option(g.label, g.label);
    if (g.label === currentCountry) o.selected = true;
    country.appendChild(o);
  });

  function fillCities() {
    city.innerHTML = '';
    const g = groups.find((x) => x.label === country.value);
    if (!g) {
      city.appendChild(new Option('← 先に国を選ぶ', ''));
      city.disabled = true;
      return;
    }
    city.disabled = false;
    city.appendChild(new Option(placeholder || '都市を選ぶ', ''));
    // いま選ばれている都市は、使用ずみでも消さずに残す
    const names = g.cities.includes(value) || !value ? g.cities : [value, ...g.cities];
    names.forEach((n) => {
      const o = new Option(n, n);
      if (n === value) o.selected = true;
      city.appendChild(o);
    });
  }
  fillCities();

  country.addEventListener('change', () => { fillCities(); onChange(''); });
  city.addEventListener('change', () => onChange(city.value));

  wrap.append(country, city);
  return wrap;
}

/* ------------------------------------------------------------
 *  行き／帰りの道すじ
 * ---------------------------------------------------------- */
function renderLeg(box, dir) {
  box.innerHTML = '';
  const isOut = dir === 'out';
  const list = isOut ? trip.out : trip.back;

  const row = (label, node, strong) => {
    const r = document.createElement('div');
    r.className = 'row' + (strong ? ' row-strong' : '');
    const l = document.createElement('span');
    l.className = 'row-label';
    l.textContent = label;
    r.append(l, node);
    return r;
  };

  // すでに使っている都市（同じ都市を二度選べないように）
  const used = () => [trip.from, trip.to, trip.dest, trip.ret, ...trip.out, ...trip.back].filter(Boolean);

  if (isOut) {
    box.appendChild(row('出発地', makePicker({
      value: trip.from, used: used().filter((c) => c !== trip.from),
      placeholder: '出発する都市', onChange: (v) => { trip.from = v; refresh(); },
    }), true));
  }

  // オープンジョーのときは、帰りがどこから始まるかを選びます
  if (!isOut && trip.mode === 'openjaw') {
    box.appendChild(row('帰りの出発地', makePicker({
      value: trip.ret, used: used().filter((c) => c !== trip.ret),
      placeholder: '帰りに乗る都市', onChange: (v) => { trip.ret = v; refresh(); },
    }), true));
  } else if (!isOut) {
    const start = document.createElement('div');
    start.className = 'goal';
    start.textContent = trip.dest || '（目的地は上で選びます）';
    box.appendChild(row('帰りの出発地', start, true));
  }

  list.forEach((v, i) => {
    box.appendChild(row(`乗継 ${i + 1}`, makePicker({
      value: v, used: used().filter((c) => c !== v),
      placeholder: '乗り継ぐ都市', onChange: (nv) => { list[i] = nv; tidy(list); refresh(); },
    })));
  });

  if (isOut) {
    const goal = document.createElement('div');
    goal.className = 'goal';
    goal.textContent = trip.dest || '（目的地は上で選びます）';
    box.appendChild(row('目的地', goal, true));
  } else {
    box.appendChild(row('帰着地', makePicker({
      value: trip.to, used: used().filter((c) => c !== trip.to),
      placeholder: '帰り着く都市', onChange: (v) => { trip.to = v; refresh(); },
    }), true));
  }
}

/* 空いた枠を後ろに詰める（乗継1を消したら2が繰り上がる） */
function tidy(list) {
  const filled = list.filter(Boolean);
  for (let i = 0; i < list.length; i++) list[i] = filled[i] || '';
}

/* ------------------------------------------------------------
 *  旅程の形をえらぶボタン
 * ---------------------------------------------------------- */
function renderModes() {
  const box = $('modes');
  box.innerHTML = '';
  for (const [key, m] of Object.entries(MODES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mode' + (trip.mode === key ? ' on' : '');
    b.setAttribute('aria-pressed', String(trip.mode === key));
    b.innerHTML = `<span class="mode-name">${m.label}</span>` +
                  `<span class="mode-desc">${m.desc}</span>`;
    b.addEventListener('click', () => {
      trip.mode = key;
      // 形を変えたときに、使わなくなった値が残らないようにします
      if (key !== 'openjaw') trip.ret = '';
      if (key === 'oneway') { trip.back = ['', '', '']; trip.to = ''; trip.stopover = ''; }
      else if (!trip.to) trip.to = trip.from;
      refresh();
    });
    box.appendChild(b);
  }
}

/* ------------------------------------------------------------
 *  描き直し
 * ---------------------------------------------------------- */
function refresh() {
  renderModes();
  const oneway = trip.mode === 'oneway';
  $('backCard').hidden = oneway;
  $('stopCard').hidden = oneway;
  // 目的地
  $('destPicker').replaceChildren(makePicker({
    value: trip.dest,
    used: [trip.from, trip.to, trip.ret, ...trip.out, ...trip.back].filter(Boolean),
    placeholder: '行きたい都市', onChange: (v) => { trip.dest = v; refresh(); },
  }));
  const d = trip.dest && cityInfo(trip.dest);
  $('destHint').textContent = d ? `${d.countryName}／${MB.labels[d.zone]}（Zone ${d.zone}）` : '';

  renderLeg($('legOut'), 'out');
  if (!oneway) {
    renderLeg($('legBack'), 'back');
    renderStopChips();
  }

  const r = judge(trip);
  renderVerdict(r);
  renderMiles(r);
  renderItinerary(r);
  save();
}

function renderVerdict(r) {
  const mark = $('verdictMark'), text = $('verdictText'), box = $('verdict');
  box.classList.remove('ok', 'ng', 'idle');
  if (!r.ready) {
    box.classList.add('idle');
    mark.textContent = '…';
    text.textContent = r.errors[0] || '目的地を選んでください';
  } else if (r.ok) {
    box.classList.add('ok');
    mark.textContent = '○';
    const zone = r.isJapanOrigin ? `Zone ${r.fromZone}` : `${MB.labels[r.fromZone]}発`;
    text.textContent = `組めます（${r.segCount}区間・${zone}）`;
  } else {
    box.classList.add('ng');
    mark.textContent = '×';
    text.textContent = `${r.errors.length}件、きまりに合いません`;
  }

  // まだ入力の途中のときは、上の帯に出したのと同じ文をくり返しません
  const ul = $('msgList');
  ul.innerHTML = '';
  if (r.ready) {
    r.errors.forEach((m) => ul.appendChild(li(m, 'ng')));
    r.notes.forEach((m) => ul.appendChild(li(m, 'note')));
  }
}

function li(text, cls) {
  const el = document.createElement('li');
  el.className = cls;
  el.textContent = text;
  return el;
}

function renderMiles(r) {
  /* この箱は隠しません。隠すと見出しの番号が 1 → 3 と飛んでしまい、
     こわれているように見えるためです。中身だけ入れ替えます。 */
  const card = $('milesCard');
  card.hidden = false;
  if (!r.ready || !r.miles) {
    $('milesBox').innerHTML =
      '<div class="mile mile-empty"><span class="mile-cls">目的地を選ぶと、ここに出ます</span></div>';
    $('milesHint').textContent = '';
    return;
  }

  const names = { Y: 'エコノミー', PY: 'プレミアムエコノミー', C: 'ビジネス', F: 'ファースト' };
  $('milesBox').innerHTML = Object.entries(r.miles)
    .map(([k, v]) => `<div class="mile"><span class="mile-cls">${names[k] || k}</span>` +
                     `<span class="mile-val"><span class="mile-num">${v.toLocaleString()}</span>` +
                     `<span class="mile-unit">マイル</span></span></div>`).join('');

  const hint = $('milesHint');
  if (r.milesNote) {
    hint.textContent = r.milesNote;
    return;
  }
  if (r.fromZone === '1-B' && r.milesBase) {
    const diff = Object.entries(r.miles)
      .filter(([k]) => r.milesBase[k] != null)
      .map(([k, v]) => `${names[k]} +${(v - r.milesBase[k]).toLocaleString()}`)
      .join('　');
    hint.textContent = `海外で乗り継ぐので Zone 1-B です。直行の往復（Zone 1-A）にくらべて ${diff} マイル。`;
  } else if (r.fromZone === '1-A') {
    hint.textContent = '海外で乗り継がない旅程なので Zone 1-A です。海外の乗継地を足すと 1-B になり、必要マイル数が上がります。';
  } else {
    hint.textContent = '';
  }
}

function renderStopChips() {
  const box = $('stopChips');
  box.innerHTML = '';
  const candidates = [...trip.out, ...trip.back].filter((c) => c && !isJapan(c));
  if (!candidates.length) {
    box.innerHTML = '<p class="hint">海外の乗継地を入れると、ここで選べるようになります。</p>';
    trip.stopover = '';
    return;
  }
  if (trip.stopover && !candidates.includes(trip.stopover)) trip.stopover = '';

  const add = (name, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (trip.stopover === name ? ' on' : '');
    b.textContent = label;
    b.addEventListener('click', () => { trip.stopover = name; refresh(); });
    box.appendChild(b);
  };
  add('', 'とまらない');
  candidates.forEach((c) => add(c, c));
}

function renderItinerary(r) {
  const card = $('itinCard');
  if (!r.ready || !r.segments || !r.segments.length) { card.hidden = true; return; }
  card.hidden = false;

  $('segs').innerHTML = r.segments.map((s) => {
    if (s.gap) {
      return `<li class="seg seg-gap">
        <div class="seg-route"><b>${s.from}</b><span class="arrow">⇢</span><b>${s.to}</b></div>
        <div class="seg-air"><span class="air none">ここは自分で移動します（特典に含まれません）</span></div></li>`;
    }
    const air = s.airlines.length
      ? s.airlines.map((c) => {
          const cls = MB.starCodes.has(c) ? 'air star' : 'air partner';
          const end = MB.ending[c] ? ` title="${MB.ending[c]}"` : '';
          return `<span class="${cls}"${end}>${airlineName(c)}</span>`;
        }).join('')
      : '<span class="air none">直行便が見つかりません</span>';
    const stay = s.stay
      ? `<span class="stay ${s.stay === '24時間以上' ? 'long' : s.stay === '目的地' ? 'dest' : ''}">${s.stay}</span>`
      : '';
    return `<li class="seg">
      <div class="seg-route"><b>${s.from}</b><span class="arrow">→</span><b>${s.to}</b></div>
      <div class="seg-air">${air}</div>${stay}</li>`;
  }).join('');

  $('segHint').textContent =
    '航空会社は「その区間を飛んでいる会社」の参考表示です。実際に特典の空席があるかどうかは別です。';
}

/* ------------------------------------------------------------
 *  書き出し
 * ---------------------------------------------------------- */
function asText() {
  const r = judge(trip);
  const lines = [`旅程の形：${MODES[trip.mode].label}`, `目的地：${trip.dest}`];
  if (r.miles) {
    lines.push(`必要マイル：` + Object.entries(r.miles)
      .map(([k, v]) => `${{ Y: 'エコノミー', PY: 'プレエコ', C: 'ビジネス', F: 'ファースト' }[k]} ${v.toLocaleString()}`)
      .join(' / ') + `（${r.isJapanOrigin ? 'Zone ' + r.fromZone : MB.labels[r.fromZone] + '発'}）`);
  }
  lines.push('');
  r.segments.forEach((s, i) => {
    if (s.gap) { lines.push(`　　（${s.from} → ${s.to} は自分で移動）`); return; }
    const air = s.airlines.map(airlineName).join('・') || '—';
    lines.push(`区間${i + 1}: ${s.from}→${s.to}${s.stay ? `（${s.stay}）` : ''}　${air}`);
  });
  return lines.join('\n');
}

/* ------------------------------------------------------------
 *  保存と読み込み（この端末の中だけ）
 * ---------------------------------------------------------- */
function save() {
  try { localStorage.setItem(APP.storageKey + ':trip', JSON.stringify(trip)); } catch (e) {}
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(APP.storageKey + ':trip') || 'null');
    if (s) Object.assign(trip, s);
  } catch (e) {}
}

/* ------------------------------------------------------------
 *  起動
 * ---------------------------------------------------------- */
(async function start() {
  try {
    const src = await loadAll();
    load();
    if (!trip.from) trip.from = APP.homeCity;
    if (!trip.to) trip.to = APP.homeCity;

    $('sources').textContent =
      `必要マイル数とゾーン区分：ANA公式／就航路線：${src.routeSource}`;

    $('loading').hidden = true;
    $('main').hidden = false;
    refresh();
  } catch (e) {
    $('loading').textContent = '読み込みに失敗しました：' + e.message;
    return;
  }

  $('copyBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(asText());
      flash($('copyBtn'), 'コピーしました');
    } catch (e) { flash($('copyBtn'), 'コピーできませんでした'); }
  });

  $('saveBtn').addEventListener('click', () => {
    const blob = new Blob(['﻿' + asText() + '\n'], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `旅程_${trip.dest || '未定'}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('resetBtn').addEventListener('click', () => {
    Object.assign(trip, {
      mode: 'roundtrip', from: APP.homeCity, out: ['', '', ''], dest: '',
      ret: '', back: ['', '', ''], to: APP.homeCity, stopover: '',
    });
    refresh();
  });

  $('themeBtn').addEventListener('click', () => {
    const now = document.documentElement.dataset.theme;
    const next = now === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(APP.storageKey + ':theme', next); } catch (e) {}
  });
})();

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1400);
}
