/* ============================================================
 *  Claude に空席を探してもらう（2026-11-24）
 *
 *  Mile Board は ANA のサーバーに一度もつなぎません。それは変えません。
 *  ここでするのは2つだけです。
 *
 *    1. 頼む文を作る
 *       判定で「組めます」になった旅程から、Claude（Chrome の拡張機能）に
 *       ANA のサイトで空席を調べてもらうための文を組み立てます。
 *       ANA のサイトを動かすのは Claude で、Mile Board ではありません。
 *    2. 返事を取り込む
 *       Claude の返事の最後にある「Mile Board 用の記録」を読んで、空席メモに写します。
 *
 *  ★文の中の「調べかた」は、2026-11-24 に本物の ANA の画面で試して分かったことです。
 *    ・ブラウザの「戻る」を押すと「処理しています」のまま止まる
 *    ・片道の「前後3日の空席を比較」は、どのクラスでも1席あれば「空席あり」と出る
 *      （ビジネスを探すときに当てにならない）
 *    ・「複数都市・クラス混在」の結果は1区間目しか出ないが、クラスが列で並ぶ
 *    ・候補の「バンコク(全て)」は2番目。いちばん上を選ぶと DMK が抜ける
 *    画面が変わったら、ここを直します。
 *
 *  ★予約のきまり（乗り継ぎの回数・ゾーン・1社しばり）は、文を作る前に Mile Board が見ます。
 *    Claude にはきまりの判断をさせません。AI はきまりを取り違えることがあるためです。
 *    ただし「1社しばりの会社の空き」は Claude が見つけてしまうので、
 *    取り込むときに Mile Board の側で外します（その会社だけで組む旅程なら残します）。
 *
 *  ★この文は Mile Board が自分で書いたものです。
 *    お得トラベルさんの動画の概要欄にある指示文は「再配布はご遠慮ください」なので、
 *    写していません。考え方（空港を全部見る・日を省かない・滞在を時間で書く）だけ借りています。
 * ============================================================ */

/* ANA の特典航空券の検索の入り口（複数都市もここから選びます） */
const AI_ANA_URL = 'https://aswbe-i.ana.co.jp/international_asw/pages/award/search/roundtrip/' +
                   'award_search_roundtrip_input.xhtml?CONNECTION_KIND=JPN&LANG=ja';

/* 提携航空会社特典で使うクラス。プレミアムエコノミーは使えません（公式）。 */
const AI_CLASSES = [
  { key: 'Y', label: 'エコノミー' },
  { key: 'C', label: 'ビジネス' },
  { key: 'F', label: 'ファースト' },
];

/* 目的地でどれくらいとまりたいか。rule は頼む文に書く言い方です。 */
const AI_STAYS = [
  { key: '',   label: '長さは決めない',       rule: '滞在の長さは自由' },
  { key: '24', label: '24時間を超えてとまる', rule: '到着から次の出発まで24時間を超える' },
  { key: '48', label: '48時間以上とまる',     rule: '到着から次の出発まで48時間以上' },
  { key: '72', label: '72時間以上とまる',     rule: '到着から次の出発まで72時間以上' },
];

/* 1回に頼む量の目安。本物の通しで 15マス 14分・5時間枠の11%だった。 */
const AI_SOFT_CELLS = 40;
const AI_MAX_DAYS = 31;

/* 取り込んだ記録の書き出しの印 */
const AI_BLOCK_START = '#MILEBOARD v1';
const AI_BLOCK_END = '#END';

/* ------------------------------------------------------------
 *  日付の小道具（日付は 'YYYY-MM-DD' の文字で持ちます）
 * ---------------------------------------------------------- */
function aiAddDays(d, n) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function aiDates(start, end) {
  const out = [];
  for (let d = start; d <= end && out.length < AI_MAX_DAYS; d = aiAddDays(d, 1)) out.push(d);
  return out;
}
function aiShort(d) {
  const [, m, day] = d.split('-').map(Number);
  return `${m}/${day}`;
}
function aiWeek(d) {
  return WEEK_JA[new Date(d + 'T00:00:00Z').getUTCDay()];
}

