/**
 * Pack Board 同期用 Apps Script
 * ============================================================
 * スプレッドシートに「1行＝1件」で置きます。
 *
 *   pin | kind | id | listId | up | del | body
 *
 * ★ pin（合言葉）が違えば別の入れ物です。配った相手のデータと混ざりません。
 * ★ 同じ（pin, kind, id）が来たら、**up が新しいほうだけ**を残します。
 *   これで、2つの端末で同時に直しても片方が消えません。
 *
 * 【置きかた】
 *  1. Google スプレッドシートを新しく作る（名前は何でもよい）
 *  2. 拡張機能 → Apps Script
 *  3. このファイルの中身を全部貼り付けて保存
 *  4. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *       次のユーザーとして実行：自分
 *       アクセスできるユーザー：**全員**
 *     （「全員」でも、合言葉を知らない人は中身を取り出せません）
 *  5. 出てきた URL を js/config.js の syncUrl に貼る
 */

var SHEET = 'packboard';
var HEAD = ['pin', 'kind', 'id', 'listId', 'up', 'del', 'body'];

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 合言葉の総当たり対策。
 * 10分のあいだに10回まちがえたら、しばらく受け付けません。
 */
function tooManyTries_() {
  var p = PropertiesService.getScriptProperties();
  var now = Date.now();
  var until = Number(p.getProperty('LOCK_UNTIL') || 0);
  if (now < until) return true;
  var tries = JSON.parse(p.getProperty('TRIES') || '[]')
    .filter(function (t) { return now - t < 10 * 60 * 1000; });
  if (tries.length >= 10) {
    p.setProperty('LOCK_UNTIL', String(now + 10 * 60 * 1000));
    p.setProperty('TRIES', '[]');
    return true;
  }
  tries.push(now);
  p.setProperty('TRIES', JSON.stringify(tries));
  return false;
}

/**
 * 端末の時計が進んでいるときの守り。
 *
 * ★どちらを残すかは「更新時刻が新しいほう」で決めています。
 *   ということは、**時計が進んでいる端末の書き込みが常に勝ちます。**
 *   1台だけ時計が10分進んでいると、そちらで消したものが
 *   もう片方でよみがえる、といったことが起きます。
 *
 *   そこで、いまより先の時刻はサーバーの時刻に切り詰めます。
 *   少しの誤差（2分）は通します。通信の行き帰りがあるためです。
 */
function clampUp_(up) {
  var now = new Date();
  var t = new Date(String(up || ''));
  if (isNaN(t.getTime())) return now.toISOString();
  if (t.getTime() > now.getTime() + 2 * 60 * 1000) return now.toISOString();
  return t.toISOString();
}

/** 合言葉として使ってよい形か（短すぎるものを弾きます） */
function okPin_(pin) {
  return typeof pin === 'string' && pin.trim().length >= 4;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return json_({ ok: false, error: 'こみ合っています。少し待ってください' });
  }
  try {
    var req = JSON.parse(e.postData.contents);
    var pin = String(req.pin || '').trim();

    if (!okPin_(pin)) {
      return json_({ ok: false, error: '合言葉は4文字以上にしてください' });
    }
    if (tooManyTries_()) {
      return json_({ ok: false, error: 'しばらく待ってからやり直してください' });
    }

    var sh = sheet_();
    var last = sh.getLastRow();
    var rows = last > 1 ? sh.getRange(2, 1, last - 1, HEAD.length).getValues() : [];

    // いま入っているもの（この合言葉のぶんだけ）を、引きやすい形にします
    var index = {};      // key → { row(1始まり), up }
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) !== pin) continue;
      index[rows[i][1] + '\t' + rows[i][2]] = { row: i + 2, up: String(rows[i][4]) };
    }

    // ---- 受け取ったものを書き込む（新しいほうだけ）----
    var incoming = req.records || [];
    var adds = [];
    for (var j = 0; j < incoming.length; j++) {
      var r = incoming[j];
      if (!r || !r.kind || !r.id) continue;
      var key = r.kind + '\t' + r.id;
      var up = clampUp_(r.up);       // 先走った時計を切り詰めます
      var line = [pin, r.kind, r.id, r.listId || '', up,
                  r.del ? 1 : 0, JSON.stringify(r.body || {})];
      var cur = index[key];
      if (!cur) {
        adds.push(line);
        // 同じ回の中で二重に足さないよう、覚えておきます
        index[key] = { row: -1, up: up };
      } else if (cur.row > 0 && up > cur.up) {
        sh.getRange(cur.row, 1, 1, HEAD.length).setValues([line]);
        cur.up = up;
      }
    }
    if (adds.length) {
      sh.getRange(sh.getLastRow() + 1, 1, adds.length, HEAD.length).setValues(adds);
    }

    // ---- 相手に返す（since より新しいものだけ）----
    var since = String(req.since || '');
    var out = [];
    if (!req.probe) {
      last = sh.getLastRow();
      rows = last > 1 ? sh.getRange(2, 1, last - 1, HEAD.length).getValues() : [];
      for (var k = 0; k < rows.length; k++) {
        if (String(rows[k][0]) !== pin) continue;
        var up = String(rows[k][4]);
        if (since && up <= since) continue;
        out.push({
          kind: rows[k][1], id: String(rows[k][2]), listId: String(rows[k][3]),
          up: up, del: Number(rows[k][5]) ? 1 : 0,
          body: JSON.parse(rows[k][6] || '{}'),
        });
      }
    }

    return json_({ ok: true, rows: out, now: new Date().toISOString(),
                   count: out.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** ブラウザで開いたときの確認用。中身は返しません */
function doGet() {
  return json_({ ok: true, note: 'Pack Board の同期です。POST で使います。' });
}

/** 手で動かして、置けているか確かめる */
function 確かめる() {
  var sh = sheet_();
  Logger.log('シート: ' + sh.getName());
  Logger.log('行数: ' + Math.max(0, sh.getLastRow() - 1));
  var last = sh.getLastRow();
  if (last > 1) {
    var pins = {};
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      pins[r[0]] = (pins[r[0]] || 0) + 1;
    });
    Object.keys(pins).forEach(function (p) {
      Logger.log('  合言葉 [' + String(p).slice(0, 2) + '***]: ' + pins[p] + ' 件');
    });
  }
}
