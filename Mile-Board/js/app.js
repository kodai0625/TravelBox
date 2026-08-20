/* ============================================================
 *  画面
 *  入力の受け付けと、結果の描き出しを担当します。
 *  きまりの判定そのものは rules.js にあります。
 * ============================================================ */

/* いま画面に入っている旅程。ここだけが「本当の値」です。 */
const trip = {
  mode: 'roundtrip',   // roundtrip（往復）/ openjaw（オープンジョー）/ oneway（片道）
  from: '',
  out: [],
  dest: '',
  ret: '',             // 帰りの出発地。オープンジョーのときだけ使います
  back: [],
  to: '',
  stopover: '',
  date: '',            // 行きの搭乗日。シーズンを決めるのに使います
  onlyReachable: true, // 行けるところだけ出すか

  /* どの欄でどの国を選んだか。
     ★これを覚えていないと、国を選んだ瞬間に画面を描き直したときに
       選択が消えて、都市までたどり着けません。 */
  countries: {},
};

const $ = (id) => document.getElementById(id);

/* 乗継の空き枠。数は config.js の RULE.transitSlots で決まります。 */
function emptySlots() {
  return Array(RULE.transitSlots).fill('');
}

/* 保存してあった旅程の枠が、いまの枠数と違うときにそろえる */
function fitSlots(list) {
  const filled = (list || []).filter(Boolean).slice(0, RULE.transitSlots);
  return [...filled, ...Array(RULE.transitSlots - filled.length).fill('')];
}

/* すでに旅程で使っている都市。
   同じ都市を二度選べないよう、プルダウンから外すために使います。
   field は、いま編集している欄の名前です。

   ★気をつけるところが2つあります。
     ・いま使っていない欄まで数えると、選べるはずの都市が消えます。
       片道なら帰りの欄、オープンジョー以外なら「帰りの出発地」は数えません。
     ・出発地と帰着地は、往復なら同じ都市なのがふつうです（東京→…→東京）。
       どちらかを編集しているあいだは、もう一方を候補から外しません。
       ここを外すと、出発地に東京を選べなくなります。 */
function usedCities(field) {
  const list = [trip.dest, ...trip.out];
  if (trip.mode !== 'oneway') list.push(...trip.back);
  if (trip.mode === 'openjaw') list.push(trip.ret);
  if (field !== 'from' && field !== 'to') {
    list.push(trip.from);
    if (trip.mode !== 'oneway') list.push(trip.to);
  }
  return list.filter(Boolean);
}

/* ------------------------------------------------------------
 *  部品：国と都市の2段プルダウン
 * ---------------------------------------------------------- */