/* 予約を受け付けてもらえる日の範囲（区間ごと）。
   公式：搭乗日の355日前の午前9時（日本時間）から、出発の96時間前まで。
   ・いちばん先の日 … 今から355日後の日（UTC の日付で数えるとちょうど合います。
     X日 0時(日本) − 355日 + 9時間 ＝ X日 0時(UTC) − 355日 なので）
   ・いちばん手前の日 … 96時間後の日本の日付の、次の日（控えめに見ています） */
function aiBookableRange(nowMs) {
  const now = nowMs || Date.now();
  const last = new Date(now + BOOKING.openDaysBefore * DAY_MS).toISOString().slice(0, 10);
  const soon = new Date(now + BOOKING.closeHoursBefore * 3600000 + 9 * 3600000)
    .toISOString().slice(0, 10);
  return { first: aiAddDays(soon, 1), last };
}

/* ------------------------------------------------------------
 *  頼む中身をまとめる
 * ---------------------------------------------------------- */
function aiDefaults() {
  return { start: '', end: '', cls: 'C', stay: '24' };
}

function aiPlan(r) {
  const a = Object.assign(aiDefaults(), trip.ai || {});
  const segs = (r && r.ready && r.ok && r.segments ? r.segments : [])
    .filter((s) => !s.gap)
    .map((s, i) => ({ ...s, no: i + 1 }));
  /* オープンジョーの「自分で移動する」ところ */
  const gap = (r && r.segments || []).find((s) => s.gap) || null;

  const start = a.start || trip.date || '';
  const end = a.end || (trip.mode !== 'oneway' && trip.dateBack) || (start ? aiAddDays(start, 4) : '');
  const ok = !!(start && end && start <= end);
  const all = ok ? aiDates(start, end) : [];
  const range = aiBookableRange();
  const dates = all.filter((d) => d >= range.first && d <= range.last);
  const notOpen = all.filter((d) => d > range.last);
  const tooSoon = all.filter((d) => d < range.first);
  const tooLong = ok && aiAddDays(start, AI_MAX_DAYS - 1) < end;

  return {
    segs, gap, start, end, ok, all, dates, notOpen, tooSoon, tooLong, range,
    cls: a.cls, stay: a.stay,
    carrier: trip.carrier || '',
    cells: segs.length * dates.length,
  };
}

/* 都市の書き方：名古屋（NGO） / バンコク（BKK・DMK） */
function aiCityText(name) {
  const c = cityInfo(name);
  return c && c.iata.length ? `${name}（${c.iata.join('・')}）` : name;
}

/* 区間の終わりでどうするか */
function aiStayText(s, plan) {
  if (s.stay === '24時間以内') return '着いたら24時間以内に次の区間へ（乗り継ぎ）';
  if (s.stay === '24時間以上') return '24時間を超えて滞在する（途中降機）';
  if (s.stay === '目的地') {
    if (trip.mode === 'oneway') return '目的地（ここで終わり）';
    const st = AI_STAYS.find((x) => x.key === plan.stay) || AI_STAYS[0];
    return `目的地。${st.rule}`;
  }
  return '';
}

function aiCarrierText(plan) {
  if (plan.carrier) {
    return `${airlineName(plan.carrier)}（${plan.carrier}）が運航する便だけで組む。` +
           'ANA のきまりで、この会社はほかの会社と混ぜられない。';
  }
  const solo = [...MB.partnerOnly].sort().map((c) => `${airlineName(c)}（${c}）`).join('、');
  return '限定しない（ANA便・スターアライアンス便）。ただし次の会社が運航する便は、' +
         `ほかの会社と混ぜられないので旅程の案には使わない：${solo}。` +
         '記録には、ほかの便と同じように書いてよい。';
}

/* ------------------------------------------------------------
 *  頼む文
 * ---------------------------------------------------------- */
