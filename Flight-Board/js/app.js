/* ============================================================
 *  画面の組み立て
 *  データの読み込みと検索は data.js が担当しています。
 * ============================================================ */

const $ = (id) => document.getElementById(id);

/* 画面に文字を出すときは必ずこれを通す。
   空港名に & や < が入っていてもレイアウトが壊れないようにするため。 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SIZE_LABEL = { L: '大規模', M: '中規模', S: '小規模' };

/* 現在の絞り込み状態 */
const state = {
  tab: 'routes',
  airportQuery: '',
  airportFilter: {},
  airlineQuery: '',
  airlineFilter: {},
  routeFrom: '',
  routeTo: '',
  routeView: 'list',              // 'list' か 'map'
  routeFilter: { area: '', alliance: '', band: '', carrier: '' },
  // 開いているエリアの見出し。出発地を変えたら畳み直すので、どこ発かも覚えておく
  routeOpen: { from: '', keys: new Set() },
  mapNeedsFit: true,              // 地図を開いたとき全体が入るように合わせ直すか
  aircraftQuery: '',
  aircraftFilter: {},
  aircraftAirline: '',   // 機材タブで選んでいる航空会社
  favs: new Set(),       // お気に入りの機材（起動時に読み込む）
  awardFilter: {},
  awardQuery: '',
  themePref: 'auto',     // 'auto' | 'light' | 'dark'
};

/* 就航の状態。Wikipedia の表記をそのまま日本語にしたもの */
const STATE_LABEL = {
  scheduled: '', // 通年運航はふつうなので、あえて何も出さない
  seasonal: '季節運航',
  charter: 'チャーター',
  future: '就航予定',
  ending: '運航終了予定',
  suspended: '運休中',
};

function stateTag(state) {
  const label = STATE_LABEL[state];
  return label ? `<span class="tag tag--${esc(state)}">${esc(label)}</span>` : '';
}

/* 空港を「NGO 中部国際（セントレア）」の形で表す */
function airportLabel(iata) {
  const a = FB.airportByIata[iata];
  if (!a) return iata;
  return `${iata} ${a.nameJa || a.name}`;
}

/* ------------------------------------------------------------
 *  路線
 * ---------------------------------------------------------- */
/* 運航会社の名前。マスタに載っていれば日本語、無ければ路線データの英語名。
   地図と一覧で表記が違うと混乱するので、両方ここを通します。 */
function airlineName(x) {
  const al = x.code ? FB.airlineByIata[x.code] : null;
  return al ? al.name : x.name;
}

function airlineChips(list, limit) {
  const shown = list.slice(0, limit);
  const rest = list.length - shown.length;
  return shown.map((x) =>
    `<span class="airline-chip">${esc(x.code ? `${x.code} ` : '')}${esc(airlineName(x))}${stateTag(x.state)}</span>`
  ).join('') + (rest > 0 ? `<span class="airline-chip airline-chip--more">ほか${rest}社</span>` : '');
}

/* いま選ばれている出発地の就航先を、距離やエリアの情報付きで取り出す */
function currentDestinations() {
  if (!FB.routesReady || !state.routeFrom) return [];
  const dests = FB.destinationsFrom(state.routeFrom);
  return FB.decorateDestinations(dests, state.routeFrom);
}

/* エリアの絞り込みボタンを、実際に就航先があるエリアだけで作り直す */
function renderAreaFilters(all) {
  const box = $('areaFilters');
  if (!all.length) { box.innerHTML = ''; return; }

  const opts = FB.areaOptions(all, state.routeFrom);
  box.innerHTML =
    `<button type="button" class="chip${state.routeFilter.area ? '' : ' is-active'}" data-area="">すべて<span class="chip__hint">${all.length}</span></button>` +
    opts.map((o) => `<button type="button" class="chip${state.routeFilter.area === o.key ? ' is-active' : ''}" data-area="${esc(o.key)}">${esc(o.label)}<span class="chip__hint">${o.count}</span></button>`).join('');
}

/* 絞り込みが何個効いているかをボタンに出す */
function renderFilterCount() {
  const f = state.routeFilter;
  const n = ['alliance', 'band', 'carrier'].filter((k) => f[k]).length;
  const badge = $('filterCount');
  badge.textContent = n;
  badge.classList.toggle('is-hidden', n === 0);
}

/* 就航先1件ぶんの行 */
function destRow(d) {
  const ap = d.airport;
  const name = ap ? (ap.nameJa || ap.name) : d.dest;
  const sub = ap ? [ap.cityJa || ap.city, ap.countryJa].filter(Boolean).join('・') : '';
  return `<li class="list__item list__item--route" data-airport="${esc(d.dest)}">
    <span class="code code--${esc(ap ? ap.size : 'S')}">${esc(d.dest)}</span>
    <span class="list__main">
      <span class="list__name">${esc(name)}</span>
      <span class="list__sub">${esc(sub)}　<span class="dist">${d.km.toLocaleString()}km</span></span>
      <span class="chips-inline">${airlineChips(d.airlines, 3)}</span>
    </span>
    <span class="list__arrow" aria-hidden="true">›</span>
  </li>`;
}

function renderRouteResult() {
  const box = $('routeResult');
  const toolbar = document.querySelector('.route-toolbar');
  const mapWrap = $('mapWrap');

  const showTools = (on) => {
    toolbar.classList.toggle('is-hidden', !on);
    $('areaFilters').classList.toggle('is-hidden', !on);
    if (!on) {
      $('filterPanel').classList.add('is-hidden');
      $('filterToggle').setAttribute('aria-expanded', 'false');
    }
  };

  if (!FB.routesReady) {
    showTools(false);
    mapWrap.classList.add('is-hidden');
    box.classList.remove('is-hidden');
    box.innerHTML = FB.routesError
      ? `<p class="notice__text notice--error">${esc(FB.routesError)}</p>`
      : '<p class="hint">路線データを読み込んでいます…</p>';
    return;
  }

  const from = state.routeFrom;
  const to = state.routeTo;

  if (!from) {
    showTools(false);
    mapWrap.classList.add('is-hidden');
    box.classList.remove('is-hidden');
    box.innerHTML = `<p class="hint">出発する空港を選ぶと、そこから飛べる就航先が出ます。
      到着も選べば、直行便があるかどうかが分かります。</p>`;
    return;
  }

  // ---- 2空港のあいだ（絞り込みも地図も使わない） ----
  if (to) {
    showTools(false);
    mapWrap.classList.add('is-hidden');
    box.classList.remove('is-hidden');

    const airlines = FB.directBetween(from, to);
    const km = FB.distanceKm(FB.airportByIata[from], FB.airportByIata[to]);
    const head = `<div class="route-head">
      <span class="route-head__ap">${esc(airportLabel(from))}</span>
      <span class="route-head__arrow" aria-hidden="true">→</span>
      <span class="route-head__ap">${esc(airportLabel(to))}</span>
    </div>
    <p class="result-count">直線距離 約 ${km.toLocaleString()} km</p>`;

    if (!airlines.length) {
      box.innerHTML = head + `<div class="verdict verdict--no">
        <p class="verdict__title">直行便は見つかりませんでした</p>
        <p class="verdict__note">乗り継ぎが必要か、この区間がまだ表に載っていない可能性があります。
          データの出どころは各空港の Wikipedia なので、開設したばかりの路線は反映が遅れることがあります。</p>
      </div>`;
      return;
    }

    box.innerHTML = head + `<div class="verdict verdict--yes">
        <p class="verdict__title">直行便あり　${airlines.length}社</p>
      </div>
      <ul class="list">
        ${airlines.map((x) => `<li class="list__item${x.code ? '' : ' is-plain'}"${x.code ? ` data-airline="${esc(x.code)}"` : ''}>
          <span class="code code--airline">${esc(x.code || '—')}</span>
          <span class="list__main">
            <span class="list__name">${esc(airlineName(x))}</span>
            <span class="list__sub">${esc(STATE_LABEL[x.state] || '通年運航')}</span>
          </span>
          ${x.code ? '<span class="list__arrow" aria-hidden="true">›</span>' : ''}
        </li>`).join('')}
      </ul>`;
    return;
  }

  // ---- 出発地からの就航先 ----
  const all = currentDestinations();
  if (!all.length) {
    showTools(false);
    mapWrap.classList.add('is-hidden');
    box.classList.remove('is-hidden');
    box.innerHTML = `<p class="hint">${esc(airportLabel(from))} の就航先が見つかりませんでした。
      小さな空港は Wikipedia に路線の表が無いことがあります。</p>`;
    return;
  }

  showTools(true);
  renderAreaFilters(all);
  renderFilterCount();

  const dests = FB.filterDestinations(all, state.routeFilter, from);
  const isMap = state.routeView === 'map';
  box.classList.toggle('is-hidden', isMap);
  mapWrap.classList.toggle('is-hidden', !isMap);

  if (isMap) {
    ensureMap();
    FBMap.show(FB.airportByIata[from], dests, state.mapNeedsFit);
    state.mapNeedsFit = false;
    // 絞り込みで選んでいた就航先が消えたら、情報パネルも閉じる
    showMapInfo(FBMap.selected);
    return;
  }

  if (!dests.length) {
    box.innerHTML = '<p class="hint">この条件に合う就航先はありませんでした。絞り込みを緩めてみてください。</p>';
    return;
  }

  const groups = FB.groupDestinations(dests, from);
  const countries = new Set(dests.map((d) => d.airport && d.airport.country).filter(Boolean));

  // 出発地が変わったら、開いていたエリアは畳み直す
  const open = state.routeOpen;
  if (open.from !== from) { open.from = from; open.keys.clear(); }
  // エリアが1つしかないときに畳んでおくと、ただの一手間なので開けておく
  const isOpen = (g) => groups.length === 1 || open.keys.has(g.key);
  const allOpen = groups.every(isOpen);

  box.innerHTML = `<div class="result-head">
      <p class="result-count">${dests.length} 就航先　${countries.size} の国・地域</p>
      ${groups.length > 1
        ? `<button type="button" class="result-toggle" id="destToggleAll" data-open="${allOpen ? '1' : ''}">
             ${allOpen ? 'すべて畳む' : 'すべて開く'}
           </button>`
        : ''}
    </div>` +
    groups.map((g) => `<details class="destgroup" data-group="${esc(g.key)}"${isOpen(g) ? ' open' : ''}>
      <summary class="destgroup__head">
        <span class="destgroup__name">${esc(g.label)}</span>
        <span class="destgroup__n">${g.items.length}</span>
      </summary>
      <ul class="list">${g.items.map(destRow).join('')}</ul>
    </details>`).join('');
}

