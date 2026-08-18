/* ============================================================
 *  Pack Board — 端末をまたいだ同期
 *  （Google スプレッドシート＋Apps Script。T3 Works と同じやり方）
 *
 *  【考え方】
 *  ・**まず端末の中に保存します。**画面はすぐ反応し、機内でも動きます
 *  ・送るのは裏で、あとから。つながったときにまとめて送ります
 *  ・**1件ごとに更新時刻（up）を持ち、新しいほうを残します。**
 *    リストを丸ごと送り合うと、あとから送ったほうで相手の修正が
 *    消えてしまいます。1件ごとなら、iPhone で「パスポート」に、
 *    Mac で「歯ブラシ」に同時にチェックを付けても両方残ります
 *  ・消したものは「消した印」を送ります。行ごと消すと、まだ知らない
 *    端末から送り返されてよみがえるためです
 *
 *  【人の分けかた】
 *  合言葉（PIN）で分けます。合言葉が違えば別の入れ物になり、
 *  互いのリストは見えません。配った相手のデータと混ざりません。
 *
 *  APP.syncUrl が空のあいだ、この仕組みは丸ごと止まります
 *  （いままでどおり端末の中だけで動きます）。
 * ============================================================ */

const Sync = {
  _pinKey: APP.storageKey + ':pin',
  _sinceKey: APP.storageKey + ':since',
  timer: null,
  running: false,
  lastError: '',
  lastAt: null,
  onChange: null,     // ようすが変わったら呼ばれます（画面の更新用）

  enabled() { return !!(APP.syncUrl && APP.syncUrl.trim()); },
  pin() { return localStorage.getItem(this._pinKey) || ''; },
  setPin(p) { localStorage.setItem(this._pinKey, String(p).trim()); },
  clearPin() {
    localStorage.removeItem(this._pinKey);
    localStorage.removeItem(this._sinceKey);
  },
  since() { return localStorage.getItem(this._sinceKey) || ''; },
  _setSince(v) { if (v) localStorage.setItem(this._sinceKey, v); },

  on() { return this.enabled() && !!this.pin(); },

  /** 何か直したときに呼びます。少し待ってからまとめて送ります */
  push() {
    if (!this.on()) return;
    clearTimeout(this.timer);
    // 続けて直したときに何度も送らないよう、少しまとめます
    this.timer = setTimeout(() => this.run(), 1200);
  },

  _notify() { if (this.onChange) this.onChange(); },

  /* -------- いまの中身を、送れる形（1件ずつ）に並べ直す -------- */
  records() {
    const out = [];
    state.cats.forEach((c) => out.push({
      kind: 'cat', id: c.id, listId: '', up: c.up, del: 0,
      body: { name: c.name, icon: c.icon || 'tag', ord: c.ord },
    }));
    state.lists.forEach((l) => {
      out.push({
        kind: 'list', id: l.id, listId: '', up: l.up, del: 0,
        body: { name: l.name, ord: l.ord },
      });
      l.items.forEach((it) => out.push({
        kind: 'item', id: it.id, listId: l.id, up: it.up, del: 0,
        body: { cat: it.cat, name: it.name, note: it.note,
                done: !!it.done, ord: it.ord },
      }));
    });
    state.graves.forEach((g) => out.push({
      kind: g.kind, id: g.id, listId: g.listId || '', up: g.up, del: 1, body: {},
    }));
    return out;
  },

  /* -------- 受け取ったものを取り込む -------- */
  merge(rows) {
    let changed = 0;

    const applyDel = (r) => {
      if (r.kind === 'cat') {
        const i = state.cats.findIndex((c) => c.id === r.id);
        if (i >= 0 && !isNewer(state.cats[i], r)) { state.cats.splice(i, 1); changed++; }
      } else if (r.kind === 'list') {
        const i = state.lists.findIndex((l) => l.id === r.id);
        if (i >= 0 && !isNewer(state.lists[i], r)) { state.lists.splice(i, 1); changed++; }
      } else {
        state.lists.forEach((l) => {
          const i = l.items.findIndex((x) => x.id === r.id);
          if (i >= 0 && !isNewer(l.items[i], r)) { l.items.splice(i, 1); changed++; }
        });
      }
      // 消した印は手元にも残します（ほかの端末へ伝えるため）
      if (!state.graves.some((g) => g.kind === r.kind && g.id === r.id)) {
        state.graves.push({ kind: r.kind, id: r.id, listId: r.listId, up: r.up, del: 1 });
      }
    };

    rows.forEach((r) => {
      if (r.del) { applyDel(r); return; }
      // こちらで消したものが送られてきても、よみがえらせません。
      // ただし相手の「消した印」より新しい復活なら受け入れます
      const grave = state.graves.find((g) => g.kind === r.kind && g.id === r.id);
      if (grave && !isNewer(r, grave)) return;
      if (grave) state.graves = state.graves.filter((g) => g !== grave);

      if (r.kind === 'cat') {
        const cur = state.cats.find((c) => c.id === r.id);
        if (!cur) { state.cats.push({ id: r.id, up: r.up, ...r.body }); changed++; }
        else if (isNewer(r, cur)) { Object.assign(cur, r.body, { up: r.up }); changed++; }
      } else if (r.kind === 'list') {
        const cur = state.lists.find((l) => l.id === r.id);
        if (!cur) { state.lists.push({ id: r.id, up: r.up, items: [], ...r.body }); changed++; }
        else if (isNewer(r, cur)) {
          const { items } = cur;
          Object.assign(cur, r.body, { up: r.up, items });
          changed++;
        }
      } else {
        const l = state.lists.find((x) => x.id === r.listId);
        if (!l) return;      // まだリストが届いていないときは、次の同期で入ります
        const cur = l.items.find((x) => x.id === r.id);
        if (!cur) { l.items.push({ id: r.id, up: r.up, ...r.body }); changed++; }
        else if (isNewer(r, cur)) { Object.assign(cur, r.body, { up: r.up }); changed++; }
      }
    });
    return changed;
  },

  /* -------- 送って受け取る -------- */
  async run(force) {
    if (!this.on() || this.running) return;
    this.running = true;
    this.lastError = '';
    this._notify();
    try {
      const res = await fetch(APP.syncUrl, {
        method: 'POST',
        // text/plain にするのは、ブラウザに事前確認（preflight）をさせないためです。
        // Apps Script は事前確認に応えないので、application/json だと通りません。
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          pin: this.pin(),
          since: force ? '' : this.since(),
          records: this.records(),
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '断られました');

      const changed = this.merge(data.rows || []);
      this._setSince(data.now);
      this.lastAt = new Date();
      if (changed) { save(); render(); }
      else { save(); }
    } catch (e) {
      this.lastError = String(e.message || e);
    } finally {
      this.running = false;
      this._notify();
    }
  },

  /** 合言葉が合うかどうかだけを見ます（設定のとき） */
  async test(pin) {
    const res = await fetch(APP.syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ pin, since: '', records: [], probe: 1 }),
    });
    return res.json();
  },
};

/* つながったときと、画面に戻ったときに取りに行きます */
window.addEventListener('online', () => Sync.run());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) Sync.run();
});