function aiPromptText(plan) {
  const cls = AI_CLASSES.find((c) => c.key === plan.cls) || AI_CLASSES[0];
  const L = [];
  L.push('ANA 特典航空券の空席しらべ（Mile Board で作った頼み文）');
  L.push('');
  L.push('■ してほしいこと');
  L.push('ANA のウェブサイトで、下の区間ごと・日付ごとに、特典航空券の空席を調べてください。');
  L.push('調べ終わったら、空席のある便だけで組める旅程の案を出し、最後に「Mile Board 用の記録」を書いてください。');
  L.push('予約・発券・支払いには進まないでください。');
  L.push('');
  L.push('■ 守ること');
  L.push('- ANA のサイトは、利用者がログインしてある Chrome で使う。パスワードや会員番号を求められたら、入れずに止まって、利用者に入れてもらう');
  L.push('- タブは1つだけ。検索は1回ずつ順番に。同じ検索をくり返さない');
  L.push('- 「次へ」「予約」「確認」の類は押さない。時間切れの「延長」は押してよい');
  L.push('- ブラウザの「戻る」は使わない（ANA の画面が「処理しています」のまま止まる）。条件を変えるときは、検索結果の画面の下にある「再検索」を使う');
  L.push('- 画面写真より、ページの文字を読むほうが速くて確か。画面写真は入力したものを確かめるときだけにする');
  L.push('- ボタンは場所ではなく文字（「再検索」「検索する」）で探して押す。途中で画面の高さが変わり、場所で押すと外れることがある');
  L.push('');
  L.push('■ 旅程（予約のきまりは Mile Board で確かめてあるので、判断しなくてよい）');
  L.push(`形：${MODES[trip.mode].label}`);
  plan.segs.forEach((s) => {
    const stay = aiStayText(s, plan);
    L.push(`区間${s.no}：${aiCityText(s.from)} → ${aiCityText(s.to)}` + (stay ? `　${stay}` : ''));
  });
  if (plan.gap) {
    L.push(`※${plan.gap.from} から ${plan.gap.to} までは自分で移動する（特典に含まれない）。この間の日数は自由`);
  }
  L.push(`期間：${plan.start} 〜 ${plan.end}（全区間をこの中で）`);
  L.push(`クラス：${cls.label}（旅程の案はこのクラスで組む。表に出ているほかのクラスも記録する）`);
  L.push(`航空会社：${aiCarrierText(plan)}`);
  L.push('乗り継ぎの余裕：同じ空港なら2時間、空港が変わるなら（羽田→成田など）4時間はあける');
  L.push('');
  L.push('■ 調べかた（ANA の画面に合わせた手順）');
  L.push(`1. ここを開く：${AI_ANA_URL}`);
  L.push('2. 「複数都市・クラス混在」を選ぶ。片道・往復の「前後3日の空席を比較」は使わない（どのクラスでも1席あれば「空席あり」と出るため）');
  L.push('3. 1行目に調べる区間と日付、2行目に形だけの区間（下の表のとおり）を入れて検索する。結果には1行目の区間だけが、エコノミー／プレミアムエコノミー／ビジネス／ファーストの列で出る');
  L.push('4. 都市は名前で入れ、候補に「〇〇(全て)」があれば必ずそれを選ぶ（いちばん上に出るとは限らない。バンコクなら2番目）。「(全て)」が無ければ空港ごとに分けて調べる。名前で候補が出なければ、上の旅程のカッコ内の空港コードで入れる。候補は下矢印キーと Enter で選べる（バンコク(全て)なら下矢印2回）');
  L.push('   日付は欄を押すとカレンダーが出る。「次の3ヶ月」で目当ての月まで送ってから日を押す');
  L.push('5. 次の日付は、結果の画面の「再検索」で1行目の日付だけ変えて検索する');
  L.push('6. 直行便（乗継0回）の行だけを記録する。乗り継ぎのある行は記録しない（空席のあるものは、最後に「ほかの行き方」として一言書いてよい）');
  L.push('7. 列ごとに「空席あり」「空席待ち」「空欄」を読む。期間の日はすべて調べる。途中で省かない');
  L.push('');
  L.push(`調べる組み合わせ（${plan.segs.length}区間 × ${plan.dates.length}日 ＝ ${plan.cells}回）：`);
  plan.segs.forEach((s) => {
    L.push(`- 区間${s.no}：1行目 ${s.from} → ${s.to}／2行目（形だけ）${s.to} → ${s.from}、日付 ${plan.end}`);
  });
  L.push(`- 日付：${plan.dates.join('、')}`);
  if (plan.notOpen.length) {
    L.push(`- ${plan.notOpen[0]} 以降は予約がまだ始まっていないので調べない（記録には「未開放」と書く）`);
  }
  if (plan.tooSoon.length) {
    L.push(`- ${plan.tooSoon[plan.tooSoon.length - 1]} までは出発が近すぎて予約できないので調べない（記録には「未開放」と書く）`);
  }
  L.push('');
  L.push('■ 返事の形');
  L.push(`1. 旅程の案を3つまで（A・B・C）。${cls.label}が「空席あり」の直行便だけを使い、上の滞在と乗り継ぎの余裕を守る。` +
         '日付・便名・空港・出発到着時刻・それぞれの街での滞在時間と、勧める理由を1〜2文で。');
  L.push('   組めないときは、どの区間のどの日がネックかを書き、近い代わり（ほかのクラス、乗り継ぎのある便、混ぜられない会社の便）があれば添える');
  L.push(`2. 最後に「Mile Board 用の記録」を、${AI_BLOCK_START} から ${AI_BLOCK_END} まで、形を変えずに書く（コードブロックに入れてよい）`);
  L.push('');
  L.push('Mile Board 用の記録の書き方：');
  L.push('- はじめの数行は下のとおり写し、「調べた時刻」だけ書き入れる（最初に検索した時刻）');
  L.push('- 区間・日付ごとに、表に出た直行便を1便1行で書く（空席がひとつも無い便も、表に出ていれば書く）。便は、運休の日や特典の席が無い日には表に出ないことがある。出なかった便は書かなくてよい：');
  L.push('  区間番号|日付|便名|運航会社のコード|出発時刻|到着時刻|出発空港|到着空港|Y=あり|C=なし|F=なし');
  L.push('  空席は「あり」「待ち」「なし」の3つで書く。プレミアムエコノミーは書かない');
  L.push('  運航会社のコードは便名の頭2文字でよい。ただし行の区分が「提携航空会社便」なのに便名が ANA やスターアライアンスの会社のものなら、開閉ボタンを開いて運航会社を確かめ、そのコードを書く');
  L.push('- 直行便が1つも出なかった日：区間番号|日付|直行便なし');
  L.push('- 調べられなかった日：区間番号|日付|未確認（「なし」と書かない）');
  L.push('- 予約が始まっていない日：区間番号|日付|未開放');
  L.push('');
  L.push(AI_BLOCK_START);
  L.push('調べた時刻|（ここに YYYY-MM-DD HH:MM）');
  L.push(`クラス|${cls.key}`);
  L.push(`航空会社|${plan.carrier || '指定なし'}`);
  plan.segs.forEach((s) => L.push(`区間|${s.no}|${s.from}|${s.to}`));
  L.push('（ここに区間・日付ごとの行）');
  L.push(AI_BLOCK_END);
  return L.join('\n');
}