/* 地図で就航先をタップしたときに、その路線を誰が飛んでいるかを出す */
function showMapInfo(iata) {
  const panel = $('mapInfo');
  if (!iata || iata === state.routeFrom) {
    panel.classList.add('is-hidden');
    return;
  }

  const d = (FBMap.dests || []).find((x) => x.dest === iata);
  if (!d) { panel.classList.add('is-hidden'); return; }

  const ap = d.airport;
  const name = ap ? (ap.nameJa || ap.name) : iata;
  const sub = ap ? [ap.cityJa || ap.city, ap.countryJa].filter(Boolean).join('・') : '';

  $('mapInfoBody').innerHTML = `
    <p class="map-info__route">
      <span class="map-info__code">${esc(state.routeFrom)}</span>
      <span aria-hidden="true">→</span>
      <span class="map-info__code">${esc(iata)}</span>
      <span class="map-info__name">${esc(name)}</span>
    </p>
    <p class="map-info__meta">${esc(sub)}　直線距離 約 ${d.km.toLocaleString()} km　${d.airlines.length}社が運航</p>
    <ul class="map-info__airlines">
      ${d.airlines.map((x) => {
        return `<li class="map-info__airline">
        <span class="map-info__al-code">${esc(x.code || '—')}</span>
        <span class="map-info__al-name">${esc(airlineName(x))}</span>
        ${stateTag(x.state)}
      </li>`;
      }).join('')}
    </ul>
    <button type="button" class="link-btn link-btn--wide" data-airport="${esc(iata)}">この空港の詳細を見る</button>`;
  panel.classList.remove('is-hidden');
}

/* 地図は初回に開いたときだけ用意する（陸地データの読み込みを待つため） */
function ensureMap() {
  if (FBMap._ready) { FBMap.resize(); return; }
  FBMap.init($('routeMap'), FB.land, FB.airports, showMapInfo);
  state.mapNeedsFit = true;
}

/* 空港を選ぶ入力欄。候補を出してタップで確定する */
function wirePicker(inputId, suggestId, clearId, onPick) {
  const input = $(inputId);
  const suggest = $(suggestId);
  const clear = $(clearId);

  const hide = () => suggest.classList.add('is-hidden');

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clear.classList.toggle('is-hidden', !q);
    if (!q) { hide(); onPick(''); return; }

    const hits = FB.searchAirports(q, {}).slice(0, 8);
    if (!hits.length) { hide(); return; }
    suggest.innerHTML = hits.map((a) => `<li class="suggest__item" data-iata="${esc(a.iata)}">
      <span class="code code--${esc(a.size)}">${esc(a.iata)}</span>
      <span class="suggest__name">${esc(a.nameJa || a.name)}</span>
      <span class="suggest__sub">${esc(a.cityJa || a.city)}</span>
    </li>`).join('');
    suggest.classList.remove('is-hidden');
  });

  suggest.addEventListener('click', (e) => {
    const li = e.target.closest('.suggest__item');
    if (!li) return;
    const iata = li.dataset.iata;
    input.value = airportLabel(iata);
    clear.classList.remove('is-hidden');
    hide();
    onPick(iata);
  });

  clear.addEventListener('click', () => {
    input.value = '';
    clear.classList.add('is-hidden');
    hide();
    onPick('');
    input.focus();
  });

  // 候補を開いたまま他所をさわったら閉じる
  document.addEventListener('click', (e) => {
    if (!e.target.closest(`#${suggestId}`) && e.target !== input) hide();
  });
}

/* ------------------------------------------------------------
 *  空港
 * ---------------------------------------------------------- */
function airportRow(a) {
  const name = a.nameJa || a.name;
  const city = a.cityJa || a.city;
  // 日本語名を出しているときは、英語の正式名も小さく併記する。
  // 海外のサイトや航空券の画面は英語表記なので、突き合わせられたほうが役に立つ。
  const sub = [city, a.countryJa].filter(Boolean).join('・');
  const alt = a.nameJa && a.name !== a.nameJa ? a.name : '';

  return `<li class="list__item" data-airport="${esc(a.iata)}">
    <span class="code code--${esc(a.size)}">${esc(a.iata)}</span>
    <span class="list__main">
      <span class="list__name">${esc(name)}</span>
      <span class="list__sub">${esc(sub)}${alt ? ' ／ ' + esc(alt) : ''}</span>
    </span>
    <span class="list__arrow" aria-hidden="true">›</span>
  </li>`;
}

function renderAirports() {
  const hits = FB.searchAirports(state.airportQuery, state.airportFilter);
  const limit = APP.listLimit;
  const shown = hits.slice(0, limit);

  $('airportCount').textContent =
    hits.length ? `${hits.length.toLocaleString()} 件` : '見つかりませんでした';
  $('airportList').innerHTML = shown.map(airportRow).join('');

  const more = $('airportMore');
  if (hits.length > limit) {
    more.textContent = `ほかに ${(hits.length - limit).toLocaleString()} 件あります。検索語を足すと絞り込めます。`;
    more.classList.remove('is-hidden');
  } else {
    more.classList.add('is-hidden');
  }

  $('airportClear').classList.toggle('is-hidden', !state.airportQuery);
}

/* 空港の詳細に出す就航先の要約。長くなりすぎないよう上位だけ見せて、
   全部見たい人は「路線」タブへ回ってもらう */
