/* ============================================================
 *  データの読み込みと、共通の計算
 *  画面の組み立ては app.js が担当します。
 * ============================================================ */

const DB = {
  countries: [],      // 国の配列
  byCode: {},         // 国コード → 国
  regions: [],        // 地域の並び順
  climate: {},        // "TH:0" → 月別の平年値
  seasons: {},        // "TH:0" → 天気の判定と気温の印
  prices: {},         // "TH" → 物価
  safety: {},         // "TH" → 危険情報
  guide: {},          // "TH" → 行事と規則
  season: {},         // "TH" → 一般に勧められる時期（人の言っていることのまとめ）
  meta: {},           // 各データの出典と版
};

/* ------------------------------------------------------------
 *  読み込み
 * ---------------------------------------------------------- */
async function loadAll() {
  const get = async (path) => {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${path} が読めません（${res.status}）`);
    return res.json();
  };

  const [countries, climate, seasons, prices, safety, guide, fares] = await Promise.all([
    get(DATA_FILES.countries), get(DATA_FILES.climate), get(DATA_FILES.seasons),
    get(DATA_FILES.prices), get(DATA_FILES.safety), get(DATA_FILES.guide),
    get(DATA_FILES.fares),
  ]);

  DB.countries = countries.countries;
  DB.regions = countries.regions;
  DB.countries.forEach((c) => { DB.byCode[c.code] = c; });

  DB.climate = climate.cities;
  DB.seasons = seasons.seasons;
  DB.prices = prices.prices;
  DB.safety = safety.safety;
  DB.guide = guide.guide;
  DB.season = guide.season || {};
  // 航空券の高い時期・安い時期。値段そのものではなく上がり下がりの傾向です
  DB.fares = fares.fares;
  DB.fareMeta = fares.meta;

  DB.meta = {
    countries: countries.meta, climate: climate.meta, seasons: seasons.meta,
    prices: prices.meta, safety: safety.meta, guide: guide.meta,
    fares: fares.meta,
  };
}

/* ------------------------------------------------------------
 *  時差
 *
 *  時差の表は持ちません。端末の中にある IANA のデータを
 *  Intl 経由で引いて、そのつど計算します。こうすると
 *  サマータイムの切り替えも、制度が変わったときも、
 *  こちらが何もしなくても正しくなります。
 * ---------------------------------------------------------- */

/** そのタイムゾーンの、その瞬間の UTC からのずれ（分） */
function tzOffsetMinutes(tz, when) {
  const at = when || new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);

  const p = {};
  parts.forEach((x) => { p[x.type] = x.value; });
  // hour12:false でも真夜中が "24" になる環境があるので丸めます
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day,
                         (+p.hour) % 24, +p.minute, +p.second);
  return Math.round((asUTC - at.getTime()) / 60000);
}

/** 日本との時差（時間、小数あり）。＋なら日本より進んでいます。 */
function hoursFromJapan(tz, when) {
  const at = when || new Date();
  return (tzOffsetMinutes(tz, at) - tzOffsetMinutes(APP.homeTz, at)) / 60;
}

/** 「−7時間」「＋30分」のような表示にする */
function formatDiff(h) {
  if (Math.abs(h) < 0.01) return '時差なし';
  const sign = h > 0 ? '＋' : '−';
  const abs = Math.abs(h);
  const hh = Math.floor(abs);
  const mm = Math.round((abs - hh) * 60);
  if (hh && mm) return `${sign}${hh}時間${mm}分`;
  if (hh) return `${sign}${hh}時間`;
  return `${sign}${mm}分`;
}

/** その国の現在時刻。「8月15日（金）4:07」の形。 */
function localTime(tz, when) {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: tz, month: 'numeric', day: 'numeric', weekday: 'short',
    hour: 'numeric', minute: '2-digit', hour12: false,
  }).format(when || new Date());
}

/** 今が日本の何日とずれているか（−1＝前の日、＋1＝次の日） */
function dayShift(tz, when) {
  const at = when || new Date();
  const d = (tz) => new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
  const a = new Date(d(tz) + 'T00:00:00Z').getTime();
  const b = new Date(d(APP.homeTz) + 'T00:00:00Z').getTime();
  return Math.round((a - b) / 86400000);
}

/* ------------------------------------------------------------
 *  国ごとの取り出し
 * ---------------------------------------------------------- */

/** 国の代表都市（cities[0]）のキー */
function primaryKey(code) { return `${code}:0`; }

/** その国・その都市の気候。無ければ null */
function climateOf(code, cityIndex) {
  return DB.climate[`${code}:${cityIndex || 0}`] || null;
}
function seasonOf(code, cityIndex) {
  return DB.seasons[`${code}:${cityIndex || 0}`] || null;
}

/** 指定した月（1〜12）の天気の点数。
 *  月を指定しないときは12か月の平均を返します。
 *  最高点にすると、1か月だけ良い国と一年中良い国が並んでしまうためです。 */
function scoreOf(code, month, cityIndex) {
  const s = seasonOf(code, cityIndex);
  if (!s) return null;
  if (month) return s.scores[month - 1];
  return Math.round(s.scores.reduce((a, b) => a + b, 0) / 12);
}

/** 経済全体の物価水準（日本=100）。数字が無い国は null */
function priceLevelOf(code) {
  const p = DB.prices[code];
  return p && typeof p.level === 'number' ? p.level : null;
}

/** 外食と宿泊の物価（日本=100）。並べ替えと絞り込みはこちらを使います。
 *  旅行の支出でいちばん大きい費目だからです。
 *  無い国は経済全体の物価水準で代わりにします。 */
function eatLevelOf(code) {
  const p = DB.prices[code];
  if (!p) return null;
  if (typeof p.eat === 'number') return p.eat;
  return typeof p.level === 'number' ? p.level : null;
}

/** 点数を ◎○△✕ に直す。
 *  build_seasons.py の grade() と同じ境目です。片方だけ変えると
 *  月を選んだときと指定なしのときで意味が食い違うので、
 *  境目を変えるときは両方直してください。 */
function gradeOf(score) {
  if (score == null) return null;
  if (score >= 80) return '◎';
  if (score >= 65) return '○';
  if (score >= 50) return '△';
  return '✕';
}

/** 危険情報。出ていない国は null */
function safetyOf(code) { return DB.safety[code] || null; }

/** 選んだ月が台風・サイクロンの季節か
 *  wholeOnly を真にすると、国全体が対象のものだけを数えます。
 *  オーストラリアのサイクロンは北部だけなので、
 *  絞り込みでシドニー行きまで消えないようにするために使います。 */
function isStormMonth(code, month, cityIndex, wholeOnly) {
  const s = seasonOf(code, cityIndex);
  if (!s || !s.storm || !month) return false;
  if (wholeOnly && s.storm.partial) return false;
  return s.storm.months.includes(month);
}

/* ------------------------------------------------------------
 *  検索用の文字づくり
 *  ひらがな・カタカナ・英語のどれでも引けるようにします。
 * ---------------------------------------------------------- */
function kataToHira(s) {
  return s.replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function searchText(c) {
  const cities = c.cities.map((x) => `${x.ja} ${x.en}`).join(' ');
  const raw = `${c.ja} ${c.en} ${c.code} ${c.region} ${cities}`;
  return `${raw} ${kataToHira(raw)}`.toLowerCase();
}

function matches(c, query) {
  if (!query) return true;
  const q = kataToHira(query).toLowerCase().trim();
  if (!q) return true;
  if (!c._search) c._search = searchText(c);
  return q.split(/\s+/).every((w) => c._search.includes(w));
}
