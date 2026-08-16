/* ============================================================
 *  設定ファイル
 *  アプリの見た目や初期値は、ここだけ編集すれば変えられます。
 *  他のファイルは触らなくてOKです。
 * ============================================================ */

const APP = {
  title: 'Trip Board',
  sub: '季節・物価・治安・時差で比較',

  // ★基準にする国。時差も物価もこことの比較で出します。
  //   タイムゾーンは端末の設定ではなく、ここで固定します。
  //   海外にいるときも「日本との時差」で見たいためです。
  homeTz: 'Asia/Tokyo',
  homeName: '日本',

  // ★一覧に一度に出す件数。
  listLimit: 80,

  // ★比較画面に並べられる国の数。
  //   スマホの画面幅で読めるのは4列までです。
  compareMax: 4,

  // ★時差が「近い」とみなす境目（時間）。絞り込みの「時差5時間以内」で使います。
  nearHours: 5,

  // お気に入りや選んだ月の保存場所につける名前。
  // 変えると今までの設定が読めなくなるので、通常は触りません。
  storageKey: 'trip-board-v1',
};

/* ------------------------------------------------------------
 *  データファイルの置き場所
 *  ふつうは触りません。tools/ の各スクリプトが作ります。
 * ---------------------------------------------------------- */
const DATA_FILES = {
  countries: 'data/countries.json', // 国と代表都市（tools/build_countries.py）
  climate:   'data/climate.json',   // 月別の平年値（tools/build_climate.py）
  seasons:   'data/seasons.json',   // 天気の判定・気温の印・雨の日数（tools/build_seasons.py）
  prices:    'data/prices.json',    // 物価（tools/build_prices.py）
  safety:    'data/safety.json',    // 外務省の危険情報（tools/build_safety.py）
  guide:     'data/guide.json',     // 行事と独自ルール（tools/build_guide.py）
  fares:     'data/fares.json',     // 航空券の高い時期・安い時期（tools/build_fares.py）
};

/* ------------------------------------------------------------
 *  出典。画面の下と詳細パネルに出します。
 *  数字がどこから来たのか分からないアプリにしないための決めごとです。
 * ---------------------------------------------------------- */
const SOURCES = [
  { name: '気温・降水', by: 'NASA POWER（MERRA-2 由来の気候値）',
    url: 'https://power.larc.nasa.gov/' },
  { name: '雨の日数', by: 'Open-Meteo（ERA5 再解析 / Copernicus）',
    url: 'https://open-meteo.com/' },
  { name: '費目別の物価', by: '世界銀行 国際比較プログラム（ICP 2021）価格水準指数',
    url: 'https://www.worldbank.org/en/programs/icp' },
  { name: '経済全体の物価水準', by: '世界銀行 World Development Indicators',
    url: 'https://data.worldbank.org/' },
  { name: '航空券の高低', by: '各国のシーズン解説をもとに手で整備（金額は持ちません）',
    url: 'https://www.ana.co.jp/ja/jp/guide/amc/award/international/terms/' },
  { name: '危険情報', by: '外務省 海外安全ホームページ',
    url: 'https://www.anzen.mofa.go.jp/kiken_list.html' },
  { name: '時差', by: 'IANA タイムゾーンデータベース（端末が持つもの）',
    url: 'https://www.iana.org/time-zones' },
];
