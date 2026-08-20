/* ============================================================
 *  手動での更新
 *
 *  ホーム画面に追加したアプリは、公開側を新しくしても古い画面のまま
 *  開くことがあります。ふだんは sw.js（世話係）が自動で面倒を見ますが、
 *  それでも変わらないときの逃げ道がこのボタンです。
 *
 *  やっていることは3つです。
 *    1. 世話係に「新しい版が出ていないか」確かめさせる
 *    2. 端末に残っている控えを全部消す
 *    3. ページ本体を取り直して読み込み直す
 *
 *  ★このファイルは玄関と中のアプリすべてに
 *    まったく同じ中身で置いてあります。直すときは3つとも直してください。
 *    ずれていないかは「公開用を作る.py」が毎回検算します。
 * ============================================================ */
(function () {
  'use strict';

  var KEY = 'travel-box:sw-version';   // 前回見た版番号
  var FLAG = 'travel-box:updated';     // 読み込み直したあとに何を伝えるか

  /* 公開側の sw.js から版番号を読む。
     アプリは1階層下にあるので、自分の階層 → 親の順に探します。
     手元の開発サーバーには sw.js が無いので、その場合は null です。 */
  function swVersion() {
    return ['sw.js', '../sw.js'].reduce(function (chain, path) {
      return chain.then(function (found) {
        if (found) return found;
        return fetch(path, { cache: 'reload' })
          .then(function (r) { return r.ok ? r.text() : null; })
          .then(function (text) {
            if (!text) return null;
            var m = text.match(/VERSION\s*=\s*'([^']+)'/);
            return m ? m[1] : null;
          })
          .catch(function () { return null; });
      });
    }, Promise.resolve(null));
  }

  /* 画面の上に短く出す知らせ */
  function toast(text) {
    var el = document.createElement('p');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = text;
    document.body.appendChild(el);
    // 描かれてから色を付けないと、animation が効きません
    requestAnimationFrame(function () { el.classList.add('is-on'); });
    setTimeout(function () {
      el.classList.remove('is-on');
      setTimeout(function () { el.remove(); }, 400);
    }, 3600);
  }

  function run(btn) {
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1';
    btn.classList.add('is-busy');

    var before = null;
    try { before = localStorage.getItem(KEY); } catch (e) { /* 使えなくても続けます */ }

    swVersion().then(function (now) {
      var jobs = [];

      // 1. 世話係に新しい版がないか確かめさせる
      if ('serviceWorker' in navigator) {
        jobs.push(navigator.serviceWorker.getRegistrations()
          .then(function (regs) {
            return Promise.all(regs.map(function (r) { return r.update(); }));
          }).catch(function () { /* 未登録なら何もしません */ }));
      }

      // 2. 端末に残っている控えを全部消す
      if (window.caches) {
        jobs.push(caches.keys().then(function (keys) {
          return Promise.all(keys.map(function (k) { return caches.delete(k); }));
        }).catch(function () { /* 消せなくても続けます */ }));
      }

      // 3. ページ本体を取り直す。
      //    ブラウザ自身が持っている控えを飛び越えるために cache:'reload' を使います。
      //    これをしないと、控えを消しても同じ古い HTML が返ってくることがあります。
      jobs.push(fetch(location.href, { cache: 'reload' }).catch(function () {}));

      return Promise.all(jobs).then(function () {
        try {
          if (now) localStorage.setItem(KEY, now);
          // 版番号を読めなかったときに「最新でした」と言い切らないよう、
          // 前回の記録があるときだけ新旧を判定します。
          localStorage.setItem(FLAG,
            !now ? 'done' : (!before ? 'done' : (now === before ? 'same' : 'new')));
        } catch (e) { /* 保存できなくても読み込み直します */ }
        location.reload();
      });
    }).catch(function () {
      btn.dataset.busy = '';
      btn.classList.remove('is-busy');
      toast('更新できませんでした。通信を確かめてください。');
    });
  }

  /* 読み込み直したあとに、何が起きたのかを伝えます。
     押したのに何も言われないと、効いたのかどうか分かりません。 */
  function report() {
    var flag = null;
    try {
      flag = localStorage.getItem(FLAG);
      if (flag) localStorage.removeItem(FLAG);
    } catch (e) { return; }
    if (!flag) return;
    toast(flag === 'new' ? '新しい版に更新しました'
        : flag === 'same' ? 'すでに最新でした'
        : '最新の状態にしました');
  }

  function init() {
    var btn = document.getElementById('updateBtn');
    if (btn) btn.addEventListener('click', function () { run(btn); });
    report();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
