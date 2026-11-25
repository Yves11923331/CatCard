/* ============================================================
 * 猫卡 · 随机源 (random.js)
 * ------------------------------------------------------------
 * 全 App **唯一**的随机入口。骰子点数 / 抽签 / 洗牌 / 对话行为 /
 * 新卡新牌堆的 id —— 全部走这里，底层统一是 `crypto.getRandomValues`。
 *
 * 为什么不再用 Math.random（2026-11-13 用户要求「随机源统一成
 * crypto.getRandomValues」）：
 *   · Math.random 是 V8 的 xorshift128+，同一进程里可预测，而且不同
 *     调用点各抽各的，骰子 / 神签 / 对话的"随机"根本不是同一个来源；
 *   · 占卜类应用里，洗牌顺序、掷骰点数、抽到哪句签文都该是不可预测的。
 *     现在只有一个源，出问题也只查这一个文件。
 *
 * 三个细节：
 *   ① 整数走**拒绝采样**（rejection sampling），不做 `% n` —— 取模会给
 *      小余数偏高的偏差（牌 78 张时尤其明显）；
 *   ② 浮点取 53 位（21 + 32），值域和精度与 Math.random 一致；
 *   ③ 不给 Math.random 兜底：目标环境（Android 10+ WebView）一直有
 *      Web Crypto，缺了就该当场报清楚，而不是悄悄退回一个弱随机源。
 *
 * API（`window.MoKa.random`，也留了 `window.MoKaRandom` 别名）：
 *   float()          → [0, 1) 均匀浮点（53 位）
 *   int(n)           → [0, n) 均匀整数
 *   range(a, b)      → [a, b) 均匀浮点
 *   pick(arr)        → 数组里均匀取一个（空数组返回 undefined）
 *   shuffle(ids)     → 返回洗乱后的**副本**（Fisher-Yates，不改入参）
 *   uid(prefix)      → 'prefix-<36 进制时间>-<6 位 36 进制随机>'
 * ============================================================ */
(function (global) {
  'use strict';

  var c = global.crypto || global.msCrypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    /* 不兜底 Math.random：那样"统一随机源"就成了一句空话，而且谁也不会
       发现真机上退回了弱随机。宁可这里当场报错，也别静默降级。 */
    throw new Error('猫卡需要 crypto.getRandomValues —— 当前 WebView 不提供 Web Crypto');
  }

  var BUF32 = new Uint32Array(1);
  var BUF53 = new Uint32Array(2);
  var POW32 = 4294967296;          // 2^32
  var POW53 = 9007199254740992;    // 2^53

  /* 32 位无符号整数（一次 getRandomValues 调用） */
  function u32() {
    c.getRandomValues(BUF32);
    return BUF32[0];
  }

  /* [0, 1)：取 53 位随机位（高 21 位 + 低 32 位），与 Math.random 的精度一致 */
  function float() {
    c.getRandomValues(BUF53);
    return ((BUF53[0] >>> 11) * POW32 + BUF53[1]) / POW53;
  }

  /* [0, n) 均匀整数：拒绝采样，丢掉会造成取模偏差的尾部 */
  function int(n) {
    n = Math.floor(n);
    if (!(n > 0)) return 0;
    if (n > POW32) throw new Error('MoKa.random.int(n) 的 n 超出 32 位范围：' + n);
    var limit = Math.floor(POW32 / n) * n;
    var x;
    do { x = u32(); } while (x >= limit);
    return x % n;
  }

  function range(a, b) { return a + float() * (b - a); }

  function pick(arr) {
    if (!arr || !arr.length) return undefined;
    return arr[int(arr.length)];
  }

  /* Fisher-Yates；返回副本，调用方原来的数组一根手指都不动
     （选牌台的 trayOrder 就靠这个：洗牌不改牌组自己的顺序） */
  function shuffle(ids) {
    var a = Array.prototype.slice.call(ids || []);
    for (var i = a.length - 1; i > 0; i--) {
      var j = int(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  var ALNUM = '0123456789abcdefghijklmnopqrstuvwxyz';
  function uid(prefix) {
    var s = '';
    for (var i = 0; i < 6; i++) s += ALNUM[int(36)];
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + s;
  }

  var R = {
    float: float,
    int: int,
    range: range,
    pick: pick,
    shuffle: shuffle,
    uid: uid
  };

  global.MoKa = global.MoKa || {};
  global.MoKa.random = R;
  global.MoKaRandom = R;      // 兼容/走查用的全局别名（两个名字指向同一个对象）
})(window);
