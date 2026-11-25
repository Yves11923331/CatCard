/* ============================================================
 * 猫卡 · IndexedDB 图片存储 (idb.js)
 * ------------------------------------------------------------
 * 把卡面图/牌背图存进 IndexedDB（不受 localStorage 5MB 限制），
 * localStorage 里只放带标记(idb:xxx)的轻量元数据。
 * 若浏览器禁用 IndexedDB → ok=false，上层自动回退为老的内嵌方式。
 * ============================================================ */
(function (global) {
  'use strict';
  const DB_NAME = 'moka-images';
  const STORE = 'images';

  let db = null;
  let ok = false;
  let openPromise = null;

  /* ★ 2026-09-18：打开失败要**允许下次再试**。
     原来 opened=true 之后就再也不开第二次了 —— 一次冷启动超时（WebView 打开大库可能要几秒），
     整个会话都按"没有图片库"处理；再叠加上层"读不到就当图没了"的老逻辑，就成了"丢图"。
     现在：成功就常驻；失败/超时就把 openPromise 清掉，下次调用重新开一次。 */
  function ensure() {
    if (openPromise && ok) return Promise.resolve(true);
    if (openPromise) return openPromise;
    openPromise = new Promise(function (resolve) {
      let settled = false;
      let timer;
      const done = function (val) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(val);
      };
      // 超时兜底: 数据库卡死(旧连接占用等)时 2.5s 后按“不可用”处理, 避免白屏
      // ★ 2026-10-11：2.5s → 4s —— 大库冷启动经常超过 2.5s，被判"不可用"后
      //   图片全落 localStorage 兜底库（5MB 上限，用户报"储存上限太低"的一条根因）。
      //   多等 1.5s 换来图片进大容量的 IDB，值得。
      timer = setTimeout(function () { done(false); }, 4000);
      if (!global.indexedDB) { ok = false; done(false); return; }
      let rq;
      try { rq = global.indexedDB.open(DB_NAME, 1); }
      catch (e) { ok = false; done(false); return; }
      rq.onupgradeneeded = function () {
        try {
          const d = rq.result;
          if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
        } catch (e) {}
      };
      rq.onsuccess = function () {
        const conn = rq.result;
        // 超时的旧请求不许覆盖后一次连接，也不留下闲置连接。
        if (settled) { conn.close(); return; }
        db = conn;
        ok = true;
        function reset() {
          if (db === conn) { db = null; ok = false; openPromise = null; }
        }
        conn.onversionchange = function () { conn.close(); reset(); };
        conn.onclose = reset;
        done(true);
      };
      rq.onerror = function () { done(false); };
      rq.onblocked = function () { /* 由上方 setTimeout 兜底 */ };
    });
    // 失败 → 允许下次重试（把内部状态清空，openPromise 由调用方拿到结果后重置）
    openPromise = openPromise.then(function (v) {
      if (!v) { openPromise = null; db = null; }
      return v;
    });
    return openPromise;
  }

  // 一次性拉回全部键值(大量图片时避免逐张查询)
  /* 一次性拉回全部键值。
     ★ 返回值语义要和"库是空的"区分开：**读失败返回 null，空库返回 {}**。
       上层（hydrateImages）靠这个区别决定"这次先不动引用"还是"确实缺图"。 */
  function all() {
    return new Promise(function (resolve) {
      if (!ok || !db) { resolve(null); return; }
      try {
        const out = {};
        const r = store('readonly').openCursor();
        r.onsuccess = function () {
          const cur = r.result;
          if (cur) { out[cur.key] = cur.value; cur.continue(); }
          else resolve(out);
        };
        r.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }

  // 枚举当前全部键(清理孤儿图片用)
  function keys() {
    return new Promise(function (resolve) {
      if (!ok || !db) { resolve([]); return; }
      try {
        const out = [];
        const r = store('readonly').openCursor();
        r.onsuccess = function () {
          const cur = r.result;
          if (cur) { out.push(cur.key); cur.continue(); }
          else resolve(out);
        };
        r.onerror = function () { resolve([]); };
      } catch (e) { resolve([]); }
    });
  }

  function store(mode) {
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  function write(change) {
    return new Promise(function (resolve) {
      if (!ok || !db) { resolve(false); return; }
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.oncomplete = function () { resolve(true); };
        tx.onabort = function () { resolve(false); };
        // 请求失败默认会中止事务；只在事务结束后交付结果。
        change(tx.objectStore(STORE));
      } catch (e) { resolve(false); }
    });
  }

  function set(key, value) {
    return write(function (s) { s.put(value, key); });
  }

  function get(key) {
    return new Promise(function (resolve) {
      if (!ok || !db) { resolve(null); return; }
      try {
        const r = store('readonly').get(key);
        r.onsuccess = function () { resolve(r.result != null ? r.result : null); };
        r.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }

  function remove(key) {
    return write(function (s) { s.delete(key); });
  }

  global.MoKa = global.MoKa || {};
  global.MoKa.images = { ensure: ensure, ok: function () { return ok; }, set: set, get: get, remove: remove, keys: keys, all: all };
})(window);
