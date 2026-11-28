/* ============================================================
 * 猫卡 · 网页版启动补丁（web-boot.js）
 * ------------------------------------------------------------
 * 只在网页版（Pages 发布的 /CatCard/ 与 /CatCard/desktop.html）里加载，
 * 排在页面自己的脚本**之前**。
 *
 * 干两件事：
 * 1) 过滤「跨域脚本」的报错噪声。
 *    index.html 里有个开发用的调试框（#err-box），会把所有未捕获错误
 *    红条显示在页面底部。浏览器扩展 / 被注入的内容脚本抛错时，Chrome 只给
 *    一句 "Script error." 且没有文件名和堆栈 —— 那不是这个页面的错，
 *    却会吓到用户（实测：电脑版有扩展就报，手机版没有就干净）。
 *    这里在捕获阶段先拦掉「message 是 Script error. 且 ev.error 为空」的那类，
 *    其余错误（有文件名、有堆栈）照常显示。
 * 2) 开一个调试开关：地址后面加 ?dbg=1 就什么都不拦，方便真机排错。
 * ============================================================ */
(function (global) {
  'use strict';
  if (!global || !global.addEventListener) return;
  if (global.__mokaWebBoot) return;      /* 只装一次 */
  global.__mokaWebBoot = true;

  var dbg = /[?&]dbg=1\b/.test(global.location.search);

  global.addEventListener('error', function (ev) {
    if (dbg) return;                     /* ?dbg=1：原样透传，看真实报错 */
    if (ev && ev.message === 'Script error.' && !ev.error) {
      /* 拿不到任何信息的跨域错误：浏览器扩展/注入脚本的事，不是本页的 */
      ev.stopImmediatePropagation();
      if (global.console && console.debug) {
        console.debug('[猫卡·网页版] 已忽略一条跨域脚本错误（通常是浏览器扩展注入）：', ev.filename || '(inline)');
      }
    }
  }, true);
})(typeof window !== 'undefined' ? window : null);
