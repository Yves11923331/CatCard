/* ============================================================
 * 猫卡 · 应用入口 (app.js)
 * ------------------------------------------------------------
 * 职责: 场景切换(占卜桌 / 牌库), 初始化各模块, 绑定底部导航。
 * ============================================================ */
(function (global) {
  'use strict';

  const THEME_KEY = 'moka.theme';
  function currentTheme() { return document.documentElement.getAttribute('data-ui-theme') === 'dark' ? 'dark' : 'light'; }
  function syncThemeBtn() {
    const b = document.getElementById('btn-theme');
    if (!b) return;
    const dark = currentTheme() === 'dark';
    /* ★ 2026-10-15：这颗按钮在 HTML 里是 role="switch" —— 那就**必须**有 aria-checked，
       否则读屏软件只能念出"切换深浅主题"、念不出"现在是开还是关"（同项目里
       牌库那个 .deck-check 一直是有 aria-checked 的，只有这里漏了）。
       状态的唯一真源是 html[data-ui-theme]，所以在这里跟着它一起写。 */
    b.setAttribute('aria-checked', dark ? 'true' : 'false');
    // ★ 2026-09-18：主题按钮改成了两个内联 SVG（月亮 / 太阳），
    //   由 CSS 按 html[data-ui-theme] 切换显示 —— 这里**绝对不能再写 textContent**，
    //   写一次就把两个 svg 抹掉，而且不报错（这种"静默失效"最难查）。
    if (b.querySelector('svg')) return;
    b.textContent = dark ? '☀' : '☾';   // 兜底：万一结构被换回纯文字
  }
  function applyTheme() {
    let t = 'light';
    try { t = localStorage.getItem(THEME_KEY) || 'light'; } catch (e) {}
    document.documentElement.setAttribute('data-ui-theme', t === 'dark' ? 'dark' : 'light');
    syncThemeBtn();
    /* ★ 2026-11-17：系统状态栏/导航栏的颜色归原生壳管（网页改不了系统栏）。
       网页这边只做一件事：把"现在深还是浅"告诉壳，它在那边上色 + 图标反色。
       浅色壳刷 #FFFFFF、深色刷 #1B1F24，跟顶栏/底栏同色 —— 顶部那条黑边就是这么没的。
       非壳环境（桌面浏览器 / 走查 jsdom）没有 window.CatCard，静默跳过。 */
    try {
      if (window.CatCard && typeof window.CatCard.setUiTheme === 'function') {
        window.CatCard.setUiTheme(currentTheme());
      }
    } catch (e) {}
  }
  function toggleTheme() {
    const nx = currentTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, nx); } catch (e) {}
    applyTheme();
  }
  applyTheme();

  const scenes = ['table', 'library', 'settings', 'lots', 'dice', 'chat', 'zhouyi'];
  let currentScene = 'table';
  /* ★★ 2026-10-15：主页（占卜桌）返回**防误触**用。 */
  const BACK_EXIT_MS = 2000;      // "再按一次退出"的时间窗（Android 惯例 2 秒）
  let lastBackAt = 0;

  function gotoScene(name) {
    if (!scenes.includes(name)) return;
    currentScene = name;
    document.querySelectorAll('.scene').forEach(function (s) {
      s.classList.toggle('is-active', s.dataset.scene === name);
    });
    document.querySelectorAll('.tabbar .tab').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.goto === name);
    });
    document.querySelectorAll('.drawer-item[data-goto]').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.goto === name);
    });
    // 隐藏跨场景覆盖层
    global.MoKa.table && global.MoKa.table.hideMeaning && global.MoKa.table.hideMeaning();
    global.MoKa.table && global.MoKa.table.hideCover && global.MoKa.table.hideCover();
    /* ★ 2026-10-15：确认框/输入框挂在 #overlay-root（body 级、fixed + z-index:300），
       **不属于任何一个场景**，切场景它照样浮着。实测：占卜桌拉线抽屉点「重来」→
       手滑点了底部「牌库」→ 牌库页上还浮着「重新开始？」；这时点「收回重来」，
       doReset() 在牌库场景里把牌全清了，人在牌库屏幕上什么都看不到，
       回占卜桌才发现牌没了。上面已经收了牌义层和引导层，唯独漏了它；
       而 ui.js 里正好有个干这事的 clearOverlay()，从头到尾没人调用。
       只清 DOM、**不 resolve 那个 Promise** → 等于用户取消了，绝不会误执行 doReset。 */
    global.MoKa.ui && global.MoKa.ui.clearOverlay && global.MoKa.ui.clearOverlay();
    if (name === 'table') {
      global.MoKa.table.openTable();
    }
    /* ★ 周易桌：占卜桌的独立拷贝，自己有 openTable/init/back（见 scenes/zhouyi-table.js） */
    if (name === 'zhouyi' && global.MoKa.zhouyiTable) {
      global.MoKa.zhouyiTable.openTable();
    }
    if (name === 'settings' && global.MoKa.settings) {
      global.MoKa.settings.render();
    }
    if (name === 'lots' && global.MoKa.lots) {
      global.MoKa.lots.render();
    }
    if (name === 'chat' && global.MoKa.chat) {
      global.MoKa.chat.render();
    }
    if (name !== 'chat' && global.MoKa.chat && global.MoKa.chat.leave) global.MoKa.chat.leave();
    if (name === 'dice' && global.MoKa.dice) {
      global.MoKa.dice.render();
    } else if (global.MoKa.dice && global.MoKa.dice.stop) {
      global.MoKa.dice.stop();          // 离开骰子页就停掉 3D 渲染循环（省电）
    }
    /* 周易页那颗骰子同理：离开周易就停掉它的 3D 渲染循环（不停会在隐藏画布上一直渲染→丢上下文） */
    if (name !== 'zhouyi' && global.MoKa.zhouyiDice && global.MoKa.zhouyiDice.stop) {
      global.MoKa.zhouyiDice.stop();
    }
    // 离开占卜桌时，把"往右拉这条线"的首次提示收掉并记为看过
    // （不记的话，每次切回占卜桌都会再弹一次，就成骚扰了）
    const etl = document.getElementById('et-layer');
    if (etl && !etl.classList.contains('is-hidden') &&
        global.MoKa.table && global.MoKa.table.closePullTut) {
      global.MoKa.table.closePullTut(true, true);   // 切场景：强制收（不受 5 秒锁影响）
    }
    // 神签 / 对话 / 周易 自己不带底部栏（周易桌照用户要求"没有底部栏"）
    if (name !== 'lots' && name !== 'chat' && name !== 'zhouyi') {
      const tb = document.getElementById('tabbar');
      if (tb) tb.style.display = '';
    } else {
      const tb = document.getElementById('tabbar');
      if (tb) tb.style.display = 'none';      // 神签 / 对话：底栏换成本场景自己的
    }
    // 牌库页有自己的页面栈(首页/牌组/编辑), 保持原状即可
  }

  /* ---------- 侧边抽屉（占卜桌左上角汉堡） ---------- */
  function openDrawer() {
    const d = document.getElementById('drawer'), m = document.getElementById('drawer-mask');
    if (!d || !m) return;
    m.classList.remove('is-hidden');
    d.classList.remove('is-hidden');
    void d.offsetWidth;              // 触发一次重排，滑入动画才会生效
    d.classList.add('is-open');
    d.setAttribute('aria-hidden', 'false');
  }
  function closeDrawer() {
    const d = document.getElementById('drawer'), m = document.getElementById('drawer-mask');
    if (!d || !m) return;
    d.classList.remove('is-open');
    d.classList.add('is-hidden');
    m.classList.add('is-hidden');
    d.setAttribute('aria-hidden', 'true');
  }

  /* ---------- 系统返回键总调度 ----------
   * 顺序：当前场景自己的页面栈 → 牌库/神签 → 回占卜桌 → false（原生才退出应用）
   * 返回 true 表示"我消化掉了这次返回"。 */
  function back() {
    const lots = global.MoKa.lots, lib = global.MoKa.library;
    if (currentScene === 'lots' && lots && lots.back && lots.back()) return true;
    if (currentScene === 'dice' && global.MoKa.dice && global.MoKa.dice.back && global.MoKa.dice.back()) return true;
    if (currentScene === 'zhouyi' && global.MoKa.zhouyi && global.MoKa.zhouyi.back && global.MoKa.zhouyi.back()) return true;
    if (currentScene === 'zhouyi' && global.MoKa.zhouyiTable && global.MoKa.zhouyiTable.back && global.MoKa.zhouyiTable.back()) return true;
    if (currentScene === 'library' && lib && lib.back && lib.back()) return true;
    if (currentScene === 'chat' && global.MoKa.chat && global.MoKa.chat.back && global.MoKa.chat.back()) return true;
    if (currentScene !== 'table') { gotoScene('table'); return true; }
    /* ★★ 2026-10-15：**主页返回防误触** —— 连按两次才退出。
       原来在占卜桌上、又没有任何浮层时，返回键直接落到原生的 finish()：
       手指从屏幕边缘顺手一滑 App 就没了，而桌面牌阵和各堆抽牌进度**只在内存里**
       （App 一退就清零，回来桌面全空、上一局抽过的牌还会重新抽到）。
       Android 上的通用做法：第一下只提示，窗口内再按一下才真退。
       注意这里必须 return true（"我消化掉了"）—— 交回 false 的话原生立刻就退了。 */
    const now = Date.now();
    if (now - lastBackAt < BACK_EXIT_MS) return false;   // 窗口内的第二下 → 放行，交给原生去 finish
    lastBackAt = now;
    if (global.MoKa.ui && global.MoKa.ui.toast) global.MoKa.ui.toast('再按一次返回退出');
    return true;                                          // 第一下：吃掉这次返回
  }

  /* ★ 2026-10-19 首屏守卫（配合 index.html 的 class="booting" 与 v3.css 的 html.booting）。
     用户报「先渲染上半屏，下半屏等一会才出来」：脚本还没执行完，浏览器就先把已经解析好的
     那半截画了，剩下的光栅 tile 要等主线程空闲才补上。这里不藏页面 —— 而是让页面在
     **透明状态下照常绘制**，等 init 跑完、DOM 稳定下来，再一次性亮出来。
     为什么是 opacity 而不是 visibility/display：见 v3.css §26 的注释（那两种都会在放行时
     重新产生绘制指令，等于没治）。
     ★ 牌堆栏预热：它正好在下半屏。默认那 4 副的缩略牌背是**内联 SVG**（backThumbInner），
       在 opacity:0 的 DOM 里会照常绘制，所以这一步对默认数据是空转；真正要它的是
       **用户自己放了牌背图**的牌组 —— 那时缩略图是 CSS background-image，光栅排在后面，
       不等它，放行后那几块还会慢慢补。300ms 上限，不会拖住启动。
     ★ 双 rAF：第一帧提交布局与合成，第二帧才真正亮，给光栅化留一帧余量。
     ★ 700ms 字体兜底：只在 init 跑完之后、等 `document.fonts.ready` 时计时（猫卡首屏其实一个
       woff2 都不请求，这条平时立刻返回）。**它不放行「没跑完的 init」**——那是 index.html
       里两级兜底（2s：脚本根本没启动 / 8s：init 挂起）和 init 异常分支的活儿。 */
  function prewarmStrip(done) {
    var fired = false;
    function fin() { if (fired) return; fired = true; done(); }
    var urls = [];
    try {
      var els = document.querySelectorAll('#pile-strip .ps-img');
      for (var i = 0; i < els.length; i++) {
        var bg = getComputedStyle(els[i]).backgroundImage || '';
        var m = bg.match(/url\(["']?(.*?)["']?\)/);
        if (m && m[1]) urls.push(m[1]);
      }
    } catch (e) {}
    if (!urls.length) { fin(); return; }
    var guard = setTimeout(fin, 300);
    var left = urls.length;
    function one() { if (fired) return; if (--left <= 0) { clearTimeout(guard); fin(); } }
    urls.forEach(function (u) {
      var im = new Image();
      im.onload = one;
      im.onerror = one;
      im.src = u;
    });
  }

  function bootReveal() {
    var html = document.documentElement, shown = false;
    function done() {
      if (shown) return;
      shown = true;
      html.classList.remove('booting');
      /* 启动时为了防深色主题闪白，往 html 上写过一次内联底色（见 index.html 头部）；
         到这里交给 CSS 管，清掉它，免得以后换主题时留一条压不掉的背景。 */
      try { html.style.backgroundColor = ''; } catch (e) {}
      /* ★ 2026-11-10 启动页：主界面这一帧已经画好，可以让 #splash 淡出了。
         顺序不能反 —— 先摘 .booting（底下亮出来），再收启动页；
         反了的话启动页淡到一半，底下还是透明的，会露白。
         具体等多久由 js/splash.js 自己算（最短 1.5s / 最长 3s）。 */
      try { if (global.MoKaSplash) global.MoKaSplash.hide(); } catch (e) {}
    }
    function reveal() { requestAnimationFrame(function () { requestAnimationFrame(done); }); }
    function start() {
      var t = setTimeout(reveal, 700);
      try {
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function () { clearTimeout(t); reveal(); },
                                    function () { clearTimeout(t); reveal(); });
        } else { clearTimeout(t); reveal(); }
      } catch (e) { clearTimeout(t); reveal(); }
    }
    prewarmStrip(start);
  }

  async function init() {
    /* ★ 告诉 index.html 那段 2s 硬兜底「init 已经开始跑了，放行交给 bootReveal」——
       否则设备慢的时候 2s 会先到，把一个还没建完牌堆栏的半成品亮出来。 */
    try { window.__bootArmed = true; } catch (e) {}
    // 底部导航
    document.querySelectorAll('.tabbar .tab').forEach(function (t) {
      t.addEventListener('click', function () { gotoScene(t.dataset.goto); });
    });
    const tb = document.getElementById('btn-theme');
    if (tb) tb.addEventListener('click', toggleTheme);
    // 抽屉
    const bd = document.getElementById('btn-drawer');
    if (bd) bd.addEventListener('click', openDrawer);
    const dm = document.getElementById('drawer-mask');
    if (dm) dm.addEventListener('click', closeDrawer);
    // 只有带 data-goto 的才算入口（底部的版本号那行不是入口，不绑定）
    document.querySelectorAll('.drawer-item[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () {
        closeDrawer();
        gotoScene(b.dataset.goto);
      });
    });
    /* ★ 2026-09-21：写盘失败的常驻提示条。
       数据层现在会把“这次到底存上没有”报出来（onPersistError）；只要报过，
       这条就一直挂着（一句 toast 两秒就没了，而“重启会回退”是必须让用户看见的），
       直到某一次真的存成功再收起来。 */
    (function () {
      var bar = document.getElementById('save-warn');
      var txt = document.getElementById('save-warn-txt');
      var cls = document.getElementById('save-warn-close');
      if (!bar || !global.MoKa.data || !global.MoKa.data.onPersistError) return;
      /* ★★ 2026-10-15 修（两条，都跟"静音"有关）：
         ① 数据层原来**只在失败时**通知，所以上面那个"看到成功就收黄条"的分支
            永远不可能执行 —— 黄条一旦出现就挂到用户手点为止。现在数据层每次落盘都通知，
            这条分支才真正活过来（挂久了人会脱敏，真警告也会被当成"又来了"）。
         ② `quiet` 原来是"这次会话再也不弹"：用户点过一次「知道了」，
            后面**每一次真实写失败**都被吞掉，直到重启 —— 而点「知道了」的本意
            只是"这条我看到了"。现在 quiet 绑定**失败签名**：只有同一类失败才静音，
            换成新类型（比如从"备份没更新"变成"整个没存上"）会重新弹。 */
      var quiet = false, quietSig = null, curSig = '';
      function sigOf(st) {
        return (st && st.metaOk === false ? 'm' : '')
             + (st && st.unresolvedImgs ? 'i' : '')
             + (st && st.bakOk === false ? 'b' : '');
      }
      global.MoKa.data.onPersistError(function (st) {
        if (st && st.ok && !st.unresolvedImgs && st.bakOk !== false) {
          bar.classList.add('is-hidden'); quiet = false; quietSig = null; return;
        }
        curSig = sigOf(st);
        if (quiet && curSig === quietSig) return;
        quiet = false; quietSig = null;
        if (txt) {
          txt.textContent = (st && st.unresolvedImgs)
            ? ('有 ' + st.unresolvedImgs + ' 张图片没存下来，这次改动重启可能回退')
            : (!st || st.metaOk === false)
              ? '这次改动没存到手机上（存储写入失败），请导出备份后重试'
              : '备份没能更新（可能是空间不足），图片恢复能力变弱了';
        }
        bar.classList.remove('is-hidden');
      });
      if (cls) cls.addEventListener('click', function () {
        quiet = true; quietSig = curSig;      // 只对"当下这一类失败"静音，换了类型还会再弹
        bar.classList.add('is-hidden');
      });
    })();
    // 先装载数据(含 IndexedDB 图片), 再初始化界面, 避免图片未就绪
    if (global.MoKa.data && global.MoKa.data.initImages) {
      try { await global.MoKa.data.initImages(); } catch (e) { console.error(e); }
    }
    // 首屏再问一次状态：冷启动时如果上次就没存上，用户一进来就该看到
    try {
      /* ★ 2026-10-15：读**落盘过**的状态（storedSaveStatus），
         因为 lastSaveStatus 是模块级变量、冷启动恒为初值 {ok:true}，原来这句永远空转。
         判据和上面订阅回调**保持一模一样的三条件**：原来只判 !ok，
         "图片没存下"和"备份没更新"这两种失败冷启动时压根不提示 ——
         用户重启后看到图丢了，界面上却一个字都没有。 */
      var D0 = global.MoKa.data;
      var st0 = (D0.storedSaveStatus && D0.storedSaveStatus()) ||
                (D0.lastSaveStatus && D0.lastSaveStatus());
      var bar0 = document.getElementById('save-warn');
      if (bar0 && st0 && !(st0.ok && !st0.unresolvedImgs && st0.bakOk !== false)) {
        bar0.classList.remove('is-hidden');
        var t0 = document.getElementById('save-warn-txt');
        if (t0) {
          t0.textContent = st0.unresolvedImgs
            ? ('有 ' + st0.unresolvedImgs + ' 张图片没存下来，这次改动重启可能回退')
            : (st0.metaOk === false)
              ? '上次的改动没存到手机上（存储写入失败），请导出备份后重试'
              : '备份没能更新（可能是空间不足），图片恢复能力变弱了';
        }
      }
    } catch (e) {}
    // 模块初始化
    global.MoKa.table.init();
    global.MoKa.library.init();
    global.MoKa.editor.init();
    // 设置：先把用户设的牌面尺寸应用到 :root（必须在 table 之后，table 读的就是这个变量）
    if (global.MoKa.settings) global.MoKa.settings.init();
    /* ★ 2026-10-12：抽屉底部的版本号从这里灌 —— **别再在 index.html 里写死**。
       历史上那里写的是 `猫卡 v1.0.8`，版本名升到 2.1.0、构建滚到 239 了它还躺着不动
       （用户：「这个版本号之前一直被遗忘」）。现在真源只有 settings.js 一处常量。 */
    (function () {
      var el = document.getElementById('drawer-ver');
      if (el && global.MoKa.settings) {
        el.textContent = '猫卡 ' + global.MoKa.settings.VERSION + ' · ' + global.MoKa.settings.BUILD;
      }
    })();
    if (global.MoKa.lots) global.MoKa.lots.init();
    if (global.MoKa.dice) global.MoKa.dice.init();
    if (global.MoKa.zhouyiTable) global.MoKa.zhouyiTable.init();   // 周易桌（占卜桌的独立拷贝）
    if (global.MoKa.zhouyi) global.MoKa.zhouyi.init();             // 周易页：骰子面板 + 易经查看器

    if (global.MoKa.chat) global.MoKa.chat.init();
    // 默认进入占卜桌
    gotoScene('table');
    /* ★ 2026-10-19：init 全部跑完（DOM 已经是最终形态）才放行首屏。
       放在这里而不是更早：牌堆栏 / 底部导航都是这一路建出来的，
       早放行等于放一个半成品出来，下半屏照样会长出来。 */
    bootReveal();
  }

  /* ★ 2026-10-19：init 是 async，任何一步抛错都会让后面的 bootReveal 永不执行 →
     .booting 摘不掉 = 永远白屏。所以统一从这里兜住：失败也放行（bootReveal 是幂等的）。 */
  function boot() {
    var p;
    try { p = init(); } catch (e) { try { console.error(e); } catch (e2) {} bootReveal(); return; }
    if (p && typeof p.catch === 'function') {
      p.catch(function (e) { try { console.error(e); } catch (e2) {} bootReveal(); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.MoKa = global.MoKa || {};
  global.MoKa.app = { gotoScene, init, openDrawer, closeDrawer, back, toggleTheme };
})(window);
