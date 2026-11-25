/* ============================================================
 * 猫卡 · 周易页 (scenes/zhouyi.js)
 * ------------------------------------------------------------
 * 这一支只做三件事，桌面本身由 scenes/zhouyi-table.js（占卜桌的 1:1 独立拷贝）负责：
 *   ① 「骰子」→ 拉起一颗小巧的六面骰（scenes/zhouyi-dice.js），掷完把点数交给这里
 *   ② 「查易经」→ 打开查看器：64 卦目录 + 全文搜索 + 单卦详情（卦辞/六爻/考释）
 *   ③ 把"掷到第几爻"落到对应的爻辞上并高亮
 *
 * 隔离约定（用户的红线：不许影响主页布局）：
 *   · 本文件只碰 #scene-zhouyi 内部的元素，一个全局 id 都不抓
 *   · 易经数据是**按需加载**的（builtin-zhouyi.js 约 180KB，绝不进开机路径）
 *   · 骰子那份拷贝不读不写用户的 moka.dice
 * ============================================================ */
(function (global) {
  'use strict';

  var POS = ['初', '二', '三', '四', '五', '上'];      // 骰 1~6 → 爻位

  var st = { yao: 0, view: 'list', cur: -1, q: '' };
  var el = {};                                         // 本页内部的元素
  var dataState = 'idle', dataWait = [];

  function $(id) { return document.getElementById(id); }
  /* 头部的图标按钮（用户第 5 条：老的文字按钮「‹ 目录 / ✕ 收起」太难看） */
  function ICON_BTN(act, path, label) {
    return '<button class="zyb-ico" type="button" data-act="' + act + '" aria-label="' + label + '" title="' + label + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="' + path + '"/></svg></button>';
  }
  function esc(s) { return global.MoKa.ui.esc(s == null ? '' : String(s)); }

  /* ---------- 数据：按需注入，绝不进开机路径 ---------- */
  function HZ() {
    var d = global.MoKaBuiltinZhouyi;
    return (d && d.hexagrams) || [];
  }
  function ensureData(cb) {
    if (HZ().length) { dataState = 'ok'; cb(true); return; }
    dataWait.push(cb);
    if (dataState === 'loading') return;
    dataState = 'loading';
    var flush = function (ok) {
      dataState = ok ? 'ok' : 'fail';
      var q = dataWait; dataWait = [];
      q.forEach(function (f) { try { f(ok); } catch (e) {} });
    };
    var sc = document.createElement('script');
    sc.src = 'js/builtin-zhouyi.js';
    sc.onload = function () { flush(HZ().length > 0); };
    sc.onerror = function () { flush(false); };
    document.head.appendChild(sc);
  }

  /* ---------- 易经牌组：拿卦画(art) 与"刚抽到哪一卦" ---------- */
  /* ⚠ 这两个都要缓存：`listDecks(true)` 每次都会读盘+克隆整份牌库，
     而目录有 64 行、每行都要一次牌组和一次卦画 —— 不缓存的话点「目录」就是 64 次读盘（用户报"较大延迟"）。 */
  var _deck = null, _art = [];
  function deck64() {
    if (_deck === null) {
      _deck = global.MoKa.data.listDecks(true).filter(function (d) { return d.builtinKey === 'zy64'; })[0] || false;
    }
    return _deck || null;
  }
  function artSVG(i) {
    if (!_art.length) {                      // 一次性把 64 张卦画的 <svg> 串做好
      var dk = deck64();
      _art = [''];
      if (dk) for (var k = 0; k < dk.cards.length; k++) {
        var a = dk.cards[k] && dk.cards[k].art;
        _art.push(a ? ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
                       'stroke-linecap="round">' + a + '</svg>') : '');
      }
    }
    return _art[i + 1] || '';
  }
  /* 周易桌上最后抽到的那张 → 卦下标（牌组与材料都是通行本卦序，按位对应） */
  function drawnIdx() {
    try {
      var T = global.MoKa.zhouyiTable, dk = deck64();
      if (!T || !T.snapshot_ || !dk) return -1;
      var s = T.snapshot_();
      if (!s || !s.piles) return -1;
      var pile = s.piles.filter(function (p) { return p.deckId === dk.id; })[0];
      if (!pile || !pile.drawnIds || !pile.drawnIds.length) return -1;
      var id = pile.drawnIds[pile.drawnIds.length - 1], i = -1;
      dk.cards.forEach(function (c, k) { if (c.id === id) i = k; });
      return (i >= 0 && i < HZ().length) ? i : -1;
    } catch (e) { return -1; }
  }

  /* ---------- 查看器：目录 / 搜索 ---------- */
  function hit(h, s) {
    if (!s) return true;
    if ([h.name, h.py, h.alias, h.gua, h.guaTr].join('\n').indexOf(s) >= 0) return true;
    for (var i = 0; i < h.yaos.length; i++) {
      var y = h.yaos[i];
      if ((y.label + y.text + y.tr + (y.note || '')).indexOf(s) >= 0) return true;
    }
    return false;
  }
  function listHTML() {
    var all = HZ(), s = st.q.trim(), show = [], d = drawnIdx();
    for (var i = 0; i < all.length; i++) if (hit(all[i], s)) show.push(i);
    return '<div class="zyb-head">' +
        ICON_BTN('close', 'M6 9l6 6 6-6', '收起') +
        '<div class="zyb-title">易经<span>' + all.length + ' 卦 · 目录</span></div></div>' +
      '<div class="zyb-search">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.4"/><path d="M16 16l4.2 4.2"/></svg>' +
        '<input id="zy-q" type="search" autocomplete="off" placeholder="搜卦名 / 拼音 / 卦辞 / 爻辞" value="' + esc(st.q) + '">' +
        (st.q ? '<button type="button" class="zyb-clr" data-act="clr">✕</button>' : '') +
      '</div>' +
      '<div class="zyb-scroll">' +
        (s ? '<div class="zyb-cnt">找到 ' + show.length + ' 卦</div>' : '') +
        (show.length ? show.map(function (i) {
          var h = all[i], isD = (i === d);
          return '<button class="zyb-row' + (isD ? ' is-draw' : '') + '" type="button" data-i="' + i + '">' +
            '<span class="zyb-art">' + artSVG(i) + '</span>' +
            '<span class="zyb-mid"><span class="zyb-nm">' + esc(h.name) +
              '<em>' + esc(h.py || '') + '</em>' +
              (isD ? '<i class="zyb-badge">你抽的</i>' : '') +
              (isD && st.yao ? '<i class="zyb-badge is-yao">骰 ' + st.yao + '</i>' : '') +
            '</span><span class="zyb-gua">' + esc((h.guaTr || h.gua || '').slice(0, 34)) + '</span></span>' +
            '<span class="zyb-no">' + esc(h.no) + '</span></button>';
        }).join('') : '<div class="zyb-none">没找到。换个词试试 —— 卦名、拼音、卦辞、爻辞原文与白话都能搜。</div>') +
      '</div>';
  }
  function yaoHTML(y, isHit) {
    return '<div class="zyb-yao' + (isHit ? ' is-hit' : '') + '">' +
      '<div class="zyb-yao-lb"><b>' + esc(y.label) + '</b>' +
        (isHit ? '<i class="zyb-badge is-yao">骰 ' + st.yao + ' · ' + (st.yao === 1 ? '初爻' : POS[st.yao - 1] + '爻') + '</i>' : '') + '</div>' +
      '<div class="zyb-yao-tx">' + esc(y.text) + '</div>' +
      (y.tr ? '<div class="zyb-yao-tr">' + esc(y.tr) + '</div>' : '') +
      (y.note ? '<div class="zyb-yao-nt">' + esc(y.note) + '</div>' : '') + '</div>';
  }
  function oneHTML() {
    var all = HZ(), h = all[st.cur];
    if (!h) return listHTML();
    var six = h.yaos.filter(function (y) { return !y.special; });
    var sp = h.yaos.filter(function (y) { return y.special; });
    return '<div class="zyb-head">' +
        ICON_BTN('list', 'M15 6l-6 6 6 6', '返回目录') +
        '<div class="zyb-title">' + esc(h.name) + '<span>第 ' + esc(h.no) + ' 卦 · ' + esc(h.py || '') + '</span></div></div>' +
      '<div class="zyb-scroll" id="zy-one">' +
        '<div class="zyb-hero">' +
          '<div class="zyb-hero-no">第 ' + esc(h.no) + ' 卦</div>' +
          '<div class="zyb-art is-big">' + artSVG(st.cur) + '</div>' +
          '<div><div class="zyb-hero-nm">' + esc(h.name) +
            '<em>' + esc(h.py || '') + (h.alias ? '（' + esc(h.alias) + '）' : '') + '</em></div>' +
            (st.yao ? '<div class="zyb-hero-y">骰子 ' + st.yao + ' → ' +
                        (st.yao === 1 ? '初爻' : POS[st.yao - 1] + '爻') + '　' +
                        esc((h.yaos[st.yao - 1] || {}).label || '') + '</div>'
                    : '<div class="zyb-hero-y is-dim">掷骰子后，对应那一爻会亮起来</div>') +
          '</div></div>' +
        '<div class="zyb-sec">卦辞</div>' +
        '<div class="zyb-block"><div class="zyb-gua-tx">' + esc(h.gua) + '</div>' +
          (h.guaTr ? '<div class="zyb-gua-tr">' + esc(h.guaTr) + '</div>' : '') +
          (h.guaNotes || []).map(function (n) { return '<div class="zyb-gua-nt">' + esc(n) + '</div>'; }).join('') +
        '</div>' +
        '<div class="zyb-sec">六爻</div>' +
        six.map(function (y, i) { return yaoHTML(y, !!(st.yao && i === st.yao - 1)); }).join('') +
        (sp.length ? '<div class="zyb-sec">用' + (h.name === '乾' ? '九' : '六') +
            '　<span style="font-weight:400;letter-spacing:0;opacity:.8">六爻皆动时才用</span></div>' +
            sp.map(function (y) { return yaoHTML(y, false); }).join('') : '') +
        (h.gloss ? '<div class="zyb-sec">卦名考释</div><div class="zyb-note">' + esc(h.gloss) + '</div>' : '') +
        (h.insp ? '<div class="zyb-sec">这一卦的钥匙</div><div class="zyb-note is-insp">' + esc(h.insp) + '</div>' : '') +
      '</div>';
  }
  function renderBook() {
    if (!el.book) return;
    if (!HZ().length) {
      el.book.innerHTML = '<div class="zyb-head"><button class="btn-mini" type="button" data-act="close">‹ 收起</button>' +
        '<div class="lib-title">易经</div><span class="btn-mini" style="border:0"></span></div>' +
        '<div class="zyb-none">' + (dataState === 'fail'
          ? '易经数据没读进来（builtin-zhouyi.js 加载失败）。'
          : '正在翻开易经…') + '</div>';
      if (dataState === 'idle' || dataState === 'loading') {
        ensureData(function () { syncToDrawn(); renderBook(); });   // 数据到手：先同步"刚抽的那一卦"
      }
      return;
    }
    el.book.innerHTML = (st.view === 'one' && st.cur >= 0) ? oneHTML() : listHTML();
    if (st.view === 'one' && st.yao) {
      // 骰到的那一爻滚到眼前（滚动容器是 .zyb-scroll，不是页面）
      var sc = el.book.querySelector('.zyb-scroll'), hitEl = el.book.querySelector('.zyb-yao.is-hit');
      if (sc && hitEl) {
        var d = hitEl.getBoundingClientRect().top - sc.getBoundingClientRect().top;
        sc.scrollTop += d - sc.clientHeight * 0.34;
      }
    }
    if (st.view !== 'one') {
      var inp = el.book.querySelector('#zy-q');
      if (inp && st.q) { inp.focus(); inp.setSelectionRange(st.q.length, st.q.length); }
    }
  }

  /* ---------- 对外 ---------- */
  /* 骰子那边出错时，把消息写进骰子下方那行小字 —— toast 两秒就没了，
     而这条需要用户截图给我（真机才复现的问题）。 */
  /* ★ 错误写进**独立的那一行**（#zy-dice-err）。
     ⚠ 别再写 `#zy-dice-cap` —— 掷完时 `setYao()` 会无条件重写那行小字，
       于是刚写进去的报错**立刻被点数覆盖**，用户永远看不到（用户报"盒子里没有那条报错"，就是这么来的）。 */
  function diceError(msg, stack) {
    var box = $('zy-dice-err');
    if (!box) return;
    box.classList.remove('is-hidden');
    box.innerHTML = '⚠ ' + esc(String(msg)) +
      (stack ? '<div style="margin-top:3px;opacity:.75">' + esc(String(stack)) + '</div>' : '');
  }
  function clearDiceError() {
    var box = $('zy-dice-err');
    if (box) { box.classList.add('is-hidden'); box.innerHTML = ''; }
  }
  function setYao(n) {
    st.yao = Math.max(1, Math.min(6, +n || 0));
    var hint = $('zy-dice-hint');
    if (hint) hint.textContent = (st.yao === 1 ? '初爻' : POS[st.yao - 1] + '爻');
    var cap = $('zy-dice-cap');
    if (cap) {
      cap.classList.remove('is-idle');
      /* 用户两次精简后的定稿：**卡片上只显示爻**（「五爻」）；没掷过时显示「点击投掷」。
         其它提示（重掷 / 3D / 平面兜底）一概不写 —— 出错有独立的 #zy-dice-err 那一行兜着。 */
      var is3D = false;
      try {
        var R = global.MoKa.zhouyiDice && global.MoKa.zhouyiDice._dbg ? global.MoKa.zhouyiDice._dbg() : null;
        is3D = !!R && !document.querySelector('#zy-dice-page .dz-2d');
      } catch (e) {}
      cap.innerHTML = '<b>' + (st.yao === 1 ? '初爻' : POS[st.yao - 1] + '爻') + '</b>';
      if (is3D) clearDiceError();          // 3D 起来了就把旧错误收掉，免得误导
    }
    if (st.view === 'one') renderBook();
  }
  function clearYao() {
    st.yao = 0;
    st.view = 'list';
    var hint = $('zy-dice-hint');
    if (hint) hint.textContent = '六面骰';
    var cap = $('zy-dice-cap');
    if (cap) { cap.classList.add('is-idle'); cap.textContent = '点击投掷'; }
    clearDiceError();
  }
  /* 把"周易桌上刚抽到的那一卦"同步成当前查看对象。
     ⚠ 易经数据是**按需加载**的（builtin-zhouyi.js 约 160KB，绝不进开机路径），
       所以第一次打开查看器时 HZ() 还是空的、drawnIdx() 必然返回 -1 ——
       必须等数据到位后再同步一次，否则永远跳不到刚抽的那一卦（实测踩过）。 */
  function syncToDrawn() {
    var i = drawnIdx();
    if (i >= 0) { st.cur = i; st.view = 'one'; return true; }
    if (st.cur < 0) st.view = 'list';
    return false;
  }
  /* ★ 骰子的交互按用户第 3 条改：
       "点一下按钮 → 骰子直接出现在桌面上转动/停下，桌面上只能存在一颗骰子"。
     所以它**不是弹层**（没有蒙层、没有标题条、没有「掷」按钮）：
       · 点顶栏「骰子」= 出现（并立刻转一次）/ 再点 = 收起
       · 点骰子本身 = 重掷（同一颗，永远只有一颗）
       ⚠ 别写成"舞台存在才渲染"—— 舞台正是渲染之后才产生的（鸡生蛋）。 */
  function rollDice() {
    /* 出错别静默：真机上的 3D 问题必须留下可查的消息（不然就是一条没头没尾的 Script error.） */
    try { if (global.MoKa.zhouyiDice) global.MoKa.zhouyiDice.roll(); }
    catch (e) { diceError('掷骰出错：' + ((e && e.message) || e), e && e.stack);
                try { global.MoKa.ui.toast('周易骰子·掷骰出错'); } catch (e2) {} }
  }
  function openDice() {
    if (!el.diceWrap || !global.MoKa.zhouyiDice) return;
    /* 位置：贴左，落在**顶栏白条下方** —— 顶栏高度按实测算（真机上它可能因为状态栏安全区/字号更高，
       写死 47px 会钻到顶栏底下，用户报过）。 */
    try {
      var hd = document.querySelector('#scene-zhouyi header');
      var hh = hd ? hd.getBoundingClientRect().height : 47;
      el.diceWrap.style.top = Math.round(hh + 12) + 'px';
    } catch (e) {}
    el.diceWrap.classList.remove('is-hidden');
    setTimeout(function () {
      try { global.MoKa.zhouyiDice.render(); }
      catch (e) { diceError('渲染出错：' + ((e && e.message) || e), e && e.stack);
                  try { global.MoKa.ui.toast('周易骰子·渲染出错'); } catch (e2) {} }
      rollDice();                      // 出现即转动
    }, 40);
  }
  function hideDice() {
    if (el.diceWrap) el.diceWrap.classList.add('is-hidden');
    /* ★ 一定要停渲染循环：App 自带的骰子离开场景时会 stop()，我这份原来没有 ——
       于是关掉盒子后还在往一个 display:none（0 尺寸）的画布一直渲染，
       在 WebView 里很容易把 WebGL 上下文搞丢（表现就是"莫名其妙变平面骰"）。 */
    try { if (global.MoKa.zhouyiDice && global.MoKa.zhouyiDice.stop) global.MoKa.zhouyiDice.stop(); } catch (e) {}
  }
  function toggleDice() {
    if (!el.diceWrap) return;
    if (el.diceWrap.classList.contains('is-hidden')) openDice(); else hideDice();
  }
  /* ★ 2026-11-17（用户：「查看易经 选牌台按钮 悬浮其上」）：
     书面板是 .zy-panel(z 41) + .zy-mask(z 40)，而右下那颗选牌台按钮 .tray-btn 在
     main.css:817 是 z-index:80 —— 面板一开，按钮就端端正正压在卦辞/爻辞正文上（实测 393×852：
     按钮 327..379 × 655..707，落进面板 182..811 的正文区，命中测试点的就是它自己）。
     做法：**只在面板打开期间**给 #zy-btn-tray 挂 .is-hidden（main.css:846 早就有这条
     display:none），既不碰 .tray-btn 的尺寸/颜色/阴影，也不会连累占卜桌的 #btn-tray。
     口子只留这一个 helper，open/close 各调一次，别在七八处复制粘贴。
     ★ 2026-11-17（t19）：四步引导（.zy-guide z=60）也在 z=80 的按钮**下面**，
       首次进入第一眼的蒙层上浮着一颗亮按钮太扎眼 —— 所以「被盖住」的判据扩成两条：
       书面板开着 **或** 引导亮着，都把 #zy-btn-tray 收起来；两者都收才恢复。
       仍然只有这一个 helper，引导侧只在 gzShow/gzClose 各调一次。 */
  function syncTrayBtn() {
    var b = $('zy-btn-tray');
    if (!b) return;
    var bookOpen = !!(el.bookWrap && !el.bookWrap.classList.contains('is-hidden'));
    var guideOpen = gzOpen();
    b.classList.toggle('is-hidden', bookOpen || guideOpen);
  }
  function openBook() {
    var show = function () {
      hideDice();                                  // 桌面上的骰子先收起来，别和查看器叠在一起
      el.bookWrap.classList.remove('is-hidden');
      if (el.mask) el.mask.classList.remove('is-hidden');
      renderBook();
      syncTrayBtn();                               // ★ 书面板盖住了选牌台按钮 → 收起它
    };
    if (!HZ().length) { show(); return; }        // renderBook 会按需取数，取回来再同步
    syncToDrawn();
    show();
  }
  function closeBook() {
    if (el.bookWrap) el.bookWrap.classList.add('is-hidden');
    if (el.mask) el.mask.classList.add('is-hidden');
    syncTrayBtn();                                 // ★ 面板收起 → 按钮回来
  }
  function onClick(e) {
    var t = e.target, act = t.closest && t.closest('[data-act]');
    if (act) {
      var a = act.dataset.act;
      if (a === 'close') { closeBook(); return; }
      if (a === 'list') { st.view = 'list'; renderBook(); return; }
      if (a === 'clr') { st.q = ''; renderBook(); return; }
      return;
    }
    var row = t.closest && t.closest('.zyb-row');
    if (row) { st.cur = +row.dataset.i; st.view = 'one'; renderBook(); return; }
  }
  function onInput(e) {
    if (e.target && e.target.id === 'zy-q') { st.q = e.target.value || ''; renderBook(); }
  }
  /* ============================================================
   * 首次进入 · 四步引导（2026-11-17，用户拍板的极简版）
   * ------------------------------------------------------------
   * 1 默想问题（无高亮）→ 2 点牌堆抽卦牌 → 3 点骰子取动爻 → 4 查看易经。
   * 规矩：
   *   · 一个蒙层 + 高亮目标上 `box-shadow: 0 0 0 9999px` 的"亮洞" + 一张文案卡；
   *     **不做** pointer-events 穿透、**不做**"点目标即学会"（用户嫌复杂）。
   *   · 只弹一次：localStorage 'moka.tut.zhouyi.v1'（只有「跳过」/走完最后一步/系统返回才置位）。
   *   · 不再和「往右拉这条线」打交道：用户 2026-11-17 定了"周易页不弹那条侧边栏引导"
   *     （zhouyi-table.js 的 openTable 已停用它）。之前的"串行/再放出来"逻辑一并删掉，
   *     不留双保险 —— 本页现在只有这一套引导。
   *   · 引导层挂在 #scene-zhouyi 里面 → 切走场景自动跟着隐藏，不会浮到别的页。
   * ============================================================ */
  var GUIDE_KEY = 'moka.tut.zhouyi.v1';
  /* ★ 2026-11-17：用户「存在废话，比如那一摞亮着」——
     正文每步压到一句话、≤18 字，只留「点哪里 + 会发生什么」，删掉形容和比喻。
     骨架不动：默想问题 → 点牌堆抽卦牌 → 点骰子取动爻 → 查看易经。 */
  var GZ_STEPS = [
    { sel: null, title: '先默想你要问的问题', desc: '想好后点「开始」继续。', ok: '开始' },
    { sel: '#zy-pile-strip', avoid: '#zy-btn-tray', title: '点牌堆，抽卦牌', desc: '点牌堆，抽一张卦牌到桌面。', ok: '下一步' },
    { sel: '#zy-btn-dice', title: '点骰子，取动爻', desc: '点骰子，掷出一爻定动爻。', ok: '下一步' },
    { sel: '#zy-btn-book', title: '查看易经', desc: '点「易经」，看六十四卦的卦辞爻辞。', ok: '开始用' }
  ];
  var gzStep = -1, gzTimer = null, gzHooked = false;

  function guideSeen() { try { return localStorage.getItem(GUIDE_KEY) === '1'; } catch (e) { return true; } }
  function markGuideSeen() { try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) {} }
  function gzOpen() { return !!el.guide && !el.guide.classList.contains('is-hidden'); }

  /* 卡片走位：目标在上半屏 → 卡片贴它下面；否则贴它上面（贴边自动翻）。全用现算的 rect，不写死 px。 */
  function gzPlace() {
    var layer = el.guide, hole = $('zy-guide-hole'), card = $('zy-guide-card'), scene = $('scene-zhouyi');
    if (!layer || !hole || !card || !scene) return;
    var st = GZ_STEPS[gzStep];
    var t = (st && st.sel) ? document.querySelector(st.sel) : null;
    var sr = scene.getBoundingClientRect();
    var r = t ? t.getBoundingClientRect() : null;
    /* 第 1 步（无目标）/ 目标还没渲染出来：居中一张小卡，蒙层自己负责压暗 */
    if (!r || (!r.width && !r.height)) {
      layer.classList.remove('has-hole');
      hole.style.borderRadius = '';      // 清掉上一步的内联圆角，别带进下次无目标的居中卡
      card.classList.add('is-center');
      card.style.left = ''; card.style.right = ''; card.style.top = ''; card.style.bottom = '';
      return;
    }
    /* ★ 2026-11-17：亮洞贴目标本身 —— 原来向外扩 6px，目标 44px、洞 56px，
       就成了「目标小小一颗、亮洞一大片」。现在四周向内收 3px（底边贴屏的目标例外，见下），
       圆角取目标自身的圆角再减掉这 3px（同心），洞的边就正好压在目标自己的边上。 */
    var inset = 3;
    var rad = 0;
    try {
      var tcs = window.getComputedStyle(t);
      var rv = tcs.borderTopLeftRadius || '0px';
      rad = parseFloat(rv);
      if (!isFinite(rad)) rad = 0;
      if (rv.indexOf('%') >= 0) rad = Math.min(r.width, r.height) * rad / 100;   // 百分比圆角
    } catch (e) { rad = 0; }
    var maxRad = Math.max(0, Math.min(r.width, r.height) / 2 - inset);
    rad = Math.max(0, Math.min(rad - inset, maxRad));
    var hLeft = r.left - sr.left + inset;
    var hTop = r.top - sr.top + inset;
    var hRight = r.right - sr.left - inset;
    var hBottom = r.bottom - sr.top - inset;
    /* 底边贴着屏幕的目标（牌堆条）：底边不再内缩。
       否则亮洞下方会多出一条 3px 的暗边 —— 又成了「屏幕最下方那道阴影」。
       牌堆条下面的白底一直铺到屏底，把洞放到底才是贴合它真正露出来的形状。 */
    if (sr.bottom - r.bottom <= 4) hBottom = sr.height;
    hole.style.left = hLeft + 'px';
    hole.style.top = hTop + 'px';
    hole.style.width = Math.max(2, hRight - hLeft) + 'px';
    hole.style.height = Math.max(2, hBottom - hTop) + 'px';
    hole.style.borderRadius = rad + 'px';
    layer.classList.add('has-hole');
    card.classList.remove('is-center');
    card.style.left = '16px'; card.style.right = '16px';
    if ((r.top - sr.top) < sr.height * 0.5) {          // 目标在上半屏 → 卡片放下面
      card.style.top = (r.bottom - sr.top + 14) + 'px'; card.style.bottom = 'auto';
    } else {                                            // 目标在下半屏（牌堆条）→ 卡片放上面
      /* avoid：右下角「选牌台」那颗浮动按钮在牌堆条上方 —— 卡片落在它上面，别压着它只露半颗 */
      var edge = r.top - sr.top;
      var av = st.avoid ? document.querySelector(st.avoid) : null;
      if (av) { var ar = av.getBoundingClientRect(); if (ar.height) edge = Math.min(edge, ar.top - sr.top); }
      card.style.bottom = (sr.height - edge + 14) + 'px'; card.style.top = 'auto';
    }
  }
  function gzRender() {
    var st = GZ_STEPS[gzStep];
    if (!st || !el.guide) return;
    $('zy-guide-step').textContent = '第 ' + (gzStep + 1) + ' 步 / 共 ' + GZ_STEPS.length + ' 步';
    $('zy-guide-title').textContent = st.title;
    $('zy-guide-desc').textContent = st.desc;
    $('zy-guide-ok').textContent = st.ok;
    gzPlace();
  }
  function gzShow(step) {
    if (!el.guide) return;
    gzStep = step;
    el.guide.classList.remove('is-hidden');
    el.guide.setAttribute('aria-hidden', 'false');
    gzRender();
    syncTrayBtn();          // ★ 2026-11-17（t19）：引导亮着 → 选牌台按钮收起（和书面板同一口子）
  }
  function gzClose(mark) {
    if (!gzOpen()) return;
    gzStep = -1;
    el.guide.classList.add('is-hidden');
    el.guide.setAttribute('aria-hidden', 'true');
    el.guide.classList.remove('has-hole');
    if (mark) markGuideSeen();
    syncTrayBtn();          // ★ 引导收起 → 按钮回来（书面板还开着的话由 helper 判据留在隐藏）
  }
  function gzNext() {
    if (gzStep >= GZ_STEPS.length - 1) { gzClose(true); return; }   // 走完第 4 步 = 看过了
    gzShow(gzStep + 1);
  }
  function gzOnEnter() {
    if (guideSeen()) return;
    if (gzTimer) clearTimeout(gzTimer);
    /* 本页只有这一套引导（「往右拉」已按用户要求停用），不和其他提示抢时序。
       等桌面落定再弹（一进场景就糊上来太唐突），也别和开场的场景动画抢 */
    gzTimer = setTimeout(function () {
      gzTimer = null;
      var scene = $('scene-zhouyi');
      if (!scene || !scene.classList.contains('is-active')) return;   // 人已经走了，下次再讲
      if (el.bookWrap && !el.bookWrap.classList.contains('is-hidden')) return;  // 有弹层：别糊上去
      gzShow(0);
    }, 900);
  }
  /* openTable 由 app.js 在切到周易页时调用（zhouyi-table.js 负责真正铺桌）——
     这里包一层拿"进入了本页"这个时机，免得改 app.js / zhouyi-table.js。 */
  function hookEnter() {
    var T = global.MoKa.zhouyiTable;
    if (gzHooked || !T || !T.openTable) return;
    var orig = T.openTable;
    T.openTable = function () {
      var ret = orig.apply(this, arguments);
      try { gzOnEnter(); } catch (e) {}
      return ret;
    };
    gzHooked = true;
  }

  function init() {
    el.mask = $('zy-mask');
    el.diceWrap = $('zy-dice-panel');
    el.bookWrap = $('zy-book-panel');
    el.book = $('zy-book-body');
    if (!el.diceWrap) return;

    // 顶栏「骰子」：出现 / 收起（出现即转动）
    var dbtn = $('zy-btn-dice');
    if (dbtn) dbtn.addEventListener('click', toggleDice);
    // 点骰子本身 = 重掷（3D 与 2D 兜底两条路都照顾到）
    if (el.diceWrap) el.diceWrap.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.zyb-ico')) return;
      rollDice();
    });
    // 顶栏「查易经」→ 查看器
    var bbtn = $('zy-btn-book');
    if (bbtn) bbtn.addEventListener('click', openBook);
    if (el.mask) el.mask.addEventListener('click', closeBook);
    if (el.bookWrap) {
      el.bookWrap.addEventListener('click', onClick);
      el.bookWrap.addEventListener('input', onInput);
    }
    if (global.MoKa.zhouyiDice) global.MoKa.zhouyiDice.init();

    // 拷贝进来的顶栏两颗：汉堡打开 App 抽屉，主题按钮照旧切换全局主题
    /* 左上角那颗现在是**返回键**（用户要求，和其他界面一致）：走过去 → 回占卜桌。
       `theme` 那颗在本页已被删除，这里保留判断只是防御。 */
    var mb = $('zy-btn-drawer'), tb = $('zy-btn-theme');
    if (mb) mb.addEventListener('click', function () {
      if (global.MoKa.app && global.MoKa.app.back) global.MoKa.app.back();
      else if (global.MoKa.app && global.MoKa.app.gotoScene) global.MoKa.app.gotoScene('table');
    });
    if (tb && global.MoKa.app && global.MoKa.app.toggleTheme) tb.addEventListener('click', global.MoKa.app.toggleTheme);

    /* 四步引导：节点 + 两个按钮；位置在 resize 时重算（转屏/键盘会改几何） */
    el.guide = $('zy-guide');
    var gzOk = $('zy-guide-ok'), gzSkip = $('zy-guide-skip');
    if (gzOk) gzOk.addEventListener('click', gzNext);
    if (gzSkip) gzSkip.addEventListener('click', function () { gzClose(true); });
    window.addEventListener('resize', function () { if (gzOpen()) gzPlace(); });
    hookEnter();

    clearYao();
    syncTrayBtn();          // ★ 进来时先归一态：面板没开就保证按钮在（别带着上次的隐藏类）
  }
  function back() {                                  // 系统返回：先收层，再交回 app.js
    if (gzOpen()) { gzClose(true); return true; }    // 引导亮着：返回键 = 跳过（和「跳过」同一语义）
    if (el.bookWrap && !el.bookWrap.classList.contains('is-hidden')) { closeBook(); return true; }
    if (el.diceWrap && !el.diceWrap.classList.contains('is-hidden')) { hideDice(); return true; }
    return false;
  }

  global.MoKa = global.MoKa || {};
  global.MoKa.zhouyi = {
    init: init, back: back, setYao: setYao, hideDice: hideDice, clearYao: clearYao, openBook: openBook, diceError: diceError, clearDiceError: clearDiceError,
    _state: function () { return { yao: st.yao, view: st.view, cur: st.cur, q: st.q, drawn: drawnIdx() }; }
  };
})(window);