function airportRoutesBlock(iata) {
  if (!FB.routesReady) {
    return `<div class="todo"><p class="todo__title">就航路線</p>
      <p class="todo__text">${esc(FB.routesError || '読み込み中です。')}</p></div>`;
  }

  const dests = FB.destinationsFrom(iata);
  if (!dests.length) {
    return `<div class="todo"><p class="todo__title">就航路線</p>
      <p class="todo__text">この空港の路線表は見つかりませんでした。
      小さな空港は Wikipedia に表が無いことがあります。</p></div>`;
  }

  const top = dests.slice(0, 12);
  const rest = dests.length - top.length;
  return `<div class="routes-block">
    <p class="routes-block__title">就航先 ${dests.length}</p>
    <ul class="mini-list">
      ${top.map((d) => {
        const ap = d.airport;
        return `<li class="mini-list__item" data-airport="${esc(d.dest)}">
          <span class="mini-list__code">${esc(d.dest)}</span>
          <span class="mini-list__name">${esc(ap ? (ap.nameJa || ap.name) : d.dest)}</span>
          <span class="mini-list__n">${d.airlines.length}社</span>
        </li>`;
      }).join('')}
    </ul>
    ${rest > 0 ? `<p class="routes-block__more">ほか ${rest} 就航先。「ここからの路線を見る」で全部出ます。</p>` : ''}
  </div>`;
}

function openAirport(iata) {
  const a = FB.airportByIata[iata];
  if (!a) return;

  const name = a.nameJa || a.name;
  const rows = [
    ['IATAコード', a.iata],
    ['ICAOコード', a.icao || '—'],
    ['英語名', a.name],
    ['都市', [a.cityJa, a.city].filter(Boolean).join(' / ') || '—'],
    ['国・地域', `${a.countryJa}（${a.country}）`],
    ['規模', SIZE_LABEL[a.size] || '—'],
    ['座標', `${a.lat}, ${a.lon}`],
  ];

  const maps = `https://maps.apple.com/?q=${encodeURIComponent(a.name)}&ll=${a.lat},${a.lon}`;
  const wiki = a.wiki ? `https://en.wikipedia.org/wiki/${a.wiki}` : '';

  openSheet(`${a.iata}　${name}`, `
    <dl class="spec">
      ${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
    </dl>
    <div class="links">
      <a class="link-btn" href="${esc(maps)}" target="_blank" rel="noopener">地図で見る</a>
      ${wiki ? `<a class="link-btn" href="${esc(wiki)}" target="_blank" rel="noopener">Wikipedia</a>` : ''}
      <button type="button" class="link-btn" data-route-from="${esc(a.iata)}">ここからの路線を見る</button>
    </div>
    ${airportRoutesBlock(a.iata)}
  `);
}

/* ------------------------------------------------------------
 *  航空会社
 * ---------------------------------------------------------- */
function allianceChip(a) {
  const al = FB.alliances[a.alliance];
  if (!al) return '<span class="badge badge--none">非加盟</span>';
  // 資格停止中（ロシアの2社）は、色を薄くして「今は特典に使えない」と分かるようにする
  const cls = a.suspended ? 'badge badge--suspended' : 'badge';
  const label = a.suspended ? `${al.name}（停止中）` : al.name;
  return `<span class="${cls}" style="--badge:${esc(al.color)}">${esc(label)}</span>`;
}

function airlineRow(a) {
  return `<li class="list__item" data-airline="${esc(a.iata)}">
    <span class="code code--airline">${esc(a.iata)}</span>
    <span class="list__main">
      <span class="list__name">${esc(a.name)}</span>
      <span class="list__sub">${esc(a.countryJa)} ／ ${esc(a.nameEn)}</span>
    </span>
    ${allianceChip(a)}
  </li>`;
}

function renderAirlines() {
  const hits = FB.searchAirlines(state.airlineQuery, state.airlineFilter);
  $('airlineCount').textContent =
    hits.length ? `${hits.length} 社` : '見つかりませんでした';
  $('airlineList').innerHTML = hits.map(airlineRow).join('');
  $('airlineClear').classList.toggle('is-hidden', !state.airlineQuery);
}