function makePicker({ key, value, japanOnly, overseasOnly, used, only, placeholder, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'picker';

  const groups = cityOptions({ japanOnly, overseasOnly, used, only });

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

  /* いまどの国が選ばれているか。
     都市が入っていればその国、まだなら前に選んだ国を覚えておいたものを使います。 */
  const current = value ? cityInfo(value) : null;
  const currentCountry = current ? current.countryName : (trip.countries[key] || '');

  country.appendChild(new Option('国・地域を選ぶ', ''));
  /* 東アジア・東南アジア…とエリアごとにまとめます。
     200近い国が1本に並ぶと、スマホでは目当ての国まで転がし続けることになります。 */
  let group = null, lastRegion = null;
  groups.forEach((g) => {
    if (g.region !== lastRegion) {
      group = document.createElement('optgroup');
      group.label = g.region;
      country.appendChild(group);
      lastRegion = g.region;
    }
    const o = new Option(g.label, g.label);
    if (g.label === currentCountry) o.selected = true;
    group.appendChild(o);
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

  country.addEventListener('change', () => {
    trip.countries[key] = country.value;   // 先に覚える。でないと描き直しで消えます
    fillCities();
    if (value) onChange('');               // 都市が入っていたときだけ、消して描き直す
    else save();
  });
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


  if (isOut) {
    box.appendChild(row('出発地', makePicker({
      key: 'from', value: trip.from, used: usedCities('from'),
      placeholder: '出発する都市', onChange: (v) => { trip.from = v; refresh(); },
    }), true));
  }

  // オープンジョーのときは、帰りがどこから始まるかを選びます
  if (!isOut && trip.mode === 'openjaw') {
    box.appendChild(row('帰りの出発地', makePicker({
      key: 'ret', value: trip.ret, used: usedCities('ret'),
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
      key: `${dir}${i}`, value: v, used: usedCities(`${dir}${i}`),
      only: trip.onlyReachable ? allowedTransits(trip, dir, i) : null,
      placeholder: '乗り継ぐ都市', onChange: (nv) => { list[i] = nv; tidy(list); refresh(); },
    })));
  });

  renderReachChips(box, dir);

  if (isOut) {
    const goal = document.createElement('div');
    goal.className = 'goal';
    goal.textContent = trip.dest || '（目的地は上で選びます）';
    box.appendChild(row('目的地', goal, true));
  } else {
    box.appendChild(row('帰着地', makePicker({
      key: 'to', value: trip.to, used: usedCities('to'),
      placeholder: '帰り着く都市', onChange: (v) => { trip.to = v; refresh(); },
    }), true));
  }
}

/* 押すだけで乗継地を足せる候補。
   プルダウンを開いて転がすより、これのほうが速く選べます。 */
function renderReachChips(box, dir) {
  if (!trip.onlyReachable || !trip.dest || !trip.from) return;
  const list = dir === 'out' ? trip.out : trip.back;
  const at = list.findIndex((v) => !v);
  if (at < 0) return;                     // 空き枠がない

  const set = allowedTransits(trip, dir, at);
  if (!set) return;
  const near = at > 0 && list[at - 1] ? list[at - 1] : trip.from;
  const names = sortCities(set, near);

  const wrap = document.createElement('div');
  wrap.className = 'reach';
  const head = document.createElement('p');
  head.className = 'reach-head';
  head.textContent = names.length
    ? `ここに入れられる街　${names.length}`
    : 'ここに入れられる街がありません';
  wrap.appendChild(head);

  if (names.length) {
    const chips = document.createElement('div');
    chips.className = 'chips';
    const show = trip.reachOpen === dir ? names : names.slice(0, 12);
    show.forEach((n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip chip-reach';
      b.textContent = n;
      b.addEventListener('click', () => { list[at] = n; tidy(list); refresh(); });
      chips.appendChild(b);
    });
    if (names.length > show.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'chip chip-more';
      more.textContent = `ほか ${names.length - show.length}`;
      more.addEventListener('click', () => { trip.reachOpen = dir; refresh(); });
      chips.appendChild(more);
    }
    wrap.appendChild(chips);
  }
  box.appendChild(wrap);
}

/* 空いた枠を後ろに詰める（乗継1を消したら2が繰り上がる） */
function tidy(list) {
  const filled = list.filter(Boolean);
  for (let i = 0; i < list.length; i++) list[i] = filled[i] || '';
}

/* ------------------------------------------------------------
 *  行き方の案
 * ---------------------------------------------------------- */
function renderSuggests(plans) {
  const box = $('suggests');
  box.innerHTML = '';
  if (!plans) return;
  if (!plans.length) {
    box.innerHTML = '<p class="hint">この行き先で成り立つ乗り継ぎの道すじが見つかりませんでした。' +
                    '出発地を変えるか、目的地を近いところにしてみてください。</p>';
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'plans';
  plans.forEach((p) => {
    const chain = [trip.from, ...p.out, trip.dest, ...p.back, trip.to]
      .map((c) => (c === p.stopover ? `<span class="plan-stop">${c}★</span>` : c))
      .join('<span class="plan-arrow">→</span>');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'plan';
    b.innerHTML = `<span class="plan-route">${chain}</span>` +
      `<span class="plan-sub"><span>寄れる街 ${p.cities}</span>` +
      `<span>${p.segCount}区間</span>` +
      `<span>${p.km.toLocaleString()}km${p.detour > 1.6 ? '（遠回り）' : ''}</span>` +
      (p.miles ? `<span>エコノミー ${p.miles.Y.toLocaleString()}／ビジネス ${(p.miles.C || 0).toLocaleString()}</span>` : '') +
      `</span>`;
    b.addEventListener('click', () => {
      trip.out = [...p.out, ...Array(RULE.transitSlots - p.out.length).fill('')];
      trip.back = [...p.back, ...Array(RULE.transitSlots - p.back.length).fill('')];
      trip.stopover = p.stopover;
      trip.countries = {};    // 覚えていた国は、選び直しになるので消します
      renderSuggests(null);
      refresh();
      $('itinCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    wrap.appendChild(b);
  });
  box.appendChild(wrap);
  box.insertAdjacentHTML('beforeend',
    '<p class="hint">★ が24時間以上とまる街です。押すと、その道すじが下の欄に入ります。</p>');
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
      if (key === 'oneway') { trip.back = emptySlots(); trip.to = ''; trip.stopover = ''; }
      else if (!trip.to) trip.to = trip.from;
      renderSuggests(null);
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
  $('dateIn').value = trip.date || '';
  $('onlyReach').checked = trip.onlyReachable !== false;
  const oneway = trip.mode === 'oneway';
  $('backCard').hidden = oneway;
  $('stopCard').hidden = oneway;
  // 目的地
  $('destPicker').replaceChildren(makePicker({
    key: 'dest', value: trip.dest,
    used: usedCities('dest'),
    only: trip.onlyReachable ? allowedDestinations(trip) : null,
    placeholder: '行きたい都市', onChange: (v) => { trip.dest = v; renderSuggests(null); refresh(); },
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
  renderSeasonHint(r);
  renderMiles(r);
  renderAnaBox(r);
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
    $('milesLead').textContent = '';
    $('milesBox').innerHTML =
      '<div class="mile mile-empty"><span class="mile-cls">目的地を選ぶと、ここに出ます</span></div>';
    $('milesHint').textContent = '';
    return;
  }

  const names = { Y: 'エコノミー', PY: 'プレミアムエコノミー', C: 'ビジネス', F: 'ファースト' };
  /* ★どちらの表の数字かを必ず書きます。
     ANA便だけで組むかどうかで、まったく別の表になるためです。 */
  $('milesLead').textContent = 'スターアライアンス便を1便でも使うとき';
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

/* 搭乗日から、その旅程のシーズンを画面に出す */
function renderSeasonHint(r) {
  const el = $('seasonHint');
  if (!trip.date) {
    el.textContent = '日を入れると、ANA便だけで組んだときのマイル数も出ます。';
    return;
  }
  const a = r.ready && r.anaOnly;
  if (a && a.season) {
    const [y, m, d] = trip.date.split('-');
    el.textContent = `${Number(y)}年${Number(m)}月${Number(d)}日は ${a.seasonName} です（行き先で区切りが変わります）。`;
  } else if (r.ready) {
    el.textContent = 'この日のシーズンは、ANA公式にまだ出ていません。';
  } else {
    el.textContent = '目的地を選ぶと、その日のシーズンが出ます。';
  }
}

/* ANA運航便だけで組んだときとの見くらべ */
function renderAnaBox(r) {
  const box = $('anaBox');
  box.innerHTML = '';
  const a = r.ready && r.anaOnly;
  if (!a || !r.miles) return;

  const names = { Y: 'エコノミー', PY: 'プレエコ', C: 'ビジネス', F: 'ファースト' };
  const el = document.createElement('div');
  el.className = 'ana-box';

  if (!a.hasChart) {
    el.innerHTML = '<div class="ana-title">ANA便だけでは行けません</div>' +
      `<p class="ana-note">${MB.labels[r.destZone]}へは、ANAの自社便が飛んでいません。` +
      'スタアラ便を使う旅程になります。</p>';
    box.appendChild(el);
    return;
  }
  if (!a.possible) {
    el.innerHTML = '<div class="ana-title">ANA便だけでは組めません</div>' +
      `<p class="ana-note">${a.noAna.join('・')} にANA便が見つかりません。` +
      '1区間でもスタアラ便が入ると、上のマイル数になります。</p>';
    box.appendChild(el);
    return;
  }
  if (!a.miles) {
    el.innerHTML = '<div class="ana-title">ANA便だけで組めます</div>' +
      '<p class="ana-note">上の「行きの搭乗日」を入れると、そのときのマイル数が出ます。' +
      'ANA便だけの特典はシーズンで値段が変わるためです。</p>';
    box.appendChild(el);
    return;
  }

  const rows = Object.entries(a.miles)
    .filter(([cls]) => r.miles[cls] != null)
    .map(([cls, v]) => {
      const diff = v - r.miles[cls];
      const kind = diff < 0 ? 'down' : diff > 0 ? 'up' : 'same';
      const word = diff < 0 ? `${Math.abs(diff).toLocaleString()} 安い`
                 : diff > 0 ? `${diff.toLocaleString()} 高い` : '同じ';
      return `<div class="ana-row"><span class="ana-row-cls">${names[cls] || cls}</span>` +
             `<span class="ana-row-num">${v.toLocaleString()}</span>` +
             `<span class="ana-diff ${kind}">${word}</span></div>`;
    }).join('');

  const pairs = Object.entries(a.miles).filter(([cls]) => r.miles[cls] != null);
  const cheaper = pairs.some(([cls, v]) => v < r.miles[cls]);
  const same = pairs.every(([cls, v]) => v === r.miles[cls]);

  el.innerHTML =
    `<div class="ana-title">ANA便だけで組むと` +
    `<span class="ana-season">${a.seasonName}</span></div>` +
    `<div class="ana-rows">${rows}</div>` +
    `<p class="ana-note">${
      same ? 'この日は、どちらで組んでも必要マイル数は同じです。'
             + '乗りたい会社や空席のあるほうで選べます。'
    : cheaper ? 'この日は、全部ANA便で組んだほうが安くなります。'
                + 'ただしANA便に特典の空席があることが要ります。'
    : 'この日は、スターアライアンス便を1便でも入れたほうが安くなります。'
      + 'ANA便だけの特典はシーズンで高くなりますが、'
      + 'スターアライアンス便が入る特典にはシーズンがないためです。'}</p>`;
  box.appendChild(el);
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

  $('diagram').innerHTML = drawItinerary(r, trip);
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
  if (trip.date) lines.push(`搭乗日：${trip.date}` + (r.anaOnly && r.anaOnly.seasonName ? `（${r.anaOnly.seasonName}）` : ''));
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
    if (!trip.countries) trip.countries = {};   // 前の版の記録には入っていません
    if (trip.onlyReachable === undefined) trip.onlyReachable = true;
    trip.out = fitSlots(trip.out);              // 枠の数が変わっていることがあります
    trip.back = fitSlots(trip.back);
  } catch (e) {}
}

/* ------------------------------------------------------------
 *  起動
 * ---------------------------------------------------------- */
(async function start() {
  try {
    const src = await loadAll();
    load();
    if (!trip.out.length) trip.out = emptySlots();
    if (!trip.back.length) trip.back = emptySlots();
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
      mode: 'roundtrip', from: APP.homeCity, out: emptySlots(), dest: '',
      ret: '', back: emptySlots(), to: APP.homeCity, stopover: '', date: '', countries: {},
    });
    refresh();
  });

  $('dateIn').addEventListener('change', () => { trip.date = $('dateIn').value; refresh(); });

  $('onlyReach').addEventListener('change', () => {
    trip.onlyReachable = $('onlyReach').checked;
    trip.reachOpen = '';
    trip.countries = {};   // 候補が変わるので、覚えていた国は選び直しになります
    refresh();
  });

  $('suggestBtn').addEventListener('click', () => {
    const btn = $('suggestBtn');
    if (!trip.dest) { flash(btn, 'さきに目的地を選んでください'); return; }
    if (trip.mode === 'openjaw') { flash(btn, 'オープンジョーでは出せません'); return; }
    btn.textContent = 'さがしています…';
    // 画面に「さがしています」を出してから探しにいきます
    setTimeout(() => {
      const t0 = performance.now();
      const plans = suggestRoutes(trip, 6);
      renderSuggests(plans);
      btn.textContent = '行き方をいくつか出す';
      console.log(`道さがし ${Math.round(performance.now() - t0)}ミリ秒 / ${plans.length}件`);
    }, 20);
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
