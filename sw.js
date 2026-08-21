/* Travel Box の世話係（サービスワーカー）
 *
 * ページ本体（HTML）は毎回サーバーに取りに行き、
 * ?v= の付いた css / js / img と、データの json だけ端末の控えを使います。
 * こうすると、直した画面はすぐ届き、重いデータは使い回せます。
 * 通信できないときは控えで動きます。
 *
 * 下の版番号は「公開用を作る.py」が毎回書き換えます。
 * 中身が変わる＝端末が「新しい世話係だ」と気づく合図なので、
 * ここを消したり固定したりしないでください。
 */
const VERSION = '512836bf';
const CACHE = 'travel-box-' + VERSION;

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isPage = req.mode === 'navigate' || url.pathname.endsWith('.html')
                 || url.pathname.endsWith('/');

  if (isPage) {
    // ページは毎回取りに行く。取れなければ控えを出す（機内でも開ける）
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        // ★ 取れた＝正しいページ、ではありません。
        //    GitHub が落ちているときは、エラーの画面（ユニコーンの絵）が
        //    ちゃんと返ってきます。中身を見ずに控えると、それを
        //    アプリの画面として持ち続け、電波のない場所で出してしまいます。
        //    控えるのは 200 のときだけです。
        if (res && res.ok) {
          const c = await caches.open(CACHE);
          c.put(req, res.clone());
          return res;
        }
        // サーバーが変事のときは、前に取っておいた正しい画面を出します。
        // 無ければ、起きたことがそのまま見えるようにエラーを返します。
        const hit = await caches.match(req);
        return hit || res;
      } catch (err) {
        const hit = await caches.match(req);
        return hit || Response.error();
      }
    })());
    return;
  }

  // それ以外は控えを優先。無ければ取りに行って控える
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res && res.status === 200) {
      const c = await caches.open(CACHE);
      c.put(req, res.clone());
    }
    return res;
  })());
});
