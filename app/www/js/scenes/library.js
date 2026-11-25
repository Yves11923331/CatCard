/* ============================================================
 * 猫卡 · 牌库 (library.js)
 * ------------------------------------------------------------
 * 页面栈: home(牌组列表) → deck(某牌组的猫卡列表) → card(编辑一张猫卡)
 * 猫卡字段: 卡名 / 关键词(可开关上牌面) / 简洁(不上牌面) / 牌义「说明」
 * 卡面样式: 卡名与关键词的位置(上中下)+文字背景色/透明度(每卡独立); 牌背以牌组为单位
 *          (image 字段已预留, 供后续"上传图片"功能使用)
 * ============================================================ */
(function (global) {
  'use strict';
  const D = global.MoKa.data;
  const UI = global.MoKa.ui;

  const pages = {};
  let currentDeckId = null;   // deck 页正在查看的牌组
  let editingCardId = null;   // card 页正在编辑的猫卡 (null=新建)

  function init() {
    pages.home = document.getElementById('lib-home');
    pages.deck = document.getElementById('lib-deck');
    pages.editor = document.getElementById('lib-editor');
    pages.back = document.getElementById('lib-back');

    // 牌组变化 → 若在对应页面, 自动刷新
    D.subscribe(function () {
      if (pages.home.classList.contains('is-active')) renderHome();
      else if (pages.deck.classList.contains('is-active') && currentDeckId) renderDeckList();
      else if (pages.editor.classList.contains('is-active') && currentDeckId) { /* 编辑态由草稿持有, 不整体刷新 */ }
    });
    renderHome();
  }

  /* ---------- 页面栈导航 ---------- */
  function go(name) {
    Object.keys(pages).forEach(function (k) {
      pages[k].classList.toggle('is-active', k === name);
    });
  }
  /* 系统返回键：编辑页 → 牌组页 → 首页；已在首页返回 false（交给 app 回占卜桌） */
  function back() {
    if (hideManual()) return true;   // 说明弹层开着 → 返回键先关它（不是关整个牌库）
    if (pages.editor.classList.contains('is-active') && global.MoKa.editor) { global.MoKa.editor.back(); return true; }
    if (pages.back.classList.contains('is-active')) { leaveBackGuarded(); return true; }   // 回它进来的地方（有改动先问）
    if (pages.deck.classList.contains('is-active')) { goHome(); return true; }
    return false;
  }
  function goHome() { currentDeckId = null; go('home'); renderHome(); }
  function goDeck(deckId) { currentDeckId = deckId; go('deck'); renderDeckList(); }
  /* ★ 2026-10-11「鲸造」重构：编辑猫卡整页移交给 scenes/editor.js（单屏编辑器）。
     这里只做转发，牌组页点卡 / 添加猫卡都走这个入口。 */
  function goCard(deckId, cardId) {
    currentDeckId = deckId;
    if (global.MoKa.editor) global.MoKa.editor.open(deckId, cardId);
    else goDeck(deckId);
  }
  /* ★ 2026-09-18 修：牌背设定页有**两个入口** ——
       ① 首页「我的牌组」每张牌盒上的「设定」
       ② 牌组页头里的「设定」
     原来它的「返回」和「保存设定」都写死 goDeck()，于是从首页进去、保存完却掉到牌组页
     （用户报的"设定→保存→竟然返回点击管理之后的那个界面"）。
     现在记下来路，原路返回。系统返回键也走同一个出口。 */
  let backFrom = 'deck';                       // 'home' | 'deck' | 'canvas'
  function goBack(deckId, from) {
    currentDeckId = deckId;
    backFrom = (from === 'home') ? 'home' : (from === 'canvas' ? 'canvas' : 'deck');
    go('back');
    renderBackEditor();
  }
  /* ★★ 2026-10-15：「牌背设定页」原来**没有未保存保护** ——
     这一页的改动只存在 backDraft 里，只有点「保存牌背」才写回数据层；
     而「‹ 返回」和系统返回键都直接走 leaveBack()，一句都不问。
     于是：牌库 → 牌背 → 选择图片 → 裁剪完成（大预览都换新图、主色也取好了）→ 点返回
     → 直接离开，牌背还是旧的，下次进来只能重选重裁重摆。同 App 的编辑页是有
     dirty 确认的（editor.back()），同一件事两套规矩。
     注：同页「缩略牌背」却是一点就写盘生效的，更容易让人以为整页都即时生效。 */
  function backIsDirty() {
    const d = D.findDeck(currentDeckId);
    if (!d || !backDraft) return false;
    return (backDraft.image || null) !== (d.backImage || null)
        || (backDraft.template || null) !== (d.backTemplate || null)
        || String(backDraft.color || '') !== String(d.backColor || '')
        || !!backDraft.edge !== (d.backEdge !== false)
        || !!backDraft.faceEdge !== (d.faceEdge !== false)
        || !!backDraft.useRev !== !!d.useRev
        || !!backDraft.hiRes !== !!d.hiRes;
  }
  /* 「‹ 返回」和系统返回键都走这里：有没保存的改动先问一句（「保存牌背」不经过它）。 */
  function leaveBackGuarded() {
    if (!backIsDirty()) { leaveBack(); return true; }
    UI.confirmDialog({
      icon: '⚠', title: '牌背还没保存',
      sub: '刚选的图片 / 颜色还没保存，离开就没了。',
      okText: '不保存', cancelText: '留下'
    }).then(function (ok) { if (ok) leaveBack(); });
    return true;
  }
  function leaveBack() {                       // 「返回」/「保存」/ 系统返回键 共用
    if (backFrom === 'home') { goHome(); return; }
    if (backFrom === 'canvas') {              // 从编辑页进来的，原路回编辑页（草稿还在）
      if (global.MoKa.editor) global.MoKa.editor.resume();
      else goDeck(currentDeckId);
      return;
    }
    goDeck(currentDeckId);
  }

  /* ============================================================
   * home: 牌组列表
   * ============================================================ */
  function renderHome() {
    const decks = D.listDecks();
    let html = '';
    if (!decks.length) {
      html = '<div style="text-align:center;padding:60px 20px;color:var(--ink-3)">' +
             '<div style="font-size:44px;margin-bottom:12px">🂡</div>' +
             '还没有牌组，点右上角「新建」开始吧' +
             '</div>';
    } else {
      html = decks.map(function (deck) {
        // 牌盒缩略背(默认蓝背 / 有 backImage 用图)
        // ★ 走 UI.backThumbStyle()：它认设置页那个「缩略牌背」开关（默认/个性图片）
        const backStyle = UI.backThumbStyle(deck);
        const on = D.isOnTable(deck.id);
        const tick = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4.5 4.5L19 7"/></svg>';
        return '<div class="deck-box' + (on ? '' : ' is-off') + '">' +
          '<div class="deck-box-back' + (UI.backThumbHasImg(deck) ? ' has-img' : '') +
              (UI.backThumbHasTpl(deck) ? ' has-tpl' : '') + '" style="' + backStyle + '">' +
            UI.backThumbInner(deck, 'dbb-tpl', 'dbb-mark') +
          '</div>' +
          '<div class="deck-box-main">' +
            '<div class="deck-box-top">' +
              '<div class="deck-box-name">' + UI.esc(deck.name) + '</div>' +
              '<button type="button" class="deck-check' + (on ? ' is-on' : '') + '" data-check="' + UI.esc(deck.id) + '"' +
                ' role="checkbox" aria-checked="' + (on ? 'true' : 'false') + '" title="勾上才会出现在占卜桌" aria-label="上占卜桌">' +
                (on ? tick : '') + '</button>' +
            '</div>' +
            '<div class="deck-box-meta">' + deck.cards.length + ' 张猫卡</div>' +
            '<div class="deck-box-actions">' +
              '<button type="button" class="btn btn-soft btn-deck-back" data-id="' + UI.esc(deck.id) + '">牌背</button>' +
              '<button type="button" class="btn btn-soft btn-edit" data-id="' + UI.esc(deck.id) + '">管理</button>' +
              '<button type="button" class="btn btn-soft btn-clone" data-id="' + UI.esc(deck.id) + '">克隆</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    // 头部：已选计数 + 全选/全不选
    const total = decks.length;
    const picked = D.tableDecks().length;
    pages.home.innerHTML =
      '<div class="lib-head">' +
        '<div class="lib-title">我的牌组<span class="lib-sub" id="on-table-count">' +
          picked + '/' + total + ' 上桌</span></div>' +
        '<button type="button" class="btn-mini" id="btn-check-all">' + (picked === total && total ? '全不选' : '全选') + '</button>' +
        '<button type="button" class="btn-mini" id="btn-new-deck">＋ 新建</button>' +
      '</div>' +
      '<div class="lib-scroll">' + html + '</div>';

    pages.home.querySelector('#btn-new-deck').addEventListener('click', onCreateDeck);
    // 勾选「上占卜桌」：只切换状态，点别处照旧进牌组页
    pages.home.querySelectorAll('[data-check]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const id = btn.dataset.check;
        const now = D.setOnTable(id, !D.isOnTable(id));
        btn.classList.toggle('is-on', now);
        btn.setAttribute('aria-checked', now ? 'true' : 'false');
        btn.innerHTML = now ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4.5 4.5L19 7"/></svg>' : '';
        const box = btn.closest('.deck-box');
        if (box) box.classList.toggle('is-off', !now);
        refreshOnTableHead();
        if (global.MoKa.table && global.MoKa.table.syncPiles) global.MoKa.table.syncPiles();
      });
    });
    const allBtn = pages.home.querySelector('#btn-check-all');
    if (allBtn) allBtn.addEventListener('click', function () {
      const allOn = D.tableDecks().length === decks.length && decks.length > 0;
      D.setAllOnTable(!allOn);
      renderHome();
      if (global.MoKa.table && global.MoKa.table.syncPiles) global.MoKa.table.syncPiles();
    });
    // 点牌组盒子本体（牌背缩略图/名字那块"牌面"）也进牌组页：以前只有里面那三个小按钮能点，
    // 点盒子本身完全没反应（真机上传来的"点击牌面没反应"）。
    // 点在小按钮上时不抢（那是 设定/管理/克隆 各自的活）。
    function refreshOnTableHead() {
      const el = pages.home.querySelector('#on-table-count');
      if (!el) return;
      const t = D.listDecks().length, p = D.tableDecks().length;
      el.textContent = p + '/' + t + ' 上桌';
      const b = pages.home.querySelector('#btn-check-all');
      if (b) b.textContent = (p === t && t) ? '全不选' : '全选';
    }
    /* ★ 2026-10-15：牌组的 id 先取一次 —— 原来 `D.listDecks()[i]` 写在 forEach 回调里，
       而 listDecks() 每次都是**整份牌组数组的 JSON 深拷贝**（data.js: clone = JSON.parse(JSON.stringify)），
       运行时每张卡的 image 又是完整 base64 dataURL：N 副牌组就白拷 N 遍全库，
       再叠上 renderHome/refreshOnTableHead 里另外那两三次，勾一下"上占卜桌"要拷 3 遍以上，
       牌一多就掉帧。这里只按顺序取 id 数组，语义与原来完全一致。 */
    const homeIds = D.listDecks().map(function (d) { return d.id; });
    pages.home.querySelectorAll('.deck-box').forEach(function (box, i) {
      const id = homeIds[i];
      if (!id) return;
      box.addEventListener('click', function (e) {
        if (e.target.closest && (e.target.closest('.deck-box-actions') || e.target.closest('.deck-check'))) return;
        goDeck(id);
      });
    });
    pages.home.querySelectorAll('.btn-deck-back').forEach(function (b) {
      b.addEventListener('click', function () { goBack(b.dataset.id, 'home'); });
    });
    pages.home.querySelectorAll('.btn-edit').forEach(function (b) {
      b.addEventListener('click', function () { goDeck(b.dataset.id); });
    });
    pages.home.querySelectorAll('.btn-clone').forEach(function (b) {
      b.addEventListener('click', function () {
        const deck = D.cloneDeck(b.dataset.id);
        if (deck) UI.toast('已克隆：' + deck.name);
        renderHome(); // 克隆会触发 subscribe → renderHome, 这行兜底
      });
    });
  }

  async function onCreateDeck() {
    const name = await UI.promptDialog({ title: '新建牌组', placeholder: '给牌组起个名字', okText: '创建' });
    if (name == null) return;
    if (!name) { UI.toast('名字不能为空'); return; }
    const deck = D.createDeck(name);
    goDeck(deck.id);
  }

  /* ============================================================
   * deck: 某个牌组的猫卡列表
   * ============================================================ */
  /* ============================================================
     牌组页：牌面缩略网格 + 长按拖动排序（2026-09-18，用户选 B+G）
     ------------------------------------------------------------
     B：白瓷砖 → **1:1.45 的牌面比例**小牌（顶上一道卡色条 + 名字 + symbol + 关键词）。
        原来白底里再套一层白卡，两层白框挤在一起，一堵"名字墙"；现在一眼是"一副牌"。
     G：长按 360ms 抬起 → 拖动换位（虚线槽位占位）→ 松手写回牌库顺序（D.moveCard）。
     ★ 几何全靠 getBoundingClientRect 现取；量不到就**只抬起、不重排** —— 宁可不动也别乱动。
     ============================================================ */
  const REORDER_HOLD = 360;          // 长按多久算"要拖动"（ms）
  const REORDER_SLOP = 10;           // 提前动了这么多 = 用户在滚列表，放弃长按
  let deckLastDragAt = 0;            // 刚拖完的时间戳：用来吃掉尾随的那次 click

  function deckCardHTML(card, i) {
    // ★ 2026-09-21（用户选的方案 B）：牌盒＝**缩小的牌面**，调的就是占卜桌那张牌同一个渲染器
    //   UI.faceHTML(card)。以前这里另拼一套小布局（色条/名字/徽记/关键词各写一遍），于是每加一种
    //   图案都得在这套里再补一行 —— 牌背、自定义牌面图、层级条都是这么补出来的，还漏过。
    //   现在牌面里设计的东西一律自动出现。尺寸由外层 .deck-grid 上的 --card-w 控制（见 renderDeckList）。
    return '<div class="grid-tile deck-card dc-face-tile" data-id="' + UI.esc(card.id) + '">' +
      '<div class="dc-facebox"><div class="tcard-inner">' + UI.faceHTML(card) + '</div></div>' +
      '<span class="dc-no">' + (i + 1) + '</span>' +
    '</div>';
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
  }
  // 落点索引 = "离手指最近的那一格"（纯函数，方便自跑测试直接喂坐标）
  function dropIndexFromRects(rs, x, y) {
    let best = 0, bd = Infinity;
    rs.forEach(function (r, i) {
      const cx = (r.l + r.r) / 2, cy = (r.t + r.b) / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  function bindDeckReorder(grid, deck) {
    const tiles = Array.prototype.slice.call(grid.querySelectorAll('.deck-card'));
    if (tiles.length < 2) return;                       // 一两张就别折腾了

    let drag = null;          // { el, slot, sx, sy, noGeo, id }

    function stopDrag(commit) {
      if (!drag) return;
      const d = drag; drag = null;
      deckLastDragAt = Date.now();
      if (d.scrollBlock) {
        document.removeEventListener('touchmove', d.scrollBlock, { passive: false });
        d.scrollBlock = null;
      }
      d.el.classList.remove('is-lift', 'no-anim');
      // ★ 只清我加的那几个属性，别用 cssText='' —— 会把行内的 --ck（卡色）一起抹掉
      ['position', 'left', 'top', 'width', 'height', 'transform'].forEach(function (k) { d.el.style[k] = ''; });
      let to = -1;
      if (commit && !d.noGeo && d.slot.parentNode) {
        // 槽位前面有多少张"别的牌"，就是新位置
        to = 0;
        for (let i = 0; i < grid.children.length; i++) {
          const ch = grid.children[i];
          if (ch === d.slot) break;
          if (ch !== d.el && ch.classList && ch.classList.contains('deck-card')) to++;
        }
      }
      if (d.slot.parentNode) d.slot.parentNode.removeChild(d.slot);
      if (to >= 0) {
        const moved = D.moveCard(deck.id, d.id, to);    // 写回数据 → 订阅会重渲这一页
        if (moved) UI.toast('顺序已保存');
      } else {
        renderDeckList();                               // 没提交/量不到：重渲回原样
      }
    }

    tiles.forEach(function (el) {
      el.addEventListener('pointerdown', function (e) {
        if (drag) return;
        const sx = e.clientX, sy = e.clientY;
        let hold = setTimeout(function () {
          hold = null;
          lift(el, sx, sy);
        }, REORDER_HOLD);
        const bail = function (ev) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > REORDER_SLOP) quit();
        };
        const quit = function () {
          if (hold) { clearTimeout(hold); hold = null; }
          el.removeEventListener('pointermove', bail);
          el.removeEventListener('pointerup', quit);
          el.removeEventListener('pointercancel', quit);
        };
        el.addEventListener('pointermove', bail);
        el.addEventListener('pointerup', quit);
        el.addEventListener('pointercancel', quit);
      });
    });

    function lift(el, sx, sy) {
      const r = rectOf(el);
      const noGeo = !r.w;                               // 无头/异常环境量不到尺寸
      const slot = document.createElement('div');
      slot.className = 'deck-slot';
      if (!noGeo) { slot.style.width = r.w + 'px'; slot.style.height = r.h + 'px'; }
      grid.insertBefore(slot, el);

      drag = { el: el, slot: slot, sx: sx, sy: sy, noGeo: noGeo, id: el.dataset.id, scrollBlock: null };
      el.classList.add('is-lift', 'no-anim');
      if (!noGeo) {
        el.style.position = 'fixed';
        el.style.left = r.l + 'px';
        el.style.top = r.t + 'px';
        el.style.width = r.w + 'px';
        el.style.height = r.h + 'px';
      }
      // 拖动期间按住滚动：WebView 里 touchmove 不拦掉的话，手指一动列表就跟着滚
      drag.scrollBlock = function (ev) { ev.preventDefault(); };
      document.addEventListener('touchmove', drag.scrollBlock, { passive: false });

      const onMove = function (ev) {
        if (!drag) return;
        const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
        drag.el.style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0)';
        if (drag.noGeo) return;
        const others = tiles.filter(function (t) { return t !== drag.el; });
        const rs = others.map(rectOf);
        const k = dropIndexFromRects(rs, ev.clientX, ev.clientY);
        const target = others[k], tr = rs[k];
        if (!target || !tr) return;
        const after = ev.clientX > (tr.l + tr.r) / 2;
        if (after) grid.insertBefore(drag.slot, target.nextSibling);
        else grid.insertBefore(drag.slot, target);
      };
      const onUp = function () { end(true); };
      const onCancel = function () { end(false); };
      function end(commit) {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
        stopDrag(commit);
      }
      drag.end = end;
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
    }
  }

  /* ★ 牌组「使用说明」弹层（2026-10-06）——
     完全通用：谁有 deck.manual 就显示谁，本文件里没有写死任何一副牌的名字。
     数据来源 = decks/<key>/deck.json 的 manual 字段（经 tools/内置牌组.py 生成进注册表）。 */
  /* 说明书从**注册表实时取**（不写进 deck 对象、也就不落盘）——
     理由：它是"这副内置牌"的说明，不该占用户的 localStorage；
     克隆/导入出来的牌组没有 builtinKey，自然就没有说明书，正合语义。 */
  function deckManual(deck) {
    if (!deck || !deck.builtinKey) return null;
    const B = global.MoKaBuiltinDecks || [];
    for (let i = 0; i < B.length; i++) {
      if (B[i] && B[i].key === deck.builtinKey) return B[i].manual || null;
    }
    return null;
  }
  function renderSpread(layouts) {
    let h = '';
    (layouts || []).forEach(function (L) {
      const slots = L.slots || [];
      h += '<div class="spread-row">' +
        (L.name ? '<div class="spread-name">' + UI.esc(L.name) + '</div>' : '') +
        '<div class="spread ' + (L.shape === 'diamond' ? 'is-diamond' : 'is-row') + '">' +
        slots.map(function (x) { return '<div class="spread-slot">' + UI.esc(x) + '</div>'; }).join('') +
        '</div></div>';
    });
    return h;
  }
  /* 说明正文的**轻标记**（按行套样式，省得靠全角空格对齐）：
       `#` 小标题 · `-` 说明项 · `>` 批注 · 空行 = 段间隔 · 其余 = 正文 */
  function renderManualBody(body) {
    const lines = String(body || '').split('\n');
    let h = '';
    lines.forEach(function (ln) {
      const t = ln.trim();
      if (!t) { h += '<div class="ml-gap"></div>'; return; }
      const c = t.charAt(0), rest = t.slice(1).trim();
      if (c === '#') h += '<div class="ml-h">' + UI.esc(rest) + '</div>';
      else if (c === '-') h += '<div class="ml-i">' + UI.esc(rest) + '</div>';
      else if (c === '>') h += '<div class="ml-note">' + UI.esc(rest) + '</div>';
      else h += '<div class="ml-p">' + UI.esc(t) + '</div>';
    });
    return h;
  }
  function showManual(deck) {
    const mn = deckManual(deck);
    if (!mn) return false;
    let el = document.getElementById('manual-layer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'manual-layer';
      el.className = 'manual-layer';
      document.body.appendChild(el);
      el.addEventListener('pointerdown', function (e) { if (e.target === el) hideManual(); });
    }
    let body = '';
    (mn.sections || []).forEach(function (sec) {
      body += '<div class="manual-sec">';
      if (sec.title) body += '<div class="manual-sec-h">' + UI.esc(sec.title) + '</div>';
      if (sec.kind === 'spread' && Array.isArray(sec.layouts)) body += renderSpread(sec.layouts);
      if (sec.body) body += '<div class="manual-sec-b">' + renderManualBody(sec.body) + '</div>';
      body += '</div>';
    });
    el.innerHTML =
      '<div class="manual-panel">' +
        '<div class="manual-head">' +
          '<div class="manual-title">' + UI.esc(mn.title || (deck.name + ' · 说明')) + '</div>' +
        '</div>' +
        '<div class="manual-scroll">' + body + '</div>' +
        '<div class="manual-foot">' +
          '<button type="button" class="btn btn-ghost btn-block" id="btn-manual-close">收起</button>' +
        '</div>' +
      '</div>';
    el.classList.add('is-on');
    const cb = el.querySelector('#btn-manual-close');
    if (cb) cb.addEventListener('click', hideManual);
    return true;
  }
  function hideManual() {
    const el = document.getElementById('manual-layer');
    if (!el || !el.classList.contains('is-on')) return false;   // 没开着 → 别吃返回键
    el.classList.remove('is-on');
    return true;
  }

  function renderDeckList() {
    const deck = D.findDeck(currentDeckId);
    if (!deck) { goHome(); return; }
    let html =
      '<div class="lib-head">' +
        '<button type="button" class="btn-mini" id="btn-back-home">‹ 返回</button>' +
        '<div class="lib-title">' + UI.esc(deck.name) + '</div>' +
        (deckManual(deck) ? '<button type="button" class="btn-mini" id="btn-deck-manual">说明</button>' : '') +
        '<button type="button" class="btn-mini" id="btn-deck-settings">牌背</button>' +
        '<button type="button" class="btn-mini" id="btn-rename-deck">改名</button>' +
      '</div>';

    const addTile = '<div class="grid-tile grid-add-tile deck-add" id="btn-add-card"><div>' +
      '<div class="gt-symbol">＋</div>' + (deck.cards.length ? '添加猫卡' : '添加第一张猫卡') + '</div></div>';
    let grid;
    if (!deck.cards.length) {
      grid = '<div style="text-align:center;padding:30px 20px 18px;color:var(--ink-3)">' +
             '<div style="font-size:38px;margin-bottom:10px">🂮</div>' +
             '这个牌组还没有猫卡' +
             '</div>' +
             '<div class="card-grid deck-grid">' + addTile + '</div>';
    } else {
      grid = '<div class="deck-hint">' + deck.cards.length + ' 张 · 长按可拖动排序</div>' +
        '<div class="card-grid deck-grid">' +
          deck.cards.map(deckCardHTML).join('') + addTile +
        '</div>';
    }

    html += '<div class="lib-scroll">' + grid +
      '<div style="height:14px"></div>' +
      '<div class="sec-card">' +
        '<div class="sec-card-h">管理</div>' +
        '<div class="sec-card-actions">' +
          '<button type="button" class="btn btn-soft" id="btn-deck-import">导入</button>' +
          '<button type="button" class="btn btn-soft" id="btn-deck-export">导出</button>' +
        '</div>' +
        '<button type="button" class="btn btn-danger btn-block" id="btn-del-deck">删除整个牌组</button>' +
      '</div>' +
      '</div>';

    // 整页重渲染
    pages.deck.innerHTML = html;

    pages.deck.querySelector('#btn-back-home').addEventListener('click', goHome);
    pages.deck.querySelector('#btn-rename-deck').addEventListener('click', onRenameDeck);
    pages.deck.querySelector('#btn-deck-settings').addEventListener('click', function () { goBack(currentDeckId, 'deck'); });
    const mnBtn = pages.deck.querySelector('#btn-deck-manual');
    if (mnBtn) mnBtn.addEventListener('click', function () { showManual(deck); });
    const exd = pages.deck.querySelector('#btn-deck-export');
    if (exd) exd.addEventListener('click', function () { if (global.MoKa.io) global.MoKa.io.exportDeck(currentDeckId); });
    const imd = pages.deck.querySelector('#btn-deck-import');
    if (imd) imd.addEventListener('click', function () { if (global.MoKa.io) global.MoKa.io.importTo(currentDeckId); });
    const addBtn = pages.deck.querySelector('#btn-add-card');
    if (addBtn) addBtn.addEventListener('click', function () { goCard(currentDeckId, null); });
    const gridEl = pages.deck.querySelector('.deck-grid');
    if (gridEl) {
      // 牌面的尺寸全都按 --card-w 算，所以这里量一次第一个格子的宽度，设给整栏。
      // ★ jsdom / 隐藏时量不到（getBoundingClientRect 全 0）→ 兜底 104px，别写死成 0。
      const first = gridEl.querySelector('.dc-face-tile');
      const measured = first ? Math.round(first.getBoundingClientRect().width) : 0;
      const w = measured > 40 ? measured : 104;
      gridEl.style.setProperty('--card-w', w + 'px');
      gridEl.style.setProperty('--card-h', Math.round(w * 1.45) + 'px');
      bindDeckReorder(gridEl, deck);
    }
    pages.deck.querySelectorAll('.grid-tile[data-id]').forEach(function (t) {
      t.addEventListener('click', function () {
        // 刚长按拖过一次就别顺手把编辑页打开了（长按完松手也会补一次 click）
        if (Date.now() - deckLastDragAt < 450) return;
        goCard(currentDeckId, t.dataset.id);
      });
    });
    pages.deck.querySelector('#btn-del-deck').addEventListener('click', onDeleteDeck);
  }

  async function onRenameDeck() {
    const deck = D.findDeck(currentDeckId);
    const name = await UI.promptDialog({ title: '重命名牌组', value: deck.name, okText: '保存' });
    if (name == null) return;
    if (!name) { UI.toast('名字不能为空'); return; }
    D.renameDeck(currentDeckId, name);
    renderDeckList(); // 订阅也会触发, 这里避免双刷也 OK
  }

  async function onDeleteDeck() {
    const deck = D.findDeck(currentDeckId);
    const ok = await UI.confirmDialog({
      icon: '✕',
      title: '删除牌组？',
      sub: '「' + deck.name + '」及其 ' + deck.cards.length + ' 张猫卡都会被删除，无法恢复。',
      okText: '删除',
      cancelText: '再想想'
    });
    if (!ok) return;
    D.deleteDeck(currentDeckId);
    // ★ 立刻同步占卜桌的牌堆栏：不然刚删掉的牌组会以"幽灵牌堆"的样子留在牌堆栏里，
    //   点它只会提示「抽完了」。以前是靠切回占卜桌时 openTable→syncPiles 兜的，
    //   这里主动补一次，别依赖"用户一定会切场景"。
    if (global.MoKa.table && global.MoKa.table.syncPiles) global.MoKa.table.syncPiles();
    goHome();
  }

  /* ============================================================
   * back: 编辑牌背 (自定义图 / 边框模板 / 自动主色)
   * ============================================================ */
  /* 边框模板（2026-09-18：4 → 8 个；名字统一成 2~3 个字，chip 排起来才整齐）
     画法全在 v3.css 第 34 节：一次声明、牌面与大预览两处生效，
     所以这里加一条只需要加个 id + 名字。
     ★ 2026-09-21：「斜纹」（diag）**下架** —— 它和「竖纹」来回切看不出区别，用户让删了。
       老装机上存过 diag 的牌组由 data.js 的 migrateDroppedBacks 静默认到「竖纹」，
       模板表里有没有这一项都不影响那些牌组显示。 */
  const BACK_TPL = [
    { id: null,       name: '无边框' },
    { id: 'frame',    name: '金线' },
    { id: 'double',   name: '双线' },
    { id: 'lozenge',  name: '菱纹' },
    { id: 'corner',   name: '四角' },
    { id: 'dotted',   name: '点线' },
    { id: 'stripe',   name: '竖纹' },
    // ★ 内置牌背（aegis/guax/hero…）已数据化（decks/<key>/back.svg），不再进这张通用模板表。
  ];
  /* ============================================================
   * 缩略牌背（2026-10-11 从设置页搬来）
   * ------------------------------------------------------------
   * 这三处的**小牌背**显示「个性图片」还是「默认样子」：
   *   牌库的牌盒、占卜桌上那一摞、选牌台的小背。
   * 翻开的那张牌永远用这副牌组自己的牌背，不受这里影响。
   * ★ 放在牌背设定页 = 用户不用再记"设置里还有个牌背开关"。
   * ============================================================ */
  const TB_LEVELS = [
    { v: 'own',     t: '个性图片', note: '有自己放的牌背图就显示它（默认）' },
    { v: 'default', t: '默认',     note: '一律用默认样子（✦ / 内置划杠·盾印）' }
  ];
  function thumbBackNow() { return (D.getThumbBack ? D.getThumbBack() : 'own'); }
  function tbNote(v) {
    const L = TB_LEVELS.filter(function (x) { return x.v === v; })[0] || TB_LEVELS[0];
    return L.note;
  }
  /* 改完立刻把三处缩略背重画一遍（桌面那摞 + 选牌台 + 牌库列表） */
  function refreshThumbs() {
    try { if (global.MoKa.table && global.MoKa.table.renderPileStrip) global.MoKa.table.renderPileStrip(); } catch (e) {}
    try { if (global.MoKa.table && global.MoKa.table.refreshTray) global.MoKa.table.refreshTray(); } catch (e) {}
    try { renderHome(); } catch (e) {}
  }

  let backDraft = null; // { image, template, color }

  function renderBackEditor() {
    const deck = D.findDeck(currentDeckId);
    if (!deck) { goHome(); return; }
    // 进入时载入当前牌背作为草稿
    backDraft = {
      image: deck.backImage || null,
      template: deck.backTemplate || null,
      color: deck.backColor || '#8a7a3a',
      edge: deck.backEdge !== false,        // 牌背纸边：默认开
      faceEdge: deck.faceEdge !== false,    // 牌面纸边：默认开
      useRev: !!deck.useRev,
      hiRes: !!deck.hiRes
    };

    pages.back.innerHTML =
      '<div class="lib-head">' +
        '<button type="button" class="btn-mini" id="btn-back-home2">‹ 返回</button>' +
        '<div class="lib-title">牌背 · ' + UI.esc(deck.name) + '</div>' +
      '</div>' +
      '<div class="lib-scroll">' +
        '<div class="back-preview-wrap" id="back-pv-wrap"></div>' +

        /* —— 一、牌背外观 —— */
        '<div class="sec-card">' +
          '<div class="sec-card-h">牌背外观</div>' +
          '<button type="button" class="btn btn-soft btn-block" id="btn-pick-img">选择图片</button>' +
          '<div class="set-hint">选图后会进入裁剪：可拖动位置、双指缩放，固定 2:3。完成后自动生成同色边框。</div>' +
          '<div class="set-lb" style="margin-top:18px">边框模板<span class="dim">颜色自动取图主色</span></div>' +
          '<div class="tpl-row" id="tpl-row">' +
            (function () {
              const shown = [];
              BACK_TPL.forEach(function (t, i) {
                // 内置模板不跨界显示：谁声明的这个模板，只有那副（及其克隆/改名）看得见
                if (t.builtin && !D.deckOwnsBack(deck, t.id) && deck.backTemplate !== t.id) return;
                shown.push({ t: t, i: i });                                                   // data-idx 用**原表**下标
              });
              return shown.map(function (x) {
                return '<button type="button" class="tpl-chip' + (backDraft.template === x.t.id ? ' is-sel' : '') +
                  '" data-idx="' + x.i + '">' + UI.esc(x.t.name) + '</button>';
              }).join('');
            })() +
          '</div>' +
        '</div>' +

        /* —— 二、纸边：两个开关并排放在同一组，方便对着调 —— */
        '<div class="sec-card">' +
          '<div class="sec-card-h">纸边</div>' +
          '<div class="set-row">' +
            '<span class="set-lb">牌背纸边</span>' +
            '<span class="seg">' +
              '<button type="button" class="seg-btn' + (backDraft.edge !== false ? ' is-sel' : '') + '" id="edge-on">开</button>' +
              '<button type="button" class="seg-btn' + (backDraft.edge === false ? ' is-sel' : '') + '" id="edge-off">关</button>' +
            '</span>' +
          '</div>' +
          '<div class="set-row">' +
            '<span class="set-lb">牌面纸边</span>' +
            '<span class="seg">' +
              '<button type="button" class="seg-btn' + (backDraft.faceEdge !== false ? ' is-sel' : '') + '" id="face-on">开</button>' +
              '<button type="button" class="seg-btn' + (backDraft.faceEdge === false ? ' is-sel' : '') + '" id="face-off">关</button>' +
            '</span>' +
          '</div>' +
        '</div>' +

        /* —— 三、牌面与翻牌 —— */
        '<div class="sec-card">' +
          '<div class="sec-card-h">牌面与翻牌</div>' +
          '<div class="set-row">' +
            '<span class="set-lb">正逆位</span>' +
            '<span class="seg">' +
              '<button type="button" class="seg-btn' + (backDraft.useRev ? ' is-sel' : '') + '" id="rev-on">开</button>' +
              '<button type="button" class="seg-btn' + (backDraft.useRev ? '' : ' is-sel') + '" id="rev-off">关</button>' +
            '</span>' +
          '</div>' +
          '<div class="set-hint">建议在使用上下对称的牌背时开启</div>' +
          /* ★ 2026-10-11：「高清牌面」开关**下架**（用户指出冗余）——
             裁剪输出统一 1080 宽后，查看器本来就够清晰，再存一张 1440 大图是重复劳动。
             老数据里的 imageHi 仍会被查看器优先使用（读逻辑没动）。 */
          '<div class="set-hint">牌面图统一按 1080 宽高清输出（够放大镜看），不再需要单独的高清开关。</div>' +
        '</div>' +

        /* —— 缩略牌背（2026-10-11 从设置页搬来：和"牌背"放在一起，用户不用记两处） —— */
        '<div class="sec-card">' +
          '<div class="sec-card-h">缩略牌背</div>' +
          '<div class="set-row">' +
            '<span class="set-lb">小牌背用</span>' +
            '<span class="seg" id="tb-seg">' +
              TB_LEVELS.map(function (L) {
                return '<button type="button" class="seg-btn' + (thumbBackNow() === L.v ? ' is-sel' : '') +
                  '" data-tb="' + L.v + '">' + L.t + '</button>';
              }).join('') +
            '</span>' +
          '</div>' +
          '<div class="set-hint" id="tb-hint">' + tbNote(thumbBackNow()) + '</div>' +
          '<div class="set-hint">只影响三处<b>小牌背</b>：牌库的牌盒、占卜桌上那一摞、选牌台的小背。' +
            '翻开的那张牌永远用这副牌组自己的牌背。</div>' +
        '</div>' +

        /* —— 底部操作 —— */
        '<div class="sec-card sec-card-actions">' +
          '<button type="button" class="btn btn-ghost" id="btn-back-default">恢复默认</button>' +
          '<button type="button" class="btn btn-primary" id="btn-back-save">保存牌背</button>' +
        '</div>' +
      '</div>';

    refreshBackEditorUI();
    /* 这一页有 4 组「开 / 关」，全是同一个控件语言 —— 用一个 bindSeg 统一，
       不要再各写一份（原来 正逆位 / 高清 / 纸边 三套几乎一样的代码）。 */
    function bindSeg(onId, offId, get, set) {
      const bOn = pages.back.querySelector('#' + onId);
      const bOff = pages.back.querySelector('#' + offId);
      function sync() {
        if (bOn) bOn.classList.toggle('is-sel', !!get());
        if (bOff) bOff.classList.toggle('is-sel', !get());
      }
      if (bOn) bOn.addEventListener('click', function () { set(true); sync(); refreshBackEditorUI(); });
      if (bOff) bOff.addEventListener('click', function () { set(false); sync(); refreshBackEditorUI(); });
      sync();
    }
    bindSeg('edge-on',  'edge-off',  function () { return backDraft.edge !== false; },
                                     function (v) { backDraft.edge = v; });
    bindSeg('face-on',  'face-off',  function () { return backDraft.faceEdge !== false; },
                                     function (v) { backDraft.faceEdge = v; });
    bindSeg('rev-on',   'rev-off',   function () { return !!backDraft.useRev; },
                                     function (v) { backDraft.useRev = v; });
    /* ★ 下架：高清牌面开关（见上面的说明） */

    /* 缩略牌背：点一下立刻重画三处小牌背 */
    Array.prototype.forEach.call(pages.back.querySelectorAll('#tb-seg button'), function (b) {
      b.addEventListener('click', function () {
        const v = b.dataset.tb;
        if (D.setThumbBack) D.setThumbBack(v);
        Array.prototype.forEach.call(pages.back.querySelectorAll('#tb-seg button'), function (x) {
          x.classList.toggle('is-sel', x.dataset.tb === v);
        });
        const hint = pages.back.querySelector('#tb-hint');
        if (hint) hint.textContent = tbNote(v);
        refreshThumbs();
        UI.toast('缩略牌背：' + b.textContent);
      });
    });

    pages.back.querySelector('#btn-back-home2').addEventListener('click', leaveBackGuarded);
    pages.back.querySelector('#btn-pick-img').addEventListener('click', onPickImage);
    pages.back.querySelector('#btn-back-default').addEventListener('click', function () {
      // 只重置"牌背"本身；正逆位不是牌背的东西，别顺手关掉
      backDraft = { image: null, template: null, color: '#8a7a3a', edge: true, faceEdge: true,
                    useRev: backDraft.useRev };
      refreshBackEditorUI();
    });
    pages.back.querySelector('#btn-back-save').addEventListener('click', function () {
      D.setDeckBack(currentDeckId, {
        image: backDraft.image,
        template: backDraft.template,
        color: backDraft.color,
        edge: backDraft.edge,
        faceEdge: backDraft.faceEdge
      });
      try { D.setUseRev(currentDeckId, !!backDraft.useRev); } catch (e) {}
      UI.toast('牌背已保存');
      leaveBack();          // ★ 回它进来的地方（首页进来的就回首页）
    });
    // 模板行
    BACK_TPL.forEach(function (t, idx) {
      const el = pages.back.querySelector('#tpl-row .tpl-chip[data-idx="' + idx + '"]');
      if (el) el.addEventListener('click', function () {
        backDraft.template = t.id;
        refreshBackEditorUI();
      });
    });
  }

  // 根据草稿刷新: 大预览 + 模板选中态
  function refreshBackEditorUI() {
    if (!pages.back) return;
    const wrap = pages.back.querySelector('#back-pv-wrap');
    if (wrap) {
      wrap.innerHTML =
        '<div class="back-preview' + (backDraft.template ? ' is-tpl-' + backDraft.template : '') +
          (backDraft.edge !== false ? ' is-edge' : '') + '" style="--bk:' + UI.esc(backDraft.color) + '">' +
          (backDraft.image
            ? '<div class="bp-img" style="background-image:url(\'' + UI.esc(backDraft.image) + '\')"></div>'
            : '<div class="bp-img" style="background:radial-gradient(circle at 32% 22%,rgba(255,255,255,.16),transparent 58%),var(--bk, #8a7a3a)"></div>') +
          (D.builtinBackSvg(backDraft.template) ? '<div class="bp-tpl">' + D.builtinBackSvg(backDraft.template) + '</div>' : '') +
        '</div>';
      let fb = wrap.nextElementSibling;
      if (!fb || fb.id !== 'back-fb') {
        fb = document.createElement('div');
        fb.id = 'back-fb';
        wrap.parentNode.insertBefore(fb, wrap.nextSibling);
      }
      let tname = '无边框';
      BACK_TPL.forEach(function (t) { if (t.id === backDraft.template) tname = t.name; });
      fb.textContent = '当前边框模板：' + tname + (backDraft.image ? '（边框颜色自动取图主色）' : '');
    }
    // 模板选中态
    // 模板选中态：现在是纯文字 chip，不用再同步缩略图
    pages.back.querySelectorAll('#tpl-row .tpl-chip').forEach(function (it) {
      const t = BACK_TPL[+it.dataset.idx];
      if (t) it.classList.toggle('is-sel', backDraft.template === t.id);
    });
  }

  function onPickImage() {
    try {
      if (!global.MoKa.imagecrop) { UI.toast('裁剪组件未加载，请刷新页面'); return; }
      global.MoKa.imagecrop.open({
        onDone: function (dataURL, err) {
          try {
            if (!dataURL) { if (err && err.message !== '已取消') UI.toast('未选择图片'); return; }
            backDraft.image = dataURL;
            refreshBackEditorUI();           // 先显示图
            UI.extractColor(dataURL, function (hex) {   // 再取主色(异步)
              try {
                if (backDraft.image === dataURL) { backDraft.color = hex || '#8a7a3a'; refreshBackEditorUI(); }
              } catch (e1) { console.error(e1); }
            });
          } catch (e2) {
            console.error('[选图完成回调出错]', e2);
            UI.toast('处理图片出错: ' + (e2 && e2.message || e2));
          }
        }
      });
    } catch (e3) {
      console.error('[打开裁剪器出错]', e3);
      UI.toast('打开裁剪器出错: ' + (e3 && e3.message || e3));
    }
  }

  /* ---------- 对外接口 ---------- */
  global.MoKa = global.MoKa || {};
  /* ★ 2026-10-11「鲸造」重构：编辑猫卡整页移交给 scenes/editor.js。
     这里把页面切换与底栏开关借给它（_go / _setTabbar），
     牌组页点卡仍走 goCard（内部转发 editor.open）。 */
  function setTabbar(on) {
    const tb = document.getElementById('tabbar');
    if (tb) tb.style.display = on ? '' : 'none';
  }
  global.MoKa.library = {
    init,
    goHome,
    goDeck,
    goCard,
    goBack, leaveBack,
    showManual, hideManual,
    back,
    renderHome,
    _go: go,
    _setTabbar: setTabbar,
    // 自跑测试用：落点索引是纯函数，直接喂坐标就能验
    _dropIndex: dropIndexFromRects
  };
})(window);