/* ------------------------------------------------------------
 *  返事を読む
 *  Claude が多少くずして書いても読めるようにします
 *  （コードブロック・全角の縦棒・2027/3/1 の形・○△× など）。
 * ---------------------------------------------------------- */
function aiNormDate(s) {
  const m = String(s || '').trim().match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?$/);
  if (!m) return '';
  const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return isNaN(new Date(d + 'T00:00:00Z')) ? '' : d;
}

function aiNormMark(s) {
  const v = String(s || '').replace(/\s/g, '');
  if (/^(あり|空席あり|有|○|◎|o|ok)$/i.test(v)) return 'o';
  if (/^(待ち|空席待ち|まち|△|wl|waitlist)$/i.test(v)) return 't';
  if (/^(なし|無し|空欄|×|−|-|ー|x|設定なし|none)$/i.test(v)) return 'x';
  return '';
}

function parseAiReport(text) {
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[｜¦]/g, '|').replace(/^[\s>*`]+|[\s`]+$/g, '').replace(/^-\s+/, ''));
  const i0 = lines.findIndex((l) => /^#\s*MILEBOARD/i.test(l));
  if (i0 < 0) return { error: 'noblock' };
  let i1 = lines.findIndex((l, k) => k > i0 && /^#\s*END\b/i.test(l));
  if (i1 < 0) i1 = lines.length;

  const rep = { at: 0, cls: '', carrier: null, segs: {}, rows: [], skipped: [] };
  for (const raw of lines.slice(i0 + 1, i1)) {
    if (!raw || /^（.*）$/.test(raw)) continue;
    const p = raw.split('|').map((x) => x.trim());
    if (p.length < 2) { rep.skipped.push(raw); continue; }

    if (p[0] === '調べた時刻') {
      const m = p[1].match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T]+(\d{1,2}):(\d{2})/);
      if (m) {
        const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}:00+09:00`;
        const t = Date.parse(iso);
        if (!isNaN(t)) rep.at = Math.floor(t / 1000);
      }
      continue;
    }
    if (p[0] === 'クラス') { rep.cls = p[1].toUpperCase(); continue; }
    if (p[0] === '航空会社') { rep.carrier = /^[A-Z0-9]{2}$/.test(p[1]) ? p[1] : ''; continue; }
    if (p[0] === '区間') {
      if (/^\d+$/.test(p[1]) && p[2] && p[3]) rep.segs[Number(p[1])] = { from: p[2], to: p[3] };
      else rep.skipped.push(raw);
      continue;
    }

    const no = /^\d+$/.test(p[0]) ? Number(p[0]) : 0;
    const date = aiNormDate(p[1]);
    if (!no || !date) { rep.skipped.push(raw); continue; }

    const what = p[2] || '';
    if (/直行便なし|便なし/.test(what)) { rep.rows.push({ no, date, kind: 'none' }); continue; }
    if (/未確認/.test(what)) { rep.rows.push({ no, date, kind: 'unknown' }); continue; }
    if (/未開放/.test(what)) { rep.rows.push({ no, date, kind: 'closed' }); continue; }

    const flight = what.replace(/\s/g, '').toUpperCase();
    const carrier = /^[A-Z0-9]{2}$/.test((p[3] || '').toUpperCase())
      ? p[3].toUpperCase() : flight.slice(0, 2);
    const marks = {};
    for (const part of p.slice(3)) {
      const m = part.match(/^(Y|C|F|PY)\s*[=＝:：]\s*(.+)$/i);
      if (!m) continue;
      const k = m[1].toUpperCase();
      const v = aiNormMark(m[2]);
      if (k !== 'PY' && v) marks[k] = v;
    }
    if (!Object.keys(marks).length) { rep.skipped.push(raw); continue; }
    rep.rows.push({
      no, date, kind: 'flight', flight, carrier, marks,
      dep: p[4] || '', arr: p[5] || '', depAp: p[6] || '', arrAp: p[7] || '',
    });
  }
  return rep;
}

/* ------------------------------------------------------------
 *  空席メモに写す
 *
 *  1日・1区間・1クラスごとに、いちばん良い印を1つ決めます。
 *    使える便のどれかが「あり」 → ○
 *    「あり」は無いが「待ち」がある → △
 *    便はあるが空いていない、または直行便が無い → −
 *    未確認・未開放 → 書かない（前の記録を消さない）
 *  ★使える便＝その旅程に入れられる会社の便です。
 *    1社しばりの会社（ベトナム航空など）の空きは、その会社だけで組むときにしか数えません。
 * ---------------------------------------------------------- */
const AI_RANK = { o: 3, t: 2, x: 1 };

function seatPut(award, from, to, date, cls, mark, at) {
  const [y, m, d] = date.split('-');
  const month = `${y}-${m}`;
  const key = seatNoteKey(award, from, to, month);
  let n = SEAT_DATA.notes[key];
  if (!n) n = SEAT_DATA.notes[key] = { award, from, to, month, cells: {}, updated: at };
  n.cells[`${Number(d)}:${cls}`] = [mark, at];
  n.updated = Math.max(n.updated || 0, at);
}

function importAiReport(rep, planSegs, fallbackCarrier) {
  const now = nowSec();
  const at = rep.at && rep.at <= now + 600 ? rep.at : now;
  const carrier = rep.carrier === null ? (fallbackCarrier || '') : rep.carrier;
  const usable = (code) => (carrier ? code === carrier : !MB.partnerOnly.has(code));

  /* 区間番号 → 都市。記録の「区間」行を先に見て、Mile Board の都市名でなければ今の旅程から引きます */
  const segOf = (no) => {
    const s = rep.segs[no];
    if (s && cityInfo(s.from) && cityInfo(s.to)) return s;
    const t = planSegs.find((x) => x.no === no);
    return t ? { from: t.from, to: t.to } : null;
  };

  const groups = new Map();
  const res = { cells: 0, counts: { o: 0, t: 0, x: 0 }, unknown: 0, closed: 0,
                badSeg: 0, excluded: [], skipped: rep.skipped.length, days: new Set(), routes: new Set() };

  for (const row of rep.rows) {
    const seg = segOf(row.no);
    if (!seg) { res.badSeg++; continue; }
    const k = `${row.no}|${row.date}`;
    if (!groups.has(k)) groups.set(k, { seg, no: row.no, date: row.date, rows: [] });
    groups.get(k).rows.push(row);
  }

  for (const g of groups.values()) {
    const flights = g.rows.filter((r) => r.kind === 'flight');
    const none = g.rows.some((r) => r.kind === 'none');
    if (!flights.length && !none) {
      if (g.rows.some((r) => r.kind === 'closed')) res.closed++;
      else res.unknown++;
      continue;
    }
    /* 書くクラス：直行便なしなら3つとも、便があるなら記録に出てきたクラスだけ */
    const classes = none && !flights.length
      ? AI_CLASSES.map((c) => c.key)
      : [...new Set(flights.flatMap((f) => Object.keys(f.marks)))];
    for (const cls of classes) {
      let best = 'x';
      for (const f of flights) {
        if (!usable(f.carrier)) continue;
        const m = f.marks[cls];
        if (m && AI_RANK[m] > AI_RANK[best]) best = m;
      }
      if (best !== 'o') {
        const other = flights.find((f) => !usable(f.carrier) && f.marks[cls] === 'o');
        if (other) res.excluded.push({ no: g.no, date: g.date, cls, carrier: other.carrier, seg: g.seg });
      }
      seatPut('partner', g.seg.from, g.seg.to, g.date, cls, best, at);
      res.cells++;
      if (cls === (rep.cls || '')) res.counts[best]++;
    }
    res.days.add(g.date);
    res.routes.add(`${g.seg.from}→${g.seg.to}`);
  }
  if (res.cells) seatsSave();
  res.cls = rep.cls;
  res.at = at;
  return res;
}

/* 取り込んだ結果を、ひとことで */
function aiResultText(res) {
  if (!res.cells && !res.unknown && !res.closed) {
    return '取り込める行がありませんでした。返事の最後の記録（#MILEBOARD から #END まで）が入っているか見てください。';
  }
  const clsName = (AI_CLASSES.find((c) => c.key === res.cls) || {}).label;
  const parts = [`${res.routes.size}区間・${res.days.size}日ぶんを空席メモに入れました。`];
  if (clsName) {
    parts.push(`${clsName}は ○${res.counts.o}・△${res.counts.t}・−${res.counts.x}。`);
  }
  if (res.unknown) parts.push(`未確認 ${res.unknown}（前の記録はそのままです）。`);
  if (res.closed) parts.push(`未開放 ${res.closed}。`);
  if (res.badSeg) parts.push(`区間の分からない行 ${res.badSeg}。`);
  if (res.skipped) parts.push(`読めなかった行 ${res.skipped}。`);
  if (res.excluded.length) {
    const ex = res.excluded.slice(0, 3).map((e) =>
      `${aiShort(e.date)} ${e.seg.from}→${e.seg.to}（${airlineName(e.carrier)}）`).join('、');
    parts.push(`<br><b>混ぜられない会社だけが空いていた日</b>は、この旅程では使えないので数えていません：${ex}` +
               (res.excluded.length > 3 ? ` ほか${res.excluded.length - 3}件` : '') +
               '。その会社だけで組むなら、上の「航空会社」で選んでください。');
  }
  return parts.join('');
}

/* ------------------------------------------------------------
 *  画面
 * ---------------------------------------------------------- */
function renderAiCard(r) {
  const card = $('aiCard');
  const ok = r && r.ready && r.ok && r.segments && r.segments.some((s) => !s.gap);
  card.hidden = !ok;
  if (!ok) return;

  const plan = aiPlan(r);

  // 入力欄（はじめの1回だけ選択肢を作ります）
  const cs = $('aiCls');
  if (!cs.options.length) AI_CLASSES.forEach((c) => cs.appendChild(new Option(c.label, c.key)));
  cs.value = plan.cls;
  const ss = $('aiStay');
  if (!ss.options.length) AI_STAYS.forEach((s) => ss.appendChild(new Option(s.label, s.key)));
  ss.value = plan.stay;
  $('aiStart').value = plan.start;
  $('aiEnd').value = plan.end;
  $('aiStayLine').hidden = !plan.segs.some((s) => s.stay === '目的地') || trip.mode === 'oneway';

  // どれくらいの量か
  const size = $('aiSize');
  if (!plan.ok) {
    size.textContent = '探す期間を入れてください。行きと帰りの搭乗日を入れてあれば、それが入ります。';
  } else {
    /* 2026-11-24 の本物の通し：15回で14分、Max の5時間枠の 11%（頼む文だけを渡した Claude） */
    const min = Math.max(5, Math.round(plan.cells * 0.75 + 3));
    const use = Math.max(1, Math.round(plan.cells * 0.7));
    size.textContent = `${plan.segs.length}区間 × ${plan.dates.length}日 ＝ ${plan.cells}回の検索です。` +
                       `だいたい${min}分、Claude の使用量は Max の5時間枠の${use}%ほどです` +
                       '（2026年11月の通しでは15回で14分・11%）。';
  }

  const warn = $('aiWarn');
  warn.innerHTML = '';
  if (plan.ok && plan.tooLong) warn.appendChild(li(`期間は${AI_MAX_DAYS}日までにしてください。それより先は入れていません。`, 'note'));
  if (plan.notOpen.length) {
    warn.appendChild(li(`${plan.notOpen[0]} 以降（${plan.notOpen.length}日）は、まだ予約が始まっていないので調べません。` +
                        `区間ごとの予約は、その日の355日前の午前9時から始まります。`, 'note'));
  }
  if (plan.tooSoon.length) {
    warn.appendChild(li(`${plan.tooSoon[plan.tooSoon.length - 1]} までは出発の96時間前を切っているので調べません。`, 'note'));
  }
  if (plan.cells > AI_SOFT_CELLS) {
    warn.appendChild(li(`${plan.cells}回は多めです。区間か日数をしぼると早く終わり、ANA への負担も小さくなります。`, 'note'));
  }
  if (plan.ok && !plan.dates.length) warn.appendChild(li('調べられる日がありません。期間を見直してください。', 'ng'));

  $('aiCopy').disabled = !plan.ok || !plan.dates.length;
  if (!$('aiPre').hidden) $('aiPre').textContent = plan.ok ? aiPromptText(plan) : '';

  renderAiGrid(plan);
}

/* 区間 × 日付の空席の一覧。空席メモにあるものをそのまま並べます。 */
function renderAiGrid(plan) {
  const box = $('aiGrid');
  if (!plan.ok || !plan.segs.length || !plan.all.length) { box.innerHTML = ''; return; }
  const cls = plan.cls;
  let any = false, newest = 0;
  const rows = plan.segs.map((s) => {
    const cells = plan.all.map((d) => {
      if (plan.notOpen.includes(d) || plan.tooSoon.includes(d)) {
        return '<td class="ai-c ai-closed" title="予約できない日">未</td>';
      }
      const hit = seatLookup(s.from, s.to, d, 'partner');
      const m = hit && hit.marks[cls];
      if (!m) return '<td class="ai-c m-none">·</td>';
      any = true;
      newest = Math.max(newest, hit.at || 0);
      const age = seatAge(hit.at);
      return `<td class="ai-c m-${m}${age ? ' age-' + age.tier : ''}" title="${SEAT_MARKS[m].name}` +
             `${age ? '（' + age.text + '）' : ''}">${SEAT_MARKS[m].sign}</td>`;
    }).join('');
    return `<tr><th class="ai-seg" scope="row"><span class="ai-no">${s.no}</span>${s.from}→<span class="ai-to">${s.to}</span></th>${cells}</tr>`;
  }).join('');
  if (!any) { box.innerHTML = ''; return; }

  const head = plan.all.map((d) => {
    const w = new Date(d + 'T00:00:00Z').getUTCDay();
    return `<th class="ai-d w${w}" scope="col">${aiShort(d)}<span>${aiWeek(d)}</span></th>`;
  }).join('');
  const clsName = (AI_CLASSES.find((c) => c.key === cls) || {}).label;
  const age = seatAge(newest);
  box.innerHTML =
    `<p class="ai-grid-title">空席メモにある${clsName}の空き</p>` +
    `<div class="ai-grid-wrap"><table class="ai-grid"><thead><tr><th></th>${head}</tr></thead>` +
    `<tbody>${rows}</tbody></table></div>` +
    `<p class="hint">○空席あり　△空席待ち（提携の特典では待てません）　−空きなし　·まだ調べていない　未＝予約できない日` +
    (age ? `<br>いちばん新しい記録は ${age.text}です。特典の空席は数時間で変わります。` : '') + '</p>';
}

