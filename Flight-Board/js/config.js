/* ============================================================
 *  設定ファイル
 *  アプリの見た目や初期値は、ここだけ編集すれば変えられます。
 *  他のファイルは触らなくてOKです。
 * ============================================================ */

const APP = {
  title: 'Flight Board',
  sub: '空港・航空会社・アライアンス',

  // ★最初に開いたときに出しておく空港（IATAコード）
  //   名古屋を拠点にするなら 'NGO'。羽田中心なら 'HND' など。
  homeAirport: 'NGO',

  // ★一覧に一度に出す件数。
  //   世界の空港は4,000件以上あるので、全部出すとスマホでは重くなります。
  //   検索で絞ったぶんはこの件数まで表示し、超えたぶんは「もっと絞ってください」と出します。
  listLimit: 60,


  // お気に入りの保存場所につける名前。
  // 変えると今まで付けたお気に入りが読めなくなるので、通常は触りません。
  storageKey: 'flight-board-v1',
};

/* ------------------------------------------------------------
 *  データファイルの置き場所
 *  ふつうは触りません。
 *  第2段（路線データ）を足すときは、ここに routes を増やす予定です。
 * ---------------------------------------------------------- */
const DATA_FILES = {
  airports:   'data/airports.json',    // 空港マスタ（tools/build_airports.py で生成）
  airportsJa: 'data/airports-ja.json', // 空港名の日本語（手で足せる。無くても動く）
  airlines:   'data/airlines.json',    // 航空会社＋アライアンス（tools/build_airlines.py で生成）
  aircraft:   'data/aircraft.json',    // 機材（tools/build_aircraft.py で生成）
  cabins:     'data/aircraft-cabins.json', // 各社の座席仕様（tools/build_cabins.py で生成）
  products:   'data/cabin-products.json',  // 特別な座席・設備（tools/build_cabin_products.py で生成）
  routes:     'data/routes.json',      // 就航路線（tools/build_routes.py で生成）
  awards:     'data/award-links.json', // 特典航空券のリンク（手で編集する）
  worldmap:   'data/worldmap.json',   // 世界地図の陸地（tools/build_map.py で生成）
};
