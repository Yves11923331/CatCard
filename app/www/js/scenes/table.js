/* ============================================================
 * 猫卡 · 占卜桌 (table.js) —— 多牌堆 + 地图式画布桌面
 * ------------------------------------------------------------
 * 会话模型:
 *   - 桌面(画布)上的牌全局保留, 与来自哪副堆无关
 *   - 牌库里的每一副牌都是一个「牌堆」, 各自记录已抽走的牌
 *   - 底部牌堆栏: 点其它堆=切换待抽堆(桌面不动);
 *     点当前激活堆=从它随机抽一张
 *   - 右侧 🂠 = 全屏选牌台, 从当前激活堆里挑牌发到桌面
 * 桌面 = 地图式: 单指拖空白平移, 双指捏合缩放, 牌永不缩字。
 * ============================================================ */
(function (global) {
  'use strict';
  const D = global.MoKa.data;
  const UI = global.MoKa.ui;
  const RND = global.MoKa.random;   // 洗牌 / 抽牌 / 正逆位：统一走 crypto 随机源

  /* ---------- 会话 ---------- */
  let session = null;
  // session = {
  //   tableCards: [tcard],         桌面上的牌(跨牌堆保留)
  //   piles: [pile],               当前勾选上桌的牌堆
  //   pilesById: Map<deckId, pile>, 本局牌堆进度，撤下后仍保留
  //   activePileId: string
  // }

  const els = {};
  let fieldRect = null;
  let zTop = 10;
  /* 抬到全局最上层 —— **发牌 / 点击 / 拖动** 共用的唯一入口。
     ★ 必须写内联 z-index：每张牌发下来时都写死了内联值，CSS 里的 z-index 压不过它。
     ★ 放在 pointerdown（手指一落下）而不是拖动阈值之后：这样"轻点一下"和"拖动"
       天然走同一条路径，不用为点击再写一套分支。 */
  function bringToFront(el) { zTop += 1; el.style.zIndex = zTop; }

  let cam = { x: 0, y: 0, scale: 1 };
  const SCALE_MIN = 0.35, SCALE_MAX = 3;
  const PAD = 12, GRID_GAP = 14;

  /* ---------- 初始化 ---------- */
  function init() {
    els.playfield = document.getElementById('playfield');
    els.canvas = document.getElementById('desk-canvas');
    els.hint = document.getElementById('field-tip');
    els.cover = document.getElementById('table-cover');
    els.coverTitle = document.getElementById('cover-title');
    els.coverSub = document.getElementById('cover-sub');
    els.coverIcon = document.getElementById('cover-icon');
    els.btnCoverAction = document.getElementById('btn-cover-action');
    els.btnCoverSecondary = document.getElementById('btn-cover-secondary');
    // 桌面右侧栏整条删掉了（2026-09，连 #btn-reset 一起）—— 重来搬进左边缘「拉线」抽屉。
    //   走过的弯路记一笔：低频动作先后试过「长按浮层 #tray-tools」「双击唤出」「桌面右栏」，都不好用；
    //   模式切换搬去顶栏、起点改成全自动之后，右栏只剩一颗「重来」，索性收进抽屉。
    els.btnNavLock = document.getElementById('btn-nav-lock');
    els.ground = document.createElement('div');
    els.ground.className = 'world-ground';
    els.canvas.appendChild(els.ground);
    els.meaningLayer = document.getElementById('meaning-layer');
    els.pileStrip = document.getElementById('pile-strip');
    els.deckName = document.getElementById('table-deck-name');   // P5-B：顶栏当前牌堆名
    els.btnTray = document.getElementById('btn-tray');
    els.trayBtnCount = document.getElementById('tray-btn-count');
    els.trayLayer = document.getElementById('tray-layer');
    els.trayGrid = document.getElementById('tray-grid');
    els.trayScroll = document.getElementById('tray-scroll');
    els.btnTrayClose = document.getElementById('btn-tray-close');
    els.trayTitle = document.getElementById('tray-title-text');

    bindEdgePull();
    bindTrayOrb();           // 选牌台按钮：点一下就进选牌台（单动作）
    els.btnTrayClose.addEventListener('click', trayClose);
    els.trayGrid.addEventListener('click', onTrayCardClick);
    bindTableTools();
    applyTableMode();
    /* ⚠ 2026-09-21 修的坑：这里原来还有一条
         els.btnCoverAction.addEventListener('click', function () { hideCover(); resetSession(true); });
       而 showCover() 每次都把主按钮的动作写成 `btnCoverAction.onclick = onAction` ——
       于是引导层的主按钮**挂了两个监听**：点「去牌库勾选」会先切到牌库、紧接着再弹一次
       「重新开始？桌面上的牌会被收回」，点「收回重来」就把刚摆好的牌清空了；
       点「这个牌堆是空的 / 知道了」同样会莫名弹出"重新开始"。
       引导层的主按钮**只该做它写的那件事**，"重来"是抽屉里 #pd-reset 的活（table.js:650）。 */
    els.btnCoverSecondary.addEventListener('click', hideCover);
    // 点面板外面关掉。★ 用 pointerdown，不能用 click：
    // 真机点一下牌 = pointerdown → pointerup → click 一串，而面板正是在这一串里才铺满全屏的，
    // 于是末尾那个 click 会落在面板遮罩上 → 刚弹出就被关掉（用户报的"点牌面弹窗不跳"）。
    els.meaningLayer.addEventListener('pointerdown', function (e) {
      if (e.target !== els.meaningLayer) return;
      if (Date.now() - _meaningOpenedAt < 350) return;   // 双保险
      hideMeaning();
    });

    // ★ 牌组数据一变就同步牌堆（加/删卡、删牌组、导入、克隆…）。
    //   以前 table.js **完全不订阅数据变化**，全靠"切回占卜桌时 openTable→syncPiles"兜底 ——
    //   只要有任何一条路径在占卜桌场景下改了牌组（比如确认弹窗开着时切走场景、回来再确定），
    //   牌堆栏就会停在旧数字上，"已抽出"里还会留着已经删掉的卡 id
    //   （自跑测试种子 100 抓到的）。syncPiles 在没有会话时自己会 return，订阅是安全的。
    D.subscribe(function () { try { syncPiles(); } catch (e) {} });

    bindViewportGestures();
    /* ★ 尺寸变化：占卜桌**没显示**的时候不量也不应用镜头。
       那时 .scene 是 display:none，playfield 量出来是 0×0，拿它算镜头会把"居中"那两项
       （fieldRect.width/2、height/2）算成 0 —— 切回占卜桌整个桌面偏掉半屏。
       触发场景很日常：在牌库点「导入」，选文件回来后 WebView 会发一次 resize（用户报的就是这个）。
       回到占卜桌时 openTable() 会重新量 + 重新应用，不会漏。 */
    window.addEventListener('resize', function () {
      if (!fieldVisible()) return;
      measureField(); clampCam(); applyCam();
    });
    measureField();
    layoutGround();
    resetCamera(false);
  }
  function layoutGround() {
    if (!els.ground) return;
    els.ground.style.width = (WORLD_HALF * 2) + 'px';
    els.ground.style.height = (WORLD_HALF * 2) + 'px';
    els.ground.style.left = (-WORLD_HALF) + 'px';
    els.ground.style.top = (-WORLD_HALF) + 'px';
  }

  // 占卜桌当前是不是显示着（切场景时 app.js 会给 .scene 加/去 is-active）
  function fieldVisible() {
    const sc = (els.playfield && els.playfield.closest) ? els.playfield.closest('.scene') : null;
    return !sc || sc.classList.contains('is-active');
  }

  function measureField() {
    if (!els.playfield) return fieldRect;
    const r = els.playfield.getBoundingClientRect();
    /* ★ 尺寸为 0 一律不算数，保留上一次量到的好值。
       占卜桌隐藏时（display:none）量出来必然是 0×0；一旦存进去，镜头就把"居中"算成 0
       （切回桌面整个偏半屏），而且没人会主动再量一次。
       从没量到过（fieldRect 还是 null）就用窗口尺寸兜个底，别让下游拿到 null。 */
    if (!r || !r.width || !r.height) {
      if (!fieldRect) {
        fieldRect = { left: 0, top: 0, right: 0, bottom: 0, x: 0, y: 0,
                      width: (typeof window !== 'undefined' && window.innerWidth) || 0,
                      height: (typeof window !== 'undefined' && window.innerHeight) || 0 };
      }
      return fieldRect;
    }
    fieldRect = r;
    return fieldRect;
  }
  // 世界地面: 一张足够大的"桌布"(网格层), 与牌同在画布内随镜头移动
  const WORLD_HALF = 4200;

  /* ============================================================
   * 牌堆管理
   * ============================================================ */
  function syncPiles() {
    if (!session) return;
    // 上桌勾选只影响可见牌堆，不重置本局进度或移动桌上已经发出的牌。
    const byId = session.pilesById;
    byId.forEach(function (pile, id) {
      const deck = D.findDeck(id);
      if (!deck) { byId.delete(id); return; }
      pile.name = deck.name;
      pile.cardCount = deck.cards.length;
      // 即使张数没变，名单也可能已换；撤下的牌堆也要同步已删除的卡。
      const alive = new Set(deck.cards.map(function (c) { return c.id; }));
      pile.drawn.forEach(function (cardId) { if (!alive.has(cardId)) pile.drawn.delete(cardId); });
      pile.trayOrder = pile.trayOrder.filter(function (cardId) { return alive.has(cardId); });
    });
    const merged = D.tableDecks().map(function (d) {
      if (!byId.has(d.id)) {
        byId.set(d.id, { deckId: d.id, name: d.name, cardCount: d.cards.length, drawn: new Set(),
                        trayFill: false, trayOrder: [], autoShuffled: false });
      }
      return byId.get(d.id);
    });
    const hadVisiblePiles = session.piles.length > 0;
    session.piles = merged;
    if (!merged.length) session.activePileId = null;
    else if (!merged.find(p => p.deckId === session.activePileId)) {
      /* ★ 2026-10-15：用户选中的那一堆不在桌上了（比如刚在牌库把它的勾去掉），
         这里会把当前堆**静默**换成第一堆：界面（尤其全屏的选牌台）整个换成另一副牌组，
         标题只变了个数字 —— 用户以为还在抽原来那堆，实际抽出来的是另一副，
         占卜结果从源头就错了。换就换，但要告诉人家。 */
      const previousId = session.activePileId;
      const from = previousId && D.findDeck(previousId);
      session.activePileId = merged[0].deckId;
      const to = D.findDeck(session.activePileId);
      if (hadVisiblePiles && previousId) {
        try {
          UI.toast('「' + ((from && from.name) || '原来那副') + '」已不在桌上，当前牌堆换成「'
            + ((to && to.name) || '第一副') + '」', 3200);
        } catch (e) {}
      }
    }
    renderPileStrip();
    // ★ 选牌台也要一起刷：牌组张数/名单变了之后，开着（或切场景回来还开着的）选牌台
    //   标题会停在旧数字上（自跑测试种子 42 抓到的：标题「剩 8 张」vs 实际 9 张）。
    renderTrayGrid();
    // 一个都不勾：桌上有牌就只给引导（★不动已发出的牌），桌上没牌才走 renderNoDeck（它会清桌）
    if (!merged.length) {
      if (session.tableCards.length) {
        if (els.pileStrip) els.pileStrip.innerHTML = '<div class="pile-empty">到「牌库」勾选要上桌的牌组</div>';
        showCover('✦', '还没有上桌的牌组', '到「牌库」把要上占卜桌的牌组勾上（牌组右上角那个圆圈）', '去牌库勾选', function () {
          global.MoKa.app && global.MoKa.app.gotoScene('library');
        });
      } else {
        renderNoDeck();
      }
      trayClose();
    } else if (!hadVisiblePiles) {
      hideCover();
    }
    showFieldTip();
  }

  function activePile() {
    if (!session) return null;
    return session.piles.find(p => p.deckId === session.activePileId) || null;
  }
  // 当前激活堆剩余可抽的牌
  function pileRemainingCards(pile) {
    const d = D.findDeck(pile.deckId);
    if (!d) return [];
    return d.cards.filter(c => !pile.drawn.has(c.id));
  }

  /* ---------- 底部牌堆栏 ---------- */
  function renderPileStrip() {
    if (!session || !els.pileStrip) return;
    if (!session.piles.length) {
      els.pileStrip.innerHTML = '<div class="pile-empty">先去「牌库」建一副牌</div>';
      /* ★ 2026-09-21：这里原来直接 return，跳过了下面那句 updateTrayCount() ——
         于是"牌组全被取消勾选"之后，右下角那颗选牌台按钮还挂着上一次的数字
         （实测残留 "36"），点进去只得到一句"还没有牌堆"。牌堆栏重画了就得同步角标。 */
      updateTrayCount();
      updateDeckUI();
      updateDeckName();          // P5-B：一堆都不剩 → 顶栏名字也清掉
      return;
    }
    const html = session.piles.map(function (p) {
      const d = D.findDeck(p.deckId);
      /* 剩余张数与选牌台走同一个实时口径，而不是用上次同步的数量快照相减。 */
      const left = pileRemainingCards(p).length;
      /* ★ 2026-10-20 重构：一摞牌的 HTML 现在只有**一处**（和周易页共用 UI.pileItemHTML）。
         厚度层 / 牌背图 / 内置模板 / 剩余张数角标都在 ui.js 里拼；
         两页以前各拼一份，历史上就漏过一次 .ps-tpl。 */
      return UI.pileItemHTML(d, {
        left: left,
        active: p.deckId === session.activePileId,
        name: p.name,
        id: p.deckId
      });
    }).join('');
    els.pileStrip.innerHTML = html;
    updateTrayCount();
    updateDeckName();            // P5-B：切堆/抽牌/数据变化都从同一条路刷新顶栏名字

    els.pileStrip.querySelectorAll('.pile-item').forEach(function (item) {
      item.addEventListener('click', function () { onPileItemClick(item.dataset.id); });
    });
  }

  function onPileItemClick(deckId) {
    if (!session) return;
    if (deckId !== session.activePileId) {
      // 切换到其它堆(桌面保留)
      session.activePileId = deckId;
      renderPileStrip();
      // ★ 切堆也要刷选牌台：不刷的话选牌台还显示上一个堆的牌和剩余数
      //   （真机上选牌台是全屏层、盖住了牌堆栏，所以点不到；但状态不一致迟早出事）
      renderTrayGrid();
      hideCover();

      return;
    }
    // 点当前激活堆 = 抽一张
    onDraw();
  }

  /* ---------- 顶栏「当前牌堆名」（P5-B，2026-11-06） ----------
     为什么要有：牌堆栏的名字框只有 52px（v3 §6），内置第一副
     「Love & Armour 六十张爱情与护甲」要 154px —— 靠省略号永远看不全；
     原来的 title 属性在触摸端没有 hover，等于没有全名入口。顶栏给两行。
     周易页同构（zy-table-deck-name），两页必须一起维护。 */
  function updateDeckName() {
    if (!els.deckName) return;
    const p = activePile();
    const d = p ? D.findDeck(p.deckId) : null;
    const txt = d ? (d.name || '') : '';
    if (els.deckName.textContent !== txt) els.deckName.textContent = txt;
    els.deckName.title = txt;
    els.deckName.style.display = txt ? '' : 'none';
  }

  /* ---------- 新局 ---------- */
  function openTable() {
    maybeShowPullTut();          // 第一次进占卜桌：教一次"往右拉这条线"
    if (session) {
      /* ★ 2026-09-21 修的坑：hideCover() 原来排在 syncPiles() **后面** ——
         而"一个牌组都没勾"的引导层正是在 syncPiles → renderNoDeck 里弹出来的，
         于是刚弹出就被这一行关掉：用户切回占卜桌只看到空桌面，引导层一闪而过（实测 is-hidden=true）。
         收起"上一轮的引导"要发生在**这一轮 syncPiles 决定弹什么之前**。 */
      hideCover();
      // 牌库结构变了 → 重对齐牌堆; 桌面牌保留
      syncPiles();
      measureField();
      /* ★ 量完必须**重新应用**一次镜头：画布上的居中量是"上一次 applyCam 时的 fieldRect"，
         中途尺寸可能变过（最典型：在牌库点导入、选文件回来时 WebView 发 resize，而那时占卜桌是隐藏的）。
         不重应用，就会带着旧的居中量画出来 —— 整个桌面偏半屏（用户报的就是这个）。 */
      applyCam();
      // 切回桌面时保留当前镜头位置与摆好的牌, 不重排、不弹回
      ensureOrigin();
      const p = activePile();
      if (p && D.findDeck(p.deckId) && D.findDeck(p.deckId).cards.length === 0) {
        showCover('✦', '这个牌堆是空的', '去牌库给它添加猫卡再来占卜，或换一副牌。', '知道了');
      }
      return;
    }
    playDeck(D.getActiveDeckId());
  }

  function playDeck(deckId) {
    const decks = D.listDecks();
    const deck = decks.find(d => d.id === deckId) || decks[0];
    if (!deck) { renderNoDeck(); return; }
    D.setActiveDeckId(deck.id);
    startSession(deck.id);
  }

  function startSession(preferDeckId) {
    trayClose();
    session = {
      tableCards: [],
      piles: [],
      pilesById: new Map(),
      activePileId: preferDeckId || D.getActiveDeckId() || null,
      spawnOrigin: null,  // 发牌出生点(世界坐标)。用户不设了 —— 发牌前若视野动过就自动锚到视野中心
      originCam: null,    // 上次锚定时的摄像头 {x,y,scale}，用来判断"视野动过没有"
      spawnCount: 0,      // 从当前出生点已发出的张数(决定下一张的排位)
    };
    clearTableCards();
    applyTableMode();
    measureField();
    syncPiles();
    if (!session.piles.length) return;
    resetCamera(false);
    const p = activePile();
    if (p && D.findDeck(p.deckId) && D.findDeck(p.deckId).cards.length === 0) {
      showCover('✦', '这个牌堆是空的', '去牌库给它添加几张猫卡再来占卜吧。', '去牌库添加', function () {
        global.MoKa.app.gotoScene('library');
        global.MoKa.library.goDeck(p.deckId);
      }, '知道了');
    }
  }

  function resetSession(confirmWarn) {
    if (!session) return;
    if (confirmWarn && session.tableCards.length === 0) return;
    // ★ 重排前先把抽屉层按「无动画」收起并隐藏 —— 见 pdApply 末尾那段（合成残影）
    const doReset = function () { pdApply(0, false); startSession(activePile() ? activePile().deckId : null); };
    if (confirmWarn && session.tableCards.length > 0) {
      UI.confirmDialog({
        icon: '↺',
        title: '重新开始？',
        sub: '桌面上的 ' + session.tableCards.length + ' 张牌会被收回，各牌堆回到满副状态。',
        okText: '收回重来'
      }).then(function (ok) { if (ok) doReset(); });
    } else doReset();
  }

  function renderNoDeck() {
    clearTableCards();
    const noneAtAll = !D.listDecks().length;      // 一副牌都没有 vs 有牌但一个都没勾
    if (els.pileStrip) els.pileStrip.innerHTML = '<div class="pile-empty">' +
      (noneAtAll ? '先去「牌库」新建一副牌' : '到「牌库」勾选要上桌的牌组') + '</div>';
    if (noneAtAll) {
      showCover('✦', '还没有牌组', '请先到「牌库」新建一个牌堆并添加猫卡', '去牌库', function () {
        global.MoKa.app && global.MoKa.app.gotoScene('library');
      });
    } else {
      showCover('✦', '还没有上桌的牌组', '到「牌库」把要上占卜桌的牌组勾上（牌组右上角那个圆圈）', '去牌库勾选', function () {
        global.MoKa.app && global.MoKa.app.gotoScene('library');
      });
    }
  }

  function screenToWorld(sx, sy) {
    return { x: cam.x + (sx - fieldRect.width / 2) / cam.scale, y: cam.y + (sy - fieldRect.height / 2) / cam.scale };
  }
  function applyCam() {
    els.canvas.style.transform =
      'translate3d(' + (-cam.x * cam.scale + fieldRect.width / 2) + 'px,' +
      (-cam.y * cam.scale + fieldRect.height / 2) + 'px,0) scale(' + cam.scale + ')';
  }
  // 镜头边界: 允许在大范围世界内自由平移(类似地图), 避免"拖不动/顶边"
  // 范围足够覆盖正常摆放 + 任意设置的出生点; 找不到用「复位」回出生点
  function clampCam() {
    const HALF = WORLD_HALF - 400; // 别把视野拖到网格地面外
    cam.x = Math.max(-HALF, Math.min(HALF, cam.x));
    cam.y = Math.max(-HALF, Math.min(HALF, cam.y));
    cam.scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, cam.scale));
  }
  function resetCamera(animate) {
    cam.scale = 1;
    if (session && session.spawnOrigin) {
      // 复位到"发牌起点": 用户设过的出生点, 或发牌时自动落定的起点
      cam.x = session.spawnOrigin.x;
      cam.y = session.spawnOrigin.y;
    } else if (session && session.tableCards.length) {
      const c = centerOfCards();
      cam.x = c.x; cam.y = c.y;
    } else {
      cam.x = PAD + baseCardW() / 2;
      cam.y = PAD + baseCardH() / 2;
    }
    if (animate) els.canvas.classList.add('is-pan-smooth');
    clampCam(); applyCam();
    setTimeout(function () { els.canvas.classList.remove('is-pan-smooth'); }, 340);
  }
  function centerOfCards() {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    session.tableCards.forEach(function (tc) {
      minX = Math.min(minX, tc.x); minY = Math.min(minY, tc.y);
      maxX = Math.max(maxX, tc.x + tc.w); maxY = Math.max(maxY, tc.y + tc.h);
    });
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }

  /* 以屏幕中心为锚点缩放(动画过渡)。
     ★ 2026-09-18：顶栏 ＋/－ 去掉后暂时没人调用 —— 故意留着。
       界固定（默认）是完全锁死的，开放 / 牌固定下用双指缩放。 */

  function bindViewportGestures() {
    const pointers = new Map();
    let mode = null;
    let pinchPrev = { dist: 0, mx: 0, my: 0 };
    let startWorld = null;
    function rel(e) { return { x: e.clientX - fieldRect.left, y: e.clientY - fieldRect.top }; }

    els.playfield.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('.tcard')) return;
      // ★ 界固定 = 画面**完全**锁死：不平移、也不缩放。
      //   （2026-09-18 用户明确过：界固定模式下还能缩放，本身就是 bug。）
      //   所以这一模式下没有缩放入口是**故意的** —— 要缩放请点「定位」切到开放 / 牌固定。
      if (viewLocked) return;
      pointers.set(e.pointerId, rel(e));
      try { els.playfield.setPointerCapture(e.pointerId); } catch (err) {}
      if (pointers.size === 1) {
        mode = 'pan';
        const p = rel(e);
        startWorld = screenToWorld(p.x, p.y);
      } else if (pointers.size === 2) {
        mode = 'pinch';
        const pts = Array.from(pointers.values());
        pinchPrev.dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
        pinchPrev.mx = (pts[0].x + pts[1].x) / 2;
        pinchPrev.my = (pts[0].y + pts[1].y) / 2;
      }
    });
    els.playfield.addEventListener('pointermove', function (e) {
      if (!pointers.has(e.pointerId)) return;
      const p = rel(e);
      if (mode === 'pan' && pointers.size === 1) {
        cam.x = startWorld.x - (p.x - fieldRect.width / 2) / cam.scale;
        cam.y = startWorld.y - (p.y - fieldRect.height / 2) / cam.scale;
        pointers.set(e.pointerId, p);
        clampCam(); applyCam();
        return;
      }
      if (mode === 'pinch' && pointers.size >= 2) {
        pointers.set(e.pointerId, p);
        const pts = Array.from(pointers.values()).slice(0, 2);
        const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
        const mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
        if (pinchPrev.dist > 0 && Math.abs(dist - pinchPrev.dist) > 1) {
          const wm = screenToWorld(pinchPrev.mx, pinchPrev.my);
          cam.scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, cam.scale * (dist / pinchPrev.dist)));
          cam.x = wm.x - (pinchPrev.mx - fieldRect.width / 2) / cam.scale;
          cam.y = wm.y - (pinchPrev.my - fieldRect.height / 2) / cam.scale;
        }
        const dmx = mx - pinchPrev.mx, dmy = my - pinchPrev.my;
        if (Math.abs(dmx) > 0.5 || Math.abs(dmy) > 0.5) {
          cam.x -= dmx / cam.scale;
          cam.y -= dmy / cam.scale;
        }
        pinchPrev = { dist: dist, mx: mx, my: my };
        clampCam(); applyCam();
      }
    });
    function endPointer(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) mode = pointers.size === 1 ? 'pan' : null;
      if (pointers.size === 1) {
        const rest = pointers.entries().next().value;
        if (rest) startWorld = screenToWorld(rest[1].x, rest[1].y);
      }
    }
    els.playfield.addEventListener('pointerup', endPointer);
    els.playfield.addEventListener('pointercancel', endPointer);
  }

  /* ---------- 镜头辅助 D-pad: 方向键平移 + 起点 = 视野中心 ---------- */
  /* ---------- 虚拟摇杆: 拖圆点控制镜头平移, 偏离越远越快 ---------- */
  /* ---------- 桌面工具: 设起点 / 模式开关 ----------
     三种模式(点按钮循环切换):
     0 开放   = 画面可缩放/移动 + 牌可拖/翻/抽 (正常)
     1 牌固定 = 画面可缩放/移动, 牌不会被碰动(防误碰)
     2 界固定 = 画面不能缩放/移动, 牌可以拖/翻          */
  /* 模式三档（2026-09-18 改名 + 加图标）
     名字压成 2 个字：原来是 开放 / 牌固定 / 界固定（2/3/3 字），
     放进顶栏那颗胶囊按钮里会一宽一窄，所以统一成 2 字。
     图标用「指认对象」那套（**不画锁** —— 13px 下锁只剩 3px，固牌/固界会糊在一起）：
       开放 = 十字箭头（什么都能动）· 固牌 = 卡牌 · 固界 = 窗口。
     三个都是 24 viewBox / fill:none / stroke 1.9 / 圆角端点 —— 和顶栏的月亮同一套线。 */
  const MODE_SVG = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
  const MODE_ICO = {
    move:  '<svg ' + MODE_SVG + '><path d="M12 3.4v17.2M3.4 12h17.2"/><path d="M12 3.4L9.7 5.7M12 3.4l2.3 2.3M12 20.6l-2.3-2.3M12 20.6l2.3-2.3M3.4 12l2.3-2.3M3.4 12l2.3 2.3M20.6 12l-2.3-2.3M20.6 12l-2.3 2.3"/></svg>',
    card:  '<svg ' + MODE_SVG + '><rect x="6.6" y="3.6" width="10.8" height="16.8" rx="2.2"/><path d="M9.6 8.6h4.8M9.6 12h3.2"/></svg>',
    frame: '<svg ' + MODE_SVG + '><rect x="3.6" y="5.4" width="16.8" height="13.2" rx="2.4"/><path d="M3.6 9.4h16.8"/></svg>'
  };
  const TABLE_MODES = [
    { label: '开放', icon: 'move',  toast: '开放：画面可缩放移动，牌可拖动翻面' },
    { label: '固牌', icon: 'card',  toast: '固牌：画面可缩放移动，牌不会被碰动' },
    { label: '固界', icon: 'frame', toast: '固界：画面不缩放移动，牌可拖动翻面' }
  ];
  let tableMode = 2;         // 默认 界固定；0 开放 / 1 牌固定 / 2 界固定（点按钮循环）
  let cardsLocked = false;   // 牌不可拖/点（模式1）
  let viewLocked = false;    // 画面不可缩放/移动（模式2）

  function applyTableMode() {
    cardsLocked = tableMode === 1;
    viewLocked = tableMode === 2;
    const cards = els.canvas ? els.canvas.querySelectorAll('.tcard') : [];
    cards.forEach(function (el) { el.classList.toggle('is-locked', cardsLocked); });
    const m = TABLE_MODES[tableMode];
    if (els.btnNavLock) {
      // ★ 按钮里现在有「图标 + 文字」两块，**不能再写 textContent**（会把图标一起抹掉，
      //   而且不报错 —— 这个坑在主题按钮上踩过一次，这里同样各写各的子元素）。
      const lab = document.getElementById('mode-label');
      const ico = document.getElementById('mode-ico');
      if (lab) lab.textContent = m.label; else els.btnNavLock.textContent = m.label;
      if (ico) ico.innerHTML = MODE_ICO[m.icon] || '';
      els.btnNavLock.classList.toggle('is-on', tableMode !== 0);
      els.btnNavLock.title = '模式：' + m.label + '（点一下切换）';
      els.btnNavLock.setAttribute('aria-label', '模式：' + m.label + '，点一下切换');
    }
  }

  /* ---------- 左边缘拉线 →「桌面」抽屉（2026-09-18，用户选定 A 款） ----------
     一条极不显眼的竖线（两端渐隐、中段留断口，箭头嵌在断口里），往右拉出抽屉。
     交互：拖 = 跟手（面板同步露出、遮罩渐显）；点一下 = 开关；点面板外 = 收回。
     ★ 两个必须注意的点（都是踩过类似坑之后写下的）：
       ① 拉线是 #playfield 的子元素，pointerdown 必须 stopPropagation() ——
          不拦的话，事件冒泡到桌面的平移手势上，就成了"一边拉抽屉一边把桌子推走"。
       ② 拖动过程中**不能写 transition**，松手才写；否则跟手会有一层肉眼可见的延迟。 */
  const PD_W = 236;                      // 和 CSS 里的面板宽度保持一致
  const PD_OPEN_AT = 0.4;                // 松手时超过 40% 就展开
  const PD_ANIM_MS = 240;                // 与 pdApply 里那条 .24s transition 对齐
  let pdOpen = false, pdDrag = null, pdHideTimer = null;

  function pdParts() {
    return {
      wrap: document.getElementById('pull-drawer'),
      mask: document.getElementById('pd-mask'),
      panel: document.getElementById('pd-panel'),
      count: document.getElementById('pd-cnt'),
      handle: document.getElementById('edge-pull')
    };
  }
  // p: 0 = 全收起，1 = 全展开
  function pdApply(p, animate) {
    const e = pdParts();
    if (!e.wrap || !e.panel) return;
    const pct = Math.max(0, Math.min(1, p));
    e.panel.style.transition = animate ? 'transform .24s cubic-bezier(.2,.7,.3,1)' : 'none';
    e.panel.style.transform = 'translateX(' + (-PD_W + pct * PD_W).toFixed(1) + 'px)';
    e.mask.style.transition = animate ? 'opacity .24s ease' : 'none';
    e.mask.style.opacity = String(Math.min(1, pct * 1.2));   // 拉一点就把遮罩带上，手感更实
    e.wrap.style.pointerEvents = pct > 0.002 ? 'auto' : 'none';
    /* ★★ 2026-10-13（用户报的合成残影）：收起动画走完就把整层 visibility:hidden。
       病根：`.pull-drawer` 是 `position: fixed; inset: 0` 的全屏层，里面的面板做过
       transform 动画、还带 box-shadow —— Android WebView 会把它提升成独立合成层，
       并且**动画结束后不会自己撤下来**。紧接着「重来」把桌面整块重排
       （`resetSession` → `startSession`），重绘没覆盖到的底部区域就留着抽屉遮罩的
       旧像素 = 屏幕底部一条灰色残影；切一下底部栏（换场景，整层重绘）才消失。
       用户原话：「占卜桌→任意抽几张牌→侧边栏里的洗牌/重来→屏幕底部会留下侧边栏的残留」。
       不抽牌不复现，是因为 `resetSession(true)` 在桌上没牌时直接 return、压根不重排。
       这里让层在收起后彻底退场，重排就没有"旧像素"可留。 */
    if (pdHideTimer) { clearTimeout(pdHideTimer); pdHideTimer = null; }
    if (pct > 0.002) {
      e.wrap.style.visibility = 'visible';
    } else if (!animate) {
      e.wrap.style.visibility = 'hidden';
    } else {
      pdHideTimer = setTimeout(function () {
        pdHideTimer = null;
        if (pdOpen) return;                  // 动画途中又被拉开了 → 保持可见
        e.wrap.style.visibility = 'hidden';
      }, PD_ANIM_MS + 30);
    }
  }
  function pdRefreshCount() {
    const e = pdParts();
    if (!e.count) return;
    const n = session ? session.tableCards.length : 0;
    // 只写子元素（按钮里还有图标的话写 textContent 会把它抹掉，这个坑踩过三次了）
    e.count.innerHTML = n === 0 ? '桌上还没有牌' : '桌上 <b>' + n + '</b> 张牌';
  }
  /* ---------- 首次提示：「往右拉这条线」（2026-09-18） ----------
     只为了"有人真的看不见那条线"。一次就够，看完写 localStorage；
     任何关掉方式都算看过（点知道了 / 点提示外 / 直接拉一下 / 按返回键）。 */
  const PULL_TUT_KEY = 'moka.tut.pull.v1';
  const showPullTut_ = showPullTut;   // 测试钩子（下划线结尾）
  let pullTutTimer = null;
  function pullTutSeen() {
    try { return localStorage.getItem(PULL_TUT_KEY) === '1'; } catch (e) { return true; }  // 存不了就别弹
  }
  function markPullTutSeen() {
    try { localStorage.setItem(PULL_TUT_KEY, '1'); } catch (e) {}
  }
  /* ★ 2026-09-26 用户要求：提示亮着的时候先锁 5 秒 ——
     有人下意识点「知道了」或点空白就把教程跳过了，等于没看。
     锁着的时候点按钮 / 点遮罩 / 按返回键都无效；只有"真的把线拉出来"可以提前结束。 */
  const TUT_LOCK_MS = 5000;
  let tutLockUntil = 0, tutTick = null;
  function tutRender() {
    const btn = document.getElementById('et-ok');
    if (!btn) return;
    const left = Math.ceil((tutLockUntil - Date.now()) / 1000);
    if (left > 0) { btn.textContent = '知道了 · ' + left; btn.classList.add('is-wait'); }
    else { btn.textContent = '知道了'; btn.classList.remove('is-wait'); }
  }
  function tutStopTick() {
    if (tutTick) { clearInterval(tutTick); tutTick = null; }
    tutLockUntil = 0;
  }
  function showPullTut() {
    const l = document.getElementById('et-layer');
    if (!l) return;
    const scene = document.getElementById('scene-table');
    if (scene && !scene.classList.contains('is-active')) return;   // 人已经走了，下次再说
    l.classList.remove('is-hidden');
    l.setAttribute('aria-hidden', 'false');
    const h = document.getElementById('edge-pull');
    if (h) { h.classList.remove('is-demo'); void h.offsetWidth; h.classList.add('is-demo'); }  // 让它自己探一下头
    tutStopTick();
    tutLockUntil = Date.now() + TUT_LOCK_MS;
    tutRender();
    tutTick = setInterval(function () {
      tutRender();
      if (Date.now() >= tutLockUntil) tutStopTick();
    }, 200);
  }
  /* force=true = "不是用户点掉的"（切场景、拉出抽屉那种），可以越过 5 秒锁。
     ★ 锁定期间被强制收掉的（比如切到别的页），**不算看过** —— 下次进来还得再过一遍 5 秒锁。 */
  function closePullTut(mark, force) {
    const l = document.getElementById('et-layer');
    if (!l || l.classList.contains('is-hidden')) return;
    const locked = Date.now() < tutLockUntil;
    if (!force && locked) return;                         // 锁着：点按钮 / 点空白 / 按返回 一律当没点
    tutStopTick();
    l.classList.add('is-hidden');
    l.setAttribute('aria-hidden', 'true');
    const h = document.getElementById('edge-pull');
    if (h) h.classList.remove('is-demo');
    if (mark !== false && !locked) markPullTutSeen();      // 锁没满就溜掉 → 不算看过
  }
  function maybeShowPullTut() {
    if (pullTutSeen()) return;
    if (pullTutTimer) clearTimeout(pullTutTimer);
    // 等桌面落定再弹（一进场景就糊上来太唐突），也别和开场的场景动画抢
    pullTutTimer = setTimeout(function () { pullTutTimer = null; showPullTut(); }, 900);
  }

  function openPullDrawer() {
    const e = pdParts();
    if (!e.wrap) return;
    closePullTut(true, true);    // 自己拉出来 = 已经学会了（越过 5 秒锁）
    markPullTutSeen();           //   这是真学会了 → 记成看过，别再见一次
    pdOpen = true;
    pdRefreshCount();
    e.wrap.classList.add('is-open');
    e.wrap.setAttribute('aria-hidden', 'false');
    pdApply(1, true);
  }
  function closePullDrawer() {
    const e = pdParts();
    if (!e.wrap) return;
    pdOpen = false;
    e.wrap.classList.remove('is-open');
    e.wrap.setAttribute('aria-hidden', 'true');
    pdApply(0, true);
  }
  function togglePullDrawer() { if (pdOpen) closePullDrawer(); else openPullDrawer(); }

  function bindEdgePull() {
    const e = pdParts();
    if (!e.handle) return;
    const p0 = function () { return pdOpen ? 1 : 0; };
    const at = function (clientX) {
      const dx = clientX - pdDrag.x;
      return Math.max(0, Math.min(1, pdDrag.p0 + dx / PD_W));
    };
    e.handle.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();                      // ★ 别让桌面跟着一起平移
      try { e.handle.setPointerCapture(ev.pointerId); } catch (err) {}
      pdDrag = { x: ev.clientX, p0: p0(), moved: 0, t: Date.now() };
      e.handle.classList.add('is-drag');
      pdApply(pdDrag.p0, false);
    });
    e.handle.addEventListener('pointermove', function (ev) {
      if (!pdDrag) return;
      ev.stopPropagation();
      const dx = ev.clientX - pdDrag.x;
      if (Math.abs(dx) > pdDrag.moved) pdDrag.moved = Math.abs(dx);
      pdApply(at(ev.clientX), false);
    });
    const finish = function (ev, cancelled) {
      if (!pdDrag) return;
      const dx = (ev.clientX || 0) - pdDrag.x;
      const dt = Date.now() - pdDrag.t;
      const p = at(ev.clientX || pdDrag.x);
      const moved = pdDrag.moved;
      pdDrag = null;
      e.handle.classList.remove('is-drag');
      if (cancelled) { pdOpen ? pdApply(1, true) : pdApply(0, true); return; }
      // 没怎么动、又按得快 → 是"点了一下"，开关一次
      if (moved < 6 && dt < 320) { togglePullDrawer(); return; }
      if (p >= PD_OPEN_AT) openPullDrawer(); else closePullDrawer();
    };
    e.handle.addEventListener('pointerup', function (ev) { finish(ev, false); });
    e.handle.addEventListener('pointercancel', function (ev) { finish(ev, true); });
    // 点遮罩收回（遮罩盖住整个桌面，所以抽屉开着时桌面手势天然不会被打到）
    if (e.mask) e.mask.addEventListener('click', function () { if (pdOpen) closePullDrawer(); });
    // 首次提示：点「知道了」或点提示外，都算看过
    const etOk = document.getElementById('et-ok');
    if (etOk) etOk.addEventListener('click', function (ev) { ev.stopPropagation(); closePullTut(true); });
    const etScrim = document.getElementById('et-scrim');
    if (etScrim) etScrim.addEventListener('click', function () { closePullTut(true); });
    const etCard = document.getElementById('et-card');
    if (etCard) etCard.addEventListener('click', function (ev) { ev.stopPropagation(); });
    const row = document.getElementById('pd-reset');
    if (row) row.addEventListener('click', function () {
      closePullDrawer();
      resetSession(true);                        // 原右栏那颗「重来」的活，原样接过来
    });
    pdApply(0, false);                           // 初始收起（不带动画）
  }

  /* ---------- 选牌台按钮（2026-09-18 改回"单动作"） ----------
     这颗按钮上先后挂过「长按 450ms」和「双击」来唤出工具扇，用户反馈手感不好；
     而且"同一个控件上藏第二个动作"这件事**天生有歧义**：
       · 长按：pointerleave 会把它取消（手指在 52px 的按钮上滑一点就出边界）；
       · 双击：系统必须先等一个窗口才知道是哪一种，单击必然要延迟。
     所以工具全部搬到右侧栏，这颗按钮只剩"进选牌台"一件事 —— 没有计时器、没有状态。 */
  function bindTrayOrb() {
    if (!els.btnTray) return;
    els.btnTray.addEventListener('click', trayToggle);
  }

  /* ---------- 起点不再需要用户设了（2026-09-18） ----------
     原来是：一颗「起点」按钮，点一下回到起点、长按新建起点。
     现在改成**移到哪儿、就在哪儿开张** —— 你在发牌前把屏幕移到想放牌的位置，
     下一张牌就从当前视野中心开始发（见 ensureOrigin）。
     于是「回到起点」和「新建起点」这两个动作都不需要存在了，按钮整颗删掉。
     顺带把桌面上的「起点十字标记」也删了：新起点永远在视野中心，
     标记就永远停在屏幕正中，等于没有信息，只是噪音。 */

  function bindTableTools() {
    els.btnNavLock.addEventListener('click', function () {
      tableMode = (tableMode + 1) % TABLE_MODES.length;
      applyTableMode();
      UI.toast(TABLE_MODES[tableMode].label + '：' + TABLE_MODES[tableMode].toast.split('：')[1]);
    });
  }

  /* ---------- 尺寸 ---------- */
  function baseCardW() {
    const css = getComputedStyle(document.documentElement);
    const w = parseFloat(css.getPropertyValue('--card-w'));
    return isNaN(w) ? 110 : w;
  }
  function baseCardH() {
    const css = getComputedStyle(document.documentElement);
    const h = parseFloat(css.getPropertyValue('--card-h'));
    return isNaN(h) ? 167 : h;
  }
  // 牌只能在"世界地面"范围内摆放(超出会到网格外)
  function clampToCanvas(x, y, w, h) {
    const lim = WORLD_HALF - 60;
    const mx = lim - w, my = lim - h;
    return {
      x: Math.max(-lim, Math.min(x, mx)),
      y: Math.max(-lim, Math.min(y, my))
    };
  }

  /* ---------- 排布/发牌 ---------- */
  function gridCols() {
    const w = baseCardW() + GRID_GAP;
    return Math.max(1, Math.floor((fieldRect.width - PAD * 2 + GRID_GAP) / w));
  }
  // 起点 = **视野中心那个世界点**（发牌时牌的中心压在它上面，见 dealToDesk）。
  /* 发牌起点（2026-09-18 起**自动**锚定）
     ------------------------------------------------------------------
     规则只有一句：**发牌前，如果视野跟上次锚定时不一样，就把起点重新锚到当前视野中心。**
     （"起点"= 桌面可视区的正中心那个世界点；牌以**自己的中心**对齐它，所以新牌就出现在屏幕正中。）
       · 没动过屏幕 → 起点不动，牌继续从原处向右下错位叠放（保持原来的排布习惯）；
       · 动过屏幕   → 起点 = 新视野中心，错位计数归零，下一张从新地方重新开始叠。
     用"比较摄像头"来判断，而不是去 hook 平移/缩放的每个回调 ——
     后者要改三处手势代码，这里只动一个函数，而且天然覆盖复位、双指捏合、边界钳制等所有路径。 */
  function ensureOrigin() {
    if (!session) return { x: 0, y: 0 };
    const wc = screenToWorld(fieldRect.width / 2, fieldRect.height / 2);
    const o = session.originCam;
    const moved = !session.spawnOrigin || !o ||
      Math.abs(o.x - cam.x) > 1 ||
      Math.abs(o.y - cam.y) > 1 ||
      Math.abs(o.scale - cam.scale) > 0.002;
    if (moved) {
      session.spawnOrigin = { x: wc.x, y: wc.y };
      session.spawnCount = 0;                       // 新起点 → 从第一格重新错位
      session.originCam = { x: cam.x, y: cam.y, scale: cam.scale };
    }
    return session.spawnOrigin;
  }
  // 全桌自动排队(仅"手动收拢整理"时使用; 正常发牌不再调用, 避免挪动玩家摆好的牌)
  function relayoutDesk(animate) {
    if (!session || !session.tableCards.length) return;
    measureField();
    const cols = Math.max(1, gridCols());
    const bw = baseCardW(), bh = baseCardH();
    session.tableCards.forEach(function (tc, i) {
      const col = i % cols, row = Math.floor(i / cols);
      const p = clampToCanvas(PAD + col * (bw + GRID_GAP), PAD + row * (bh + GRID_GAP), bw, bh);
      tc.x = p.x; tc.y = p.y; tc.w = bw; tc.h = bh;
      applyCardRect(tc, animate);
    });
  }
  // 设置页改了「牌面默认大小」后，把桌面上已经发出的牌一起改成新尺寸
  // （位置不动，只改宽高；返回受影响的张数）
  function refreshCardSize() {
    if (!session || !session.tableCards) return 0;
    const w = baseCardW(), h = baseCardH();
    session.tableCards.forEach(function (tc) {
      tc.w = w; tc.h = h;
      applyCardRect(tc, false);
    });
    return session.tableCards.length;
  }

  function applyCardRect(tc, animate) {
    tc.el.style.width = tc.w + 'px';
    tc.el.style.height = tc.h + 'px';
    tc.el.style.left = tc.x + 'px';
    tc.el.style.top = tc.y + 'px';
    if (animate) tc.el.classList.add('is-reloc');
  }

  function dealToDesk(card, animate, sourceDeckId) {
    if (!session) return null;
    // 牌背配置: 从来源牌组取(默认当前激活牌堆)
    const srcId = sourceDeckId || (activePile() ? activePile().deckId : null);
    const srcDeck = srcId ? D.findDeck(srcId) : null;
    const back = srcDeck ? {
      image: srcDeck.backImage,
      template: srcDeck.backTemplate,
      color: srcDeck.backColor,
      edge: srcDeck.backEdge !== false     // 纸边：默认开
    } : {};
    const useRev = srcDeck ? !!srcDeck.useRev : false;
    const isRev = useRev && RND.float() < 0.5;
    const tcard = {
      uid: D.uid('tc'), card: card, x: 0, y: 0, w: baseCardW(), h: baseCardH(),
      flipped: false, moved: false, rev: isRev
    };
    const el = document.createElement('div');
    el.className = 'tcard is-spawn' + (isRev ? ' rev' : '');
    const faceOpt = { edge: srcDeck ? (srcDeck.faceEdge !== false) : true };   // 牌面纸边
    el.innerHTML = '<div class="tcard-inner">' + UI.faceHTML(card, faceOpt) + UI.backHTML('猫卡', back) + '</div>';
    tcard.el = el;
    el.dataset.uid = tcard.uid;
    session.tableCards.push(tcard);
    els.canvas.appendChild(el);

    // 新牌位置: 从"出生点"开始逐张向右下错位叠放, 露出左上斜角;
    // 已发出的牌永远不动(无论手动摆放还是自动), 起点只决定新牌位置
    // ★ 顺序要紧：ensureOrigin() 在"视野动过"时会把错位计数清零，
    //   所以必须先问起点、再读计数。反过来的话，刚移完屏幕的那张牌会
    //   接着上一处的错位量发（走了 60，牌只走 50）—— 自跑测试里量出来过。
    const org = ensureOrigin();
    const n = session.spawnCount || 0;
    // 起点是"视野中心"这个**点**，牌的**中心**压在它上面 —— 牌才是屏幕正中，
    // 而不是把左上角搁在正中（那样整张牌会比中间偏右下半个身位，用户看着就是"没在中心"）。
    const w = baseCardW(), h = baseCardH();
    const OFF_X = 10, OFF_Y = 14;        // 每张错位量(露出斜角)
    const p = clampToCanvas(
      org.x - w / 2 + n * OFF_X,
      org.y - h / 2 + n * OFF_Y,
      w, h
    );
    session.spawnCount = n + 1;
    tcard.x = p.x; tcard.y = p.y;
    applyCardRect(tcard, false);

    bindCardPointer(el, tcard);
    if (cardsLocked) el.classList.add('is-locked'); // 牌固定模式下发的新牌同样不可碰
    bringToFront(el);
    setTimeout(function () { el.classList.remove('is-spawn'); }, 350);

    els.hint.classList.add('is-hidden');
    // 不重排桌面: 保证玩家已摆好的牌不被挪动
    return tcard;
  }

  function clearTableCards() {
    if (els.canvas) {
      els.canvas.querySelectorAll('.tcard').forEach(function (n) { n.remove(); });
    }
  }

  /* ---------- 抽牌: 从当前激活堆 ---------- */
  function onDraw() {
    if (!session) return;
    /* ★ 2026-10-15 修（新装首启就中招）：**用户自己动了手 = 已经上手**，教程层让路。
       原来这条路上没人收教程层：牌堆栏在 #playfield 之外所以点得到，
       可抽出来的牌落在桌面后会被 .et-scrim（inset:0 / z-index:30）整个罩住 ——
       点不翻、拖不动（真 Chromium 实测：elementFromPoint 打在牌中心返回 et-scrim），
       而 5 秒锁里点「知道了」/点空白/按返回键又全部无效 → 用户以为 App 卡死。
       解锁**必须在 closePullTut 之前**：它里面按 tutLockUntil 判断"是不是用户点掉的"，
       锁没满就溜掉的那次不算看过（下次还得再弹）。这里先清零 = 这一趟算真的用过一次。 */
    if (!pullTutSeen()) { tutLockUntil = 0; closePullTut(true, true); markPullTutSeen(); }
    const pile = activePile();
    if (!pile) { UI.toast('还没有牌堆'); return; }
    const remaining = pileRemainingCards(pile);
    if (remaining.length === 0) {
      const d = D.findDeck(pile.deckId);
      if (d && d.cards.length === 0) UI.toast('这个牌堆没有猫卡，去牌库添加吧');
      else UI.toast('「' + pile.name + '」抽完了，点「重来」洗回满副');
      return;
    }
    const pick = RND.pick(remaining);
    pile.drawn.add(pick.id);
    const drawnCard = dealToDesk(pick);
    renderPileStrip();
    // ★ 必须一起刷选牌台：onDraw 抽走的那张牌如果不在选牌台里同步成空槽，
    //   它就会以"可点的牌"的样子留在那儿 —— 再点它，onTrayCardClick 里
    //   pileRemainingCards().find() 找不到 → 直接 return，那一格点了没反应。
    //   （真机上选牌台是全屏层、盖住了牌堆栏，所以这条路径目前点不到；
    //     但状态不一致留着迟早出事，而且会让走查偶发失败。）
    renderTrayGrid();
    hideCover();
  }

  // (全发按钮已移除)


  /* ---------- 拖牌 vs 点按 ---------- */
  /* ★ 2026-10-15：拖动 / 点按的**唯一**阈值（屏幕像素）。
     原来 move 里写 6、up 里写 14 —— 两个魔数两处判定，于是 6~14px 那一段成了鬼区间：
     牌已经跟着手指走了（还放大 1.06），抬手却走"点按"分支 → 弹回原位 + 自己翻面。
     用户按着想微调对齐一下，看到的就是"牌不听使唤、老是乱翻"。 */
  const TAP_SLOP = 10;
  function bindCardPointer(el, tc) {
    let sx = 0, sy = 0, ox = 0, oy = 0;
    let dragging = false, moved = false;
    let settleTimer = null;
    function cancelSettle() {
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
      el.classList.remove('is-settle', 'no-trans');
    }
    /* ★ 2026-09-21：**认第一根手指**。原来 pointerdown 不判 pointerId ——
       同一张牌上落下第二根手指（想捏合缩放、或拇指搭在牌上）时，sx/sy/ox/oy 被第二根
       直接覆盖，等第一根抬起时 dx 就成了"两根手指之间的距离"（实测 85px）→
       牌被甩到别处；随后第二根手指抬起时位移只有几像素 → 被当成"点按"→ 牌又被翻开。
       现在只接受第一个 pointerId，move/up 也只认它。 */
    let activePid = null;
    el.addEventListener('pointerdown', function (e) {
      if (activePid !== null) return;          // 已经有手指在操作这张牌了，忽略后来者
      activePid = e.pointerId;
      e.preventDefault();
      e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      cancelSettle();
      /* ★ 2026-10-15：**手指一落下就接管 transform**。
         CSS 动画（Animation origin）在级联里高于内联 style，`is-spawn` 存续的 340ms 里
         .tcard 的 transform 归 spawn 动画所有 —— 实测：发牌后立刻写内联
         translate3d(50px,50px,0) scale(1.06)，getComputedStyle 读到的还是 matrix(0.5,…)，
         牌一动不动；340ms 一到动画摘除，内联值立刻生效，牌"啪"地跳到手指当前位置。
         连点抽牌后立刻拖刚发出的那张，就是这个手感（看着像按空了）。 */
      el.classList.remove('is-spawn');
      sx = e.clientX; sy = e.clientY;
      ox = tc.x; oy = tc.y;
      dragging = false; moved = false;
      el.classList.add('is-drag');
      /* ★ 2026-11-13 用户：拖动和点击都要把牌抬到最上面（A/B/C/D 叠着，碰 A 时 A 在最顶）。
         手指一落下就抬 —— 点击、拖动共用这一条，不用两套分支。 */
      bringToFront(el);
    });
    el.addEventListener('pointermove', function (e) {
      if (e.pointerId !== activePid) return;      // 别理第二根手指
      if (!el.hasPointerCapture) return;
      try { if (!el.hasPointerCapture(e.pointerId)) return; } catch (err) { return; }
      const dx = (e.clientX - sx) / cam.scale;
      const dy = (e.clientY - sy) / cam.scale;
      if (!moved && Math.hypot(dx, dy) * cam.scale > TAP_SLOP) { moved = true; dragging = true; }
      if (dragging) {
        const p = clampToCanvas(ox + dx, oy + dy, tc.w, tc.h);
        el.style.transform = 'translate3d(' + (p.x - ox) + 'px,' + (p.y - oy) + 'px,0) scale(1.06)';
      }
    });
    el.addEventListener('pointerup', function (e) {
      if (e.pointerId !== activePid) return;      // 第二根手指抬起 → 什么都不做（更不许当点按翻牌）
      activePid = null;
      el.classList.remove('is-drag');
      /* ★ 2026-10-15：判定口径统一到 TAP_SLOP（原来这里是 14、move 里是 6）。
         轻微手抖（< TAP_SLOP）仍算点按 —— 否则一点牌就"翻面 + 弹不出说明"；
         而只要真的移动过（moved），就**一律提交拖动**，不再拿屏幕位移二次判定。 */
      if (moved) {
        dragging = false;
        tc.moved = true;
        const dx = (e.clientX - sx) / cam.scale;
        const dy = (e.clientY - sy) / cam.scale;
        const p = clampToCanvas(ox + dx, oy + dy, tc.w, tc.h);
        tc.x = p.x; tc.y = p.y;
        el.style.left = tc.x + 'px';
        el.style.top = tc.y + 'px';
        el.style.transform = '';
        el.classList.add('is-settle', 'no-trans');
        settleTimer = setTimeout(function () {
          el.classList.remove('is-settle', 'no-trans');
          settleTimer = null;
        }, 200);
        return;
      }
      el.style.transform = '';
      onCardTap(tc);
    });
    el.addEventListener('pointercancel', function (e) {
      if (e.pointerId !== activePid) return;
      activePid = null;
      el.classList.remove('is-drag');
      el.style.transform = '';
      dragging = false; moved = false;
    });
  }

  /* ---------- 点按翻面/牌义 ---------- */
  function onCardTap(tc) {
    if (!tc.flipped) {
      tc.flipped = true;
      tc.el.classList.add('flipped');
    } else {
      _pendingBackUid = tc.uid;
      openMeaning(tc.card, tc.rev);
    }
  }
  let _meaningOpenedAt = 0;
  function openMeaning(card, rev) {
    const layer = els.meaningLayer;
    _meaningOpenedAt = Date.now();
    // 注意: 牌义是用户自由输入 / 可随牌组 ZIP 从外部导入的文本,
    // 必须 esc 后再入模板 —— 否则 <b> 之类会被当 HTML 解析(导入的牌组可以借此注入标签)。
    // 换行不用转 <br>: .meaning-body 有 white-space: pre-wrap, 原样保留。
    layer.innerHTML =
      '<div class="meaning-panel">' +
        '<div class="meaning-head">' +
          // 牌面缩略图：点它（或右边那个放大镜）进全屏查看器。
          // 缩略图本身就是"这里能放大"的暗示，比只放一个图标更直白。
          // 逆位时加 is-rev —— 只倒置内层 .mv-inner，不动盒子本身。
          '<div class="mh-face" id="mh-face" role="button" tabindex="0" aria-label="放大查看牌面">' +
            '<div class="cv-card' + (rev ? ' is-rev' : '') + '"><div class="mv-inner">' + UI.faceHTML(card) + '</div></div>' +
          '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="mh-name">' + UI.esc(card.name || card.keyword || '猫卡') + '</div>' +
            (card.name && card.keyword ? '<div class="mh-keyword">关键词 · <b>' + UI.esc(card.keyword) + '</b></div>' : '') +
            (rev ? '<div class="mh-rev">逆位</div>' : '') +
          '</div>' +
          '<button type="button" class="mh-lens" id="mh-lens" aria-label="放大查看牌面">' +
            '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="meaning-body">' +
          '<div class="meaning-label">牌义「说明」</div>' +
          // 牌面句当索引：有就印在第一段；没有就不印，正文照常从下面开始。
          // 空值是正常状态 —— 索引句与正文第一句重复时就不该印两遍（「对象a」那张，用户有意删的）。
          (card.faceText ? '<div class="meaning-index">' + UI.esc(card.faceText) + '</div>' : '') +
          UI.esc(card.meaning || '（这张卡还没有「说明」，可以去牌库编辑补充。）') +
        '</div>' +
        '<div class="meaning-foot">' +
          '<button type="button" class="btn btn-ghost btn-close" style="flex:1">收起</button>' +
        '</div>' +
      '</div>';
    layer.classList.remove('is-hidden');
    layer.querySelector('.btn-close').addEventListener('click', hideMeaning);
    const openV = function () { openViewer(card, rev); };
    layer.querySelector('#mh-face').addEventListener('click', openV);
    layer.querySelector('#mh-lens').addEventListener('click', openV);
  }

  /* ============================================================
   * 牌面放大查看器（牌义弹层之上再盖一层，全屏）
   *   · 双指缩放 / 单指拖动 / 双击复位 / 点任意处关闭
   *   · 独立一层，以后牌库、选牌台想复用直接调 openViewer(card, rev)
   *   · 逆位：只给 .mv-inner 加 rotate(180deg)，不碰外面的 .tcard（项目硬规则）
   * ============================================================ */
  let _viewerOpenedAt = 0;
  function openViewer(card, rev) {
    const layer = els.meaningLayer;
    if (!layer || layer.querySelector('.mv')) return;   // 已经开着
    // ★ 放大时优先用「高清大图」——只有牌组在设定页开了「高清牌面」、
    //   并且这张卡是开了之后新选/重裁过图，才会有 imageHi。
    //   没有就退回原图：老卡放大到 1× 就到源分辨率上限了，糊是正常的（不是 bug）。
    //   顺手说明为什么这里值得单独一张：查看器牌面约 258 CSS px 宽、乘 dpr 约 710 设备像素，
    //   而台面用的 720 宽原图正好卡在这个数上 —— 所以 1× 勉强、再放大就是纯拉伸。
    const vcard = card.imageHi ? Object.assign({}, card, { image: card.imageHi }) : card;
    _viewerOpenedAt = Date.now();
    const v = document.createElement('div');
    v.className = 'mv';
    v.innerHTML =
      '<div class="mv-top">' +
        '<button type="button" class="mv-x" id="mv-close" aria-label="关闭">✕</button>' +
        '<div class="mv-title">' + UI.esc(card.name || card.keyword || '猫卡') +
          (rev ? '<em>逆位</em>' : '') + '</div>' +
        '<span style="width:36px;flex:none"></span>' +
      '</div>' +
      '<div class="mv-stage" id="mv-stage">' +
        '<div class="mv-zoom" id="mv-zoom">' +
          '<div class="cv-card mv-face' + (rev ? ' is-rev' : '') + '">' +
            '<div class="mv-inner">' + UI.faceHTML(vcard) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="mv-hint">双指缩放 · 双击复位 · 点空白处关闭</div>';
    layer.appendChild(v);
    v.querySelector('#mv-close').addEventListener('click', function () { closeViewer(); });
    bindViewerGestures(v);
  }

  // 关掉查看器；返回 true 表示"确实关了一个"（返回键靠这个决定要不要吃掉这次返回）
  function closeViewer() {
    const v = els.meaningLayer && els.meaningLayer.querySelector('.mv');
    if (!v) return false;
    v.remove();
    return true;
  }

  function bindViewerGestures(v) {
    const stage = v.querySelector('#mv-stage');
    const zoom = v.querySelector('#mv-zoom');
    // 上限从 4× 收到 2.5×：1440 的大图在 2× 正好 1:1，2.5× 只超一点；
    // 没大图的老卡也一样受这个上限保护，至少不会糊到 4× 那种程度。
    const MAXS = 2.5;
    let sc = 1, tx = 0, ty = 0;
    const ptrs = Object.create(null);
    let start = null, moved = false, lastTap = 0, noClose = false;

    function apply() { zoom.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + sc + ')'; }
    function ids() { return Object.keys(ptrs); }
    function ptDist() {
      const k = ids(), a = ptrs[k[0]], b = ptrs[k[1]];
      return Math.hypot(a.x - b.x, a.y - b.y) || 1;
    }
    function ptMid() {
      const k = ids(), a = ptrs[k[0]], b = ptrs[k[1]];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    function clampPan() {
      const r = stage.getBoundingClientRect();
      const lx = (r.width || 320) * 0.6 * sc, ly = (r.height || 420) * 0.6 * sc;
      tx = Math.max(-lx, Math.min(lx, tx));
      ty = Math.max(-ly, Math.min(ly, ty));
    }
    function reset() {
      sc = 1; tx = 0; ty = 0;
      zoom.style.transition = 'transform .18s ease';
      apply();
      setTimeout(function () { zoom.style.transition = ''; }, 220);
    }
    // 手指是不是落在"牌面"上（用于区分"双击复位"和"点空白关闭"）。
    // ★ 可以用 getBoundingClientRect：它已经把 translate/scale 算进去了。
    function insideCard(x, y) {
      const r = zoom.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }
    function rearm() {
      const k = ids();
      if (k.length === 1) {
        const p = ptrs[k[0]];
        start = { mode: 'pan', x: p.x, y: p.y, tx: tx, ty: ty };
      } else if (k.length === 2) {
        const m = ptMid();
        start = { mode: 'pinch', d: ptDist(), sc: sc, mx: m.x, my: m.y, tx: tx, ty: ty };
      } else start = null;
    }

    stage.addEventListener('pointerdown', function (e) {
      if (Date.now() - _viewerOpenedAt < 300) return;   // 刚打开那一下别当交互
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      if (ids().length === 1) {
        moved = false; noClose = false;
        const now = Date.now();
        const onCard = insideCard(e.clientX, e.clientY);
        // 双击"牌面"才复位。点在空白处不该参与双击 —— 那第一下就已经把它关了。
        if (now - lastTap < 300 && onCard) { reset(); noClose = true; lastTap = 0; }
        else lastTap = onCard ? now : 0;
      }
      rearm();
    });

    stage.addEventListener('pointermove', function (e) {
      if (!ptrs[e.pointerId] || !start) return;
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      if (start.mode === 'pan' && ids().length === 1) {
        tx = start.tx + (e.clientX - start.x);
        ty = start.ty + (e.clientY - start.y);
        if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 6) moved = true;
      } else if (start.mode === 'pinch' && ids().length >= 2) {
        sc = Math.max(1, Math.min(MAXS, start.sc * (ptDist() / start.d)));
        const m = ptMid();
        tx = start.tx + (m.x - start.mx);
        ty = start.ty + (m.y - start.my);
        moved = true;
      }
      clampPan();
      apply();
    });

    function up(e) {
      if (!ptrs[e.pointerId]) return;
      const wasSingle = ids().length === 1;
      delete ptrs[e.pointerId];
      // 没动过的单击：点在**牌面以外**（空白处）才关闭 —— 点牌面留给"双击复位"。
      // ★ 用坐标判断，不用 e.target：setPointerCapture 之后事件一律被重定向到 stage，
      //   e.target 已经不是手指底下那个元素了。
      if (wasSingle && !moved && !noClose) {
        if (!insideCard(e.clientX, e.clientY)) closeViewer();
      } else rearm();
    }
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', function (e) { delete ptrs[e.pointerId]; rearm(); });
    apply();
  }

  let _pendingBackUid = null;
  function hideMeaning() {
    closeViewer();                       // 收起弹层时顺手把查看器也收掉
    els.meaningLayer.classList.add('is-hidden');
    _pendingBackUid = null;
  }

  /* ============================================================
   * 选牌台 (从当前激活堆)
   * ============================================================ */
  let trayOpen = false;
  function trayToggle() {
    if (trayOpen) trayClose(); else trayOpen_();
  }
  function trayOpen_() {
    if (!session) return;
    const pile = activePile();
    if (!pile) { UI.toast('还没有牌堆'); return; }
    if (!pileRemainingCards(pile).length) { UI.toast('当前牌堆已抽完，点「重来」或换一副'); return; }
    // ★ 2026-10-15：同理 —— 会开选牌台就说明人已经上手了，教程层别留在下面罩着桌面（见 onDraw 的注释）
    if (!pullTutSeen()) { tutLockUntil = 0; closePullTut(true, true); markPullTutSeen(); }
    autoShuffleIfNeeded(pile);      // ★ 这一局第一次点开：自动洗牌
    renderTrayGrid();
    els.trayLayer.classList.remove('is-hidden');
    trayOpen = true;
  }
  function trayClose() {
    els.trayLayer.classList.add('is-hidden');
    trayOpen = false;
  }
  // 设置页改「缩略牌背」时调它：选牌台开着就重画一遍
  function refreshTray() { if (trayOpen) renderTrayGrid(); }

  function renderTrayGrid() {
    const pile = activePile();
    if (!pile) return;
    const deck = D.findDeck(pile.deckId);
    if (!deck) return;
    const cards = pileRemainingCards(pile);
    /* ★ 2026-10-15：标题带上**牌堆名**。选牌台是 z-index:200 的全屏层，一开就把底下
       唯一能看出"现在哪一堆"的牌堆栏整个盖住，而标题原来只有一句"剩 N 张" ——
       用户在满屏牌背里挑牌，压根不知道这些牌属于哪副牌组（deck 明明已经取到了）。
       下面还有一条更暗的坑：牌堆被换掉时 activePileId 会被静默改写，标题只变了个数字。 */
    els.trayTitle.textContent = '选牌台 · ' + (deck.name || '未命名') + ' · 剩 ' + cards.length + ' 张';
    if (!cards.length) {
      els.trayGrid.innerHTML = '<div class="tray-empty">这副抽完啦 🎉<br>收起后点「重来」洗回，或切到其它牌堆</div>';
      els.trayTitle.textContent = '选牌台 · ' + (deck.name || '未命名') + ' · 已抽完';
      return;
    }
    const edgeCls = (deck.backEdge !== false) ? ' is-edge' : '';   // 纸边跟着这副牌组的设定
    // ★ 小牌背也跟着这副牌组的**模板**走（划杠那副就该是划杠）。
    //   不能还是那颗 ✦ —— 选牌台是用户看得最多的地方。其它模板保持原样（它们是叠层纹）。
    const tplCls = '';
    // ★ 跟着这副牌组的牌背走：自己的图 > 内置模板 > ✦（2026-09-20 补：以前只认模板，
    //   用户自己放的图在选牌台根本不显示）
    const backMark = UI.backThumbImg(deck, 'tc-img') + UI.backThumbInner(deck, 'tc-tpl', 'tc-logo');
    const slotHTML = function (card) {
      if (pile.drawn.has(card.id)) return '<div class="tray-slot"></div>';
      return '<div class="tray-card' + tplCls + edgeCls + '" data-id="' + UI.esc(card.id) + '">' + backMark + '</div>';
    };
    if (pile.trayFill && pile.trayOrder && pile.trayOrder.length) {
      // 洗过牌：槽位顺序**固定**为那次洗牌的结果。洗牌那一下已经把空位补齐（牌都在前排），
      // 之后每抽一张只是把该槽位变成空槽，其余牌一律不动 —— 这就是"填充是一次性的"。
      const byId = {};
      deck.cards.forEach(function (c) { byId[c.id] = c; });
      const seen = {}, cells = [];
      pile.trayOrder.forEach(function (id) {
        if (byId[id] && !seen[id]) { seen[id] = 1; cells.push(byId[id]); }
      });
      cards.forEach(function (c) { if (!seen[c.id]) cells.push(c); });   // 洗牌之后新加的牌接在后面
      els.trayGrid.innerHTML = cells.map(slotHTML).join('');
    } else {
      // 未洗牌：按牌堆原始顺序铺满槽位，抽走的显示为空槽（不补位，其余牌不动）
      els.trayGrid.innerHTML = deck.cards.map(slotHTML).join('');
    }
  }

  // 洗牌：把「还没抽走」的牌洗乱并排拢到前面 —— 一次性填掉当前的空槽。
  // 之后每抽一张只留一个空槽，不再自动重排（这就是"填充是一次性的"）。
  // ★ 2026-09-18：不再有「洗牌」按钮，改成**自动** ——
  //   进 App / 点「重来」之后，第一次点开选牌台时洗一次；每副牌堆每局只洗一次。
  function shufflePile(pile) {
    if (!pile) return false;
    const ids = pileRemainingCards(pile).map(function (c) { return c.id; });
    if (!ids.length) return false;
    pile.trayOrder = shuffled(ids);
    pile.trayFill = true;              // 只表示"槽位顺序用这次洗牌结果"，不代表每次重排
    pile.autoShuffled = true;
    return true;
  }
  function autoShuffleIfNeeded(pile) {
    if (!pile || pile.autoShuffled) return;   // 这一局已经洗过 → 不重复洗（抽走的牌位要留住）
    shufflePile(pile);
  }



  // 洗牌：Fisher-Yates 本体已收进 js/random.js（crypto 随机源 + 拒绝采样），
  // 这里只留一个别名，选牌台/走查都还按老名字调。
  function shuffled(ids) { return RND.shuffle(ids); }

  function onTrayCardClick(e) {
    const tile = e.target.closest ? e.target.closest('.tray-card') : null;
    if (!tile) return;
    if (!session) return;
    const pile = activePile();
    if (!pile) return;
    const id = tile.dataset.id;
    const card = pileRemainingCards(pile).find(c => c.id === id);
    if (!card) return;
    pile.drawn.add(id);
    const drawnCard = dealToDesk(card);
    // 选牌台手点发牌: 不再弹「已发出」提示(用户要求去掉, 牌本身已落桌可见)
    // 抽走后该格留空(不自动补位), 其余牌原地不动
    renderTrayGrid();
    renderPileStrip();
    updateTrayCount();
  }

  /* ---------- UI 同步 ---------- */
  function updateDeckUI() {
    if (!session) return;
    const pile = activePile();
    const left = pile ? pileRemainingCards(pile).length : 0;
    els.trayBtnCount.textContent = left;
    els.btnTray.classList.toggle('is-hidden', !pile || left === 0);
  }
  function updateTrayCount() {
    if (!session || !els.trayBtnCount) return;
    const pile = activePile();
    // ★ 用"实时剩余数"而不是 pile.cardCount - drawn.size：
    //   cardCount 是会话开始/上次 syncPiles 时的**快照**，而 renderPileStrip 里的
    //   剩余数用的是 d.cards.length（实时）—— 两个来源一过期就会互相打架
    //   （牌堆栏显示 0、右下角角标显示 -1 这种）。统一成实时那条。
    const live = pile ? pileRemainingCards(pile) : null;
    const left = live ? live.length : 0;
    els.trayBtnCount.textContent = left;
    els.btnTray.classList.toggle('is-hidden', left === 0);
  }
  function showFieldTip() {
    if (!session) return;
    if (session.tableCards.length === 0 && session.piles.some(p => p.cardCount > 0)) {
      els.hint && els.hint.classList.remove('is-hidden');
    } else {
      els.hint && els.hint.classList.add('is-hidden');
    }
  }

  /* ---------- 引导覆盖层 ---------- */
  function showCover(icon, title, sub, actionText, onAction, secondaryText) {
    els.coverIcon.textContent = icon || '✦';
    els.coverTitle.textContent = title || '';
    els.coverSub.textContent = sub || '';
    els.btnCoverAction.textContent = actionText || '好';
    els.btnCoverAction.onclick = onAction || (function () { hideCover(); });
    const sec = els.btnCoverSecondary;
    if (secondaryText) {
      sec.textContent = secondaryText;
      sec.style.display = '';
      sec.onclick = hideCover;
    } else sec.style.display = 'none';
    els.cover.classList.remove('is-hidden');
  }
  function hideCover() { els.cover.classList.add('is-hidden'); }

  /* ---------- 对外接口 ---------- */
  global.MoKa = global.MoKa || {};
  global.MoKa.table = {
    init, openTable, playDeck, resetSession, syncPiles,
    showCover, hideCover, onCardTap,
    // hideMeaning / closeViewer 必须导出：index.html 的系统返回键要靠它们
    // （之前漏了 hideMeaning，返回键那句一直在抛错被 try 吞掉 → 弹层关不掉）
    hideMeaning, openViewer, closeViewer,
    // 左边缘抽屉 + 首次提示：系统返回键要先收它们
    closePullDrawer, openPullDrawer,
    // 自跑测试用（下划线结尾是本项目的测试钩子约定）
    closePullTut, showPullTut_, _pullTutKey: PULL_TUT_KEY,
    _tutLockMs: TUT_LOCK_MS,                                  // 走查断言用
    _tutUnlockNow: function () { tutLockUntil = 0; tutRender(); },  // 走查里把 5 秒拨过去
    trayOpen_: trayOpen_, trayClose, refreshTray, relayoutDesk, dealToDesk, refreshCardSize,
    resetCamera, renderPileStrip,
    // 自跑测试用：只读快照（下划线结尾 = 本项目的测试钩子约定，和 trayOpen_ 一样）
    snapshot_: function () {
      if (!session) return null;
      return {
        tableCards: session.tableCards.length,
        // 镜头也一起给出去：验证「起点跟着视野走」时，要能拿到真实的平移量
        // （屏幕坐标那套在无头环境里量不出来，只能量 cam 的差）
        cam: { x: cam.x, y: cam.y, scale: cam.scale },
        activePileId: session.activePileId,
        tableCardIds: session.tableCards.map(function (t) { return t.card && t.card.id; }),
        piles: session.piles.map(function (p) {
          const dk = D.findDeck(p.deckId);
          return {
            deckId: p.deckId, name: p.name,
            // ★ cardCount 用**实时**张数：界面早就统一成实时了（§27），
            //   这里的 p.cardCount 是会话快照、会过期，拿它当"模型"会自己骗自己。
            cardCount: dk ? dk.cards.length : 0,
            snapCardCount: p.cardCount,        // 快照值留着，出问题时能对照
            drawn: p.drawn.size, drawnIds: Array.from(p.drawn)
          };
        })
      };
    }
  };
})(window);
