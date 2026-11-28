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

  /* 普通浏览：页面自带的调试红条 #err-box 直接不显示。
     它是开发期用的（会把所有未捕获错误贴到屏幕底部），公开站点不该露给用户；
     而且线上常见的跨域噪声（扩展注入、预览沙箱）只会显示成 "Script error."，
     对用户既看不懂也没法处理。要排错就用 ?dbg=1。
     用 CSS 藏而不是删节点：真机调试时控制台里 DOM 仍然完整。 */
  if (!dbg) {
    var st = global.document.createElement('style');
    st.id = 'moka-web-hide-errbox';
    st.textContent = '#err-box { display: none !important; }';
    (global.document.head || global.document.documentElement).appendChild(st);
  }

  /* ?dbg=1 时给页面自带的调试框 #err-box 加一颗「复制」，方便把真实报错发出来 */
  if (dbg) {
    var KEEP = '__mokaCopyBtn';
    var obs = new MutationObserver(function () {
      var box = global.document.getElementById('err-box');
      if (!box || box[KEEP]) return;
      box[KEEP] = true;
      var b = global.document.createElement('button');
      b.type = 'button';
      b.textContent = '复制这段';
      b.style.cssText = 'margin-top:6px;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.6);'
        + 'background:transparent;color:#fff;font-size:12px;';
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var txt = box.innerText || box.textContent || '';
        try {
          if (global.navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(txt).then(function () { b.textContent = '已复制'; });
          }
        } catch (e) {}
        /* 兜底：选中文本，长按也能复制 */
        try {
          var r = global.document.createRange();
          r.selectNodeContents(box);
          var sel = global.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        } catch (e2) {}
        setTimeout(function () { b.textContent = '复制这段'; }, 2000);
      });
      box.appendChild(b);
    });
    try {
      obs.observe(global.document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }

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
