/* ============================================================
 *  データの読み込み
 *  4つのJSONを読んで、引きやすい形に組み直すところまで担当します。
 * ============================================================ */

async function fetchJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} を読み込めませんでした（${res.status}）`);
  return res.json();
}

/* 国コード（JP）を日本語の国名（日本）に変える。
   Intl.DisplayNames はブラウザに元から入っている機能なので、
   国名のデータを自前で持たなくて済みます。 */
const countryName = (() => {
  let dn = null;
  try { dn = new Intl.DisplayNames(['ja'], { type: 'region' }); } catch (e) { dn = null; }
  const cache = {};
  return (code) => {
    if (cache[code] !== undefined) return cache[code];
    let out = code;
    try { out = (dn && dn.of(code)) || code; } catch (e) { out = code; }
    return (cache[code] = out);
  };
})();

async function loadAll() {
  const [miles, zones, cities, segments, ana] = await Promise.all([
    fetchJson(DATA_FILES.miles),
    fetchJson(DATA_FILES.zones),
    fetchJson(DATA_FILES.cities),
    fetchJson(DATA_FILES.segments),
    fetchJson(DATA_FILES.milesAna),
  ]);

  /* ANA運航便だけで組んだときの表。こちらはシーズンで変わります。 */
  MB.ana = {
    miles: ana.miles,
    milesOneway: ana.milesOneway || {},
    zoneGroup: ana.zoneGroup,
    calendar: ana.calendar,
    seasonNames: ana.meta.seasons,
  };

  MB.miles = miles.miles;
  MB.milesOneway = miles.milesOneway || {};
  MB.upgradeDiff = miles.upgradeDiff || {};
  MB.zones = zones.airports;
  MB.countryZone = zones.countries;
  MB.labels = zones.labels;
  MB.cities = cities.countries;
  MB.regionOrder = cities.regionOrder || [];
  MB.segments = segments.segments;
  MB.airlineNames = segments.meta.airlines || {};
  MB.starCodes = new Set(segments.meta.star || []);
  MB.partnerOnly = new Set(segments.meta.partnerOnly || []);
  MB.ending = segments.meta.ending || {};

  /* 都市名から一発で引ける索引を作る。
     同じ都市名が別の国にあることがあるので（例：サンティアゴ）、
     先に見つかったほうを採り、あとから来たものには国名を付けて別の項目にします。 */
  MB.cityIndex = {};
  MB.countryList = [];
  for (const [cc, info] of Object.entries(MB.cities)) {
    const jaCountry = countryName(cc);
    MB.countryList.push({ code: cc, name: jaCountry, zone: info.zone, region: info.region });
    for (const [name, iata] of Object.entries(info.cities)) {
      const key = MB.cityIndex[name] ? `${name}（${jaCountry}）` : name;
      MB.cityIndex[key] = { name: key, country: cc, countryName: jaCountry, zone: info.zone, iata };
      info.cities[name] = iata;      // もとの形は残しておく
      if (key !== name) info.cities[key] = iata;
      if (key !== name) delete info.cities[name];
    }
  }

  /* 国はエリアごとにまとめて並べます。
     エリアの順は data/cities.json の regionOrder（日本→東アジア→…）。
     同じエリアの中は五十音順です。 */
  const regionRank = (r) => {
    const i = MB.regionOrder.indexOf(r);
    return i < 0 ? 99 : i;
  };
  // 漢字ではじまる国名は、読みに置き換えてから並べます（COUNTRY_KANA）
  const kana = (n) => COUNTRY_KANA[n] || n;
  MB.countryList.sort((a, b) => {
    const r = regionRank(a.region) - regionRank(b.region);
    return r !== 0 ? r : kana(a.name).localeCompare(kana(b.name), 'ja');
  });

  return {
    milesSource: miles.meta.source,
    zoneSource: zones.meta.source,
    routeSource: segments.meta.source,
  };
}

/* 選べる都市の一覧を作る。
   used に入っている都市は、もう使われているので外します。 */
function cityOptions({ japanOnly = false, overseasOnly = false, used = [] } = {}) {
  const groups = [];
  for (const c of MB.countryList) {
    if (japanOnly && c.code !== 'JP') continue;
    if (overseasOnly && c.code === 'JP') continue;
    /* 並び順は data/cities.json に書かれている順（五十音順）をそのまま使います。
       ここで並べ直すと、せっかくそろえた順がこわれます。
       日本だけ、よく使う空港を先頭に引き上げます。 */
    let names = Object.keys(MB.cities[c.code].cities).filter((n) => !used.includes(n));
    if (c.code === 'JP') {
      const first = APP.japanFirst.filter((n) => names.includes(n));
      names = [...first, ...names.filter((n) => !first.includes(n))];
    }
    if (names.length) {
      groups.push({ label: c.name, zone: c.zone, region: c.region, cities: names });
    }
  }
  return groups;
}