/* 入力とボタン。app.js の起動のところから1回だけ呼びます。 */
function setupAiCard() {
  const setAi = (patch) => {
    trip.ai = Object.assign(aiDefaults(), trip.ai || {}, patch);
    refresh();
  };
  $('aiStart').addEventListener('change', () => {
    const v = $('aiStart').value;
    const patch = { start: v };
    /* 終わりより後ろにしたら、終わりを始まりの4日後にします */
    const end = $('aiEnd').value;
    if (v && end && end < v) patch.end = aiAddDays(v, 4);
    setAi(patch);
  });
  $('aiEnd').addEventListener('change', () => setAi({ end: $('aiEnd').value }));
  $('aiCls').addEventListener('change', () => setAi({ cls: $('aiCls').value }));
  $('aiStay').addEventListener('change', () => setAi({ stay: $('aiStay').value }));

  $('aiCopy').addEventListener('click', async () => {
    const plan = aiPlan(judge(trip));
    if (!plan.ok || !plan.dates.length) return;
    const text = aiPromptText(plan);
    try {
      await navigator.clipboard.writeText(text);
      flash($('aiCopy'), 'コピーしました');
    } catch (e) {
      // コピーが許されない画面では、中身を出して選んでもらいます
      $('aiPre').hidden = false;
      $('aiPre').textContent = text;
      $('aiShow').textContent = '中身をしまう';
      flash($('aiCopy'), '下の文を選んでコピーしてください');
    }
  });

  $('aiShow').addEventListener('click', () => {
    const pre = $('aiPre');
    pre.hidden = !pre.hidden;
    $('aiShow').textContent = pre.hidden ? '中身を見る' : '中身をしまう';
    if (!pre.hidden) {
      const plan = aiPlan(judge(trip));
      pre.textContent = plan.ok ? aiPromptText(plan) : '';
    }
  });

  $('aiImport').addEventListener('click', () => {
    const out = $('aiResult');
    const rep = parseAiReport($('aiPaste').value);
    if (rep.error === 'noblock') {
      out.innerHTML = '<b>Mile Board 用の記録が見つかりません。</b>' +
        `Claude の返事の最後にある「${AI_BLOCK_START}」から「${AI_BLOCK_END}」までが入るように、返事をまるごと貼ってください。`;
      return;
    }
    const plan = aiPlan(judge(trip));
    const res = importAiReport(rep, plan.segs, trip.carrier);
    if (res.cls && AI_CLASSES.some((c) => c.key === res.cls) && res.cls !== plan.cls) {
      trip.ai = Object.assign(aiDefaults(), trip.ai || {}, { cls: res.cls });
    }
    out.innerHTML = aiResultText(res);
    if (res.cells) {
      $('aiPaste').value = '';
      refresh();
    }
  });
}