function openAirline(iata) {
  const a = FB.airlineByIata[iata];
  if (!a) return;

  const al = FB.alliances[a.alliance];
  const rows = [
    ['IATAコード', a.iata],
    ['ICAOコード', a.icao || '—（未確認のため空欄）'],
    ['英語名', a.nameEn],
    ['国・地域', `${a.countryJa}（${a.country}）`],
    ['アライアンス', al
      ? `${al.name}（${a.joined}年加盟）${a.suspended ? '／現在は資格停止中' : ''}`
      : '非加盟'],
  ];
  if (a.note) rows.push(['備考', a.note]);

  const wiki = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(a.nameEn)}`;

  openSheet(`${a.iata}　${a.name}`, `
    <dl class="spec">
      ${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
    </dl>
    <div class="links">
      <a class="link-btn" href="${esc(wiki)}" target="_blank" rel="noopener">Wikipedia</a>
      ${al ? `<a class="link-btn" href="${esc(al.site)}" target="_blank" rel="noopener">${esc(al.name)}公式</a>` : ''}
    </div>
    ${awardBlock(a.iata)}
    ${fleetBlock(a.iata)}
  `);
}


/* 座席仕様を「F8・J56・W73・Y383」の形にする。
   上位クラスには座席タイプと当たり外れの印も添える */
function cabinLine(seats, row) {
  const types = (row && row.seatType) || {};
  const marks = (row && row.seatMark) || {};
  return FB.cabinOrder
    .filter((k) => seats[k])
    .map((k) => {
      const t = types[k];
      const m = marks[k];
      const title = t ? ` title="${esc(FB.seatTypes[t] || t)}"` : '';
      return `<span class="cab cab--${esc(k)}"${title}>${esc(k)}${seats[k]}` +
             (m ? `<i class="mark mark--${esc(m)}">${esc((FB.seatMarks[m] || {})[k] || '')}</i>` : '') +
             `</span>`;
    })
    .join('');
}

/* 座席タイプの説明行（「ビジネス＝フルフラット（直通通路）」） */
function seatTypeLine(row) {
  const types = (row && row.seatType) || {};
  const keys = FB.cabinOrder.filter((k) => types[k]);
  if (!keys.length) return '';
  return `<span class="cabin-item__type">${keys.map((k) =>
    `${esc(FB.cabinClasses[k] || k)}＝${esc(FB.seatTypes[types[k]] || types[k])}`).join('　')}</span>`;
}

/* 機材の詳細に出す「この機材を飛ばしている会社」 */
function operatorsBlock(icao) {
  const rows = FB.cabinsByAircraft[icao] || [];
  if (!rows.length) return '';

  return `<div class="routes-block">
    <p class="routes-block__title">この機材の座席仕様</p>
    <ul class="cabin-list">
      ${rows.map((r) => {
        const al = FB.airlineByIata[r.airline];
        return `<li class="cabin-item"${al ? ` data-airline="${esc(r.airline)}"` : ''}>
          <span class="cabin-item__head">
            <span class="cabin-item__name">${esc(al ? al.name : r.airline)}</span>
            <span class="cabin-item__n">${r.count ? r.count + '機' : ''}　計${r.total}席</span>
            ${favButton(favKey(r.airline, icao))}
          </span>
          <span class="cabin-item__seats">${cabinLine(r.seats, r)}</span>
          ${seatTypeLine(r)}
        </li>`;
      }).join('')}
    </ul>
    <p class="fineprint">座席タイプと印は、公表されている座席表をもとにこちらで整理したものです。
      機内改修で変わることがあります。「残念」の印は、ワイドボディか長距離を飛ぶ機体で
      フルフラットにならない場合に付けています。</p>
  </div>`;
}

/* 航空会社の詳細に出す保有機材 */
function fleetBlock(iata) {
  const data = FB.cabins[iata];
  if (!data || !data.fleet.length) return '';

  return `<div class="routes-block">
    <p class="routes-block__title">保有機材と座席仕様</p>
    <ul class="cabin-list">
      ${data.fleet.map((r) => {
        const ac = FB.aircraftByIcao[r.icao];
        return `<li class="cabin-item" data-aircraft="${esc(r.icao)}">
          <span class="cabin-item__head">
            <span class="cabin-item__name">${esc(ac ? ac.maker + ' ' + ac.model : r.label)}</span>
            <span class="cabin-item__n">${r.count ? r.count + '機' : ''}　計${r.total}席</span>
            ${favButton(favKey(iata, r.icao))}
          </span>
          <span class="cabin-item__seats">${cabinLine(r.seats, r)}</span>
          ${seatTypeLine(r)}
        </li>`;
      }).join('')}
    </ul>
  </div>`;
}

/* ------------------------------------------------------------
 *  お気に入りの機材
 *  この端末のブラウザに保存します（localStorage）。
 *  サーバーには何も送らないので、端末をまたいだ共有はされません。
 *  Safari のプライベートブラウズなど、保存できない環境でも
 *  アプリ自体は動くように、読み書きは失敗しても黙って続けます。
 * ---------------------------------------------------------- */
/* お気に入りの単位は「航空会社×機材」です。キーは "NH/B789" の形。
   同じ777-300ERでも会社によって座席が別物なので、型式だけを覚えても
   あまり役に立ちません。「ANAの787-9」まで覚えて初めて意味が出ます。 */
const FAV_KEY = () => `${APP.storageKey}:fav-fleet`;

/* お気に入りのキーを作る／分解する */
const favKey = (airline, icao) => `${airline}/${icao}`;
const favParts = (key) => {
  const i = key.indexOf('/');
  return i < 0 ? null : { airline: key.slice(0, i), icao: key.slice(i + 1) };
};

function loadFavs() {
  try {
    const raw = localStorage.getItem(FAV_KEY());
    const list = raw ? JSON.parse(raw) : [];
    // 「NH/B789」の形でないものは読み飛ばす（古い形式が残っていても壊れないように）
    return new Set(list.filter((k) => typeof k === 'string' && k.includes('/')));
  } catch (e) {
    return new Set();
  }
}

function saveFavs(set) {
  try {
    localStorage.setItem(FAV_KEY(), JSON.stringify([...set]));
  } catch (e) {
    // 保存できなくても、その回のあいだは画面上で使えるようにしておく
  }
}

function isFav(key) { return state.favs.has(key); }

function toggleFav(key) {
  if (state.favs.has(key)) state.favs.delete(key);
  else state.favs.add(key);
  saveFavs(state.favs);
}

/* 星のボタン。一覧でも詳細でも同じものを使う */
function favButton(key, big) {
  const on = isFav(key);
  return `<button type="button" class="fav${big ? ' fav--big' : ''}${on ? ' is-on' : ''}"
    data-fav="${esc(key)}" aria-pressed="${on}"
    title="${on ? 'お気に入りから外す' : 'お気に入りに入れる'}">${on ? '★' : '☆'}</button>`;
}

/* ------------------------------------------------------------
 *  機材
 * ---------------------------------------------------------- */
const CAT_CLASS = { wide: 'wide', narrow: 'narrow', regional: 'regional', prop: 'prop' };

/* 「中距離・長距離（約3〜7時間／約7時間〜）」の形にする */
function haulLabel(haul) {
  if (!haul) return '—';
  const keys = haul.split(' ');
  const names = keys.map((k) => FB.hauls[k] || k).join('・');
  const hints = keys.map((k) => FB.haulHints[k] || '').filter(Boolean).join('／');
  return hints ? `${names}（${hints}）` : names;
}

/* 収録している40社の実績から、その機種に設定されているクラスを集める。
   同じ機種でも会社によってクラス構成が違うので、実データから出しています。 */
function classesOf(icao) {
  const rows = FB.cabinsByAircraft[icao] || [];
  if (!rows.length) return '—';
  const found = new Set();
  rows.forEach((r) => Object.keys(r.seats).forEach((k) => found.add(k)));
  const list = FB.cabinOrder.filter((k) => found.has(k));
  if (!list.length) return '—';
  return list.map((k) => `${k}（${FB.cabinClasses[k] || k}）`).join('　');
}

function aircraftRow(a) {
  return `<li class="list__item" data-aircraft="${esc(a.icao)}">
    <span class="code code--ac code--ac-${esc(CAT_CLASS[a.category])}">${esc(a.icao)}</span>
    <span class="list__main">
      <span class="list__name">${esc(a.maker)} ${esc(a.model)}</span>
      <span class="list__sub">${esc(a.categoryJa)}　${a.seats}席　${a.engines}発</span>
    </span>
    ${a.status === 'prod' ? '<span class="tag tag--future">生産中</span>' : ''}
    <span class="list__arrow" aria-hidden="true">›</span>
  </li>`;
}

/* 航空会社1社ぶんの行。保有機数と、収録している機種の数を出す */
function fleetOwnerRow(code) {
  const al = FB.airlineByIata[code];
  const data = FB.cabins[code];
  const types = data.fleet.length;
  const planes = data.fleet.reduce((n, r) => n + (r.count || 0), 0);
  const alliance = al && FB.alliances[al.alliance];

  // アライアンスの札は2行目に置きます。1行目に並べると、
  // 「ANA（全日本空輸）」のような長い社名が途中で切れてしまうためです。
  return `<li class="list__item" data-fleet="${esc(code)}">
    <span class="code code--airline">${esc(code)}</span>
    <span class="list__main">
      <span class="list__name">${esc(al ? al.name : code)}</span>
      <span class="list__sub list__sub--wrap">
        ${types} 機種${planes ? `　保有 ${planes} 機` : ''}${al ? '　' + esc(al.countryJa) : ''}
        ${alliance ? `<span class="badge badge--sm" style="--badge:${esc(alliance.color)}">${esc(alliance.name)}</span>` : ''}
      </span>
    </span>
    <span class="list__arrow" aria-hidden="true">›</span>
  </li>`;
}

/* 選んだ航空会社の保有機材。タップすると機材の詳細に入る */
function fleetRow(r, airline) {
  const ac = FB.aircraftByIcao[r.icao];
  const name = ac ? `${ac.maker} ${ac.model}` : r.label;
  return `<li class="list__item list__item--route" data-aircraft="${esc(r.icao)}">
    <span class="code code--ac code--ac-${esc(ac ? CAT_CLASS[ac.category] : 'narrow')}">${esc(r.icao)}</span>
    <span class="list__main">
      <span class="list__name">${esc(name)}</span>
      <span class="list__sub">${r.count ? r.count + '機' : '発注中'}　計${r.total}席${ac ? '　' + esc(ac.categoryJa) : ''}</span>
      <span class="cabin-item__seats">${cabinLine(r.seats, r)}</span>
      ${seatTypeLine(r)}
    </span>
    ${favButton(favKey(airline, r.icao))}
    <span class="list__arrow" aria-hidden="true">›</span>
  </li>`;
}

/* お気に入りのひとかたまり。
   同じ「ANAの787-9」でも座席仕様が何種類もあることが多いので
   （国際線・国内線・機体ごとの改修差）、組み合わせを見出しにして
   仕様はその下にぶら下げます。そうしないと「2件」なのに8行出て混乱します。 */
function favGroup(key, rows) {
  const pt = favParts(key);
  const al = FB.airlineByIata[pt.airline];
  const ac = FB.aircraftByIcao[pt.icao];
  const name = ac ? `${ac.maker} ${ac.model}` : (rows[0] ? rows[0].label : pt.icao);
  const planes = rows.length ? rows[0].count : 0;

  return `<section class="favgroup">
    <header class="favgroup__head">
      <span class="code code--ac code--ac-${esc(ac ? CAT_CLASS[ac.category] : 'narrow')}">${esc(pt.icao)}</span>
      <span class="favgroup__title">
        <span class="favgroup__airline">${esc(al ? al.name : pt.airline)}</span>
        <span class="favgroup__ac">${esc(name)}${planes ? `　${planes}機` : ''}</span>
      </span>
      ${favButton(key)}
    </header>
    <ul class="list">
      ${rows.map((r) => `<li class="list__item list__item--route" data-aircraft="${esc(r.icao)}">
        <span class="list__main">
          <span class="list__sub">計 ${r.total} 席</span>
          <span class="cabin-item__seats">${cabinLine(r.seats, r)}</span>
          ${seatTypeLine(r)}
        </span>
        <span class="list__arrow" aria-hidden="true">›</span>
      </li>`).join('')}
    </ul>
  </section>`;
}

/* ------------------------------------------------------------
 *  特別な座席・設備
 *
 *  ここだけは向きが逆です。ほかは「機材を選ぶ→座席が分かる」ですが、
 *  ここは「座席を知っている→どの機材か調べる」。
 *  THE Room に乗りたい人は、機種名ではなく製品名から入るためです。
 * ---------------------------------------------------------- */

const DOOR_JA = { yes: 'あり', no: 'なし', part: '一部の席' };

/** 寸法を「198cm」「69〜105cm」のように書く。無ければ「—」 */
function sizeText(v) {
  if (v == null) return '—';
  if (Array.isArray(v)) {
    const [lo, hi] = v;
    if (lo == null) return `最大 ${hi}cm`;
    if (hi == null) return `${lo}cm〜`;
    return `${lo}〜${hi}cm`;
  }
  return `${v}cm`;
}

function productCard(p) {
  const al = FB.airlineByIata[p.airline];
  const acs = p.ac.map((c) => {
    const a = FB.aircraftByIcao[c];
    return `<button type="button" class="prod__ac" data-aircraft="${esc(c)}">${
      esc(a ? a.model : c)}</button>`;
  }).join('');

  // 寸法は確かめられたものだけ入れています。空欄は「無い」ではなく
  // 「確かめられなかった」なので、—— を出して数字を作りません。
  const specs = [
    ['扉', DOOR_JA[p.door] || '—'],
    ['配列', p.abreast],
    ['ベッド長', sizeText(p.bedL)],
    ['幅', sizeText(p.bedW)],
  ].map(([k, v]) => `<li class="prod__spec"><b>${k}</b>${esc(v)}</li>`).join('');

  const pair = (FB.productMeta.pairs || {})[p.pair] || p.pair;
  const cabinJa = (FB.productMeta.cabins || {})[p.cabin] || p.cabin;

  return `<li class="prod">
    <p class="prod__head">
      <span class="prod__cabin prod__cabin--${p.cabin}">${esc(cabinJa)}</span>
      <span class="prod__name">${esc(p.name)}</span>
    </p>
    <p class="prod__air">${esc(al ? al.name : p.airline)}${acs}${
      p.partial ? '<span class="prod__part">一部の機体だけ</span>' : ''}</p>
    <ul class="prod__specs">${specs}</ul>
    <p class="prod__pair prod__pair--${p.pair}">${esc(pair)}</p>
    <p class="prod__routes">${esc(p.routes)}</p>
    <p class="prod__note">${esc(p.note).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>
  </li>`;
}

/** 特別な座席の一覧。日本から乗れるものを先に出します。 */
function renderSpecial(q) {
  const box = $('aircraftList');
  const order = { F: 0, J: 1, W: 2, Y: 3 };
  let list = FB.products.slice();
  if (q) list = list.filter((p) => p.q.includes(normalizeQuery(q)));

  const groups = [
    ['日本から乗れる', (p) => p.jp && p.status === 'now'],
    ['乗り継げば乗れる', (p) => !p.jp && p.status === 'now'],
    ['これから', (p) => p.status === 'soon'],
  ];

  $('aircraftCount').textContent = list.length
    ? `特別な座席・設備　${list.length} 件`
    : '見つかりませんでした';

  box.innerHTML = groups.map(([label, test]) => {
    // クラスの上から順に、同じクラスなら日本の会社を先に出します。
    // 五十音でも英字順でもエールフランスが先頭に来てしまい、
    // 日本から乗る人がいちばん見たいものが下に沈むためです。
    const jpAir = { NH: 0, JL: 1, ZG: 2 };
    const rows = list.filter(test).sort((a, b) =>
      (order[a.cabin] - order[b.cabin])
      || ((jpAir[a.airline] ?? 9) - (jpAir[b.airline] ?? 9))
      || a.airline.localeCompare(b.airline));
    if (!rows.length) return '';
    return `<p class="prod-group">${label}<span class="prod-group__n">${
      rows.length}</span></p>
      <ul class="prod-list">${rows.map(productCard).join('')}</ul>`;
  }).join('') + `<p class="prod-note">${esc(FB.productMeta.note || '')}</p>`;
}

function renderAircraft() {
  const box = $('aircraftList');
  const code = state.aircraftAirline;
  const q = (state.aircraftQuery || '').trim().toLowerCase();
  const back = $('aircraftBack');

  $('aircraftClear').classList.toggle('is-hidden', !state.aircraftQuery);

  // ---- 特別な座席・設備 ----
  if (code === '__special') {
    back.classList.remove('is-hidden');
    $('aircraftSearch').placeholder = '製品名・会社・機種（例：Qsuite、ANA、A380）';
    renderSpecial(state.aircraftQuery);
    return;
  }

  // ---- お気に入りだけを見るとき ----
  if (code === '__fav') {
    back.classList.remove('is-hidden');
    $('aircraftSearch').placeholder = '航空会社・機種で絞る';

    // 登録した「航空会社×機材」に当てはまる座席仕様を集める。
    // 同じ組み合わせでも仕様違いが複数あることがあるので、その場合は全部出します
    // （エミレーツの777-300ERのように、座席数の違う機体が何種類もあるため）。
    let rows = [];
    [...state.favs].forEach((key) => {
      const pt = favParts(key);
      if (!pt) return;
      const data = FB.cabins[pt.airline];
      if (!data) return;
      data.fleet.filter((r) => r.icao === pt.icao)
        .forEach((r) => rows.push({ row: r, airline: pt.airline, key }));
    });

    if (q) {
      rows = rows.filter(({ row, airline }) => {
        const al = FB.airlineByIata[airline];
        const ac = FB.aircraftByIcao[row.icao];
        return [airline, al && al.name, al && al.nameEn, row.icao, row.label,
                ac && ac.maker, ac && ac.model]
          .filter(Boolean).join(' ').toLowerCase().includes(q);
      });
    }

    const groups = new Map();
    rows.forEach(({ row, key }) => {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    $('aircraftCount').textContent = groups.size
      ? `お気に入り　${groups.size} 件`
      : (state.favs.size ? '該当するものがありません' : 'お気に入りはまだありません');
    box.innerHTML = groups.size
      ? [...groups].map(([key, list]) => favGroup(key, list)).join('')
      : `<p class="hint">保有機材の行や、機材の詳細にある☆を押すと、ここにたまっていきます。</p>`;
    return;
  }

  // ---- すべての機材を横断で見るとき ----
  // 収録40社のどこにも属さない機材（コンコルド、YS-11 など）に
  // 辿り着けなくなるので、この入口を残しています。
  if (code === '__all') {
    back.classList.remove('is-hidden');
    $('aircraftSearch').placeholder = '機種名・型式（例：787、A350、B77W）';
    const hits = FB.searchAircraft(state.aircraftQuery, {});
    $('aircraftCount').textContent =
      hits.length ? `すべての機材　${hits.length} 機種` : '見つかりませんでした';
    box.innerHTML = `<ul class="list">${hits.map(aircraftRow).join('')}</ul>`;
    return;
  }

  // ---- 航空会社を選んでいるとき：その会社の保有機材 ----
  if (code) {
    const al = FB.airlineByIata[code];
    back.classList.remove('is-hidden');
    $('aircraftSearch').placeholder = '機種名・型式（例：787、A350）';

    let fleet = (FB.cabins[code] || { fleet: [] }).fleet;
    if (q) {
      fleet = fleet.filter((r) => {
        const ac = FB.aircraftByIcao[r.icao];
        const hay = [r.icao, r.label, ac && ac.maker, ac && ac.model]
          .filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }

    const planes = fleet.reduce((n, r) => n + (r.count || 0), 0);
    $('aircraftCount').textContent = fleet.length
      ? `${al ? al.name : code}　${fleet.length} 機種${planes ? `　保有 ${planes} 機` : ''}`
      : '該当する機材がありません';
    box.innerHTML = `<ul class="list">${fleet.map((r) => fleetRow(r, code)).join('')}</ul>`;
    return;
  }

  // ---- 航空会社の一覧 ----
  back.classList.add('is-hidden');
  $('aircraftSearch').placeholder = '航空会社名・コード（例：ANA、JL、Qatar）';

  let codes = Object.keys(FB.cabins);
  if (q) {
    codes = codes.filter((c) => {
      const al = FB.airlineByIata[c];
      const hay = [c, al && al.name, al && al.nameEn, al && al.countryJa]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  $('aircraftCount').textContent = codes.length
    ? `${codes.length} 社　タップすると保有機材が出ます`
    : '見つかりませんでした';
  const nFav = state.favs.size;
  const favEntry = (q || !nFav) ? '' : `<li class="list__item list__item--all" data-fleet="__fav">
      <span class="code code--airline code--fav">★</span>
      <span class="list__main">
        <span class="list__name">お気に入りの機材</span>
        <span class="list__sub">${nFav} 件（航空会社×機材）</span>
      </span>
      <span class="list__arrow" aria-hidden="true">›</span>
    </li>`;

  const allEntry = q ? '' : `<li class="list__item list__item--all" data-fleet="__all">
      <span class="code code--airline">✈</span>
      <span class="list__main">
        <span class="list__name">すべての機材から探す</span>
        <span class="list__sub">${FB.aircraft.length} 機種。どの会社にも属さない過去の名機もここから</span>
      </span>
      <span class="list__arrow" aria-hidden="true">›</span>
    </li>`;

  // 「THE Room に乗りたい」から入る人のための入口。
  // 会社の一覧の上に置きます。機種名を知らなくてもたどり着けるように。
  const nJp = FB.products.filter((p) => p.jp && p.status === 'now').length;
  const specialEntry = (q || !FB.products.length) ? '' :
    `<li class="list__item list__item--all list__item--special" data-fleet="__special">
      <span class="code code--airline code--special" aria-hidden="true">
        <svg class="code__i"><use href="#i-award"/></svg>
      </span>
      <span class="list__main">
        <span class="list__name">特別な座席・設備</span>
        <span class="list__sub">THE Room・Qsuite など ${FB.products.length} 件。うち日本から乗れる ${nJp} 件</span>
      </span>
      <span class="list__arrow" aria-hidden="true">›</span>
    </li>`;

  box.innerHTML = `<ul class="list">${specialEntry}${favEntry}${
    codes.map(fleetOwnerRow).join('')}${allEntry}</ul>`;
}

/** 機材の詳細に「この機材で乗れる特別な座席」を出す。
 *  会社ごとの座席仕様（何席あるか）の上に置きます。
 *  数字より先に「THE Room がある」と分かるほうが、選ぶ役に立つためです。 */
function specialBlock(icao) {
  const list = FB.productsByAircraft[icao] || [];
  if (!list.length) return '';
  const order = { F: 0, J: 1, W: 2, Y: 3 };
  const rows = list.slice().sort((a, b) => order[a.cabin] - order[b.cabin]);
  return `<div class="routes-block">
    <p class="routes-block__title">この機材で乗れる特別な座席</p>
    <ul class="prod-list">${rows.map(productCard).join('')}</ul>
  </div>`;
}

function openAircraft(icao) {
  const a = FB.aircraftByIcao[icao];
  if (!a) return;

  const rows = [
    ['型式（ICAO）', a.icao],
    ['メーカー', a.maker],
    ['種別', a.categoryJa],
    ['座席数（代表値）', `約 ${a.seats} 席`],
    ['主に使われる距離帯', haulLabel(a.haul)],
    ['設定されるクラス', classesOf(a.icao)],
    ['エコノミー座席配列', a.abreast || '—'],
    ['航続距離', a.range ? `約 ${a.range.toLocaleString()} km` : '—'],
    ['全長', `${a.length} m`],
    ['翼幅', `${a.span} m`],
    ['エンジン', `${a.engineType} × ${a.engines}`],
    ['初飛行', `${a.firstFlight}年`],
    ['生産状況', a.statusJa],
  ];

  const wiki = `https://en.wikipedia.org/wiki/${encodeURIComponent(a.wiki.replace(/ /g, '_'))}`;

  openSheet(`${a.icao}　${a.maker} ${a.model}`, `
    <dl class="spec">
      ${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
    </dl>
    ${a.note ? `<p class="ac-note">${esc(a.note)}</p>` : ''}
    <div class="links">
      <a class="link-btn" href="${esc(wiki)}" target="_blank" rel="noopener">Wikipedia</a>
    </div>
    ${specialBlock(a.icao)}
    ${operatorsBlock(a.icao)}
    <p class="fineprint">座席数と航続距離は代表値です。座席は航空会社の仕様で大きく変わり、
      航続距離も搭載条件で変わります。座席配列は胴体の太さで決まるのでほぼ動きませんが、
      777のように9列と10列の両方がある機種もあります。</p>
  `);
}


/* ------------------------------------------------------------
 *  特典航空券
 *  各社ともログインが必要で、区間や日付を入れた状態で飛べるリンクは
 *  用意されていません。飛べるのは検索画面の入口までです。
 * ---------------------------------------------------------- */
function awardCard(prog) {
  const al = FB.alliances[prog.alliance];
  const airline = FB.airlineByIata[prog.airline];

  const link = (l) => `<a class="award__link" href="${esc(l.url)}" target="_blank" rel="noopener">
      <span class="award__label">${esc(l.label)}</span>
      ${l.note ? `<span class="award__sub">${esc(l.note)}</span>` : ''}
    </a>`;

  // 使うのはたいてい先頭の1本なので、それだけ出して残りは畳んでおきます。
  // 説明も同じ扱いにすると、一覧が社名を並べただけの高さに収まります。
  const [head, ...rest] = prog.links;
  const folded = (prog.note ? `<p class="award__note">${esc(prog.note)}</p>` : '') +
    (rest.length ? `<div class="award__links">${rest.map(link).join('')}</div>` : '');

  return `<section class="award" style="--al:${esc(al ? al.color : 'var(--accent)')}">
    <header class="award__head">
      <span class="code code--airline">${esc(prog.airline)}</span>
      <span class="award__title">
        <span class="award__name">${esc(prog.name)}</span>
        ${al ? `<span class="award__alliance">${esc(al.name)}</span>` : ''}
      </span>
    </header>
    <div class="award__links">${link(head)}</div>
    ${folded ? `<details class="award__fold">
      <summary class="award__foldhead">${rest.length ? `ほかのリンク ${rest.length}　/　` : ''}このプログラムについて</summary>
      <div class="award__foldbody">${folded}</div>
    </details>` : ''}
    ${airline ? `<button type="button" class="award__more" data-airline="${esc(prog.airline)}">${esc(airline.name)}の詳細を見る</button>` : ''}
  </section>`;
}

/** そのプログラムがどのまとまりに入るか。
 *  日本の会社はアライアンスより先に見たいので、いちばん上に分けます。 */
function awardGroupOf(p) {
  const al = FB.airlineByIata[p.airline];
  if (al && al.country === 'JP') return 'jp';
  return p.alliance || 'none';
}

const AWARD_GROUPS = [
  ['jp', '日本の会社'],
  ['star', 'スターアライアンス'],
  ['oneworld', 'ワンワールド'],
  ['skyteam', 'スカイチーム'],
  ['none', 'アライアンス外'],
];

function renderAwards() {
  $('awardIntro').textContent = FB.awardMeta.warning || '';
  const f = state.awardFilter.alliance;
  const q = (state.awardQuery || '').trim().toLowerCase();

  const list = FB.awardPrograms.filter((p) => {
    if (f && awardGroupOf(p) !== f) return false;
    if (!q) return true;
    // プログラム名・航空会社コード・日本語社名・英語社名のどれでも当たるようにする
    const al = FB.airlineByIata[p.airline];
    const hay = [p.name, p.airline, al && al.name, al && al.nameEn]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });

  $('awardClear').classList.toggle('is-hidden', !state.awardQuery);
  $('awardCount').textContent = list.length
    ? `${list.length} プログラム`
    : '';

  if (!list.length) {
    $('awardList').innerHTML = '<p class="hint">該当するプログラムがありません。</p>';
    return;
  }

  // 絞り込んでいるときは見出しを出しません。1つのまとまりしか残らないので、
  // 見出しがあると同じ言葉が2回出るだけになります。
  if (f || q) {
    $('awardList').innerHTML = list.map(awardCard).join('');
    return;
  }

  $('awardList').innerHTML = AWARD_GROUPS.map(([key, label]) => {
    const rows = list.filter((p) => awardGroupOf(p) === key);
    if (!rows.length) return '';
    return `<p class="prod-group">${label}<span class="prod-group__n">${
      rows.length}</span></p>${rows.map(awardCard).join('')}`;
  }).join('');
}

/* 航空会社の詳細に出す、その社のマイレージプログラムへのリンク */
function awardBlock(iata) {
  const prog = FB.awardByAirline[iata];
  if (!prog) return '';
  return `<div class="routes-block">
    <p class="routes-block__title">特典航空券（${esc(prog.name)}）</p>
    <div class="links">
      ${prog.links.map((l) => `<a class="link-btn" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}
    </div>
  </div>`;
}

/* ------------------------------------------------------------
 *  アライアンス
 * ---------------------------------------------------------- */
function renderAlliances() {
  const order = ['star', 'oneworld', 'skyteam'];
  const html = order.map((key) => {
    const al = FB.alliances[key];
    if (!al) return '';
    const members = FB.membersOf(key);
    const stopped = members.filter((m) => m.suspended).length;
    // 「収録」と書いているのは、アライアンス公式の加盟社数とずれることがあるため。
    // 例：ワンワールドはアラスカとハワイアンを合わせて1加盟社と数えます。
    const count = `収録 ${members.length}社` + (stopped ? `（うち停止中 ${stopped}社）` : '');

    return `<section class="alliance" style="--al:${esc(al.color)}">
      <header class="alliance__head">
        <h2 class="alliance__name">${esc(al.name)}</h2>
        <p class="alliance__meta">${esc(al.nameEn)}　${al.founded}年発足　${esc(count)}</p>
        <p class="alliance__note">${esc(al.note)}</p>
      </header>
      <ul class="member-grid">
        ${members.map((m) => `<li class="member${m.suspended ? ' is-suspended' : ''}" data-airline="${esc(m.iata)}">
          <span class="member__code">${esc(m.iata)}</span>
          <span class="member__name">${esc(m.name)}</span>
          <span class="member__country">${esc(m.countryJa)}</span>
        </li>`).join('')}
      </ul>
      <a class="link-btn link-btn--wide" href="${esc(al.site)}" target="_blank" rel="noopener">公式サイト</a>
    </section>`;
  }).join('');

  const none = FB.airlines.filter((a) => !a.alliance);
  $('allianceWrap').innerHTML = html + `
    <section class="alliance alliance--none">
      <header class="alliance__head">
        <h2 class="alliance__name">どこにも属さない会社</h2>
        <p class="alliance__meta">${none.length}社を収録</p>
        <p class="alliance__note">エミレーツやLCCのように、大手でもアライアンスに入っていない会社があります。個別提携でマイルが貯まることは多いので、加盟していない＝使えない、ではありません。</p>
      </header>
      <button type="button" class="link-btn link-btn--wide" id="gotoNonAlliance">一覧を見る</button>
    </section>`;
}

/* ------------------------------------------------------------
 *  詳細パネル
 * ---------------------------------------------------------- */
function openSheet(title, bodyHtml) {
  $('sheetTitle').textContent = title;
  $('sheetBody').innerHTML = bodyHtml;
  $('sheet').classList.remove('is-hidden');
  $('sheetBackdrop').classList.remove('is-hidden');
  document.body.classList.add('is-locked');
}

function closeSheet() {
  $('sheet').classList.add('is-hidden');
  $('sheetBackdrop').classList.add('is-hidden');
  document.body.classList.remove('is-locked');
}

/* ------------------------------------------------------------
 *  タブの切り替え
 * ---------------------------------------------------------- */
function showTab(tab) {
  state.tab = tab;
  $('viewRoutes').classList.toggle('is-hidden', tab !== 'routes');
  $('viewAirports').classList.toggle('is-hidden', tab !== 'airports');
  $('viewAirlines').classList.toggle('is-hidden', tab !== 'airlines');
  $('viewAircraft').classList.toggle('is-hidden', tab !== 'aircraft');
  $('viewAwards').classList.toggle('is-hidden', tab !== 'awards');
  $('viewAlliances').classList.toggle('is-hidden', tab !== 'alliances');
  [...$('tabs').children].forEach((b) =>
    b.classList.toggle('is-active', b.dataset.tab === tab));
  window.scrollTo(0, 0);
}

/* 絞り込みボタンは「同じ列の中で1つだけ選ぶ」動きにする */
function wireChips(wrapId, onChange) {
  $(wrapId).addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    [...$(wrapId).children].forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    onChange(btn.dataset);
  });
}

/* ------------------------------------------------------------
 *  明暗の切替
 *  既定は「自動」で端末の設定に追従します。見比べたいときのために
 *  ライト・ダークで固定もできるようにしています。
 *
 *  CSS 側はメディアクエリではなく <html data-theme="light|dark"> を見ているので、
 *  「自動」のときは、ここで端末の設定を読んで実際の値に置き換えます。
 * ---------------------------------------------------------- */
const THEMES = [
  { id: 'auto',  label: '自動' },
  { id: 'light', label: 'ライト' },
  { id: 'dark',  label: 'ダーク' },
];

function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(pref) {
  const t = THEMES.find((x) => x.id === pref) || THEMES[0];
  state.themePref = t.id;
  document.documentElement.dataset.theme = resolveTheme(t.id);
  $('themeBtn').textContent = t.label;
  try { localStorage.setItem(`${APP.storageKey}:theme`, t.id); } catch (e) {}
  if (FBMap._ready) FBMap.draw();
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(`${APP.storageKey}:theme`); } catch (e) {}
  applyTheme(saved || 'auto');

  $('themeBtn').addEventListener('click', () => {
    const i = THEMES.findIndex((x) => x.id === state.themePref);
    applyTheme(THEMES[(i + 1) % THEMES.length].id);
  });

  // 「自動」のあいだは、端末の設定が変わったら追従する
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.themePref === 'auto') applyTheme('auto');
  });
}

/* ------------------------------------------------------------
 *  起動
 * ---------------------------------------------------------- */
async function init() {
  initTheme();
  $('appTitle').textContent = APP.title;
  $('appSub').textContent = APP.sub;

  try {
    await FB.load();
  } catch (err) {
    $('loading').classList.add('is-hidden');
    $('loadError').classList.remove('is-hidden');
    $('loadErrorText').textContent =
      `${err.message}\n\nファイルを直接ダブルクリックして開くと、この画面になります。README の「動かし方」を見てください。`;
    return;
  }

  $('loading').classList.add('is-hidden');

  // 最初の表示。ホーム空港が決めてあれば、出発地に入れておく
  const home = FB.airportByIata[APP.homeAirport];
  if (home) {
    state.routeFrom = home.iata;
    $('fromInput').value = airportLabel(home.iata);
    $('fromClear').classList.remove('is-hidden');
    state.airportQuery = home.iata;
    $('airportSearch').value = home.iata;
  }

  renderAirports();
  renderAirlines();
  state.favs = loadFavs();
  renderAircraft();
  renderAwards();
  renderAlliances();
  renderRouteResult();
  showTab('routes');

  // 路線データは他より大きいので、画面を出したあとに裏で読み込む。
  // 読み終わったら、いま開いている画面だけ描き直す。
  FB.loadRoutes().then(() => {
    if (state.tab === 'routes') renderRouteResult();
  });

  // ---- 路線の入力欄 ----
  wirePicker('fromInput', 'fromSuggest', 'fromClear', (iata) => {
    state.routeFrom = iata;
    // 出発地が変わるとエリアの顔ぶれも変わるので、エリアの絞り込みは外す
    state.routeFilter.area = '';
    state.mapNeedsFit = true;
    renderRouteResult();
  });
  wirePicker('toInput', 'toSuggest', 'toClear', (iata) => {
    state.routeTo = iata;
    renderRouteResult();
  });

  // ---- 一覧と地図の切替 ----
  document.querySelector('.viewtoggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.viewtoggle__btn');
    if (!btn) return;
    state.routeView = btn.dataset.rview;
    [...btn.parentNode.children].forEach((b) =>
      b.classList.toggle('is-active', b === btn));
    // 地図に切り替えた直後は、出発地と就航先が全部入るように合わせる
    if (state.routeView === 'map') state.mapNeedsFit = true;
    renderRouteResult();
  });

  // ---- 絞り込みパネルの開閉 ----
  $('filterToggle').addEventListener('click', () => {
    const panel = $('filterPanel');
    const open = panel.classList.toggle('is-hidden');
    $('filterToggle').setAttribute('aria-expanded', String(!open));
  });

  // ---- エリアの絞り込み（中身は動的なので委譲で受ける） ----
  $('areaFilters').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.routeFilter.area = btn.dataset.area || '';
    state.mapNeedsFit = true;
    renderRouteResult();
  });

  // ---- そのほかの絞り込み ----
  wireChips('allianceFilters', (d) => {
    state.routeFilter.alliance = d.alliance || '';
    state.mapNeedsFit = true;
    renderRouteResult();
  });
  wireChips('bandFilters', (d) => {
    state.routeFilter.band = d.band || '';
    state.mapNeedsFit = true;
    renderRouteResult();
  });
  wireChips('carrierFilters', (d) => {
    state.routeFilter.carrier = d.carrier || '';
    state.mapNeedsFit = true;
    renderRouteResult();
  });

  $('mapInfoClose').addEventListener('click', () => {
    FBMap.selected = '';
    FBMap.draw();
    $('mapInfo').classList.add('is-hidden');
  });

  $('mapFit').addEventListener('click', () => {
    state.mapNeedsFit = true;
    renderRouteResult();
  });

  // 画面の向きを変えたときに地図の大きさを合わせ直す
  window.addEventListener('resize', () => {
    if (state.tab === 'routes' && state.routeView === 'map' && FBMap._ready) {
      FBMap.resize();
    }
  });

  $('swapBtn').addEventListener('click', () => {
    const f = state.routeFrom, t = state.routeTo;
    state.routeFrom = t; state.routeTo = f;
    $('fromInput').value = t ? airportLabel(t) : '';
    $('toInput').value = f ? airportLabel(f) : '';
    $('fromClear').classList.toggle('is-hidden', !t);
    $('toClear').classList.toggle('is-hidden', !f);
    renderRouteResult();
  });

  // ---- 検索 ----
  $('airportSearch').addEventListener('input', (e) => {
    state.airportQuery = e.target.value;
    renderAirports();
  });
  $('airportClear').addEventListener('click', () => {
    state.airportQuery = '';
    $('airportSearch').value = '';
    renderAirports();
    $('airportSearch').focus();
  });
  $('airlineSearch').addEventListener('input', (e) => {
    state.airlineQuery = e.target.value;
    renderAirlines();
  });
  $('airlineClear').addEventListener('click', () => {
    state.airlineQuery = '';
    $('airlineSearch').value = '';
    renderAirlines();
    $('airlineSearch').focus();
  });
  $('aircraftSearch').addEventListener('input', (e) => {
    state.aircraftQuery = e.target.value;
    renderAircraft();
  });
  $('aircraftClear').addEventListener('click', () => {
    state.aircraftQuery = '';
    $('aircraftSearch').value = '';
    renderAircraft();
    $('aircraftSearch').focus();
  });

  // ---- 絞り込み ----
  wireChips('airportFilters', (d) => {
    state.airportFilter = { size: d.size || '', country: d.country || '' };
    renderAirports();
  });
  wireChips('airlineFilters', (d) => {
    state.airlineFilter = { alliance: d.alliance || '' };
    renderAirlines();
  });
  // 航空会社の行をタップしたら、その会社の保有機材へ掘り下げる
  $('aircraftList').addEventListener('click', (e) => {
    const li = e.target.closest('[data-fleet]');
    if (!li) return;
    state.aircraftAirline = li.dataset.fleet;
    state.aircraftQuery = '';
    $('aircraftSearch').value = '';
    renderAircraft();
    window.scrollTo(0, 0);
  });

  $('aircraftBack').addEventListener('click', () => {
    state.aircraftAirline = '';
    state.aircraftQuery = '';
    $('aircraftSearch').value = '';
    renderAircraft();
    window.scrollTo(0, 0);
  });
  wireChips('awardFilters', (d) => {
    state.awardFilter = { alliance: d.alliance || '' };
    renderAwards();
  });
  $('awardSearch').addEventListener('input', (e) => {
    state.awardQuery = e.target.value;
    renderAwards();
  });
  $('awardClear').addEventListener('click', () => {
    state.awardQuery = '';
    $('awardSearch').value = '';
    renderAwards();
    $('awardSearch').focus();
  });

  // ---- タブ ----
  $('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tabs__btn');
    if (btn) showTab(btn.dataset.tab);
  });
  $('homeBtn').addEventListener('click', () => showTab('routes'));

  // ---- 一覧のタップ（1か所でまとめて受ける） ----
  document.addEventListener('click', (e) => {
    // 星は行や詳細の中にあるので、いちばん先に拾って他の動作を止める
    const fv = e.target.closest('[data-fav]');
    if (fv) {
      e.stopPropagation();
      toggleFav(fv.dataset.fav);
      const on = isFav(fv.dataset.fav);
      fv.textContent = on ? '★' : '☆';
      fv.classList.toggle('is-on', on);
      fv.setAttribute('aria-pressed', String(on));
      fv.title = on ? 'お気に入りから外す' : 'お気に入りに入れる';
      // お気に入りの一覧を見ている最中なら、外した行をその場で消す
      if (state.tab === 'aircraft' && state.aircraftAirline === '__fav') renderAircraft();
      return;
    }

    // 「ここからの路線を見る」は空港の詳細の中にあるので、先に拾う
    const rf = e.target.closest('[data-route-from]');
    if (rf) {
      closeSheet();
      state.routeFrom = rf.dataset.routeFrom;
      state.routeTo = '';
      $('fromInput').value = airportLabel(state.routeFrom);
      $('fromClear').classList.remove('is-hidden');
      $('toInput').value = '';
      $('toClear').classList.add('is-hidden');
      renderRouteResult();
      showTab('routes');
      return;
    }
    if (e.target.id === 'destToggleAll') {
      const openAll = !e.target.dataset.open;
      state.routeOpen.keys.clear();
      if (openAll) {
        document.querySelectorAll('#routeResult .destgroup')
          .forEach((d) => state.routeOpen.keys.add(d.dataset.group));
      }
      renderRouteResult();
      return;
    }
    const ap = e.target.closest('[data-airport]');
    if (ap) { openAirport(ap.dataset.airport); return; }
    const al = e.target.closest('[data-airline]');
    if (al) { openAirline(al.dataset.airline); return; }
    const ac = e.target.closest('[data-aircraft]');
    if (ac) { openAircraft(ac.dataset.aircraft); return; }
    if (e.target.id === 'gotoNonAlliance') {
      state.airlineFilter = { alliance: 'none' };
      [...$('airlineFilters').children].forEach((b) =>
        b.classList.toggle('is-active', b.dataset.alliance === 'none'));
      renderAirlines();
      showTab('airlines');
    }
  });

  // ---- エリア見出しの開閉を覚えておく ----
  // <details> の toggle は上に伝わらないので、捕捉フェーズでまとめて受けます
  $('routeResult').addEventListener('toggle', (e) => {
    const key = e.target.dataset && e.target.dataset.group;
    if (!key) return;
    if (e.target.open) state.routeOpen.keys.add(key);
    else state.routeOpen.keys.delete(key);

    const btn = $('destToggleAll');
    if (!btn) return;
    const all = [...document.querySelectorAll('#routeResult .destgroup')].every((d) => d.open);
    btn.dataset.open = all ? '1' : '';
    btn.textContent = all ? 'すべて畳む' : 'すべて開く';
  }, true);

  // ---- 詳細パネルを閉じる ----
  $('sheetClose').addEventListener('click', closeSheet);
  $('sheetBackdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });
}

document.addEventListener('DOMContentLoaded', init);
