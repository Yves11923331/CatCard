/* ============================================================
 * 猫卡 · 对话 (scenes/chat.js)
 * ------------------------------------------------------------
 * 一个聊天窗口：你说一句，对方从**所有签文包 + 所有牌组**里回你一签 / 一牌 / 一签+一牌。
 *
 * ★ 对方是一套"脾气"（固定，不给用户挑），它会：
 *   ① 不回消息（非应答：真的不回，不再重试）
 *   ② 撤回消息（本地内容一起删掉，只留一行"对方撤回了一条消息"）
 *   ③ 打字有自己的速度（显示"正在输入"，长签看得见慢慢打）
 *   ④ 回复条数跟你发的**不必相等**（可能 0 条、1 条、连回两三条）
 *   这一切都是本机随机，没有服务器、没有真的另一个人。
 *
 * ★ 2026-09-27 轻量化：删掉「作息表」整套（睡眠 / 深度睡眠 / 被吵醒 / 午睡 /
 *   在忙 / 拉黑）以及它给四个参数上的倍率 —— 回不回、打多久、追加几条，
 *   现在只由设置页那几个数决定，不再随一天里的时间变化。
 * ============================================================ */
(function (global) {
  'use strict';

  var RND = global.MoKa.random;      // 不回 / 撤回 / 打字停顿 / 抽签抽牌：统一 crypto 随机源

  var K_MSG = 'moka.chat.v1';        // 消息数组
  var K_CFG = 'moka.chat.cfg.v1';    // 脾气/作息用到的小状态
  var MAX_MSG = 200;

  /* ---------------- 脾气（固定一套，不露给用户） ---------------- */
  var PROFILE = {
    typePauseP: 0.08, typePause: [400, 800],     // 打字途中偶尔停一下
    recallDelay: [800, 3000]                     // 撤回发生在发出后的这个区间内
  };
  var DEFAULTS = {
    /* 彩蛋三件套 */
    silenceP: 0.1,       // 非应答概率 %（默认千分之一）
    speed: 12,           // 打字速度 字/秒
    typeMaxMs: 3000,     // 打字封顶（伪设置：只展示 3.0 秒）
    recallP: 5,          // 撤回概率 %
    retypeP: 40,         // 撤回后改口重发 %（余下的概率 = 干脆不回）
    /* 追加回复 */
    appendP: 0.5,        // 追加概率 %（默认千分之五）
    appendCap: 1,        // 最多追加几条（伪设置：只展示）
    appendGapOn: true,   // 追加前有没有冷却
    appendGapMs: 60000,  // 冷却时长（毫秒，界面按分钟显示：0.5–1440 分钟）
    /* 内容（三项按权重自动摊平） */
    lotP: 50,            // 出签权重
    cardP: 45,           // 出卡权重
    bothP: 5             // 签+卡权重（小概率事件）
  };

  var page = null, msgs = loadMsgs(), cfg = loadCfg();
  var inScene = false, view = 'roll';        // view: roll（聊天）| settings（设置）
  var timers = [], fastMode = false, force = {};
  var roundInFlight = false, emitsPending = 0;   // R1：只允许一轮在飞，并等它的"打字"落完
  var gen = 0;                                    // 清空/离开时 +1：之前排的回调全部作废（防竞态）

  /* ---------------- 存档 ---------------- */
  function loadMsgs() {
    var a = null;
    try { a = JSON.parse(localStorage.getItem(K_MSG) || 'null'); } catch (e) {}
    return Array.isArray(a) ? a.filter(function (m) {
      return m && (m.text || m.recalled || (m.parts && (m.slip || m.card)));
    }) : [];
  }
  function saveMsgs() {
    try { localStorage.setItem(K_MSG, JSON.stringify(msgs.slice(-MAX_MSG))); return true; }
    catch (e) { global.MoKa.ui && global.MoKa.ui.toast && global.MoKa.ui.toast('存不下：手机存储写入失败'); return false; }
  }
  /* 用户可调的选项（界面在「对话 → 设置」里；每项都配一段可折叠的说明） */
  function loadCfg() {
    var o = null;
    try { o = JSON.parse(localStorage.getItem(K_CFG) || 'null'); } catch (e) {}
    var set = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      set[k] = (o && o.set && o.set[k] !== undefined) ? o.set[k] : DEFAULTS[k];
    });
    /* 老配置迁移（按存档版本号一次一次往上补，改过的值不覆盖） */
    var v = (o && +o.ver) || 0;
    /* 构建85：非应答概率的默认值从 20% 降成千分之一 */
    if (v < 2 && set.silenceP === 20) set.silenceP = 0.1;
    /* 构建91：撤回概率的默认值从 10% 降到 5%（没动过这个值的老存档跟着降） */
    if (v < 3 && set.recallP === 10) set.recallP = 5;
    /* 构建95：冷却时长从「秒」改成「分钟」（0.5–1440）。老存档都是秒级（< 0.5 分钟），抬到新默认 1 分钟 */
    if (v < 4 && (+set.appendGapMs || 0) < 30000) set.appendGapMs = 60000;
    return {
      ver: 4,
      lastAt: (o && o.lastAt) || 0,
      set: set
    };
  }
  function saveCfg() { try { localStorage.setItem(K_CFG, JSON.stringify(cfg)); } catch (e) {} }
  function S(k) { return cfg.set[k]; }
  function pct(k) { return Math.max(0, Math.min(100, +S(k) || 0)) / 100; }
  function num(v, dec) { return (Math.round(+v * Math.pow(10, dec)) / Math.pow(10, dec)).toFixed(dec); }
  function hm2m(str) { var a = String(str || '').split(':'); return (+a[0] || 0) * 60 + (+a[1] || 0); }
  function esc(t) { return global.MoKa.ui.esc(t == null ? '' : String(t)); }
  /* 全符号化的图标（底栏与设置页共用，不带汉字）——
     ★ 每个键都必须在这儿有一笔，缺了就画不出图标（icon() 会往 svg 里塞 undefined） */
  var ICON = {
    silent: '<path d="M20 12c0 3.9-3.6 7-8 7-1 0-2-.2-2.9-.5L4.5 20l1.2-3.4C4.6 15.4 4 13.7 4 12c0-3.9 3.6-7 8-7s8 3.1 8 7z"/><path d="M5.2 18.8L18.8 5.2"/>',
    recall: '<path d="M4.4 9.2h8.8a5 5 0 0 1 0 10H8.4"/><path d="M7.8 5.6L4.2 9.2l3.6 3.6"/>',
    append: '<rect x="3.4" y="5.4" width="12.6" height="6.6" rx="2.2"/><rect x="8" y="13.2" width="12.6" height="5.4" rx="2.2"/>',
    lot:    '<path d="M6.4 3.6h11.2v16.8H6.4z"/><path d="M9.2 8h5.6M9.2 11.4h5.6M9.2 14.8h3.2"/>',
    type:   '<path d="M3 7.6h18v8.8H3z"/><path d="M6.2 10.6h.01M9.2 10.6h.01M12.2 10.6h.01M15.2 10.6h.01M18 10.6h.01M7.6 13.6h8.8"/>',
    awake:  '<circle cx="12" cy="12" r="7.4"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>',
    sliders: '<path d="M4 7h5.6"/><circle cx="12.4" cy="7" r="2.2"/><path d="M14.6 7H20"/>' +
             '<path d="M4 12h9.6"/><circle cx="7.4" cy="12" r="2.2"/><path d="M9.6 12H20"/>' +
             '<path d="M4 17h5.6"/><circle cx="12.4" cy="17" r="2.2"/><path d="M14.6 17H20"/>'
  };
  function icon(k, size, sw) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) + '" fill="none" ' +
      'stroke="currentColor" stroke-width="' + (sw || 1.7) + '" stroke-linecap="round" stroke-linejoin="round">' +
      ICON[k] + '</svg>';
  }
  function $(s) { return page ? page.querySelector(s) : null; }
  function uid() { return RND.uid('m'); }
  function rnd(a, b) { return RND.range(a, b); }
  function pick(a) { return RND.pick(a); }
  function P(k) { return (force[k] !== undefined) ? force[k] : PROFILE[k]; }   // 走查可临时改脾气
  function later(fn, ms) {
    var g = gen;
    var t = setTimeout(function () {
      timers = timers.filter(function (x) { return x !== t; });
      if (g !== gen) return;                       // 已经清空/离开过：这一枪作废
      fn();
    }, fastMode ? Math.max(15, ms * 0.02) : Math.max(15, ms));
    timers.push(t);
    return t;
  }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  /* ---------------- 回复材料：所有签文 + 所有卡 ---------------- */
  function allLots() {
    var L = global.MoKa.lots, out = [];
    if (L && L.packs) {
      (L.packs() || []).forEach(function (p) {
        (p && p.lots ? p.lots : []).forEach(function (t) {
          var s = String(t == null ? '' : t).trim();
          if (s) out.push({ text: s, from: (p.name || '') });
        });
      });
    }
    return out;
  }
  function allCards() {
    var D = global.MoKa.data, out = [];
    if (!D || !D.listDecks) return out;
    (D.listDecks() || []).forEach(function (dk) {
      (dk && dk.cards ? dk.cards : []).forEach(function (c) {
        if (!c || !c.name) return;
        var head = String(c.name) + (c.keyword ? ' · ' + c.keyword : '');
        var body = String(c.meaning || '').trim();
        out.push({ head: head, body: body, from: (dk.name || ''), deckId: dk.id, cardId: c.id });
      });
    });
    return out;
  }
  function lastLotText() {
    for (var i = msgs.length - 1; i >= 0; i--) {
      var m = msgs[i];
      if (m.who !== 'lot' || m.recalled) continue;
      if (m.slip && m.slip.text) return m.slip.text;
      if (m.card && m.card.title) return m.card.title;
      if (m.text) return m.text;
    }
    return null;
  }
  function pickOne(pool, lastText) {
    if (!pool.length) return null;
    if (pool.length === 1) return pool[0];
    for (var i = 0; i < 6; i++) {
      var c = pick(pool);
      if (c.text !== lastText && c.head !== lastText) return c;
    }
    return pick(pool);
  }
  /* 内容：出签 / 出卡 / 签+卡 三项按权重自动摊平（和不必等于 100，按比例分） */
  function weights() {
    var a = Math.max(0, +S('lotP') || 0), b = Math.max(0, +S('cardP') || 0), c = Math.max(0, +S('bothP') || 0);
    if (a + b + c <= 0) { a = 50; b = 45; c = 5; }
    var sum = a + b + c;
    return { lot: a / sum, card: b / sum, both: c / sum };
  }
  function rollReply() {
    var lots = allLots(), cards = allCards();
    if (!lots.length && !cards.length) {
      return { slip: null, card: null, order: 'slip-first',
               empty: '（还没有签文和猫卡 —— 先去「神签」写几条，或在「牌库」里添几张卡）' };
    }
    var last = lastLotText(), w = weights();
    var r = RND.float(), useLot = false, useCard = false;
    if (r < w.lot) useLot = true;
    else if (r < w.lot + w.card) useCard = true;
    else { useLot = true; useCard = true; }                     // 签+卡：小概率事件
    if (!lots.length) { useLot = false; useCard = true; }        // 池子空的时候别抽空
    if (!cards.length) { useLot = true; useCard = false; }
    var slip = null, card = null;
    if (useLot) { var L = pickOne(lots, last); if (L) slip = { text: L.text, from: L.from }; }
    if (useCard) { var C = pickOne(cards, last); if (C) card = { deckId: C.deckId, cardId: C.cardId, title: C.head, body: C.body, from: C.from }; }
    return { slip: slip, card: card, order: RND.float() < 0.5 ? 'card-first' : 'slip-first' };
  }
  function replyChars(got) {
    var n = 0;
    if (got.slip && got.slip.text) n += String(got.slip.text).length;
    if (got.card) n += String(got.card.title || '').length + String(got.card.body || '').length;
    return n;
  }

  /* ---------------- 一次回应的流程 ----------------
     一条回复 = 主条（打字后发出）+ 彩蛋：撤回（→改口 或 干脆不回）／追加（冷却后再补一条）。
     撤回与追加互斥；一轮里最多撤回 1 次，追加上限看伪设置 appendCap（现在固定 1 条）。 */
  function send() {
    var inp = $('#ch-in');
    if (!inp) return;
    var text = String(inp.value || '').trim();
    if (!text) return;
    inp.value = '';
    msgs.push({ id: uid(), who: 'me', text: text, ts: Date.now() });
    if (msgs.length > MAX_MSG) msgs = msgs.slice(-MAX_MSG);
    saveMsgs();
    var l = $('#ch-list');
    if (l && l.querySelector('.ch-empty')) l.innerHTML = listHTML();
    else appendBubble(msgs[msgs.length - 1]);
    if (msgs.length === 1) refreshHead();
    toBottom();
    cfg.lastAt = Date.now();
    startRound();
  }
  function settle() { if (emitsPending <= 0) roundInFlight = false; }
  function startRound() {
    if (roundInFlight) return;           // 同一时间只处理一轮
    roundInFlight = true;
    runRound();
  }
  /* 判非应答（不回就是真的不回，不再重试） */
  function runRound() {
    var silent = Math.max(0, Math.min(0.99, pct('silenceP')));
    if (RND.float() < silent) {
      roundInFlight = false;
      setFlash('TA不想回复', 5000);          // ★ 触发非应答 → 底栏亮 5 秒
      return;
    }
    fire(rollReply(), Math.max(1, Math.round(+S('appendCap') || 1)), false);
  }
  /* ③ 打字（字数 ÷ 速度，封顶 3 秒），打完把这条发出去 */
  function emitReply(got, done) {
    var chars = replyChars(got);
    var speed = Math.max(1, (+S('speed') || 12)) * rnd(0.8, 1.25);
    var cap = Math.max(500, (+S('typeMaxMs') || 3000));
    var ms = Math.min(cap, Math.max(400, chars / Math.max(1, speed) * 1000));
    if (RND.float() < P('typePauseP')) ms = Math.min(cap, ms + rnd(P('typePause')[0], P('typePause')[1]));
    setTyping(true);
    later(function () {
      setTyping(false);
      pushReply(got);
      done && done();
    }, ms);
  }
  /* 发一条，并处理它的彩蛋；left = 这一轮还剩几次追加额度，noRecall = 这条不再抽撤回（防连环） */
  function fire(got, left, noRecall) {
    emitsPending++;
    emitReply(got, function () {
      var id = msgs.length ? msgs[msgs.length - 1].id : null;
      /* 撤回 → 改口重发一条 或 干脆不回 */
      if (!noRecall && RND.float() < pct('recallP')) {
        later(function () {
          recallById(id);
          endOne();                                   // 撤回的这条到此为止
          if (RND.float() < pct('retypeP')) fire(rollReply(), left, true);
        }, rnd(P('recallDelay')[0], P('recallDelay')[1]));
        return;
      }
      /* 追加：冷却之后再补一条；关掉冷却就紧接着补上。
         ★ 冷却期间**不占着"一轮在飞"**。老写法为了防重入把计数顶住，
         冷却只有一两秒时无所谓；现在冷却按分钟算、最长 1440 分钟，
         顶住就等于这整整一天里你发什么都没人回（startRound 一直早退）。 */
      if (left > 0 && RND.float() < pct('appendP')) {
        var go = function () { fire(rollReply(), left - 1, true); };
        endOne();                                          // 这一轮就地结账
        if (S('appendGapOn')) later(go, Math.max(200, +S('appendGapMs') || 60000));
        else go();
        return;
      }
      endOne();
    });
  }
  function endOne() { emitsPending--; settle(); }
  function pushReply(got) {
    if (got.empty) msgs.push({ id: uid(), who: 'lot', text: got.empty, pack: '', ts: Date.now() });
    else msgs.push({ id: uid(), who: 'lot', parts: true, slip: got.slip, card: got.card,
                     order: got.order, open: false, ts: Date.now() });
    if (msgs.length > MAX_MSG) msgs = msgs.slice(-MAX_MSG);
    saveMsgs();
    appendBubble(msgs[msgs.length - 1]);
    toBottom();
  }
  function recallById(id) {
    var m = null;
    msgs.forEach(function (x) { if (x.id === id) m = x; });
    if (!m) return;
    /* ★ 用户要求：本地内容一起删掉（不是只把 UI 藏起来） */
    delete m.slip; delete m.card; delete m.text; delete m.pack; delete m.parts;
    m.recalled = true; m.ts = Date.now();
    saveMsgs();
    var row = $('#ch-list') && $('#ch-list').querySelector('[data-id="' + id + '"]');
    if (row) row.outerHTML = bubble(m);
    toBottom();
  }

  /* ---------------- 画 ---------------- */
  function cardFace(ref) {
    if (!ref || !global.MoKa.data || !global.MoKa.ui) return '';
    var dk = global.MoKa.data.findDeck(ref.deckId);
    if (!dk) return '';
    var card = (dk.cards || []).filter(function (c) { return c && c.id === ref.cardId; })[0];
    if (!card) return '';
    var st = global.MoKa.data.withCardStyle ? global.MoKa.data.withCardStyle(card) : card;
    return '<div class="ch-card" style="--card-w:104px">' + global.MoKa.ui.faceHTML(st) + '</div>';
  }
  function bodyHTML(m) {
    var t = m.text, ti = m.title;
    if (ti && t.indexOf(ti) >= 0) {
      var i = t.indexOf(ti);
      return esc(t.slice(0, i)) + '<b class="ch-t">' + esc(ti) + '</b>' + esc(t.slice(i + ti.length));
    }
    return esc(t);
  }
  function slipHTML(sp) { return (sp && sp.text) ? '<div class="ch-txt">' + esc(sp.text) + '</div>' : ''; }
  function cardHTML(m) {
    var cd = m.card;
    if (!cd) return '';
    var face = cardFace(cd);
    if (!face) {
      return (cd.title || cd.body)
        ? '<div class="ch-txt"><b class="ch-t">' + esc(cd.title || '') + '</b>' +
          (cd.body ? '\n' + esc(cd.body) : '') + '</div>' : '';
    }
    var open = !!m.open;
    return '<div class="ch-cardbox">' + face +
      '<div class="ch-t">' + esc(cd.title || '') + '</div>' +
      (cd.body
        ? '<button class="ch-more" type="button" data-open="' + esc(m.id) + '">' +
            (open ? '收起牌义' : '展开牌义') + '<i>' + (open ? '▴' : '▾') + '</i></button>' +
          '<div class="ch-body' + (open ? ' is-open' : '') + '">' + esc(cd.body) + '</div>'
        : '') +
      '</div>';
  }
  function fromOf(m) {
    if (m.pack) return m.pack;
    var a = [];
    if (m.slip && m.slip.from) a.push(m.slip.from);
    if (m.card && m.card.from) a.push(m.card.from);
    return a.join(' · ');
  }
  function bubble(m) {
    if (m.who === 'sys') {
      return '<div class="ch-sys" data-id="' + esc(m.id) + '">' + esc(m.text) + '</div>';
    }
    var mine = m.who === 'me';
    var inner;
    if (m.recalled) inner = '<div class="ch-recall">对方撤回了一条消息</div>';
    else if (mine || !m.parts) inner = (mine ? '' : cardFace(m.card)) + bodyHTML(m);
    else {
      var first = m.order === 'card-first' ? ['card', 'slip'] : ['slip', 'card'];
      inner = first.map(function (k) { return k === 'card' ? cardHTML(m) : slipHTML(m.slip); }).join('');
    }
    var from = (mine || m.recalled) ? '' : fromOf(m);
    return '<div class="ch-row ' + (mine ? 'me' : 'them') + '" data-id="' + esc(m.id) + '">' +
      (mine ? '' : '<div class="ch-face">签</div>') +
      '<div class="ch-bub' + (m.recalled ? ' is-recall' : '') + '">' + inner +
        (from ? '<span class="ch-from">' + esc(from) + '</span>' : '') +

      '</div></div>';
  }
  function listHTML() {
    if (!msgs.length) {
      return '<div class="ch-empty"><div class="t">说点什么</div>' +
        '<div class="d">你发一句，我回你一签、一牌，或一签加一牌。<br>材料来自「神签」的所有签文包和「牌库」的所有猫卡。</div></div>';
    }
    return msgs.map(bubble).join('') +
      '<div class="ch-row them is-typing" id="ch-typing" hidden><div class="ch-face">签</div>' +
      '<div class="ch-bub ch-typing"><span>正在输入</span><i></i><i></i><i></i></div></div>';
  }
  function headHTML() {
    return '<div class="lib-head">' +
      '<button class="btn-mini" type="button" data-act="back">‹ 返回</button>' +
      '<div class="lib-title">对话</div>' +
      (msgs.length ? '<button class="btn-mini" type="button" data-act="clear">清空</button>' : '') +
    '</div>';
  }
  function refreshHead() {
    var h = $('.lib-head');
    if (h) h.outerHTML = headHTML();
  }
  /* 底部：状态条 + 进设置（清空已回到右上角，跟原来一样）
     ★ 左边这行字是**纯装饰**：对方是本机随机，没有真实"状态"可言，它只是不定时换一句闲话，
     让这个窗口看着像个活物（在线 / 摸鱼中 / 很期待收到你的信息…）。
     有两件事会抢这行字，因为这两件是**真的**：
       ① 正在输入（气泡里同时也有三点动画）
       ② 非应答「TA不想回复」，闪 5 秒 —— 不告诉用户，他就会一直干等 */
  /* ★ 纯装饰的一句话，3 分钟换一次 —— 间隔见 startRotate() 里的 IDLE_MS */
  var IDLE = [
    '在线', '在的', '在呢', '一直在', '没走',
    '守着', '等着', '等你开口', '慢慢来，不急', '不催你',
    '摸鱼中', '摸鱼', '假装很忙', '摸一会儿鱼', '偷个懒',
    '发呆', '发呆中', '闲着', '有点无聊', '无所事事',
    '打个盹', '刚醒', '还没睡', '睡了个回笼觉', '有点困',
    '打了个哈欠', '伸个懒腰', '揉揉眼睛', '翻个身', '刚泡了杯茶',
    '喝了口水', '啃了个苹果', '在剥橘子', '晒会儿太阳', '听外面的声音',
    '看窗外的云', '听雨', '屋里挺安静', '灯有点暗', '数牌背上的花纹',
    '把牌摊开又收起来', '洗了一遍牌', '在翻牌玩', '看签文看到出神', '读签文读上瘾了',
    '又读了一遍旧签', '在整理签文包', '给牌组排了个序', '重新数了数牌', '想给你抽一张',
    '心里过了一遍卦', '琢磨六十四卦', '记不住卦名，在背', '在看英雄之旅那副', '翻到了 Overflow 那张',
    '抽到一张好牌，收起来了', '牌都备好了', '签文也备好了', '正把牌摆整齐', '在等一个问句',
    '等你问点什么', '很期待收到你的信息', '想听你说说今天', '你怎么还不说话', '要不要聊两句',
    '有点想说话', '攒了一句话没说', '说句话吧', '别客气', '想抽就抽',
    '想聊就聊', '求签也行', '都可以', '随你', '看你',
    '就等你一句话', '刚才走神了', '想起一件事', '在想一个老问题', '在想事情',
    '脑子有点空', '什么都没想', '放空了一会儿', '心情不错', '心情一般',
    '还行', '挺好的', '今天挺安静', '有点开心', '安静地待着',
    '陪着你', '就在这儿', '不打扰你', '你忙你的', '随时都在',
    '叫我一声', '在听一首老歌', '单曲循环中', '哼了半句', '静一静'
  ];
  var TYPING = ['正在输入…', '正在打字…', '敲字中…', '写着呢…'];
  var flash = null, typingOn = false, stKey = null, stTxt = '', rotateTimer = null;
  function setFlash(text, ms) {
    flash = text ? { text: text, until: Date.now() + ms } : null;
    refreshTools();
    if (text) later(function () { if (flash && Date.now() >= flash.until) { flash = null; refreshTools(); } }, ms + 30);
  }
  /* 这行字：非应答 > 正在输入 > 闲话。短状态不换词，闲话每次进状态换一句 */
  function statusNow() {
    var key, ic;
    if (flash && Date.now() < flash.until) { key = 'silent'; ic = 'silent'; }
    else if (typingOn) { key = 'type'; ic = 'type'; }
    else { key = 'idle'; ic = 'awake'; }
    if (key !== stKey) {
      stKey = key;
      stTxt = (key === 'silent') ? flash.text
            : (key === 'type' ? pick(TYPING) : pickIdle());
    }
    return { ic: ic, txt: stTxt, key: key };
  }
  /* 闲话轮换：每 3 分钟换一句（正在输入 / 闪现这类短状态不换）——
     换太勤显得躁；3 分钟刚好是「你回来它还在，但话变了」的尺度 */
  var IDLE_MS = 3 * 60 * 1000;
  /* 随机取一句闲话（不是按顺序轮）。★ 跳过上一次那句：100 句里连抽到同一条约 1%，
     可一旦撞上，看着就像"根本没换"—— 这里直接保证每次都不一样。 */
  var lastIdle = -1;
  function pickIdle() {
    if (!IDLE.length) return '';
    if (IDLE.length < 2) return IDLE[0];
    var i = RND.int(IDLE.length - 1);   // 0 .. n-2
    if (lastIdle >= 0 && i >= lastIdle) i++;                 // 跳过 lastIdle，分布仍然均匀
    lastIdle = i;
    return IDLE[i];
  }
  function startRotate() {
    if (rotateTimer) return;
    rotateTimer = setInterval(function () {
      if (!inScene || view !== 'roll') return;
      if (stKey === 'silent' || stKey === 'type') return;
      stTxt = pickIdle();
      refreshTools();
    }, IDLE_MS);
  }
  function toolsHTML() {
    var st = statusNow();
    return '<div class="ch-tools">' +
      '<span class="ch-st">' + icon(st.ic, 17) + '<em>' + esc(st.txt) + '</em></span>' +
      '<span class="sp"></span>' +
      /* ★ 设置入口（B04 案）：小图标 + 9px 小字，竖排，不画任何边框 */
      '<button class="ch-cfg" type="button" data-act="settings" aria-label="对话设置">' +
        icon('sliders', 15) + '<b>设置</b>' +
      '</button>' +
    '</div>';
  }
  function render() {
    if (!page) page = document.getElementById('chat-page');
    if (!page) return;
    inScene = true;
    startRotate();
    /* 回到对话页就先换一句（不然会看到进设置之前那一句，像卡住了） */
    if (stKey !== 'silent' && stKey !== 'type') stTxt = pickIdle();
    if (view === 'settings') { page.innerHTML = settingsHTML(); return; }
    page.innerHTML = headHTML() +
      '<div class="ch-wrap">' +
        '<div class="ch-list" id="ch-list">' + listHTML() + '</div>' +
        '<div class="ch-bar">' +
          '<input id="ch-in" class="ch-in" type="text" maxlength="200" placeholder="说点什么…" autocomplete="off">' +
          '<button class="ch-send" type="button" data-act="send" aria-label="发送">发送</button>' +
        '</div>' +
        toolsHTML() +
      '</div>';
    toBottom(false);
  }
  /* 每项的说明（可折叠）—— 说人话，讲清"调大调小会怎样" */
  /* 「参数定义」：技术口吻（不带口语），一条覆盖全部参数 */
  var DEFS = [
    '<b>回应 · 非应答概率</b> P<sub>silent</sub>：每次应答独立采样一个均匀随机数 r ∈ [0,1)。' +
      'r 小于它就<b>本轮不回</b> —— 不回即结束，不再重试。' +
      '取值 0–20%，步长 0.01%（默认千分之一）。作用域：只决定"这一次是否开口"，不改变开口后的条数与内容；' +
      '触发时底栏状态栏亮 5 秒「TA不想回复」。',
    '<b>回应 · 打字速度</b> v：时长 = 内容字数 ÷ v；采样时 v 附 ±25% 抖动，最后夹进封顶。' +
      '取值 4–24 字/秒，步长 0.1。',
    '<b>回应 · 打字封顶</b> T：固定 3.0 秒（显示但不可改）。' +
      '作用域：无论内容多长，等待都不会无限增长 —— 这是"适用性"的地板。',
    '<b>回应 · 撤回概率</b> P<sub>recall</sub>：主条发出后 0.8–3 s 内以该概率撤回；撤回即删除本地内容' +
      '（签/卡/文本一并删除），只留一行系统事件。取值 0–40%，步长 0.1%。',
    '<b>回应 · 撤回后改口</b> P<sub>retype</sub>：撤回成立后，以该概率改口重发一条与原来不同的内容；' +
      '<b>余下的概率 = 干脆不回</b>（本轮到此结束）。改口重发的那条不再抽撤回，避免连环。0–100%，步长 0.1%。',
    '<b>追加回复 · 追加概率</b> P<sub>append</sub>：一条发出后再补一条的概率。' +
      '默认 <b>0.5%（千分之五）</b>，取值 0–5%，步长 0.01%。',
    '<b>追加回复 · 最多追加</b>：固定 1 条（显示但不可改）—— 即一轮最多两条：主条 + 一条追加。',
    '<b>追加回复 · 追加前冷却</b>：开关 S 与时长 g。开启时，命中追加概率后等 g 再补上这一条；' +
      '关闭时紧接着补上（两条几乎同时到达，是否追加只由追加概率决定）。g ∈ 0.5–1440 分钟，步长 0.5 分钟；' +
      '冷却期间<b>不占用</b>对话轮次 —— 你随时可以再发，它到点了才补那一句。',
    '<b>内容 · 三项权重</b>（出签 / 出卡 / 签+卡）：每次抽取按<b>权重自动摊平</b> —— ' +
      '实际概率 = 该项权重 ÷ 三项权重之和，因此三者不必凑满 100。默认 50 / 45 / 5，' +
      '即 签 50%、卡 45%、签+卡 5%（小概率事件）。作用域：只改内容形态，不改条数与延迟。'
  ];
  function defsHTML() {
    return '<details class="s2-def"><summary>参数定义</summary><div class="s2-defbody">' +
      DEFS.map(function (t) { return '<p>' + t + '</p>'; }).join('') + '</div></details>';
  }

  /* ★ 设置页 S2（参数表）：图标 · 名称 · 刻度条 / 开关 / 数字 · 等宽数值 · 性质符号
     分组只用拉丁小标（RESPONSE / REROLL / AUTONOMY），说明收在最下面一块「参数定义」里 */
  /* ---------------- 设置页（卡片 + 底部抽屉） ----------------
     每行只写「名称 + 当前值」，点它从底部升起抽屉填数；有常用档位的参数在抽屉里排一排胶囊，
     点一下即生效 —— 多数时候不用调出键盘。
     ★ ms:1 的参数界面按「秒」、存档是毫秒。以前 appendGapMs 漏登记换算表，
       滑条把 1.2 秒写成了 1.2 毫秒（引擎再 max(200,…) 兜底成 0.2 秒）。现在按行声明，不再走全局表。 */
  var CFG_GROUPS = [
    { title: 'RESPONSE · 回应', rows: [
      { k: 'silenceP', n: '非应答概率', u: '%', min: 0, max: 20, step: 0.01, dec: 2,
        chips: [0, 0.1, 1, 5, 10, 20], hint: '每条消息独立抽一次，抽中就这轮不回' },
      { k: 'speed', n: '打字速度', u: '字/秒', min: 4, max: 24, step: 0.1, dec: 1,
        chips: [4, 8, 12, 18, 24], hint: '以它为中值，再乘 0.8–1.25 随机' },
      { n: '打字封顶', ro: function () { return num((+S('typeMaxMs') || 3000) / 1000, 1) + '<i>s</i>'; } },
      { k: 'recallP', n: '撤回概率', u: '%', min: 0, max: 40, step: 0.1, dec: 1,
        chips: [0, 5, 10, 20, 40], hint: '每回一条独立抽一次' },
      { k: 'retypeP', n: '撤回后改口', u: '%', min: 0, max: 100, step: 0.1, dec: 1,
        chips: [0, 25, 40, 60, 100], hint: '余下的概率 = 干脆不回' }
    ] },
    { title: 'APPEND · 追加回复', rows: [
      { k: 'appendP', n: '追加概率', u: '%', min: 0, max: 5, step: 0.01, dec: 2,
        chips: [0, 0.5, 1, 3, 5], hint: '一条发出后再补一条的概率' },
      { n: '最多追加', ro: function () { return Math.round(+S('appendCap') || 1) + '<i>条</i>'; } },
      { k: 'appendGapOn', n: '追加前冷却', sw: 1 },
      { k: 'appendGapMs', n: '冷却时长', u: '分钟', min: 0.5, max: 1440, step: 0.5, dec: 1, x: 60000,
        chips: [0.5, 1, 5, 30, 60, 1440], hint: '追加前等多久，最长一天' }
    ] },
    { title: 'CONTENT · 内容（按权重自动摊平）', rows: [
      { k: 'lotP', n: '出签权重', u: '', min: 0, max: 100, step: 0.1, dec: 1,
        chips: [0, 25, 50, 75, 100], hint: '三项按权重自动摊平，不必凑满 100' },
      { k: 'cardP', n: '出卡权重', u: '', min: 0, max: 100, step: 0.1, dec: 1, chips: [0, 25, 45, 75, 100] },
      { k: 'bothP', n: '签+卡权重', u: '', min: 0, max: 100, step: 0.1, dec: 1, chips: [0, 5, 10, 25, 50] },
      { n: '实际占比', ro: function () { return normText(); }, id: 'v-norm' }
    ] }
  ];
  function normText() {
    var w = weights();
    return num(w.lot * 100, 1) + ' / ' + num(w.card * 100, 1) + ' / ' + num(w.both * 100, 1) + '<i>%</i>';
  }
  function findRow(k) {
    for (var i = 0; i < CFG_GROUPS.length; i++) {
      var rs = CFG_GROUPS[i].rows;
      for (var j = 0; j < rs.length; j++) if (rs[j].k === k) return rs[j];
    }
    return null;
  }
  /* 界面值：带 x 的参数按 x 折算（毫秒/s、毫秒/分钟），其余原样；统一留一位小数 */
  function uiVal(k, r) { return (r && r.x) ? Math.round((+S(k) || 0) / r.x * 10) / 10 : (+S(k) || 0); }
  function rowValHTML(r) {
    if (r.ro) return r.ro();
    if (r.sw) return S(r.k) ? 'ON' : 'OFF';
    return num(uiVal(r.k, r), r.dec) + (r.u ? '<i>' + r.u + '</i>' : '');
  }
  function cfgRow(r) {
    if (r.sw) {
      return '<div class="ch-row"><span class="ch-nm">' + r.n + '</span><span class="sp"></span>' +
        '<label class="ch-sw"><input type="checkbox" data-sw="' + r.k + '"' +
        (S(r.k) ? ' checked' : '') + '><i></i></label></div>';
    }
    var v = '<b class="ch-v"' + (r.id ? ' id="' + r.id + '"' : (r.k ? ' id="rv-' + r.k + '"' : '')) + '>' +
            rowValHTML(r) + '</b>';
    if (r.ro) return '<div class="ch-row is-ro"><span class="ch-nm">' + r.n + '</span><span class="sp"></span>' + v + '</div>';
    return '<div class="ch-row" data-open-set="' + r.k + '"><span class="ch-nm">' + r.n + '</span>' +
      '<span class="sp"></span>' + v + '<span class="ch-chev">›</span></div>';
  }
  function sheetHTML() {
    return '<div class="ch-sheet" id="ch-sheet" hidden>' +
      '<div class="ch-sheet-mask" data-act="sheet-close"></div>' +
      '<div class="ch-sheet-box">' +
        '<div class="ch-sheet-bar"></div>' +
        '<div class="ch-sheet-t" id="sh-t"></div>' +
        '<div class="ch-sheet-in"><input id="sh-in" type="text" inputmode="decimal" autocomplete="off"><em id="sh-u"></em></div>' +
        '<div class="chips" id="sh-chips"></div>' +
        '<div class="ch-sheet-hint" id="sh-hint"></div>' +
        '<button class="ch-sheet-ok" type="button" data-act="sheet-ok">确定</button>' +
      '</div></div>';
  }
  function settingsHTML() {
    var body = CFG_GROUPS.map(function (g) {
      return '<div class="ch-gt">' + g.title + '</div><div class="ch-card">' +
        g.rows.map(cfgRow).join('') + '</div>';
    }).join('');
    return '<div class="lib-head">' +
        '<button class="btn-mini" type="button" data-act="back2">‹ 返回</button>' +
        '<div class="lib-title">对话设置</div>' +
      '</div>' +
      '<div class="lib-scroll ch-set">' + body + defsHTML() +
        '<div class="set-foot"><button class="btn btn-soft" type="button" data-act="resetcfg">恢复默认</button></div>' +
      '</div>' + sheetHTML();
  }
  /* ---------------- 抽屉 ---------------- */
  var sheetKey = null;
  function paintRow(k) {
    var r = findRow(k), el = $('#rv-' + k);
    if (r && el) el.innerHTML = rowValHTML(r);
  }
  function markChips(r, cur) {
    var box = $('#sh-chips');
    if (!box) return;
    box.innerHTML = (r.chips || []).map(function (c) {
      return '<span class="chip' + (Math.abs(c - cur) < 1e-9 ? ' cur' : '') +
             '" data-chip="' + c + '">' + num(c, r.dec) + '</span>';
    }).join('');
  }
  function openSheet(k) {
    var r = findRow(k);
    if (!r || r.ro || r.sw) return;
    sheetKey = k;
    var cur = uiVal(k, r);
    $('#sh-t').textContent = r.n;
    $('#sh-in').value = num(cur, r.dec);
    $('#sh-u').textContent = r.u || '';
    markChips(r, cur);
    $('#sh-hint').textContent = (r.hint ? r.hint + '。' : '') +
      '范围 ' + num(r.min, r.dec) + ' – ' + num(r.max, r.dec) + (r.u ? ' ' + r.u : '') + '，步长 ' + r.step;
    $('#ch-sheet').hidden = false;
  }
  function closeSheet() {
    sheetKey = null;
    var el = $('#ch-sheet');
    if (el) el.hidden = true;
  }
  /* 写值：夹进 [min,max]，ms 类折成毫秒；closeIt=true 时顺手收起抽屉 */
  function applyVal(k, raw, closeIt) {
    var r = findRow(k);
    if (!r || r.ro || r.sw) { if (closeIt) closeSheet(); return; }
    if (typeof raw === 'number' && isFinite(raw)) {
      raw = Math.max(r.min, Math.min(r.max, raw));
      cfg.set[k] = r.x ? Math.round(raw * r.x) : raw;
      saveCfg();
      paintRow(k);
      if (k === 'lotP' || k === 'cardP' || k === 'bothP') {
        var nz = $('#v-norm');
        if (nz) nz.innerHTML = normText();
      }
      if (sheetKey === k) {
        var cur = uiVal(k, r);
        $('#sh-in').value = num(cur, r.dec);
        markChips(r, cur);
      }
    }
    if (closeIt) closeSheet();
  }
  function refreshTools() {
    var t = $('.ch-tools');
    if (t) t.outerHTML = toolsHTML();
  }
  function appendBubble(m) {
    var l = $('#ch-list');
    if (!l) return;
    var t = l.querySelector('#ch-typing');
    if (t) t.insertAdjacentHTML('beforebegin', bubble(m));
    else l.insertAdjacentHTML('beforeend', bubble(m));
    /* ★ 消息上限 200 条：数组截掉最老的之后，界面也得跟着扔（不然聊到两百条以后，
       界面上的气泡只增不减，滚动条会越来越长 —— 千步测试抓到的） */
    var rows = l.querySelectorAll('[data-id]');
    while (rows.length > msgs.length) rows[0].remove();
  }
  function toBottom() {
    var l = $('#ch-list');
    if (l) l.scrollTop = l.scrollHeight;
  }
  function setTyping(on) {
    var t = $('#ch-typing');
    if (t) t.hidden = !on;
    if (on) toBottom();
    typingOn = !!on;
    refreshTools();
  }
  function pending() { return timers.length > 0; }

  /* ---------------- 清空 ---------------- */
  function clearAll() {
    var UIc = global.MoKa.ui;
    var ask = (UIc && UIc.confirmDialog)
      ? UIc.confirmDialog({ icon: '🗑', title: '清空这次对话？', sub: '聊天记录会全删掉，签文包和牌组都不受影响。', okText: '清空' })
      : Promise.resolve(global.confirm ? global.confirm('清空这次对话？') : true);
    ask.then(function (yes) {
      if (!yes) return;
      gen++;                                        // 让"清空之前"排的所有回调作废
      clearTimers(); roundInFlight = false; emitsPending = 0; setTyping(false);
      msgs = []; saveMsgs(); render();
    });
  }

  /* ---------------- 事件 ---------------- */
  function onClick(e) {
    var tg = e.target.closest ? e.target.closest('[data-open]') : null;
    if (tg) {
      var box = tg.closest('.ch-cardbox'), body = box && box.querySelector('.ch-body');
      if (body) {
        var open = !body.classList.contains('is-open');
        body.classList.toggle('is-open', open);
        tg.innerHTML = (open ? '收起牌义<i>▴</i>' : '展开牌义<i>▾</i>');
        var id = tg.dataset.open;
        msgs.forEach(function (m) { if (m.id === id) m.open = open; });
        saveMsgs();
      }
      return;
    }
    /* 抽屉：点行开、点档位即生效 */
    var op = e.target.closest ? e.target.closest('[data-open-set]') : null;
    if (op) { openSheet(op.dataset.openSet); return; }
    var chip = e.target.closest ? e.target.closest('[data-chip]') : null;
    if (chip && sheetKey) { applyVal(sheetKey, parseFloat(chip.dataset.chip), false); return; }
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    var a = el.dataset.act;
    if (a === 'send') { send(); return; }
    if (a === 'clear') { clearAll(); return; }
    if (a === 'settings') {
      view = 'settings';
      closeSheet();
      page.innerHTML = settingsHTML();
      page.scrollTop = 0;
      return;
    }
    if (a === 'sheet-ok') {
      var sv = $('#sh-in') ? parseFloat($('#sh-in').value) : NaN;
      applyVal(sheetKey, sv, true);
      return;
    }
    if (a === 'sheet-close') { closeSheet(); return; }
    if (a === 'back2') { closeSheet(); view = 'roll'; render(); return; }
    if (a === 'resetcfg') {
      cfg.set = JSON.parse(JSON.stringify(DEFAULTS)); saveCfg();
      page.innerHTML = settingsHTML();
      global.MoKa.ui.toast('已恢复默认');
      return;
    }
    if (a === 'back') { global.MoKa.app.gotoScene('table'); return; }
  }
  function onKey(e) {
    if (e.target && e.target.id === 'ch-in' && e.key === 'Enter') { e.preventDefault(); send(); }
  }
  function onFocus(e) {
    if (e.target && e.target.id === 'ch-in') setTimeout(toBottom, 260);
  }
  /* 设置页只剩「开关」是即时生效的；数值都走抽屉的 applyVal */
  function onSet(e) {
    var el = e.target;
    if (!el.dataset || el.dataset.sw === undefined) return;
    cfg.set[el.dataset.sw] = !!el.checked;
    saveCfg();
    paintRow(el.dataset.sw);
  }

  function init() {
    page = document.getElementById('chat-page');
    if (!page) return;
    page.addEventListener('click', onClick);
    page.addEventListener('keydown', onKey);
    page.addEventListener('focusin', onFocus);
    page.addEventListener('input', onSet);
    page.addEventListener('change', onSet);
  }

  global.MoKa = global.MoKa || {};
  global.MoKa.chat = {
    init: init, render: render, send: send,
    leave: function () {
      inScene = false;
      if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = null; }
    },
    /* 返回键：在设置页先退回聊天页；聊天页里返回键照旧交给 app.back()（回占卜桌） */
    back: function () { if (view !== 'settings') return false; view = 'roll'; render(); return true; },
    _gen: function () { return gen; },
    _msgs: function () { return msgs; },
    _cfg: function () { return cfg; },
    _pending: function () { return pending(); },
    _round: function () { return roundInFlight; },
    _rollReply: rollReply,
    _weights: weights,
    _typeMsBase: function (chars) { return chars / Math.max(2, (+S('speed') || 12)) * 1000; },
    _recallById: recallById,
    _force: function (o) { force = o || {}; },     // 走查用：临时改脾气
    _set: function (k, v) { cfg.set[k] = v; saveCfg(); },   // 走查用：直接改设置
    _setObj: function () { return cfg.set; },
    _fast: function (on) { fastMode = !!on; },
    _profile: PROFILE
  };
})(window);
