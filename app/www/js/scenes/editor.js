/* ============================================================
 * 猫卡 · 单屏编辑器「鲸造」(editor.js)
 * ------------------------------------------------------------
 * 2026-10-11 重构：把旧的「信息屏 + 全屏画布页」两屏合并成**一个全屏编辑页**。
 * 定位 = 图片制作器（感觉翻译器）：先挑底子、填内容、再微调、能带走。
 *
 *   上：画布 —— 一整屏就是一张牌。点文字选中、拖动挪位置、
 *       双击改字、双指捏合缩放字号；图片模式下拖动图片、捏合缩放图片。
 *   下：工具坞 —— 第一个常显组「底子」（6 个主题整卡实况预览 + 让整副都这样），
 *       位置/字号常显；字体/样式/牌面/图片/内容与牌义/更多 分组折叠。
 *
 * 相对旧版的**根本性增量**：
 *   1. 撤销 / 重做（50 步命令栈，所有改动可回退）
 *   2. 草稿自动保存到 localStorage（中途退出/闪退可恢复）
 *   3. 双击文字块直接改字（不再回"信息屏"改内容）
 *   4. 双指捏合缩放字号（不再只靠滑条）
 *   5. 39 款样式改**实况预览网格**（与台面共用 ui.js chipHTMLFor —— 预览即台面）
 *   6. 起手式「挑底子」：主题一键套用（牌面底色+纸边+两块文字样式打包）
 *   7. 牌面底色 / 纸边可单卡设定（faceBg/faceEdge）
 *   8. 图片 = 真图层：拖动平移 / 捏合缩放 / 滤镜（imgScale/imgX/imgY/imgFilter）
 *   9. 复制这张卡（cloneCard）
 *   10. 导出牌面 / 牌背为高清 PNG（Java 端 WebView 截图 → Download，不溢出相册）
 *
 * ★ 渲染铁律：编辑页牌面**只用 UI.faceHTML**（与台面同一函数），
 *   拖动/滑条高频路径才走 paintBlock 局部改 style（不重建 DOM）。
 *   "编辑页 = 台面"由构造保证，不再有两份拷贝。
 * ============================================================ */
(function (global) {
  'use strict';
  const D = global.MoKa.data;
  const UI = global.MoKa.ui;
  const L = global.MoKa.library;

  /* ============================================================
   * 常量表（模块级 —— 别塞进函数体：构建 120 的线上报错就是这么来的）
   * ============================================================ */
  const FS_RATIO = { name: 13 / 90, kw: 10 / 90 };   // 必须与 ui.js FIT 一致

  /* 样式大类（2026-10-02 定的 6 组，沿用） */
  const BGSTYLE_GROUPS = [
    ['素净', ['none', 'plain', 'underline', 'twinline', 'outline']],
    ['药丸', ['soft', 'pill', 'tag', 'plate', 'ribbon', 'ribbon2']],
    ['框架', ['double', 'sqring', 'hex', 'notch', 'sidebar', 'stripe', 'dotgrid', 'gridpaper']],
    ['材质', ['scroll', 'bamboo', 'rice', 'ledger', 'label', 'stitch', 'velvet', 'papercut', 'leather', 'mist']],
    ['光影', ['neon', 'halo', 'spot', 'glass', 'holo']],
    ['雕金', ['carve', 'emboss', 'deboss', 'gold', 'copper']]
  ];
  const BGSTYLE_NAMES = { none: '无底', plain: '素字', underline: '下划线', twinline: '双下划线', outline: '描边',
    soft: '柔光', pill: '胶囊', tag: '方签', plate: '压暗条', ribbon: '缎带', ribbon2: '燕尾',
    double: '双框', sqring: '方框', hex: '六边', notch: '缺角', sidebar: '侧条', stripe: '斜纹', dotgrid: '点阵', gridpaper: '格纸',
    scroll: '卷轴', bamboo: '竹简', rice: '宣纸', ledger: '账簿', label: '挂牌', stitch: '缝线', velvet: '绒面', papercut: '剪纸', leather: '皮革', mist: '雾面',
    neon: '霓虹', halo: '光环', spot: '追光', glass: '玻璃', holo: '镭射',
    carve: '阴刻', emboss: '浮雕', deboss: '凹刻', gold: '金线', copper: '铜牌' };
  const BG_STYLE_ALL = (function () {
    const o = {}; BGSTYLE_GROUPS.forEach(function (g) { g[1].forEach(function (id) { o[id] = 1; }); }); return o;
  })();
  function bgcatOf(styleId) {
    for (var i = 0; i < BGSTYLE_GROUPS.length; i++) {
      if (BGSTYLE_GROUPS[i][1].indexOf(styleId) >= 0) return BGSTYLE_GROUPS[i][0];
    }
    return '素净';
  }
  /* 第二批 30 款 = 自带配色（颜色/深浅对它不起作用 → 置灰） */
  const FIXED_STYLE = { plain: 1, scroll: 1, bamboo: 1, rice: 1, carve: 1, ledger: 1, label: 1, neon: 1,
    halo: 1, spot: 1, glass: 1, hex: 1, notch: 1, stripe: 1, dotgrid: 1, gridpaper: 1, sidebar: 1,
    double: 1, stitch: 1, ribbon2: 1, sqring: 1, twinline: 1, emboss: 1, deboss: 1, gold: 1,
    copper: 1, velvet: 1, papercut: 1, holo: 1, leather: 1, mist: 1 };
  const NO_BG_STYLE = Object.assign({ outline: 1, underline: 1, none: 1 }, FIXED_STYLE);
  /* 行内策略三选一 —— 必须和 ui.js 的 BG_KEEPS_BG / BG_WHITE_TXT 一模一样（见 chipHTMLFor） */
  const KEEP_BG_STYLE = { soft: 1, pill: 1, tag: 1, plate: 1, ribbon: 1 };
  const WHITE_TXT_STYLE = { outline: 1, underline: 1, none: 1 };

  /* 主题：一键套用 = 牌面底色 + 纸边 + 两块文字的样式打包（应用后仍可微调）。
     ★ 命名 = 感觉（人话），不是参数名。 */
  /* ============================================================
   * 主题库（2026-10-11 升级：6 → 17 个，8 路风格）
   * ------------------------------------------------------------
   * 用户拍板的 8 路：星象神谕 / 东方古籍 / 黑金暗夜 / 复古版画 /
   *                  自然植物 / 月光银蓝 / 现代极简 / 矿物重彩。
   * 每个主题 = 牌面底色 + 质感层 + 字色 + 字体 + 文字样式 的打包；
   * 套用后仍可逐项微调（主题只是"一键到位的底子"，不是锁死的模板）。
   * ⚠ patch 里**不含位置/字号** —— 用户摆好的版式不该被主题改掉。
   * ============================================================ */
  const THEMES = [
    /* ① 星象神谕 */
    { id: 'xingye', name: '星野', patch: { faceBg: '#141a2e', faceEdge: false, faceTex: 'nebula', faceTexA: 55,
      nameBgStyle: 'none', kwBgStyle: 'none', nameColor: null, kwColor: null, nameFont: 'song', kwFont: 'song' } },
    { id: 'yinhe', name: '银河', patch: { faceBg: '#0e1220', faceEdge: false, faceTex: 'stars', faceTexA: 72,
      nameBgStyle: 'none', kwBgStyle: 'none', nameColor: null, kwColor: null, nameFont: 'ming', kwFont: 'ming' } },
    /* ② 东方古籍 */
    { id: 'xuanzhi', name: '宣纸', patch: { faceBg: '#f6f1e2', faceEdge: true, faceTex: 'paper', faceTexA: 42,
      nameBgStyle: 'plain', kwBgStyle: 'plain', nameColor: null, kwColor: null, nameFont: 'kai', kwFont: 'kai' } },
    { id: 'zhushatie', name: '朱砂帖', patch: { faceBg: '#f3ead5', faceEdge: true, faceTex: 'grain', faceTexA: 38,
      nameBgStyle: 'plain', kwBgStyle: 'plain', nameColor: '#a8302a', kwColor: '#8a2b26', nameFont: 'mao', kwFont: 'mao' } },
    /* ③ 黑金暗夜 */
    { id: 'heijin', name: '黑金', patch: { faceBg: '#15171c', faceEdge: false, faceTex: 'brushed', faceTexA: 45,
      nameBgStyle: 'gold', kwBgStyle: 'gold', nameColor: null, kwColor: null, nameFont: 'ming', kwFont: 'ming' } },
    { id: 'yaoshi', name: '曜石', patch: { faceBg: '#0e1014', faceEdge: false, faceTex: 'stone', faceTexA: 52,
      nameBgStyle: 'none', kwBgStyle: 'none', nameColor: null, kwColor: null, nameFont: 'song', kwFont: 'song' } },
    /* ④ 复古版画 */
    { id: 'jiuzhi', name: '旧纸', patch: { faceBg: '#e8dbc0', faceEdge: true, faceTex: 'crack', faceTexA: 46,
      nameBgStyle: 'plain', kwBgStyle: 'plain', nameColor: '#4a3a22', kwColor: '#6b5637', nameFont: 'ming', kwFont: 'ming' } },
    { id: 'tongban', name: '铜版', patch: { faceBg: '#2a2318', faceEdge: false, faceTex: 'crack', faceTexA: 44,
      nameBgStyle: 'none', kwBgStyle: 'none', nameColor: '#d3b273', kwColor: '#b99a63', nameFont: 'song', kwFont: 'song' } },
    /* ⑤ 自然植物 */
    { id: 'chenwu', name: '晨雾', patch: { faceBg: '#eef1ea', faceEdge: true, faceTex: 'watercolor', faceTexA: 42,
      nameBgStyle: 'plain', kwBgStyle: 'plain', nameColor: '#37503e', kwColor: '#4d6b52', nameFont: 'you', kwFont: 'you' } },
    { id: 'taihen', name: '苔痕', patch: { faceBg: '#1d2a22', faceEdge: false, faceTex: 'fiber', faceTexA: 40,
      nameBgStyle: 'none', kwBgStyle: 'none', nameColor: '#cfe3d2', kwColor: '#a8c4ad', nameFont: 'kai', kwFont: 'kai' } },
    /* ⑥ 月光银蓝 */
    { id: 'yueguang', name: '月光', patch: { faceBg: '#eaf0f7', faceEdge: true, faceTex: 'watercolor', faceTexA: 38,
      nameBgStyle: 'plain', kwBgStyle: 'plain', nameColor: '#2b3d5c', kwColor: '#44597a', nameFont: 'song', kwFont: 'song' } },
    { id: 'yeshuang', name: '夜霜', patch: { faceBg: '#182031', faceEdge: false, faceTex: 'frost', faceTexA: 50,
      nameBgStyle: 'none', kwBgStyle: 'none', nameColor: '#dbe6f5', kwColor: '#a9bbd4', nameFont: 'ming', kwFont: 'ming' } },
    /* ⑦ 现代极简 */
    { id: 'jingbai', name: '净白', patch: { faceBg: '#ffffff', faceEdge: true, faceTex: 'grain', faceTexA: 14,
      nameBgStyle: 'plain', kwBgStyle: 'plain', nameColor: null, kwColor: null, nameFont: 'deyi', kwFont: 'deyi' } },
    { id: 'mohui', name: '墨灰', patch: { faceBg: '#e9ebee', faceEdge: true, faceTex: null, faceTexA: 0,
      nameBgStyle: 'plain', kwBgStyle: 'plain', nameColor: '#1b1f24', kwColor: '#3d444d', nameFont: 'hei', kwFont: 'hei' } },
    /* ⑧ 矿物重彩 */
    { id: 'chensha', name: '辰砂', patch: { faceBg: '#f2e8da', faceEdge: true, faceTex: 'grain', faceTexA: 46,
      nameBgStyle: 'plain', kwBgStyle: 'plain', nameColor: '#a62f24', kwColor: '#8c3a2c', nameFont: 'mao', kwFont: 'mao' } },
    { id: 'qingjin', name: '青金', patch: { faceBg: '#16224a', faceEdge: false, faceTex: 'grain', faceTexA: 50,
      nameBgStyle: 'none', kwBgStyle: 'none', nameColor: '#e8c87a', kwColor: '#c9a75f', nameFont: 'song', kwFont: 'song' } },
    { id: 'shilv', name: '石绿', patch: { faceBg: '#e6efe6', faceEdge: true, faceTex: 'watercolor', faceTexA: 44,
      nameBgStyle: 'plain', kwBgStyle: 'plain', nameColor: '#2f6b52', kwColor: '#417a5f', nameFont: 'wei', kwFont: 'wei' } }
  ];

  /* 字体库（11 款；'sys' 之外的名字都是内嵌字体的短标签）。
     ★ ui.js 的 FONT_CLS / v3.css 的 .is-ft-<id> 必须同步 —— 三处一气改全。 */
  const FONT_LIST = [
    { id: 'sys',  name: '系统' }, { id: 'kai',  name: '书卷' }, { id: 'song', name: '庄宋' },
    { id: 'ming', name: '明朝' }, { id: 'mao',  name: '毛笔' }, { id: 'xing', name: '行书' },
    { id: 'shou', name: '手写' }, { id: 'you',  name: '悠哉' }, { id: 'deyi', name: '设计' },
    { id: 'hei',  name: '黑体' }, { id: 'wei',  name: '清秀' }
  ];
  const FONT_NAME = (function () { const o = {}; FONT_LIST.forEach(function (f) { o[f.id] = f.name; }); return o; })();

  /* 字色预设（null = 自动：按底色样式取对比色） */
  const TEXT_COLORS = [
    { v: null, name: '自动' }, { v: '#ffffff', name: '白' }, { v: '#1b1f24', name: '墨' },
    { v: '#c8a45a', name: '金' }, { v: '#b0392b', name: '朱' }, { v: '#2f6b52', name: '绿' },
    { v: '#2c3e5c', name: '靛' }
  ];

  /* 质感预设（与 assets/tex/<id>.png 一一对应） */
  const TEX_LIST = [
    { id: null, name: '无' }, { id: 'paper', name: '纸纹' }, { id: 'grain', name: '砂粒' },
    { id: 'stone', name: '石纹' }, { id: 'crack', name: '裂纹' }, { id: 'fiber', name: '布纹' },
    { id: 'brushed', name: '拉丝' }, { id: 'watercolor', name: '水彩' }, { id: 'stars', name: '星点' },
    { id: 'nebula', name: '星云' }, { id: 'frost', name: '霜花' }
  ];

  /* 牌面底色色板（null = 默认：纸白 / 深色主题深底） */
  const FACE_SWATCHES = [
    { v: null, name: '默认' },
    { v: '#ffffff', name: '纸白' },
    { v: '#f5efdc', name: '米' },
    { v: '#e9edf2', name: '雾灰' },
    { v: '#dce6f2', name: '天青' },
    { v: '#16233d', name: '夜蓝' },
    { v: '#1c2536', name: '墨' },
    { v: '#14181f', name: '黑' }
  ];
  function faceBgName(v) {
    if (v == null || v === '') return '默认';
    for (var i = 0; i < FACE_SWATCHES.length; i++) { if (FACE_SWATCHES[i].v === v) return FACE_SWATCHES[i].name; }
    return String(v).toUpperCase();
  }
  const IMG_FILTER_NAMES = { none: '原图', dim: '压暗', dark: '更暗', blur: '模糊', gray: '黑白', warm: '暖调' };

  /* ============================================================
   * 状态
   * ============================================================ */
  let pageEl = null;            // #lib-editor
  let deckId = null;
  let cardId = null;            // null = 新建
  let draft = null;             // 唯一草稿（withCardStyle 补齐过的整卡）
  let sel = 'name';             // 'name' | 'kw'
  let bgCat = '素净';           // 样式网格当前分组
  let imgMode = false;          // 图片调整模式
  let sheetOpen = false;        // 顶栏 ⋯「更多」面板开着没
  let undoStack = [], redoStack = [];
  let cleanSnap = null;         // 打开时的快照（判"是否已回到原状"）
  let dirty = false;
  let draftTimer = null;
  const MAX_UNDO = 50;
  const DRAFT_KEY = 'catcard.editor.draft.v1';

  /* 手势状态（window 级监听 move/up —— 捏合跨元素也稳） */
  let gPtr = {};      // pointerId → { x, y, wrap|null, img|null }
  let gDrag = null;   // 文字块拖动: { wrap, kind, pointerId, sx, sy, baseVy, dragging, before }
  let gPinch = null;  // 文字块捏合: { wrap, kind, dist0, fs0, before }
  let iDrag = null;   // 图片拖动: { pointerId, sx, sy, baseX, baseY, dragging, before }
  let iPinch = null;  // 图片捏合: { img, dist0, scale0, before }   ← ★ img 必填，见 pinchPtrs()
  let lastTap = { t: 0, x: 0, y: 0, kind: null };
  let showHint = false;      // 操作教程行：新卡首屏显示一次，一动就收起
  let pointerFrame = 0;
  let latestPointerEvent = null;

  /* ============================================================
   * 草稿
   * ============================================================ */
  function buildDraft(deck, card) {
    if (card) return D.withCardStyle(Object.assign({}, card));
    /* 新建：沿用上一张的**样式与图片**，文字/牌义/牌面句清空。
       ⚠ 内容字段（faceText/art/band）是内容不是样式，不许从上一张带过来。 */
    const last = deck.cards.length ? deck.cards[deck.cards.length - 1] : null;
    const base = D.withCardStyle(Object.assign({}, last || {}));
    return D.withCardStyle(Object.assign({}, base, {
      id: null, name: '', keyword: '', meaning: '',
      faceText: '', art: null, band: null,
      nameOn: true,             /* 新卡默认让卡名上牌面（与 kwOn 同一口径：上一张隐藏过，不该连累新卡） */
      kwOn: true,               /* 新卡默认让关键词上牌面（上一张若隐藏过，不该把新卡也藏起来） */
      symbol: base.symbol,
      symbolImg: base.symbolImg,
      image: (last && last.image) ? last.image : null,
      imageHi: (last && last.image) ? (last.imageHi || null) : null
    }));
  }
  function snap() {
    const { image, imageHi, ...fields } = D.withCardStyle(draft);
    return { image: image || null, imageHi: imageHi || null, fields: JSON.stringify(fields) };
  }
  function restore(s) {
    draft = D.withCardStyle(Object.assign(JSON.parse(s.fields), { image: s.image, imageHi: s.imageHi }));
  }
  function sameAsClean() {
    if (!cleanSnap) return false;
    const now = snap();
    return now.image === cleanSnap.image && now.imageHi === cleanSnap.imageHi && now.fields === cleanSnap.fields;
  }
  function refreshDirty() { dirty = !sameAsClean(); }

  /* 命令栈：每次**离散操作**（按钮/滑条松手/拖动结束/捏合结束/输入框失焦）提交一步 before 快照 */
  function commit(before) {
    if (!before) return;
    /* 第一次动手 → 收起操作教程行（它会了，别一直占一行） */
    if (showHint) {
      showHint = false;
      const h = pageEl && pageEl.querySelector('#ed-guide');
      if (h) h.remove();
    }
    undoStack.push(before);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    refreshDirty();
    syncUndoBtns();
    persistSoon();
  }
  function applyHistoryState(state) {
    if (state && state.deckStyles) {
      const ok = D.restoreDeckStyles(deckId, state.deckStyles, cardId);
      if (!ok) UI.toast('部分牌组已变化，无法恢复全部样式');
      return;
    }
    restore(state);
  }
  function historyState(state) {
    if (state && state.deckStyles) return { deckStyles: D.takeDeckStyles(deckId, cardId) };
    return snap();
  }
  function undo() {
    if (!undoStack.length) return;
    const state = undoStack.pop();
    redoStack.push(historyState(state));
    applyHistoryState(state);
    repaintAll();
    refreshDirty();
    syncUndoBtns();
    persistSoon();
  }
  function redo() {
    if (!redoStack.length) return;
    const state = redoStack.pop();
    undoStack.push(historyState(state));
    applyHistoryState(state);
    repaintAll();
    refreshDirty();
    syncUndoBtns();
    persistSoon();
  }
  function syncUndoBtns() {
    if (!pageEl) return;
    const b1 = pageEl.querySelector('#ed-undo'), b2 = pageEl.querySelector('#ed-redo');
    if (b1) b1.disabled = !undoStack.length;
    if (b2) b2.disabled = !redoStack.length;
  }

  /* 草稿自动保存：debounce 写 localStorage（剥离大图防 QuotaExceeded） */
  function persistSoon() {
    if (draftMuted) return;
    cancelDraftWrite();
    draftTimer = setTimeout(writeDraft, 500);
  }
  /* ★ 2026-10-15 修：清草稿必须**连挂起的定时器一起清**。
     原来只 removeItem、不管 draftTimer —— 于是"改动 → 500ms 内点保存/选不保存/删卡"
     这条路上，迟到的 writeDraft() 又把草稿写回去了（writeDraft 读的是外层那个还在的 draft）：
       · 保存后草稿复活 → localStorage 长期多压一份带 base64 的草稿，白占配额；
       · 选「不保存」后草稿复活 → 用户明明放弃了，下次进来还弹「恢复上次未保存的编辑？」，
         点恢复就把刚放弃的改动装回来 —— 用户明确说"不要"，App 却说"给你留着"。
     走查那两条草稿断言都在 debounce 早跑完之后才断言，所以这个竞态一直没被验到。 */
  let draftMuted = false;      // 放弃/保存之后：连"已经排上队"的那次写盘也不再算数
  function cancelDraftWrite() {
    if (draftTimer !== null) { clearTimeout(draftTimer); draftTimer = null; }
  }
  function removeStoredDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }
  function clearDraft() {
    cancelDraftWrite();
    draftMuted = true;
    removeStoredDraft();
  }
  function removeMatchingDraft() {
    const saved = readDraft();
    if (saved && saved.deckId === deckId && saved.cardId === cardId) removeStoredDraft();
  }
  function writeDraft() {
    draftTimer = null;
    if (draftMuted) return;
    if (sameAsClean()) {
      // 撤销或手动改回库内原状：清掉这张卡的旧草稿，但不静音之后的编辑。
      removeMatchingDraft();
      return;
    }
    try {
      const slim = JSON.parse(JSON.stringify(draft));
      slim.imageHi = null;   // 高清大图不进草稿（localStorage 配额），恢复时提示重选
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ deckId: deckId, cardId: cardId, draft: slim, t: Date.now() }));
    } catch (e) { /* 配额满等：静默，不打断编辑 */ }
  }
  function readDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return (o && o.deckId && o.draft) ? o : null;
    } catch (e) { return null; }
  }

  function commitActiveText() {
    if (!pageEl) return;
    const active = document.activeElement;
    if (/^ed-(name|keyword|meaning)$/.test(active && active.id || '')) active.blur();
  }

  /* ============================================================
   * 页面生命周期
   * ============================================================ */
  let stageRO = null;      // ResizeObserver：画布尺寸一变就重新收敛大牌（主防线）

  function init() {
    pageEl = document.getElementById('lib-editor');
    baseVH = window.innerHeight || 0;
    window.addEventListener('resize', function () { syncKb(); fitBigCard(); });
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowUp);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () { syncKb(); fitBigCard(); });
      window.visualViewport.addEventListener('scroll', function () { syncKb(); fitBigCard(); });
    }
  }
  /* ★ 软键盘：WebView 调 adjustResize 后可视高会明显变矮。
     ★ 2026-11-19：键盘**只改"可用高度"这一个输入**，不改坞的档位、也不直接压坞高 ——
     坞高统一由 applyDock() 按 dockLevel + 可用高算出来，写进 --dock-h（唯一来源）。
     焦点被键盘挡住的那部分交给 .ed-scroll 自己滚（见 bindEvents 的 focusin）。 */
  let baseVH = 0;      // 打开编辑器时的整屏可视高：键盘弹出后 innerHeight 也会缩，不能拿它当基准
  let baseAvail = 0;   // 无键盘时的可用体高：半屏档按它算，键盘弹起时**不更新**
  let dockLevel = 'half';   // 档位：half / full / dragging —— 坞高唯一真源
  let dragH = 0;            // 拖动中的目标高（只在 dragging 档用）
  let openCanvasFromDock = null;
  let dockFullHold = false; // 半屏→铺满动画期间先不收画布（等坞盖上去，别提前露出被裁的牌）
  let revealTimer = null;   // 焦点滚动的合并定时器（键盘动画期间会连续 resize）
  /* ★ 2026-11-19（抽屉缩放）：坞高算出来的那一刻就记下来 —— 画布缩放只认这一份。
     缩放和坞高从此是**同一个输入**（可用高 − 坞高），不再有第二套 H0/H1 算术。 */
  let dockPx = { avail: 0, h: 0 };
  let snapTimer = null;     // 吸附收尾定时器
  let snapSeq = 0;          // 吸附代号：抓手被重新抓住 / 又吸一次就 +1，旧 timer 看见代号不对直接作废
  const SNAP_MS = 260;      // 与 v3.css 吸附曲线 .24s 同长再留 20ms 余量（坞和牌两条动画才同步）

  /* 可用体高 = 可视高 − 顶栏，再与 .ed-body 实测高取小：
     adjustResize 时 body 已缩；只缩视觉视口时 byVV 更可信。jsdom 无布局 → 走 byVV。 */
  function headH() {
    const h = pageEl && pageEl.querySelector('.ed-head');
    return (h && h.offsetHeight) || 59;      // 44 键 + 8/6 padding + 1 边
  }
  function availBodyH() {
    if (!pageEl) return 0;
    const vv = window.visualViewport;
    const vh = vv ? Math.round(vv.height) : (window.innerHeight || 0);
    const byVV = Math.max(0, vh - headH());
    const body = pageEl.querySelector('.ed-body');
    const byBody = body ? body.clientHeight : 0;
    return byBody > 0 ? Math.min(byVV, byBody) : byVV;
  }
  function halfTargetH() {
    const base = baseAvail || availBodyH() || 600;
    return Math.round(base * 0.46);          // 与首帧兜底的 46vh 同口径
  }
  function halfDockH(avail) {
    // 小屏优先给工具留操作空间，同时给画布保留可用预览。
    const reserve = Math.min(150, Math.round(avail * .35));
    return Math.min(Math.max(halfTargetH(), 220), Math.max(0, avail - reserve));
  }
  /* ============================================================
   * ★ 2026-11-19（抽屉缩放）画布缩放：坞高之外不再有第二份"高度算术"
   * ------------------------------------------------------------
   * 用户原话「抽屉上拉的时候，画布的缩放也有 bug」。旧算法是
   *   clamp((H1 − 坞高 − 12) / 牌高, 硬下限, 1)
   * 三个病一起犯：① H0/H1 是绕开 --dock-h 另算的一套高度（坞高早就有唯一来源了）；
   * ② 那个硬下限在坞接近铺满时让牌缩不下去，被 stage 的 overflow:hidden 裁成一条；
   * ③ 松手吸附的目标写死成下限，和坞的终点（铺满）对不上 → 动画半路跳一下。
   * 现在只剩一句话：**stage 剩多高，牌就缩到多高**。坞每高一像素 stage 就矮一像素，
   * 所以缩放是坞高的线性函数，和坞走同一条曲线就不会错位。
   * ============================================================ */
  function stageScale(stageH, cardH) {
    if (!isFinite(stageH) || !isFinite(cardH)) return 1;   // 量不到就别乱缩
    if (!(stageH > 0)) return 0;                           // 铺满：牌子完全让开
    if (!(cardH > 0)) return 1;
    return Math.min(1, stageH / cardH);                    // 比牌高就原尺寸，只缩不放
  }
  /* 牌的实际高度：有布局就读 offsetHeight；jsdom 没布局 → 按 --card-w × 1.5 推（比例是红线里定死的） */
  function cardBoxH() {
    const card = pageEl && pageEl.querySelector('#ed-card');
    if (card && card.offsetHeight) return card.offsetHeight;
    const stage = pageEl && pageEl.querySelector('#ed-stage');
    const w = parseFloat((stage && stage.style.getPropertyValue('--card-w')) || '') || 0;
    return w > 0 ? w * 1.5 : 0;
  }
  /* 缩放唯一写入口：--dock-scale 只在这里写，别处不许再 setProperty / removeProperty。
     输入只有 applyDock 刚算出的 {avail,h}（同源）+ 牌高 —— 这就是"坞缩到哪，牌缩到哪"。 */
  function syncDockScale() {
    const stage = pageEl && pageEl.querySelector('#ed-stage');
    if (!stage) return 1;
    const s = stageScale(Math.max(0, dockPx.avail - dockPx.h), cardBoxH());
    stage.style.setProperty('--dock-scale', String(Math.round(s * 1000) / 1000));
    return s;
  }

  /* 档位状态机 → 只写 --dock-h（顺手把缩放写成同一份数字）。CSS 只读它，不再自己写 height/max-height。 */
  function applyDock() {
    if (!pageEl) return 0;
    const avail = availBodyH();
    let h;
    if (dockLevel === 'full') h = avail;
    else if (dockLevel === 'dragging') h = Math.max(halfDockH(avail), Math.min(dragH || 0, avail));
    else h = halfDockH(avail);
    h = Math.round(h);
    dockPx = { avail: avail, h: h };
    syncDockScale();                     // 先在"写坞高"之前把牌高读掉（少一次强制回流）
    pageEl.style.setProperty('--dock-h', h + 'px');
    pageEl.classList.toggle('is-dockfull', dockLevel === 'full' && !dockFullHold);
    return h;
  }
  function syncKb() {
    if (!pageEl) return;
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    if (!baseVH || h > baseVH) baseVH = h;      // 转屏/键盘收起 → 更新基准
    const kb = h < baseVH * 0.82;
    pageEl.style.setProperty('--ed-vh', Math.round(h) + 'px');
    pageEl.classList.toggle('is-kb', kb);
    if (!kb) baseAvail = availBodyH() || baseAvail;   // 键盘态不重算半屏基准 → 半屏不跳
    applyDock();                                      // 键盘变的是"可用高"，不是档位
    if (kb) revealActiveInScroll();                   // 焦点控件交给 .ed-scroll 滚进可见区
  }

  async function open(deckId0, cardId0) {
    const deck = D.findDeck(deckId0);
    if (!deck) { L.goHome(); return; }
    // 新开会话时，别让上一个编辑器挂起的定时器写到这次的草稿里。
    cancelDraftWrite();
    draftMuted = true;
    deckId = deckId0;
    cardId = cardId0 || null;

    /* 草稿恢复：上次编辑没保存（闪退/误退）→ 问一句 */
    const saved = readDraft();
    let restored = false;
    if (saved && saved.deckId === deckId && saved.cardId === cardId) {
      restored = await UI.confirmDialog({
        icon: '↩', title: '恢复上次未保存的编辑？',
        sub: '你上次编辑这张卡时没有保存，要接着改吗？（草稿里新选的高清大图需重选）',
        okText: '恢复', cancelText: '不要了'
      });
      if (!restored) removeStoredDraft(); // 只拒绝旧草稿，不影响本次自动保存
    }
    const card = cardId ? deck.cards.find(function (c) { return c.id === cardId; }) : null;
    draft = buildDraft(deck, card);
    cleanSnap = snap(); // 即便恢复了草稿，也要与库内原状（或新卡初始状态）比较
    if (restored) {
      draft = D.withCardStyle(saved.draft);
      // 草稿未保存高清图；预览图相同时，沿用原本已经入库的高清图。
      draft.imageHi = (draft.image || null) === cleanSnap.image ? cleanSnap.imageHi : null;
    }
    refreshDirty();
    draftMuted = false;
    baseVH = window.innerHeight || baseVH;
    undoStack = []; redoStack = [];
    sel = 'name'; bgCat = '素净'; imgMode = false;
    showHint = !cardId;      // 新卡才显示操作教程（旧卡已经会用了，别占一行）
    L._go('editor');
    render();
  }

  /* 从牌背设定页回来：草稿还在，直接重画（别重建草稿） */
  function resume() {
    if (!deckId || !D.findDeck(deckId)) { L.goHome(); return; }
    L._go('editor');
    render();
  }

  /* 系统返回键 / 「‹」按钮：有未保存改动先确认 */
  async function back() {
    /* ★★ 2026-10-15 修（这一条会**静默吃掉用户刚敲的字**）：
       dirty 只在 commit()/undo()/redo() 里刷新，而卡名 / 关键词 / 牌义三个输入框
       要**失焦（blur）**才会走到 commit。系统返回键**不会让输入框失焦** ——
       于是：编辑一张已有的卡 → 在卡名框里打字 → 按系统返回键／手势返回，
       dirty 还停在打开编辑器那一刻的值（false）→ 没有「有未保存的修改」确认框，
       直接退回牌组页，**刚敲的字无声消失**，草稿也没存（persistSoon 只在 commit 里调）。
       点左上角「‹」按钮时输入框会先 blur，所以这条洞只在系统返回键/手势返回上出现。
       正解：进 back() 先按**当前 draft** 重算一次 dirty，别信那个可能过期的布尔值。 */
    if (sheetOpen) { setSheet(false); return true; }   // ⋯ 面板开着 → 先关面板
    commitActiveText();
    refreshDirty();
    if (dirty) {
      const ok = await UI.confirmDialog({
        icon: '⚠', title: '有未保存的修改',
        sub: '离开后这些改动会丢失（或恢复上次的草稿）。',
        okText: '不保存', cancelText: '留下'
      });
      if (!ok) return true;    // 留下 → 吃掉这次返回
      clearDraft();            // 主动放弃 → 草稿也别再弹
    } else {
      cancelDraftWrite();
      draftMuted = true;
      removeMatchingDraft();
    }
    if (deckId && D.findDeck(deckId)) L.goDeck(deckId);
    else L.goHome();
    return true;
  }

  /* ============================================================
   * 渲染
   * ============================================================ */
  const P = function () { return sel === 'kw' ? 'kw' : 'name'; };

  function render() {
    const deck = D.findDeck(deckId);
    if (!deck || !draft) { L.goHome(); return; }
    const isNew = !cardId;

    /* ★ 2026-11-19：每次重画都从"半屏"档开始，清掉上一次可能留下的铺满/拖动类。
       #lib-editor 是常驻节点，类不会随 innerHTML 重建，不在这里清会带到下一张卡。 */
    dockLevel = 'half';
    dragH = 0;
    dockFullHold = false;
    baseAvail = 0;
    /* ★ 2026-11-19（抽屉缩放）：换了一张卡就把上一次的吸附收尾作废 ——
       否则 260ms 后它还会对着新页面 applyDock / 收类，档位被它偷偷改掉。 */
    if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; }
    snapSeq++;
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    pointerFrame = 0; latestPointerEvent = null;
    gPtr = {}; gDrag = gPinch = iDrag = iPinch = null;
    pageEl.classList.remove('is-dockfull', 'is-dockdrag', 'is-docksnap');

    pageEl.innerHTML =
      '<div class="lib-head ed-head">' +
        /* ★ 2026-10-11：顶栏图标改成 **Lucide 线条 SVG**（与 App 其它图标同一套语言）——
           原来用文字符号 ‹ ↶ ↷，字形粗细/基线各不相同，跟「完成」放一起看着不齐。 */
        '<button type="button" class="btn-mini ed-ico" id="ed-back" aria-label="返回">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>' +
        '</button>' +
        '<div class="lib-title">' + (isNew ? '新猫卡' : '编辑猫卡') + '</div>' +
        '<button type="button" class="btn-mini ed-ico" id="ed-undo" aria-label="撤销" title="撤销">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>' +
        '</button>' +
        '<button type="button" class="btn-mini ed-ico" id="ed-redo" aria-label="重做" title="重做">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>' +
        '</button>' +
        '<button type="button" class="btn-mini ed-ico" id="ed-more" aria-label="更多操作" title="更多" aria-expanded="false">' +
          '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.4" cy="12" r="1.35"/><circle cx="12" cy="12" r="1.35"/><circle cx="18.6" cy="12" r="1.35"/></svg>' +
        '</button>' +
        '<button type="button" class="btn-mini btn-done" id="ed-save">完成</button>' +
      '</div>' +

      '<div class="ed-body">' +
        '<div class="cv-stage ed-stage" id="ed-stage">' +
          '<div class="cv-guide v" id="ed-g-l" style="left:35%"></div>' +
          '<div class="cv-guide v" id="ed-g-r" style="left:65%"></div>' +
          '<div class="cv-guide h" id="ed-g-h" style="top:50%"></div>' +
          /* ★ 2026-11-14（第三轮）：位置尺从"跟牌一样高的长尺"改成**紧凑竖滑条** ——
             手指可以直接在尺上上下拖（和拖牌面上的字等价），值同步；不再占满整张牌的高度。 */
          '<div class="ed-yruler" id="ed-yruler" role="slider" tabindex="0" aria-label="上下位置" aria-valuemin="4" aria-valuemax="96" aria-valuenow="14">' +
            '<span class="ed-yr-ln"></span>' +
            /* 当前值就是这颗游标：它的 ::after 里**常显**「52%」（v3.css，值取自 data-v）。
               数值不在 DOM 里另存一份 —— syncYRuler() 写 data-v，气泡跟着它走。 */
            '<span class="ed-yr-cur" id="ed-yr-cur" data-v="14" style="top:11%"></span>' +
          '</div>' +
          '<div class="cv-card cv-big" id="ed-card"></div>' +
        '</div>' +

        '<div class="ed-dock" id="ed-dock">' +
          /* ★ 2026-11-14：抓手（上滑铺满 / 下滑看牌）。原来是 ::before 伪元素 —— 好看但点不了。 */
          '<button type="button" class="ed-grab" id="ed-grab" aria-label="上滑铺满面板 / 下滑回去看牌" aria-expanded="false"><i></i><span>展开工具</span></button>' +
          /* ★ 图片调整条改为坞内固定行（P0-04）：不再插在画布与坞之间，画布尺寸保持 224 恒定 */
          '<div class="ed-imgbar" id="ed-imgbar">' +
            '<span>正在调整图片：拖动挪位置 · 双指缩放' +
              '<b class="ed-img-sca" id="ed-img-sca"></b></span>' +
            '<button type="button" class="btn-mini btn-done" id="ed-img-done">完成</button>' +
          '</div>' +
          /* ★ P1：坞顶固定区「改字」—— 卡名/关键词目标 + 当前输入框 + 是否上牌面。
             永远不滚，解决「改字要滚 2.5–3 屏」。 */
          '<div id="ed-quick" class="ed-quick">' +
            '<span class="seg ed-quick-tabs" id="ed-target">' +
              '<button type="button" class="seg-btn" data-target="name">卡名</button>' +
              '<button type="button" class="seg-btn" data-target="kw">关键词</button>' +
            '</span>' +
            '<input class="input ed-quick-in" id="ed-name" maxlength="12" placeholder="这张卡的名字" value="' + UI.esc(draft.name || '') + '" enterkeyhint="done" autocomplete="off" spellcheck="false" autocapitalize="off">' +
            '<input class="input ed-quick-in" id="ed-keyword" maxlength="8" placeholder="一个词或短语" value="' + UI.esc(draft.keyword || '') + '" enterkeyhint="done" autocomplete="off" spellcheck="false" autocapitalize="off" hidden>' +
            '<button type="button" class="ed-mini ed-quick-on" id="ed-kw-toggle" aria-pressed="true">上牌面 开</button>' +
          '</div>' +
          '<div class="ed-scroll">' +
            (showHint ? '<div class="et-tip ed-guide" id="ed-guide">起手三件事：① 上方改字 ② 画布拖位置 / 双指调字号 ③ 下方「底子」换风格' + ((isNew && deck.cards.length) ? '（已沿用上一张样式，可单独改）' : '') + '</div>' : '') +

            
            /* ★ 2026-11-14：三个页签代替九个折叠组 —— 文字（常改）/ 外观（偶尔）/ 内容 */
            '<div class="ed-tabs" id="ed-tabs" role="tablist">' +
                          '<button type="button" class="ed-tab is-on" role="tab" data-pane="text" aria-selected="true">文字</button>' +
                          '<button type="button" class="ed-tab" role="tab" data-pane="look" aria-selected="false">外观</button>' +
                          '<button type="button" class="ed-tab" role="tab" data-pane="content" aria-selected="false">内容</button>' +
                        '</div>' +
            '<div class="ed-pane" data-pane="text">' +
            /* —— 字号（常显） —— */
            '<section class="ed-sec">' +
              '<div class="ed-sec-h"><span class="ed-sec-t">字号</span><b class="ed-sec-v" id="ed-fs-v"></b></div>' +
              '<div class="ed-sec-b">' +
                '<input type="range" id="ed-fs" min="20" max="200" step="1" aria-label="字号">' +
                '<span class="seg" id="ed-fit">' +
                  '<button type="button" class="seg-btn" data-fit="auto">自动适配</button>' +
                  '<button type="button" class="seg-btn" data-fit="manual">手动</button>' +
                '</span>' +
              '</div>' +
            '</section>' +

            
            /* —— 位置（常显） —— */
            '<section class="ed-sec">' +
              '<div class="ed-sec-h"><span class="ed-sec-t">位置</span><b class="ed-sec-v" id="ed-pos-v"></b></div>' +
              '<div class="ed-sec-b">' +
                '<div class="ed-row">' +
                  '<span class="seg" id="ed-align">' +
                    '<button type="button" class="seg-btn" data-align="l">左</button>' +
                    '<button type="button" class="seg-btn" data-align="c">中</button>' +
                    '<button type="button" class="seg-btn" data-align="r">右</button>' +
                  '</span>' +
                  '<button type="button" class="ed-mini" id="ed-pos-reset">回到默认</button>' +
                  /* ★ 2026-11-14：上下的位置不再用滑条 —— 直接拖画布上的字，右边有把尺 */
                '</div>' +
                  '<div class="et-tip">上下：直接拖牌面上的字，画布右边有尺 · 左右：用上面这排。</div>' +
              '</div>' +
            '</section>' +

            
            /* —— 字体（常显 · 2026-11-14 第三轮去折叠） —— */
            '<section class="ed-sec" id="ed-sec-font">' +
              '<div class="ed-sec-h is-static"><span class="ed-sec-t">字体</span><b class="ed-sec-v" id="ed-font-v"></b></div>' +
              '<div class="ed-sec-b">' +
                /* 11 款字体：横滑选择，**每个按钮用该字体自己的字形写字**（所见即所得的选择器） */
                '<div class="ed-fonts" id="ed-font">' +
                  FONT_LIST.map(function (f) {
                    return '<button type="button" class="ed-font' + (f.id === 'sys' ? ' is-sys' : ' is-ft-' + f.id) +
                      '" data-font="' + f.id + '">' + f.name + '</button>';
                  }).join('') +
                '</div>' +
                '<span class="seg" id="ed-weight">' +
                  '<button type="button" class="seg-btn" data-w="400">常规</button>' +
                  '<button type="button" class="seg-btn" data-w="600">中</button>' +
                  '<button type="button" class="seg-btn" data-w="700">粗</button>' +
                '</span>' +
              '</div>' +
            '</section>' +

            
            '</div>' +

            '<div class="ed-pane" data-pane="look" hidden>' +
            /* ★ 2026-11-14（第二轮）：外观页**摊平** —— 照预览稿 A2-完整-外观。
               上一轮只是把四个折叠组塞进了「外观」页签，想换质感还得先点「牌面」展开；
               现在四组常显（小标题 + 控件 + 当前值），找东西不用先猜在哪个折叠里。 */
            /* —— 底子：起手式「挑底子」（17 个主题横滑，整卡实况预览） —— */
            '<section class="ed-look" id="ed-look-theme">' +
              '<div class="ed-look-h"><span class="ed-look-t">底子</span><b class="ed-look-v" id="ed-base-v"></b></div>' +
              '<div class="ed-row ed-themes" id="ed-themes">' +
                THEMES.map(function (t) {
                  return '<button type="button" class="ed-theme" data-theme="' + t.id + '" title="' + t.name + '">' +
                    '<span class="ed-theme-pv">' + themeMiniHTML(t) + '</span>' +
                    '<em>' + t.name + '</em></button>';
                }).join('') +
              '</div>' +
              '<button type="button" class="ed-mini ed-wide" id="ed-theme-all">让整副都这样</button>' +
            '</section>' +

            /* —— 样式：6 类 × 39 款实况预览（5 列网格，格子里就是牌面上的样子） —— */
            '<section class="ed-look" id="ed-look-style">' +
              '<div class="ed-look-h"><span class="ed-look-t">样式</span><b class="ed-look-v" id="ed-style-v"></b></div>' +
              '<span class="seg is-mini seg-wrap" id="ed-bgcat">' +
                BGSTYLE_GROUPS.map(function (g) { return '<button type="button" class="seg-btn" data-bgcat="' + g[0] + '">' + g[0] + '</button>'; }).join('') +
              '</span>' +
              '<div class="ed-bggrid" id="ed-bgstyle">' + styleGridHTML() + '</div>' +
              '<div class="ed-row" id="ed-bgrow">' +
                '<span class="ed-lb">颜色</span>' +
                '<span class="ed-custom-sw"><input type="color" class="ed-color" id="ed-bg" aria-label="底色颜色"></span>' +
                '<input type="range" id="ed-bga" min="0" max="100" step="1" aria-label="底色深浅">' +
                '<span class="ed-vv" id="ed-bga-v"></span>' +
              '</div>' +
              '<div class="et-tip" id="ed-bg-tip"></div>' +
              /* 字色：朱砂 / 烫金 / 墨绿……「自动」= 按底色取对比色 */
              '<div class="ed-row" id="ed-textrow">' +
                '<span class="ed-lb">字色</span>' +
                '<span class="ed-colors" id="ed-textcolor">' +
                  TEXT_COLORS.map(function (c) {
                    const st = c.v ? ('--sw:' + c.v) : '--sw:linear-gradient(135deg,#fff 0 45%,#4a525e 45% 55%,#1b1f24 55% 100%)';
                    return '<button type="button" class="ed-cbtn" data-tc="' + (c.v || '') + '" title="' + c.name + '" style="' + st + '"></button>';
                  }).join('') +
                '</span>' +
                '<span class="ed-custom-sw"><input type="color" class="ed-color" id="ed-tc-custom" aria-label="自定义字色" title="自定义"></span>' +
              '</div>' +
            '</section>' +

            /* —— 牌面：底色 / 质感 / 纸边（每张卡独立） —— */
            '<section class="ed-look" id="ed-look-face">' +
              '<div class="ed-look-h"><span class="ed-look-t">牌面</span><b class="ed-look-v" id="ed-face-v"></b></div>' +
              '<div class="ed-row" id="ed-swatches">' +
                '<span class="ed-lb">底色</span>' +
                '<span class="ed-swatches" id="ed-swatch-list">' +
                  FACE_SWATCHES.map(function (s) {
                    const bg = s.v == null
                      ? '--sw:linear-gradient(135deg,#fff 0 45%,#dfe3e8 45% 55%,#fff 55% 100%)'
                      : '--sw:' + s.v;
                    return '<button type="button" class="ed-swatch" data-facebg="' + (s.v == null ? '' : s.v) + '" title="' + s.name + '" style="' + bg + '"></button>';
                  }).join('') +
                  '<span class="ed-custom-sw"><input type="color" class="ed-color" id="ed-facebg-custom" aria-label="自定义底色" title="自定义"></span>' +
                '</span>' +
              '</div>' +
              /* 质感：10 张程序生成的纹理（缩略图直接看效果，「无」= 平色） */
              '<div class="ed-row ed-texrow">' +
                '<span class="ed-lb">质感</span>' +
                '<div class="ed-texes" id="ed-texes">' +
                  TEX_LIST.map(function (t) {
                    const inner = t.id
                      ? '<span class="ed-tex-img' + ((t.id === 'stars' || t.id === 'nebula') ? ' is-lt' : '') +
                        '" style="background-image:url(assets/tex/' + t.id + '.png)"></span>'
                      : '';
                    return '<button type="button" class="ed-tex" data-tex="' + (t.id || '') + '" title="' + t.name + '">' +
                      '<span class="ed-tex-pv">' + inner + '</span><em>' + t.name + '</em></button>';
                  }).join('') +
                '</div>' +
              '</div>' +
              '<div class="ed-row">' +
                '<span class="ed-lb">纸边</span>' +
                '<span class="seg is-mini" id="ed-edge">' +
                  '<button type="button" class="seg-btn" data-edge="1">画</button>' +
                  '<button type="button" class="seg-btn" data-edge="0">不画</button>' +
                '</span>' +
              '</div>' +
              '<div class="et-tip">底色 / 质感 / 纸边每张卡独立；要整副统一，去「底子」点「让整副都这样」</div>' +
            '</section>' +

            /* —— 图片：选择 / 滤镜 / 调整（预览缩略图下线 —— 画布上的牌就是预览） —— */
            '<section class="ed-look" id="ed-look-img">' +
              '<div class="ed-look-h"><span class="ed-look-t">图片</span><b class="ed-look-v" id="ed-img-v"></b></div>' +
              '<div class="ed-row ed-imgbtns">' +
                '<button type="button" class="ed-mini" id="ed-pick-img">选择图片</button>' +
                '<button type="button" class="ed-mini" id="ed-clear-img">清除</button>' +
              '</div>' +
              '<div class="ed-row">' +
                '<span class="ed-lb">滤镜</span>' +
                '<span class="seg is-mini" id="ed-imgfilter">' +
                  Object.keys(IMG_FILTER_NAMES).map(function (f) {
                    return '<button type="button" class="seg-btn" data-filter="' + f + '">' + IMG_FILTER_NAMES[f] + '</button>';
                  }).join('') +
                '</span>' +
              '</div>' +
              '<button type="button" class="ed-mini ed-wide" id="ed-img-adjust">调整图片位置与大小</button>' +
              '<div class="et-tip">选图进入裁剪（2:3）作卡面底图；选完自动进入图片调整，拖动摆位置、双指缩放</div>' +
            '</section>' +

            '</div>' +

            '<div class="ed-pane" data-pane="content" hidden>' +
            /* —— 牌义（常显 · 2026-11-14 第三轮去折叠；↗ 内容页只剩它，再折叠就是空页） —— */
            '<section class="ed-sec" id="ed-sec-meaning">' +
              '<div class="ed-sec-h is-static"><span class="ed-sec-t">牌义</span><b class="ed-sec-v" id="ed-meaning-v"></b></div>' +
              '<div class="ed-sec-b">' +
                '<div class="field"><label>牌义「说明」</label>' +
                  '<textarea class="textarea" id="ed-meaning" rows="7" placeholder="这张卡的含义、想说的话…">' + UI.esc(draft.meaning || '') + '</textarea></div>' +
              '</div>' +
            '</section>' +
            '</div>' +
          '</div>' +
        '</div>' +

        /* ★ 2026-11-14（第三轮）：顶栏 ⋯ 打开的「更多」底部面板。
           原来它是内容页最底下的一条折叠组 —— 位置不对：导出/复制/删卡是全局动作，
           跟「牌义」不是一类东西。现在照预览稿放进顶栏 ⋯，用底部动作面板承载。 */
        '<div class="ed-sheet" id="ed-sheet" hidden>' +
          '<button type="button" class="ed-sheet-mask" id="ed-sheet-mask" aria-label="关闭"></button>' +
          '<div class="ed-sheet-box" role="dialog" aria-label="更多操作">' +
            '<div class="ed-sheet-h"><i></i></div>' +
            '<button type="button" class="ed-sheet-item" id="ed-export-face">导出牌面图</button>' +
            '<button type="button" class="ed-sheet-item" id="ed-export-back">导出牌背图</button>' +
            (cardId ? '<button type="button" class="ed-sheet-item" id="ed-clone-card">复制这张卡</button>' : '') +
            '<button type="button" class="ed-sheet-item" id="ed-goto-back">设置牌背</button>' +
            (cardId ? '<button type="button" class="ed-sheet-item is-danger" id="ed-del-card">删除这张卡</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>';

    L._setTabbar(false);      // 编辑页占满整屏，藏底栏
    bindEvents();
    paintFace();
    fitBigCard();
    dockSync();
    syncUndoBtns();
    setImgMode(false);
    syncKb();
    /* ★ 首帧校正 + 自动收敛：工具坞内容（底子横条 / 展开的组）会把画布挤矮，
       必须等这一帧布局落定后再算一次，并让 ResizeObserver 接管后续变化。 */
    requestAnimationFrame(function () {
      fitBigCard();
      watchStage();
      requestAnimationFrame(fitBigCard);
    });
  }

  /* 39 款样式的实况预览网格：每格直接用当前文字渲染真实 chip（ui.js previewChip） */
  function styleGridHTML() {
    const kind = P();
    const txt = sel === 'kw' ? (draft.keyword || '关键词') : (draft.name || '卡名');
    return BGSTYLE_GROUPS.map(function (g) {
      return g[1].map(function (id) {
        const cardFor = Object.assign({}, D.withCardStyle(draft), {});
        cardFor[kind === 'kw' ? 'kwBgStyle' : 'nameBgStyle'] = id;
        const chip = UI.previewChip(kind, cardFor, txt);
        const bg = (draft.faceBg) ? 'background:' + draft.faceBg + ';' : '';
        return '<button type="button" class="ed-bgcell" data-bgstyle="' + id + '" data-bgcat="' + g[0] + '">' +
          '<span class="ed-bgcell-pv" style="--card-w:56px;' + bg + '">' + chip + '</span>' +
          '<em>' + (BGSTYLE_NAMES[id] || id) + '</em></button>';
      }).join('');
    }).join('');
  }

  function themeCard(patch) {
    return Object.assign({}, D.withCardStyle(draft), patch);
  }
  function themeMiniHTML(t) {
    const p = themeCard(t.patch);
    if (!p.name) p.name = '卡名';
    if (!p.keyword) p.keyword = '关键词';
    p.nameOn = true;
    p.kwOn = true;
    return '<div class="cv-card" style="--card-w:56px">' + UI.faceHTML(p, {}) + '</div>';
  }
  function themeIsActive(t) {
    return Object.keys(t.patch).every(function (k) { return draft[k] === t.patch[k]; });
  }

  /* 画布牌面：和台面同一个 faceHTML。空文字打占位标记，选中块打 is-sel。
     ★ 重建 DOM 后手势监听也会丢 → 每次都在这里重绑。 */
  function paintFace() {
    if (!pageEl) return;
    const node = pageEl.querySelector('#ed-card');
    if (!node) return;
    const p = Object.assign({}, D.withCardStyle(draft));
    if (!p.name) p.name = '卡名';
    if (!p.keyword) p.keyword = '关键词';
    /* ★ 2026-11-19：编辑页卡名/关键词**一律渲染**（否则关掉的那块没法调样式/拖位置），
       关没关只体现为压暗（.is-off，样式在 v3.css）。台面/导出仍走 faceHTML 的真值。 */
    p.nameOn = true;
    p.kwOn = true;
    node.innerHTML = UI.faceHTML(p, {});
    if (!draft.name) { const c = node.querySelector('.fc-chip.fc-name'); if (c) c.classList.add('is-ph'); }
    if (!draft.keyword) { const c = node.querySelector('.fc-chip.fc-keyword'); if (c) c.classList.add('is-ph'); }
    applySel();
    /* P1-03 / 2026-11-19：关掉的块压暗 + title 说明；状态类由 v3.css 画，不再写行内 opacity。 */
    [['name', 'nameOn', '卡名'], ['kw', 'kwOn', '关键词']].forEach(function (it) {
      const w = node.querySelector('.fc-wrap[data-kind="' + it[0] + '"]');
      if (!w) return;
      const off = draft[it[1]] === false;
      w.classList.toggle('is-off', off);
      w.title = off ? (it[2] + '不上牌面（编辑页仍显示，方便调样式）') : '';
    });
    bindGestures();
  }

  function applySel() {
    if (!pageEl) return;
    pageEl.querySelectorAll('#ed-card .fc-wrap').forEach(function (w) {
      w.classList.toggle('is-sel', w.dataset.kind === sel);
    });
  }

  /* 拖动/滑条路径：只改已有节点的 style，绝不重建 DOM（手势三原则） */
  function paintBlock(kind) {
    if (!pageEl || !draft) return;
    const wrap = pageEl.querySelector('#ed-card .fc-wrap[data-kind="' + kind + '"]');
    if (!wrap) return;
    const Pk = kind === 'kw' ? 'kw' : 'name';
    /* 位置必须和台面用同一份算法（UI.effNameVy / UI.wrapPosStyle） */
    const fit0 = UI.fitFs(kind, kind === 'kw' ? draft.keyword : draft.name,
                          draft[Pk + 'Fs'], draft.autoFit !== false,
                          kind === 'kw' && draft.kwWrap2 === true,
                          !!(draft[Pk + 'Font'] && draft[Pk + 'Font'] !== 'sys'));
    const vy0 = (kind === 'name') ? UI.effNameVy(draft, draft) : draft.kwVy;
    const PS = UI.wrapPosStyle(kind, vy0, fit0.wrap, fit0.pin);
    wrap.style.top = PS.top; wrap.style.bottom = PS.bottom; wrap.style.transform = PS.transform;
    const h = draft[Pk + 'H'];
    wrap.style.justifyContent = h === 'l' ? 'flex-start' : (h === 'r' ? 'flex-end' : 'center');
    const chip = wrap.querySelector('.fc-chip');
    if (chip) {
      chip.style.fontSize = 'calc(var(--card-w, 90px) * ' + (FS_RATIO[Pk] * (fit0.fs / 100)).toFixed(5) + ')';
      chip.style.whiteSpace = fit0.wrap ? 'normal' : 'nowrap';
      chip.style.wordBreak = fit0.wrap ? 'break-word' : '';
    }
  }

  function paintText(kind) {
    const chip = pageEl.querySelector('#ed-card .fc-wrap[data-kind="' + kind + '"] .fc-chip');
    const value = kind === 'name' ? draft.name : draft.keyword;
    if (!chip) { paintFace(); return; }
    chip.textContent = value || (kind === 'name' ? '卡名' : '关键词');
    chip.classList.toggle('is-ph', !value);
    paintBlock(kind);
    if (sel === kind) syncFsDock(kind);
  }

  /* 画布大牌尺寸跟着可用高度收敛（防"面板一开，大牌顶出去"的老毛病）。
     ★ 2026-10-11 实测修（小屏 360×640）：光"面板开合时算一次"不够 ——
     工具坞**内容撑高**（底子组常显 + 展开别的组）时画布会变矮，而牌面不会自己缩，
     于是溢出画布**盖住顶栏的返回/撤销**。现在除了面板开合，还挂 ResizeObserver
     盯着画布本身：只要画布尺寸变了（布局完成 / 键盘弹出 / 旋转屏）就重新收敛。
     另外留 14px 余量（原来是 18px 除以 1.5 之后只剩几像素，容易贴着边）。 */
  function fitBigCard() {
    if (!pageEl) return;
    /* ★ 2026-11-14（第五轮）：铺满时画布是收起的（flex-basis 0 / opacity 0）。
       这期间 ResizeObserver 会每帧回调一次，原来每帧都重算牌宽 + 写 CSS 变量 ——
       在手机上就是"面板一开一卡一卡"的主因。收起态直接不重算，收回时（class 已摘）立刻恢复。 */
    if (pageEl.classList.contains('is-dockfull') ||
        pageEl.classList.contains('is-dockdrag') ||
        pageEl.classList.contains('is-docksnap')) return;
    const stage = pageEl.querySelector('#ed-stage');
    if (!stage) return;
    const h = stage.clientHeight || Math.round((window.innerHeight || 600) * 0.36);
    /* ★ 键盘态：画布只剩 ~92px，84 的下限会让牌 84×127 被裁掉上下两头。
       这时允许缩到 56（约 56×85，完整装进画布）；键盘收起立即回到 224。 */
    const kb = pageEl.classList.contains('is-kb');
    const avail = Math.max(1, h - (kb ? 8 : 14));
    const w = Math.max(1, Math.floor(Math.min(224, (window.innerWidth || 360) * 0.66, avail / 1.5)));
    /* ⚠ 必须写在大牌**自己**的行内 style 上（行内优先级最高）——
       只写 stage 上的话会被 .cv-big 的元素自身声明压掉（这就是小屏溢出的根因）。
       stage 上再写一份是为了参考线/将来的子元素也能拿到。 */
    stage.style.setProperty('--card-w', w + 'px');
    const card = pageEl.querySelector('#ed-card');
    if (card) card.style.setProperty('--card-w', w + 'px');

    /* ★ 2026-11-14（第三轮）：尺子不再跟着牌的高度撑满 —— 改成固定 120px 的紧凑竖滑条，
       垂直居中（CSS 定位）。用户原话：「画布上那个尺子做的也很丑 做那么长干嘛？」 */
    return w;
  }

  /* 画布尺寸变化 → 自动收敛（ResizeObserver 比"猜时机"可靠） */
  function watchStage() {
    const stage = pageEl && pageEl.querySelector('#ed-stage');
    if (!stage || typeof ResizeObserver === 'undefined') return;
    if (stageRO) { try { stageRO.disconnect(); } catch (e) {} stageRO = null; }
    let last = -1, fitRaf = 0;
    stageRO = new ResizeObserver(function () {
      const h = stage.clientHeight;
      if (h === last) return;
      last = h;
      if (fitRaf) return;
      fitRaf = requestAnimationFrame(function () {
        fitRaf = 0;
        if (stage.isConnected) fitBigCard();
      });
    });
    try { stageRO.observe(stage); } catch (e) {}
  }

  /* 工具坞全量同步（值 → 控件） */
  /* 位置尺：把草稿里的 vy 画到画布右边那根尺上（纯展示，不接手势）
     ★ 2026-11-17（返工）：尺子上那颗游标**常显**「52%」—— 气泡内容就是 data-v
       （v3.css 的 `.ed-yr-cur::after{content: attr(data-v) "%"}`），所以这里只写一次
       data-v + top，数字和游标不可能各走各的。
       三条改位置的路径全都经过这个函数（dockSync / 拖尺 applyY / 直接拖牌面上的字），
       4~96 → 0~100% 的映射也只在这里算一次。 */
  function syncYRuler(vy) {
    var cur = pageEl && pageEl.querySelector('#ed-yr-cur');
    if (!cur) return;
    var v = Math.max(4, Math.min(96, Math.round(vy || 0)));
    /* ★ 第三轮：尺子变短了，4..96 铺满整条轨道（这样手指和圆点 1:1，不会越拖越偏） */
    cur.style.top = (((v - 4) / 92) * 100).toFixed(2) + '%';
    cur.setAttribute('data-v', v);              /* ← 游标旁那个常显数字的唯一来源 */
    var ruler = pageEl.querySelector('#ed-yruler');
    if (ruler) ruler.setAttribute('aria-valuenow', v);
  }

  /* ★ 2026-11-17：字号滑条 + 标签的**唯一**口径（dockSync 与「文字块捏合」共用）。
     手动模式下滑条绑**草稿值**，不再被拽回实际值 —— 实际画出来的字号可能被
     UI.fitFs 的宽度上限压住（这是故意的，别放开），压住时标签两个数都给：
     「200% 手动 · 实际 179%」，滑条停在 200。自动模式和以前一样显示实际适配值。
     捏合路径每帧都调这里，所以别塞整个 dockSync 进去（那要扫十几组控件）。 */
  function syncFsDock(kind) {
    if (!pageEl || !draft) return;
    const Pk = (kind === 'kw' || (!kind && sel === 'kw')) ? 'kw' : 'name';
    const auto = draft.autoFit !== false;
    const real = Math.round(UI.fitFs(Pk, Pk === 'kw' ? draft.keyword : draft.name,
                                     draft[Pk + 'Fs'], auto).fs);
    /* 标签用 clamp 过的 stored 而不是裸 draft：草稿万一越界，滑条与标签也不会打架 */
    const raw = Math.round(parseFloat(draft[Pk + 'Fs']));
    const stored = Math.max(20, Math.min(200, isNaN(raw) ? (Pk === 'kw' ? 76 : 100) : raw));
    const fs = pageEl.querySelector('#ed-fs');
    if (fs) fs.value = auto ? real : stored;
    const lab = pageEl.querySelector('#ed-fs-v');
    if (lab) lab.textContent = auto ? (real + '% 自动')
      : (stored + '% 手动' + (real < stored ? ' · 实际 ' + real + '%' : ''));
  }

  function dockSync() {
    if (!pageEl || !draft) return;
    const Pk = P();
    const auto = draft.autoFit !== false;
    const setTxt = function (id, v) { const n = pageEl.querySelector(id); if (n) n.textContent = v; };

    /* 坞顶固定区（P1）：目标切换 + 当前输入框 + 关键词上牌面 */
    pageEl.querySelectorAll('#ed-target .seg-btn').forEach(function (b) {
      const on = b.dataset.target === sel;
      b.classList.toggle('is-sel', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const nameIn = pageEl.querySelector('#ed-name');
    const kwIn = pageEl.querySelector('#ed-keyword');
    if (nameIn) nameIn.hidden = (sel !== 'name');
    if (kwIn) kwIn.hidden = (sel !== 'kw');
    /* ★ 撤销/重做 / 双击改字后把输入框拉回草稿值（别在用户正在打字时抢光标） */
    if (nameIn && document.activeElement !== nameIn) nameIn.value = draft.name || '';
    if (kwIn && document.activeElement !== kwIn) kwIn.value = draft.keyword || '';
    /* ★ 2026-11-19：按钮跟当前目标走 —— 目标=卡名就显示/控制 nameOn，
       目标=关键词就显示/控制 kwOn。一个按钮、两个字段，别再写成只认 kwOn。 */
    const kwTog = pageEl.querySelector('#ed-kw-toggle');
    if (kwTog) {
      const isName = sel === 'name';
      const onNow = (isName ? draft.nameOn : draft.kwOn) !== false;
      const label = isName ? '卡名' : '关键词';
      kwTog.textContent = label + '上牌面 ' + (onNow ? '开' : '关');
      kwTog.classList.toggle('is-on', onNow);
      kwTog.setAttribute('aria-pressed', onNow ? 'true' : 'false');
      kwTog.setAttribute('aria-label', label + '是否显示在牌面上');
    }

    /* 底子：主题选中态 + 摘要 */
    const activeTheme = THEMES.filter(themeIsActive)[0] || null;
    setTxt('#ed-base-v', activeTheme ? activeTheme.name : '自定义');
    pageEl.querySelectorAll('#ed-themes .ed-theme').forEach(function (b) {
      const t = THEMES.filter(function (x) { return x.id === b.dataset.theme; })[0];
      b.classList.toggle('is-sel', !!t && themeIsActive(t));
    });

    /* 摘要值 */
    setTxt('#ed-pos-v', Math.round(draft[Pk + 'Vy']) + '% · ' + ({ l: '左', c: '中', r: '右' }[draft[Pk + 'H']] || '中'));
    syncFsDock();                     /* ★ 滑条 + 字号标签统一口径（手动模式绑草稿值） */
    setTxt('#ed-font-v', (FONT_NAME[String(draft[Pk + 'Font'] || 'sys')] || '系统') + ' · ' +
      ({ 400: '常规', 600: '中', 700: '粗' }[draft[Pk + 'Weight'] || 700]));
    setTxt('#ed-style-v', BGSTYLE_NAMES[String(draft[Pk + 'BgStyle'] || 'soft')] || '柔光');
    const texObj = TEX_LIST.filter(function (t) { return t.id === (draft.faceTex || null); })[0];
    setTxt('#ed-face-v', faceBgName(draft.faceBg) + ' · ' + (texObj ? texObj.name : '平色') +
      ' · ' + (draft.faceEdge === false ? '无纸边' : '纸边'));
    setTxt('#ed-img-v', draft.image ? ('有图 · ' + (IMG_FILTER_NAMES[draft.imgFilter] || '原图')) : '无图');
    setTxt('#ed-meaning-v', (draft.meaning || '') ? ((draft.meaning || '').length + ' 字') : '未填');

    /* 位置 */
    const vy = pageEl.querySelector('#ed-vy'); if (vy) vy.value = draft[Pk + 'Vy'];
    syncYRuler(draft[Pk + 'Vy']);
    pageEl.querySelectorAll('#ed-align .seg-btn').forEach(function (b) {
      b.classList.toggle('is-sel', b.dataset.align === draft[Pk + 'H']);
    });

    /* 字号 */
    /* ★ P0-03：滑条永远可拖；自动适配时第一次拖动会自己转手动（见 bindEvents） */
    /* ★ 2026-11-17：滑条的值已由上面的 syncFsDock() 写好（手动模式 = 草稿值），这里别再覆盖 */
    pageEl.querySelectorAll('#ed-fit .seg-btn').forEach(function (b) {
      b.classList.toggle('is-sel', (b.dataset.fit === 'auto') === auto);
    });

    /* 字体 */
    const curFont = String(draft[Pk + 'Font'] || 'sys');
    pageEl.querySelectorAll('#ed-font .ed-font').forEach(function (b) {
      b.classList.toggle('is-sel', b.dataset.font === curFont);
    });
    pageEl.querySelectorAll('#ed-weight .seg-btn').forEach(function (b) {
      b.classList.toggle('is-sel', parseInt(b.dataset.w, 10) === (draft[Pk + 'Weight'] || 700));
    });

    /* 样式 */
    const curStyle = String(draft[Pk + 'BgStyle'] || 'soft');
    pageEl.querySelectorAll('#ed-bgcat .seg-btn').forEach(function (b) {
      b.classList.toggle('is-sel', b.dataset.bgcat === bgCat);
    });
    pageEl.querySelectorAll('#ed-bgstyle .ed-bgcell').forEach(function (b) {
      b.style.display = (b.dataset.bgcat === bgCat) ? '' : 'none';
      b.classList.toggle('is-sel', b.dataset.bgstyle === curStyle);
    });
    const bgrow = pageEl.querySelector('#ed-bgrow');
    if (bgrow) bgrow.classList.toggle('is-off', !!NO_BG_STYLE[curStyle]);
    const btip = pageEl.querySelector('#ed-bg-tip');
    if (btip) {
      btip.textContent = (curStyle === 'plain')
        ? '素字：不画底、不要影，文字是深墨色 —— 白卡牌面用这个，「颜色 / 深浅」不起作用。'
        : (FIXED_STYLE[curStyle]
            ? '这款样式自带配色、而且是通条（不管几个字都是同一条）——「颜色 / 深浅」对它不起作用。'
            : (WHITE_TXT_STYLE[curStyle]
                ? '这种样式不画底色 ——「颜色 / 深浅」不起作用，文字固定白字 + 光晕。'
                : '「颜色 / 深浅」决定底块的颜色与透明度。'));
    }
    const bg = pageEl.querySelector('#ed-bg'); if (bg) bg.value = draft[Pk + 'Bg'] || '#ffffff';
    const bga = pageEl.querySelector('#ed-bga'); if (bga) bga.value = draft[Pk + 'BgA'];
    setTxt('#ed-bga-v', Math.round(draft[Pk + 'BgA']) + '%');

    /* 牌面 */
    pageEl.querySelectorAll('#ed-swatches .ed-swatch').forEach(function (b) {
      b.classList.toggle('is-sel', (b.dataset.facebg || null) === (draft.faceBg || null));
    });
    const fbc = pageEl.querySelector('#ed-facebg-custom');
    if (fbc) fbc.value = (draft.faceBg && draft.faceBg.charAt(0) === '#') ? draft.faceBg : '#ffffff';
    pageEl.querySelectorAll('#ed-edge .seg-btn').forEach(function (b) {
      b.classList.toggle('is-sel', (b.dataset.edge === '0') === (draft.faceEdge === false));
    });
    /* 字色：当前字块的强制色（null = 自动） */
    const curTc = (Pk === 'kw' ? draft.kwColor : draft.nameColor) || null;
    pageEl.querySelectorAll('#ed-textcolor .ed-cbtn').forEach(function (b) {
      b.classList.toggle('is-sel', (b.dataset.tc || null) === curTc);
    });
    const tcc = pageEl.querySelector('#ed-tc-custom');
    if (tcc) tcc.value = (curTc && curTc.charAt(0) === '#') ? curTc : '#ffffff';
    /* 质感（缩略图底色跟着牌面底色走 → 在底色上预览纹理） */
    pageEl.querySelectorAll('#ed-texes .ed-tex').forEach(function (b) {
      b.classList.toggle('is-sel', (b.dataset.tex || null) === (draft.faceTex || null));
    });
    /* ★ 2026-11-14：缩略图底色改由 CSS 给中性纸张底（见 v3.css），不再跟着 faceBg 走 ——
       faceBg 是纯白时 soft-light 会把纹理整片抹平，选纹理会变成一排白方块。 */

    /* 图片（2026-11-14：54×82 缩略图下线，画布上的牌就是预览） */
    pageEl.querySelectorAll('#ed-imgfilter .seg-btn').forEach(function (b) {
      b.classList.toggle('is-sel', b.dataset.filter === String(draft.imgFilter || 'none'));
    });

    /* 内容 */
    pageEl.querySelectorAll('#ed-kwon .seg-btn').forEach(function (b) {
      b.classList.toggle('is-sel', (b.dataset.kwon === '1') === (draft.kwOn !== false));
    });
  }

  function refreshPreviews() {
    const grid = pageEl.querySelector('#ed-bgstyle');
    if (grid) {
      grid.innerHTML = styleGridHTML();
      rebindGrid();
    }
    refreshThemePreviews();
  }

  function repaintAll() {
    paintFace();
    if (imgMode && !draft.image) setImgMode(false);
    refreshPreviews();
    dockSync();
    fitBigCard();
  }

  function paintChipColors() {
    const kind = P();
    const chip = pageEl.querySelector('#ed-card .fc-wrap[data-kind="' + kind + '"] .fc-chip');
    if (!chip) return;
    const sample = document.createElement('template');
    const text = kind === 'kw' ? (draft.keyword || '关键词') : (draft.name || '卡名');
    sample.innerHTML = UI.previewChip(kind, draft, text);
    const style = sample.content.firstElementChild.style;
    chip.style.background = style.background;
    chip.style.color = style.color;
  }

  function paintFaceColor() {
    const face = pageEl.querySelector('#ed-card .tcard-face');
    if (!face) return;
    face.style.setProperty('--fc-face', draft.faceBg);
    face.style.setProperty('--fc-plain-ink', UI.textOn(draft.faceBg));
  }

  function bindLiveColor(input, apply, paint) {
    let before = null;
    function update() {
      if (!before) before = snap();
      apply(input.value);
      paint();
    }
    input.addEventListener('input', update);
    input.addEventListener('change', function () {
      if (!before) update();
      refreshPreviews();
      dockSync();
      commit(before);
      before = null;
    });
  }

  /* 主题横条里的 17 张 mini 整卡跟着草稿走（改名字/图片/底子后立刻反映）——
     只换预览内容，不重建横条（滚动位置与事件绑定都保住）。 */
  function refreshThemePreviews() {
    if (!pageEl) return;
    pageEl.querySelectorAll('#ed-themes .ed-theme').forEach(function (b) {
      const t = THEMES.filter(function (x) { return x.id === b.dataset.theme; })[0];
      const pv = b.querySelector('.ed-theme-pv');
      if (t && pv) pv.innerHTML = themeMiniHTML(t);
    });
  }

  /* ============================================================
   * 事件
   * ============================================================ */
  function bindEvents() {
    /* ★ 2026-11-14（第三轮）：面板铺满 —— 点击 / **上滑铺满** / **下滑收回** 都行。
       用户实测「上滑铺满没生效」：上一版只绑了 click，手势一个都没接。 */
    const grabEl = pageEl.querySelector('#ed-grab');
    openCanvasFromDock = null;
    if (grabEl) {
      /* ★ 2026-11-14（第六轮）：工具坞做成**真抽屉** ——
         按住抓手上下拖，坞顶跟手走；两档（半屏 / 铺满），松手按位置 + 速度吸附；轻点快捷切换。
         ★ 2026-11-19：高度不再各写各的（CSS 一条、JS 行内一条、键盘 postscript 一条）——
         这里只改 dockLevel / dragH，真正的像素只由 applyDock() 写进 --dock-h。 */
      const dockEl = pageEl.querySelector('#ed-dock');
      let dockDrag = null;
      let dockFrame = 0;
      let gsuppress = false;
      const flushDock = function () {
        dockFrame = 0;
        if (dockLevel === 'dragging') applyDock();
      };
      const fullH = availBodyH;
      const halfH = function () { return halfDockH(fullH()); };
      const nowH = function () { return dockEl ? dockEl.offsetHeight : 0; };
      const setDockH = function (h) {
        dragH = h;
        if (!dockFrame) dockFrame = requestAnimationFrame(flushDock);
      };
      /* ★ 2026-11-19（抽屉缩放）：这里不再有第二套缩放算法 —— 唯一入口是模块级
         syncDockScale()，由 applyDock() 顺手写，输入就是刚算出来的那个坞高（同源）。 */

      /* 吸附到某一档（点击和松手共用）—— 只改档位，高度和缩放都交给 applyDock。
         ★ 2026-11-19（抽屉缩放）：收尾定时器带代号（snapSeq）——
         旧版没有 token：吸附还没走完又抓手时，260ms 后那个旧 timer 会照样
         摘 is-docksnap、删 --dock-scale，拖动中的牌当场跳一下。 */
      const snapDock = function (toFull) {
        const wasFull = (dockLevel === 'full');
        const seq = ++snapSeq;
        if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; }
        dockLevel = toFull ? 'full' : 'half';
        /* 半屏→铺满：坞先长上去，动画结束再收画布；否则画布提前收，会露出被裁的牌 */
        dockFullHold = toFull && !wasFull;
        dragH = 0;
        pageEl.classList.remove('is-dockdrag');
        pageEl.classList.add('is-docksnap');
        applyDock();
        grabEl.setAttribute('aria-expanded', toFull ? 'true' : 'false');
        grabEl.querySelector('span').textContent = toFull ? '返回画布' : '展开工具';
        grabEl.setAttribute('aria-label', toFull ? '返回画布' : '展开工具');
        snapTimer = setTimeout(function () {
          snapTimer = null;
          if (!pageEl || seq !== snapSeq) return;   // 已经又抓起来了 → 这次收尾作废，什么都不碰
          pageEl.classList.remove('is-docksnap');
          dockFullHold = false;
          applyDock();
          if (!toFull) { fitBigCard(); syncDockScale(); }   // 半屏回来按新画布重排牌宽，再重算缩放
        }, SNAP_MS);
      };

      openCanvasFromDock = function () { if (dockLevel === 'full') snapDock(false); };
      grabEl.addEventListener('pointerdown', function (e) {
        if (dockDrag) return;
        /* ★ 2026-11-19（抽屉缩放）：这一抓接管抽屉 ——
           ① 作废还没到点的吸附收尾（旧 timer 不许再改状态）；
           ② 从**视觉上的当前高**起步（动画半路抓住也不弹）；
           ③ 立刻按这个高度把 --dock-scale 算出来（从铺满起手，第一帧就是 0，
              不会先闪一张满尺寸的牌被裁在画布上）。 */
        snapSeq++;
        if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; }
        const H1 = fullH(), H0 = halfH();
        const wasFull = (dockLevel === 'full');
        const H = Math.max(H0, Math.min(H1, nowH() || dockPx.h || H0));
        dockFullHold = false;
        dockLevel = 'dragging';
        dragH = H;
        pageEl.classList.remove('is-docksnap');   // 吸附的过渡类不能带进拖动（否则坞和牌都慢半拍）
        pageEl.classList.add('is-dockdrag');
        applyDock();
        dockDrag = { id: e.pointerId, y0: e.clientY, H0: H0, H1: H1, Hstart: dragH, H: dragH,
                     moved: false, wasFull: wasFull, vy: 0, prevY: e.clientY, prevT: performance.now() };
        gsuppress = false;
        try { grabEl.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      });
      grabEl.addEventListener('pointermove', function (e) {
        const d = dockDrag;
        if (!d || d.id !== e.pointerId) return;
        const H = Math.max(d.H0, Math.min(d.H1, d.Hstart - (e.clientY - d.y0)));
        if (!d.moved && Math.abs(e.clientY - d.y0) > 4) d.moved = true;
        d.H = H;
        setDockH(H);        // 坞高 + 画布缩放都在 applyDock 里（同一个输入，不再各算一套）
        const now = performance.now();
        d.vy = (e.clientY - d.prevY) / Math.max(1, now - d.prevT);
        d.prevY = e.clientY; d.prevT = now;
        e.preventDefault();
      });
      const grabEnd = function (e) {
        const d = dockDrag;
        if (!d || d.id !== e.pointerId) return;
        dockDrag = null;
        if (dockFrame) { cancelAnimationFrame(dockFrame); flushDock(); }
        if (e.type === 'pointercancel') { snapDock(d.wasFull); return; }
        if (!d.moved) {
          /* 轻点：原样退回（交给 click 去切换） */
          pageEl.classList.remove('is-dockdrag');
          dockLevel = d.wasFull ? 'full' : 'half';
          dragH = 0;
          applyDock();
          return;
        }
        /* 松手：位置 + 速度决定吸附到哪一档 */
        const k = (d.H - d.H0) / Math.max(1, d.H1 - d.H0);
        let toFull;
        if (d.vy < -0.4) toFull = true;
        else if (d.vy > 0.4) toFull = false;
        else toFull = k > 0.45;
        /* pointerup 后浏览器会补一个 click，用 gsuppress 吃掉；
           pointercancel 之后**不会**补 click —— 别让 gsuppress 吃掉下一次轻点。 */
        gsuppress = (e.type !== 'pointercancel');
        snapDock(toFull);
      };
      grabEl.addEventListener('pointerup', grabEnd);
      grabEl.addEventListener('pointercancel', grabEnd);
      grabEl.addEventListener('click', function () {
        if (gsuppress) { gsuppress = false; return; }        // 手势已经处理过，别再 toggle 一次
        snapDock(dockLevel !== 'full');
      });
    }

    /* ★ 2026-11-14（第三轮）：位置尺本身也能拖 —— 上下拖它 = 调当前文字块的上下位置
       （和直接拖牌面上的字等价）。用户原话：「画布的那个尺子理论上应该也能滑动操作」。 */
    const yrEl = pageEl.querySelector('#ed-yruler');
    if (yrEl) {
      let yrId = null, yrBefore = null;
      const applyY = function (clientY) {
        const r = yrEl.getBoundingClientRect();
        if (!r.height) return;
        let ratio = (clientY - r.top) / r.height;
        ratio = Math.max(0, Math.min(1, ratio));
        const vy = Math.round(4 + ratio * 92);
        draft[P() + 'Vy'] = vy;
        paintBlock(sel);
        syncYRuler(vy);
        setTxtNow('#ed-pos-v', vy + '% · ' + ({ l: '左', c: '中', r: '右' }[draft[P() + 'H']] || '中'));
      };
      yrEl.addEventListener('pointerdown', function (e) {
        if (imgMode) return;
        yrId = e.pointerId; yrBefore = snap();
        /* ★ 2026-11-17：`.ed-yruler` 从来没有过 is-dragging 这个类（只有 `.cv-stage` 会挂），
           于是 v3.css 里 `.ed-yruler.is-dragging ...` 那几条一直是**死代码**。
           这里补上：按下挂、松手/取消摘。它现在管的是「拖动中把数值强调一下」——
           尺子上的数字是**常显**的（.ed-yr-cur::after），静止态 --ink-2，拖动中变墨色 + 加粗。 */
        yrEl.classList.add('is-dragging');
        try { yrEl.setPointerCapture(e.pointerId); } catch (err) {}
        applyY(e.clientY);
        e.preventDefault();
        e.stopPropagation();
      });
      yrEl.addEventListener('pointermove', function (e) {
        if (yrId !== e.pointerId) return;
        applyY(e.clientY);
        e.preventDefault();
      });
      const yrEnd = function (e) {
        if (yrId !== e.pointerId) return;
        yrId = null;
        yrEl.classList.remove('is-dragging');       // 与 pointerdown 的 add 成对，见那里的注释
        if (yrBefore) { commit(yrBefore); yrBefore = null; }
      };
      yrEl.addEventListener('pointerup', yrEnd);
      yrEl.addEventListener('pointercancel', yrEnd);
      yrEl.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const before = snap();
        const cur = Math.round(draft[P() + 'Vy'] || 0);
        draft[P() + 'Vy'] = Math.max(4, Math.min(96, cur + (e.key === 'ArrowUp' ? -1 : 1)));
        paintBlock(sel); dockSync();
        commit(before);
      });
    }

    /* ★ 2026-11-14：三个页签。切页只改 hidden，不重建 DOM —— 滚动位置和正在编辑的输入框都留着。 */
    const tabsEl = pageEl.querySelector('#ed-tabs');
    if (tabsEl) {
      const offsets = Object.create(null);
      const sc = pageEl.querySelector('.ed-scroll');
      tabsEl.addEventListener('click', function (e) {
        const b = e.target.closest('.ed-tab');
        if (!b) return;
        const want = b.dataset.pane;
        const previous = tabsEl.querySelector('.is-on');
        if (previous === b) return;
        if (sc && previous) offsets[previous.dataset.pane] = sc.scrollTop;
        pageEl.querySelectorAll('#ed-tabs .ed-tab').forEach(function (t) {
          const on = t === b;
          t.classList.toggle('is-on', on);
          t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        pageEl.querySelectorAll('.ed-pane').forEach(function (pn) {
          pn.hidden = (pn.dataset.pane !== want);
        });
        if (sc) sc.scrollTop = offsets[want] || 0;
      });
    }

    pageEl.querySelector('#ed-back').addEventListener('click', function () { back(); });
    pageEl.querySelector('#ed-undo').addEventListener('click', undo);
    pageEl.querySelector('#ed-redo').addEventListener('click', redo);
    pageEl.querySelector('#ed-save').addEventListener('click', function () {
      commitActiveText();
      saveCard();
    });

    /* 坞顶固定区：点「卡名/关键词」切目标（与画布点选同一套） */
    pageEl.querySelectorAll('#ed-target .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        const kind = (b.dataset.target === 'kw') ? 'kw' : 'name';
        commitActiveText();
        select(kind);
        /* ★ t11：切目标时焦点跟着走（切到关键词就聚焦关键词框，少一次点击） */
        const inp = pageEl.querySelector(kind === 'kw' ? '#ed-keyword' : '#ed-name');
        if (inp) {
          inp.hidden = false;
          try { inp.focus({ preventScroll: true }); } catch (e) { try { inp.focus(); } catch (e2) {} }
        }
      });
    });
    /* 「上牌面」= 当前目标（卡名或关键词）是否显示在牌面上。
       按钮文案/状态由 dockSync 跟着 sel 走；这里只写**当前目标**那个字段。 */
    pageEl.querySelector('#ed-kw-toggle').addEventListener('click', function () {
      const before = snap();
      const key = (sel === 'name') ? 'nameOn' : 'kwOn';
      draft[key] = (draft[key] === false);
      paintFace(); dockSync(); commit(before);
    });

    /* —— 底子：主题 —— */
    pageEl.querySelectorAll('#ed-themes .ed-theme').forEach(function (b) {
      b.addEventListener('click', function () {
        const before = snap();
        const t = THEMES.filter(function (x) { return x.id === b.dataset.theme; })[0];
        if (t) Object.keys(t.patch).forEach(function (k) { draft[k] = t.patch[k]; });
        repaintAll(); commit(before);
      });
    });
    pageEl.querySelector('#ed-theme-all').addEventListener('click', async function () {
      commitActiveText();
      const ok = await UI.confirmDialog({
        icon: '⇄', title: '让整副都这样？',
        sub: '把这张卡的「底子 / 字号 / 字重 / 位置 / 样式 / 图片排版 / 上牌面开关」应用到这副牌的其它所有卡。每张卡自己的名字、关键词、牌义、图片不动。',
        okText: '应用', cancelText: '再想想'
      });
      if (!ok) return;
      // 在应用前取快照；撤销/重做以卡片 id 对齐，不因列表顺序变化串位。
      const beforeDeckStyles = D.takeDeckStyles(deckId, cardId);
      const n = D.applyStyleToDeck(deckId, D.withCardStyle(draft), cardId);
      if (n) {
        // 编辑器撤销栈跨卡快照；一次撤销完整回滚本次牌组样式应用。
        undoStack.push({ deckStyles: beforeDeckStyles });
        if (undoStack.length > MAX_UNDO) undoStack.shift();
        redoStack.length = 0;
        syncUndoBtns();
      }
      UI.toast(n ? ('已应用到 ' + n + ' 张') : '这副牌还没有别的卡');
    });

    /* —— 位置 —— */
    const vyEl = pageEl.querySelector('#ed-vy');   /* 2026-11-14 起画布直接拖，滑条已下线 */
    let vyBefore = null;
    if (vyEl) vyEl.addEventListener('input', function () {
      /* ★ 2026-10-11 加固：快照改在**首次 input** 时取，不再依赖 pointerdown ——
         键盘方向键 / 无障碍操作 / 程序化设值都不会再漏进撤销栈（实测发现的）。 */
      if (!vyBefore) vyBefore = snap();
      draft[P() + 'Vy'] = parseFloat(this.value) || 0;
      paintBlock(sel);
      setTxtNow('#ed-pos-v', Math.round(draft[P() + 'Vy']) + '% · ' + ({ l: '左', c: '中', r: '右' }[draft[P() + 'H']] || '中'));
      updateCur();
    });
    if (vyEl) vyEl.addEventListener('change', function () { commit(vyBefore); vyBefore = null; });
    pageEl.querySelectorAll('#ed-align .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        const before = snap();
        draft[P() + 'H'] = b.dataset.align;
        paintBlock(sel); dockSync();
        commit(before);
      });
    });
    pageEl.querySelector('#ed-pos-reset').addEventListener('click', function () {
      const before = snap();
      draft[P() + 'Vy'] = (sel === 'kw') ? 84 : 14;
      draft[P() + 'H'] = 'c';
      paintBlock(sel); dockSync();
      commit(before);
    });

    /* —— 字号 —— */
    const fsEl = pageEl.querySelector('#ed-fs');
    let fsBefore = null;
    fsEl.addEventListener('input', function () {
      if (!fsBefore) fsBefore = snap();
      /* ★ P0-03：自动适配时也能直接拖 —— 第一下拖动就切手动，
         基准 = 当前实际字号（与捏合同一套算法，画面不跳）。 */
      if (draft.autoFit !== false) {
        draft.nameFs = Math.round(UI.fitFs('name', draft.name, draft.nameFs, true).fs);
        draft.kwFs = Math.round(UI.fitFs('kw', draft.keyword, draft.kwFs, true).fs);
        draft.autoFit = false;
      }
      draft[P() + 'Fs'] = parseFloat(this.value) || 100;
      paintBlock('name'); paintBlock('kw');
      dockSync();
      /* ★ 2026-11-17：标签已由 dockSync → syncFsDock 统一写（手动模式带「实际 xx%」），别在这儿覆盖 */
    });
    fsEl.addEventListener('change', function () { commit(fsBefore); fsBefore = null; });
    pageEl.querySelectorAll('#ed-fit .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        const before = snap();
        const goingManual = (b.dataset.fit === 'manual');
        if (goingManual && draft.autoFit !== false) {
          /* 切手动：把"当前实际字号"接过来当基准 —— 画面不跳 */
          draft.nameFs = Math.round(UI.fitFs('name', draft.name, draft.nameFs, true).fs);
          draft.kwFs = Math.round(UI.fitFs('kw', draft.keyword, draft.kwFs, true).fs);
        }
        draft.autoFit = !goingManual;
        paintBlock('name'); paintBlock('kw');
        dockSync();
        commit(before);
      });
    });

    /* —— 字体 —— */
    pageEl.querySelectorAll('#ed-font .ed-font').forEach(function (b) {
      b.addEventListener('click', function () {
        const before = snap();
        draft[P() + 'Font'] = b.dataset.font;
        repaintAll(); commit(before);
      });
    });
    pageEl.querySelectorAll('#ed-weight .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        const before = snap();
        draft[P() + 'Weight'] = parseInt(b.dataset.w, 10);
        repaintAll(); commit(before);
      });
    });

    /* —— 样式 —— */
    pageEl.querySelectorAll('#ed-bgcat .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        /* ★ 2026-10-05 的坑：分类切换绝不能把"用户刚点的分组"重置回卡片当前分组 */
        bgCat = b.dataset.bgcat;
        dockSync();
      });
    });
    rebindGrid();
    bindLiveColor(pageEl.querySelector('#ed-bg'), function (value) { draft[P() + 'Bg'] = value; }, paintChipColors);
    bindLiveColor(pageEl.querySelector('#ed-bga'), function (value) {
      const amount = parseFloat(value) || 0;
      draft[P() + 'BgA'] = amount;
      setTxtNow('#ed-bga-v', Math.round(amount) + '%');
    }, paintChipColors);

    /* —— 牌面：底色色板 / 自定义 / 纸边 —— */
    pageEl.querySelectorAll('#ed-swatches .ed-swatch').forEach(function (b) {
      b.addEventListener('click', function () {
        const before = snap();
        draft.faceBg = b.dataset.facebg || null;
        repaintAll(); commit(before);
      });
    });
    bindLiveColor(pageEl.querySelector('#ed-facebg-custom'), function (value) { draft.faceBg = value; }, paintFaceColor);
    pageEl.querySelectorAll('#ed-edge .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        const before = snap();
        draft.faceEdge = (b.dataset.edge !== '0');
        repaintAll(); commit(before);
      });
    });
    /* —— 字色（当前字块的强制色；空 = 自动） —— */
    pageEl.querySelectorAll('#ed-textcolor .ed-cbtn').forEach(function (b) {
      b.addEventListener('click', function () {
        const before = snap();
        draft[P() + 'Color'] = b.dataset.tc || null;
        repaintAll(); commit(before);
      });
    });
    bindLiveColor(pageEl.querySelector('#ed-tc-custom'), function (value) { draft[P() + 'Color'] = value; }, paintChipColors);
    /* —— 质感（纹理 id；从"无"切到某张时给个默认强度） —— */
    pageEl.querySelectorAll('#ed-texes .ed-tex').forEach(function (b) {
      b.addEventListener('click', function () {
        const before = snap();
        draft.faceTex = b.dataset.tex || null;
        if (draft.faceTex && !(draft.faceTexA > 0)) draft.faceTexA = 45;
        repaintAll(); commit(before);
      });
    });

    /* —— 图片 —— */
    pageEl.querySelector('#ed-pick-img').addEventListener('click', function () {
      if (!global.MoKa.imagecrop) { UI.toast('裁剪组件未加载'); return; }
      global.MoKa.imagecrop.open({
        onDone: function (dataURL) {
          if (!dataURL) return;
          const before = snap();
          draft.image = dataURL;
          draft.imageHi = null;      // 高清大图下架（老数据里的 imageHi 仍可读，只是不再新生成）
          repaintAll();
          commit(before);
          setImgMode(true);          // 选完图直接进入图片调整（刚放的图总要摆一摆）
        }
      });
    });
    pageEl.querySelector('#ed-clear-img').addEventListener('click', function () {
      const before = snap();
      draft.image = null;
      draft.imageHi = null;
      if (imgMode) setImgMode(false);      // 图没了就别留在图片模式（防"空手拖动"的假死）
      repaintAll();
      commit(before);
    });
    pageEl.querySelectorAll('#ed-imgfilter .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        const before = snap();
        draft.imgFilter = b.dataset.filter;
        paintFace(); refreshThemePreviews(); dockSync();
        commit(before);
      });
    });
    pageEl.querySelector('#ed-img-adjust').addEventListener('click', function () {
      /* ★ 2026-10-11 实测修：没有图片时进图片模式 = **假死**（文字块被禁用、却没有东西可拖，
         用户点完像卡住）。现在直接提示，让他先选图。 */
      if (!draft.image) { UI.toast('先选一张图片，再来调整位置'); return; }
      setImgMode(true);
    });
    pageEl.querySelector('#ed-img-done').addEventListener('click', function () { setImgMode(false); });

    /* —— 内容与牌义 —— */
    const nameEl = pageEl.querySelector('#ed-name');
    const kwEl = pageEl.querySelector('#ed-keyword');
    const meEl = pageEl.querySelector('#ed-meaning');
    let txtBefore = null;
    let previewTimer = null, composing = false;
    function cancelPreviewTimer() {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
    function scheduleTextPreviews() {
      cancelPreviewTimer();
      if (composing) return;
      previewTimer = setTimeout(function () {
        previewTimer = null;
        if (!nameEl.isConnected) return;
        const kind = P();
        const text = kind === 'kw' ? (draft.keyword || '关键词') : (draft.name || '卡名');
        const style = D.withCardStyle(draft);
        pageEl.querySelectorAll('#ed-bgstyle .ed-bgcell').forEach(function (cell) {
          const preview = cell.querySelector('.ed-bgcell-pv');
          style[kind + 'BgStyle'] = cell.dataset.bgstyle;
          if (preview) preview.innerHTML = UI.previewChip(kind, style, text);
        });
        refreshThemePreviews();
      }, 120);
    }
    [nameEl, kwEl].forEach(function (el) {
      el.addEventListener('compositionstart', function () { composing = true; cancelPreviewTimer(); });
      el.addEventListener('compositionend', function () { composing = false; scheduleTextPreviews(); });
      el.addEventListener('keydown', function (e) {
        /* 输入法组字中的 Enter 是「选词」，不能当成「完成」把输入框收掉 */
        if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && !composing) {
          e.preventDefault();
          el.blur();   // 输入法「完成」= 落字并提交，不换行
        }
      });
    });
    function armTxt() { if (!txtBefore) txtBefore = snap(); }
    function disarmTxt() { if (txtBefore) { commit(txtBefore); txtBefore = null; } }
    nameEl.addEventListener('focus', armTxt);
    nameEl.addEventListener('input', function () {
      draft.name = this.value;
      persistSoon();          // ★ 见下方 back() 的注释：敲进去的字也要进草稿
      paintText('name');
      scheduleTextPreviews();
    });
    nameEl.addEventListener('blur', disarmTxt);
    kwEl.addEventListener('focus', armTxt);
    kwEl.addEventListener('input', function () {
      draft.keyword = this.value;
      persistSoon();
      paintText('kw');
      scheduleTextPreviews();
    });
    kwEl.addEventListener('blur', disarmTxt);
    meEl.addEventListener('focus', armTxt);
    meEl.addEventListener('input', function () { draft.meaning = this.value; persistSoon(); setTxtNow('#ed-meaning-v', this.value ? this.value.length + ' 字' : '未填'); });
    meEl.addEventListener('blur', disarmTxt);
    pageEl.querySelectorAll('#ed-kwon .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        const before = snap();
        draft.kwOn = (b.dataset.kwon === '1');
        paintFace(); dockSync();
        commit(before);
      });
    });

    /* —— 更多（顶栏 ⋯ → 底部动作面板） —— */
    const moreBtn = pageEl.querySelector('#ed-more');
    if (moreBtn) moreBtn.addEventListener('click', function () { setSheet(!sheetOpen); });
    const sheetMask = pageEl.querySelector('#ed-sheet-mask');
    if (sheetMask) sheetMask.addEventListener('click', function () { setSheet(false); });
    /* ★ 第五轮：面板可以**按住往下拖**关闭（抽屉该有的手感）。
       只在非按钮区域起拖，避免把「导出/删除」的点击吃掉。 */
    const sheetBox = pageEl.querySelector('#ed-sheet .ed-sheet-box');
    if (sheetBox) {
      let sy0 = null, sdy = 0;
      const sheetMaskEl = pageEl.querySelector('#ed-sheet-mask');
      sheetBox.addEventListener('pointerdown', function (e) {
        if (!sheetOpen) return;
        if (e.target.closest('.ed-sheet-item')) return;   // 按钮上不拖
        sy0 = e.clientY; sdy = 0;
        sheetBox.classList.add('is-drag');
        try { sheetBox.setPointerCapture(e.pointerId); } catch (err) {}
      });
      sheetBox.addEventListener('pointermove', function (e) {
        if (sy0 == null) return;
        sdy = Math.max(0, e.clientY - sy0);
        sheetBox.style.transform = 'translateY(' + sdy + 'px)';
        if (sheetMaskEl) sheetMaskEl.style.opacity = String(Math.max(0, 1 - sdy / 260));
      });
      const sheetEnd = function () {
        if (sy0 == null) return;
        sy0 = null;
        sheetBox.classList.remove('is-drag');
        if (sdy > 88) {
          /* 过阈值：顺着手指的方向滑下去，再真正关闭 */
          sheetBox.style.transform = 'translateY(100%)';
          if (sheetMaskEl) sheetMaskEl.style.opacity = '';
          setSheet(false);
        } else {
          /* 没到阈值：回弹 */
          sheetBox.style.transform = '';
          if (sheetMaskEl) sheetMaskEl.style.opacity = '';
        }
        sdy = 0;
      };
      sheetBox.addEventListener('pointerup', sheetEnd);
      sheetBox.addEventListener('pointercancel', sheetEnd);
    }
    pageEl.querySelector('#ed-export-face').addEventListener('click', function () { commitActiveText(); setSheet(false); exportCardFace(); });
    pageEl.querySelector('#ed-export-back').addEventListener('click', function () { commitActiveText(); setSheet(false); exportCardBack(); });
    const cloneBtn = pageEl.querySelector('#ed-clone-card');
    if (cloneBtn) cloneBtn.addEventListener('click', function () {
      commitActiveText();
      setSheet(false);
      const c = D.cloneCard(deckId, cardId);
      UI.toast(c ? ('已复制「' + c.name + '」') : '复制失败');
    });
    pageEl.querySelector('#ed-goto-back').addEventListener('click', function () {
      commitActiveText();
      setSheet(false);
      L.goBack(deckId, 'canvas');
    });
    const delBtn = pageEl.querySelector('#ed-del-card');
    if (delBtn) delBtn.addEventListener('click', async function () {
      commitActiveText();
      setSheet(false);
      const ok = await UI.confirmDialog({
        icon: '✕', title: '删除这张猫卡？', sub: '「' + (draft.name || '') + '」将被删除，无法恢复。',
        okText: '删除', cancelText: '再想想'
      });
      if (!ok) return;
      D.deleteCard(deckId, cardId);
      clearDraft();
      L.goDeck(deckId);
    });

    /* ★ 2026-11-19：焦点进入滚动区 → 把控件滚进可见区。
       键盘只改"可用高度"，不再靠压坞让人看见；这里补上另一半。 */
    const scEl = pageEl.querySelector('.ed-scroll');
    if (scEl) scEl.addEventListener('focusin', function (e) {
      const t = e.target;
      /* 等一帧/等键盘动画：刚 focus 时可视区还没缩，立刻量会量早 */
      setTimeout(function () { revealInScroll(scEl, t); }, 60);
    });
  }

  /* 把 el 滚进 .ed-scroll 的可见区（block:'nearest' 语义；不用 scrollIntoView 以免连带滚页面）。
     jsdom 没有布局（rect 全 0）→ 退回 scrollIntoView，两边都不会报错。 */
  function revealInScroll(sc, el) {
    if (!sc || !el || !sc.contains || !sc.contains(el)) return;
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    const sr = sc.getBoundingClientRect ? sc.getBoundingClientRect() : null;
    const pad = 10;
    if (r && sr && r.height && sr.height) {
      if (r.top < sr.top + pad) sc.scrollTop -= (sr.top + pad - r.top);
      else if (r.bottom > sr.bottom - pad) sc.scrollTop += (r.bottom - sr.bottom + pad);
      return;
    }
    try { if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
  }
  /* 键盘弹起后重新把当前焦点滚进可见区（同步合并 80ms，避免拖键盘时每帧找节点） */
  function revealActiveInScroll() {
    if (!pageEl) return;
    const sc = pageEl.querySelector('.ed-scroll');
    const a = document.activeElement;
    if (!sc || !a || !sc.contains(a)) return;
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = setTimeout(function () { revealTimer = null; revealInScroll(sc, a); }, 80);
  }

  /* 网格每次重绘后要重绑点击（全量重绘路径） */
  function rebindGrid() {
    pageEl.querySelectorAll('#ed-bgstyle .ed-bgcell').forEach(function (b) {
      b.addEventListener('click', function () {
        const before = snap();
        draft[P() + 'BgStyle'] = b.dataset.bgstyle;
        paintFace();
        dockSync();
        commit(before);
      });
    });
  }

  function setTxtNow(id, v) { const n = pageEl.querySelector(id); if (n) n.textContent = v; }
  function updateCur() {
    const cur = pageEl.querySelector('#ed-cur');
    if (cur) cur.innerHTML = '正在调整 <b>' + (sel === 'kw' ? '关键词' : '卡名') + '</b>';
  }

  /* 顶栏 ⋯「更多」面板：开/关只切 hidden + is-open，动作都在 DOM 里常驻（测试也方便） */
  function setSheet(on) {
    if (!pageEl) return;
    const sheet = pageEl.querySelector('#ed-sheet');
    if (!sheet) return;
    const box = sheet.querySelector('.ed-sheet-box');
    const mask = sheet.querySelector('#ed-sheet-mask');
    const more = pageEl.querySelector('#ed-more');
    sheetOpen = !!on;
    if (sheetOpen) {
      /* 清掉拖拽留下的行内样式（拖到一半又点开时，别从半空开始） */
      if (box) box.style.transform = '';
      if (mask) mask.style.opacity = '';
      sheet.hidden = false;
      /* ★ 2026-11-14（第五轮）：先强制回流，再双 rAF 加 is-open ——
         单 rAF 在 WebView 里有时和"取消 hidden"落在同一帧，起始位移没被画出来，
         看起来就是"啪一下出现、一点动效都没有"。 */
      void sheet.offsetHeight;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { if (sheetOpen) sheet.classList.add('is-open'); });
      });
    } else {
      sheet.classList.remove('is-open');
      setTimeout(function () { if (!sheetOpen && sheet) sheet.hidden = true; }, 280);
    }
    if (more) more.setAttribute('aria-expanded', sheetOpen ? 'true' : 'false');
  }

  function setImgMode(on) {
    imgMode = !!on;
    if (!pageEl) return;
    if (imgMode && openCanvasFromDock) openCanvasFromDock();
    const stage = pageEl.querySelector('#ed-stage');
    if (stage) stage.classList.toggle('is-imgmode', imgMode);
    const hint = pageEl.querySelector('#ed-hint');
    const bar = pageEl.querySelector('#ed-imgbar');
    if (hint) hint.classList.toggle('is-hide', imgMode);
    if (bar) bar.classList.toggle('is-on', imgMode);
    if (imgMode) { updateCur(); setImgScaleNow(parseFloat(draft && draft.imgScale) || 100); }
  }

  /* 图片缩放的实时读数（imgbar 里那个百分比） */
  function setImgScaleNow(s) {
    const n = pageEl && pageEl.querySelector('#ed-img-sca');
    if (n) n.textContent = '　' + Math.round(s) + '%';
  }

  /* ============================================================
   * 手势：单击选中 / 拖动定位 / 双击改字 / 双指捏合缩放（文字块）
   *       图片模式：拖动平移 / 双指捏合缩放（图片层）
   * ------------------------------------------------------------
   * wrap 只挂 pointerdown；move/up 在 window 上统一处理，
   * 这样"第二根手指落在任何地方"都能正确进入捏合，不会丢事件。
   * ============================================================ */
  function bindGestures() {
    const cardEl = pageEl.querySelector('#ed-card');
    const stage = pageEl.querySelector('#ed-stage');
    if (!cardEl) return;
    cardEl.querySelectorAll('.fc-wrap').forEach(function (wrap) {
      wrap.addEventListener('pointerdown', onWrapDown);
    });
    if (stage && !stage._imgBound) {
      stage._imgBound = true;
      stage.addEventListener('pointerdown', onStageImgDown);
    }
  }

  function onWrapDown(e) {
    const wrap = e.currentTarget;
    const kind = wrap.dataset.kind;
    e.stopPropagation();

    /* 双击检测（同块、320ms 内、位移 < 12px）→ 改字 */
    const now = Date.now();
    if (lastTap.kind === kind && (now - lastTap.t) < 320 &&
        Math.abs(e.clientX - lastTap.x) < 12 && Math.abs(e.clientY - lastTap.y) < 12) {
      lastTap = { t: 0, x: 0, y: 0, kind: null };
      gDrag = null; gPinch = null; gPtr = {};
      editText(kind);
      return;
    }
    lastTap = { t: now, x: e.clientX, y: e.clientY, kind: kind };

    select(kind);
    gPtr[e.pointerId] = { x: e.clientX, y: e.clientY, wrap: wrap, img: null };
    const ids = Object.keys(gPtr);

    if (ids.length === 1) {
      /* 第一根手指：进入拖动 */
      gDrag = { wrap: wrap, kind: kind, pointerId: e.pointerId,
                sx: e.clientX, sy: e.clientY,
                baseVy: draft[(kind === 'kw' ? 'kw' : 'name') + 'Vy'],
                dragging: false, before: null };
      try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
    } else if (ids.length === 2) {
      /* 第二根手指：若按在同一块上 → 放弃拖动转捏合缩放 */
      const a = gPtr[ids[0]], b = gPtr[ids[1]];
      if (gDrag && a.wrap && a.wrap === b.wrap) {
        const wrap0 = a.wrap;
        const kind0 = wrap0.dataset.kind;
        gDrag = null;
        /* 自动适配开着 → 捏合直接切手动，起点 = 当前实际字号（画面不跳） */
        if (draft.autoFit !== false) {
          draft.autoFit = false;
          draft.nameFs = Math.round(UI.fitFs('name', draft.name, draft.nameFs, true).fs);
          draft.kwFs = Math.round(UI.fitFs('kw', draft.keyword, draft.kwFs, true).fs);
        }
        const fit0 = UI.fitFs(kind0, kind0 === 'kw' ? draft.keyword : draft.name,
                              draft[(kind0 === 'kw' ? 'kw' : 'name') + 'Fs'], false);
        gPinch = { wrap: wrap0, kind: kind0,
                   dist0: Math.hypot(a.x - b.x, a.y - b.y),
                   fs0: fit0.fs, before: snap() };
        const stage = pageEl.querySelector('#ed-stage');
        if (stage) stage.classList.add('is-pinching');
      }
    }
  }

  /* 图片模式：按下图片层 → 拖动/捏合 */
  function onStageImgDown(e) {
    if (!imgMode) return;
    flushPendingPointer();
    const t = e.target;
    const fcimg = (t && t.closest) ? t.closest('#ed-card .fc-img') : null;
    /* ★ 2026-10-12：第二指压在牌外的灰底上也放行（牌只有巴掌大，双指一撑就出界）。
       只认「已经有一根手指出现在图上」为前提的落点，空手按灰底依旧什么都不发生
       （不然点着空白也能凭空挪图）。 */
    const onImg = Object.keys(gPtr).some(function (id) { return gPtr[id] && gPtr[id].img; });
    if (!fcimg && !onImg) return;
    e.stopPropagation();
    gPtr[e.pointerId] = { x: e.clientX, y: e.clientY, wrap: null, img: fcimg };
    const ids = Object.keys(gPtr);
    if (ids.length === 1) {
      /* 走到这里 fcimg 必定非空（灰底落点只在"已有手指压在图上"时才放行） */
      iDrag = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY,
                baseX: draft.imgX || 0, baseY: draft.imgY || 0, dragging: false, before: null };
      try { fcimg.setPointerCapture(e.pointerId); } catch (err) {}
    } else if (ids.length === 2) {
      const a = gPtr[ids[0]], b = gPtr[ids[1]];
      /* ★ 2026-10-12 修「双指缩放无效」：这里原来要求**两指都命中同一张图**
         （a.img === b.img）。图铺满整张牌，但牌外那一圈灰底也是 #ed-stage ——
         用户的手一大半时候是搭在牌外/压在图片边缘的，第二指一 outside 就永远进不了捏合。
         现在改成：**只要第一指已经在图上（iDrag 在），第二指落在画布哪里都算**。
         （图片模式下 .fc-wrap 是 pointer-events:none，不会误抓文字块。） */
      const imgEl = a.img || b.img;
      if (iDrag && imgEl) {
        const before = iDrag.before || snap();   // 已经拖过一段 → 沿用那次快照，一次手势 = 一步撤销
        iDrag = null;
        iPinch = { img: imgEl, dist0: Math.hypot(a.x - b.x, a.y - b.y),
                   scale0: draft.imgScale || 100, before: before };
      }
    }
  }

  /* 捏合期间"算数的手指"：命中这张图的，或落在画布空白处的（见上）
     ⚠ iPinch.img 是这套过滤的钥匙：丢了它 = 捏合永远凑不齐两根手指，缩放静默失效。 */
  function pinchPtrs(p) {
    return Object.keys(gPtr).filter(function (id) {
      const q = gPtr[id];
      if (!q) return false;
      return q.img === p.img || (!q.img && !q.wrap);
    }).sort(function (x, y) {            // 压在图上那根排前面，取前两个算距离才不会取偏
      return (gPtr[x].img === p.img ? 0 : 1) - (gPtr[y].img === p.img ? 0 : 1);
    });
  }

  function onWindowMove(e) {
    if (!gPtr[e.pointerId]) return;
    gPtr[e.pointerId].x = e.clientX;
    gPtr[e.pointerId].y = e.clientY;
    latestPointerEvent = e;
    if (!pointerFrame) pointerFrame = requestAnimationFrame(flushPointerFrame);
    if (gPinch || iPinch || (gDrag && gDrag.pointerId === e.pointerId) || (iDrag && iDrag.pointerId === e.pointerId)) e.preventDefault();
  }

  function flushPendingPointer() {
    if (!pointerFrame) return;
    cancelAnimationFrame(pointerFrame);
    flushPointerFrame();
  }

  function flushPointerFrame() {
    pointerFrame = 0;
    let e = latestPointerEvent;
    latestPointerEvent = null;
    if (!e || !gPtr[e.pointerId]) return;
    const drag = gDrag || iDrag;
    if (!gPinch && !iPinch && drag && gPtr[drag.pointerId]) {
      const p = gPtr[drag.pointerId];
      e = { pointerId: drag.pointerId, clientX: p.x, clientY: p.y };
    }

    /* 文字块捏合 */
    if (gPinch) {
      const ids = Object.keys(gPtr).filter(function (id) { return gPtr[id].wrap === gPinch.wrap; });
      if (ids.length < 2) return;
      const a = gPtr[ids[0]], b = gPtr[ids[1]];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (gPinch.dist0 < 1) return;
      let fs = gPinch.fs0 * dist / gPinch.dist0;
      fs = Math.max(20, Math.min(200, Math.round(fs)));
      draft[(gPinch.kind === 'kw' ? 'kw' : 'name') + 'Fs'] = fs;
      paintBlock(gPinch.kind);
      /* ★ 2026-11-17：捏合和滑条共用一个字号字段 —— 统一走 syncFsDock()，
         否则滑条停在旧值、标签也只有裸 fs 一个数（被宽度上限压住时看不出「实际」）。
         只调这一个函数、不调整个 dockSync：这是每帧都跑的高频路径。 */
      syncFsDock(gPinch.kind);
      return;
    }

    /* 文字块拖动 */
    if (gDrag && gDrag.pointerId === e.pointerId) {
      const dx = e.clientX - gDrag.sx, dy = e.clientY - gDrag.sy;
      if (!gDrag.dragging) {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;   // 4px 内算点击
        gDrag.dragging = true;
        if (!gDrag.before) gDrag.before = snap();
        const stage = pageEl.querySelector('#ed-stage');
        if (stage) stage.classList.add('is-dragging');
      }
      const Pk = gDrag.kind === 'kw' ? 'kw' : 'name';
      const cardEl = pageEl.querySelector('#ed-card');
      const r = cardEl.getBoundingClientRect();
      if (r.height < 1) return;
      let vy = Math.max(4, Math.min(96, gDrag.baseVy + dy / r.height * 100));
      const snapY = Math.abs(vy - 50) < 4;
      if (snapY) vy = 50;
      const relX = (e.clientX - r.left) / r.width;
      const h = relX < .35 ? 'l' : (relX > .65 ? 'r' : 'c');
      draft[Pk + 'Vy'] = Math.round(vy);
      draft[Pk + 'H'] = h;
      paintBlock(gDrag.kind);
      setTxtNow('#ed-pos-v', Math.round(vy) + '% · ' + ({ l: '左', c: '中', r: '右' }[h] || '中'));
      syncYRuler(vy);
      updateCur();
      guideOn(snapY, h);
      return;
    }

    /* 图片捏合 */
    if (iPinch) {
      const ids = pinchPtrs(iPinch);
      if (ids.length < 2) return;
      const a = gPtr[ids[0]], b = gPtr[ids[1]];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (iPinch.dist0 < 1) return;
      if (!iPinch.moved && Math.abs(dist - iPinch.dist0) > 3) iPinch.moved = true;
      let s = iPinch.scale0 * dist / iPinch.dist0;
      s = Math.max(50, Math.min(400, Math.round(s)));
      draft.imgScale = s;
      paintImg();
      setImgScaleNow(s);
      return;
    }

    /* 图片拖动 */
    if (iDrag && iDrag.pointerId === e.pointerId) {
      const dx = e.clientX - iDrag.sx, dy = e.clientY - iDrag.sy;
      if (!iDrag.dragging) {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        iDrag.dragging = true;
        if (!iDrag.before) iDrag.before = snap();
      }
      const cardEl = pageEl.querySelector('#ed-card');
      const r = cardEl.getBoundingClientRect();
      if (r.width < 1) return;
      const x = Math.max(-100, Math.min(100, iDrag.baseX + dx / r.width * 100));
      const y = Math.max(-100, Math.min(100, iDrag.baseY + dy / r.height * 100));
      draft.imgX = Math.round(x);
      draft.imgY = Math.round(y);
      paintImg();
    }
  }

  /* 图片层的局部更新（不改 DOM 结构，只改 img 的 transform/filter） */
  function paintImg() {
    const img = pageEl.querySelector('#ed-card .fc-img img');
    if (!img) return;
    const s = Math.max(50, Math.min(400, parseFloat(draft.imgScale) || 100));
    const x = Math.max(-100, Math.min(100, parseFloat(draft.imgX) || 0));
    const y = Math.max(-100, Math.min(100, parseFloat(draft.imgY) || 0));
    img.style.transform = 'translate(' + x + '%,' + y + '%) scale(' + (s / 100) + ')';
  }

  function onWindowUp(e) {
    flushPendingPointer();
    delete gPtr[e.pointerId];
    const stage = pageEl.querySelector('#ed-stage');
    if (gPinch) {
      if (Object.keys(gPtr).filter(function (id) { return gPtr[id] && gPtr[id].wrap === gPinch.wrap; }).length < 2) {
        const before = gPinch.before;
        gPinch = null;
        if (stage) stage.classList.remove('is-pinching');
        dockSync();
        if (before) {
          refreshThemePreviews();
          commit(before);
        }
      }
      return;
    }
    if (gDrag && gDrag.pointerId === e.pointerId) {
      const before = gDrag.before;
      const wasDragging = gDrag.dragging;
      gDrag = null;
      if (stage) stage.classList.remove('is-dragging');
      guideOff();
      if (wasDragging) {
        dockSync();
        refreshThemePreviews();
        if (before) commit(before);
      }
      return;
    }
    if (iPinch) {
      if (pinchPtrs(iPinch).length < 2) {
        const before = iPinch.before, moved = iPinch.moved;
        iPinch = null;
        dockSync();
        if (moved && before) {
          refreshThemePreviews();
          commit(before);
        }
      }
      return;
    }
    if (iDrag && iDrag.pointerId === e.pointerId) {
      const before = iDrag.before;
      const wasDragging = iDrag.dragging;
      iDrag = null;
      if (wasDragging) {
        dockSync();
        refreshThemePreviews();
        if (before) commit(before);
      }
    }
  }

  function guideOn(snapY, h) {
    if (!pageEl) return;
    const gL = pageEl.querySelector('#ed-g-l'), gR = pageEl.querySelector('#ed-g-r'), gH = pageEl.querySelector('#ed-g-h');
    if (gH) gH.classList.toggle('on', !!snapY);
    if (gL) gL.classList.toggle('on', h === 'l');
    if (gR) gR.classList.toggle('on', h === 'r');
  }
  function guideOff() {
    if (!pageEl) return;
    pageEl.querySelectorAll('.cv-guide').forEach(function (g) { g.classList.remove('on'); });
  }

  function select(kind) {
    sel = kind;
    applySel();
    dockSync();
  }

  /* 双击文字块 → 改字（与"内容与牌义"组的输入框等效，两处互通） */
  async function editText(kind) {
    const isKw = kind === 'kw';
    const v = await UI.promptDialog({
      title: isKw ? '关键词' : '卡名',
      value: isKw ? (draft.keyword || '') : (draft.name || ''),
      maxlength: isKw ? 8 : 12,
      placeholder: isKw ? '一个词或短语' : '这张卡的名字',
      okText: '好'
    });
    if (v == null) return;
    const before = snap();
    if (isKw) draft.keyword = v; else draft.name = v;
    const inp = pageEl.querySelector(isKw ? '#ed-keyword' : '#ed-name');
    if (inp) inp.value = v;
    repaintAll();
    commit(before);
  }

  /* ============================================================
   * 导出：Java 端 WebView 截图（保真 100%），存 Download/猫卡/
   * ------------------------------------------------------------
   * 流程：临时藏掉工具坞等遮挡 → 等两帧布局稳定 → 取牌面矩形
   *       （CSS px × devicePixelRatio = 物理像素）→ CatCard.capturePNG
   *       → 恢复界面。
   * 存到 Download（MediaStore.Downloads），不写 DCIM/Pictures —— 不溢出相册。
   * ============================================================ */
  function bridgeOk() {
    return typeof window.CatCard !== 'undefined' && typeof window.CatCard.capturePNG === 'function';
  }
  async function captureCardRegion(fileName) {
    if (dockLevel !== 'half' || pageEl.classList.contains('is-docksnap')) return '导出失败：请先返回画布，再导出';
    const dock = pageEl.querySelector('.ed-dock');
    const hint = pageEl.querySelector('#ed-hint');
    const bar = pageEl.querySelector('#ed-imgbar');
    const inh = pageEl.querySelector('.et-inherit');
    [dock, hint, bar, inh].forEach(function (n) { if (n) n.classList.add('is-export-hide'); });
    await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
    fitBigCard();
    await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
    const cardEl = pageEl.querySelector('#ed-card');
    const r = cardEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    let res = '导出失败';
    try {
      res = String(window.CatCard.capturePNG(fileName,
        Math.round(r.left * dpr), Math.round(r.top * dpr),
        Math.round(r.width * dpr), Math.round(r.height * dpr)));
    } catch (e) { res = '导出失败：' + ((e && e.message) || e); }
    [dock, hint, bar, inh].forEach(function (n) { if (n) n.classList.remove('is-export-hide'); });
    fitBigCard();
    return res;
  }
  async function exportCardFace() {
    if (!bridgeOk()) { UI.toast('导出需在猫卡 App 内使用'); return; }
    UI.toast('正在导出…');
    /* ★ 2026-11-19：导出必须 = 台面真值。编辑页为了能调样式会强制渲染卡名/关键词并压暗，
       直接截屏会把「已关掉」的那块也带进 PNG。这里临时按真值重渲染，截完再 paintFace() 复原。 */
    const cardEl = pageEl.querySelector('#ed-card');
    const saved = cardEl ? cardEl.innerHTML : '';
    if (cardEl) cardEl.innerHTML = UI.faceHTML(D.withCardStyle(draft), {});
    let res = '导出失败';
    try {
      res = await captureCardRegion('猫卡-' + (draft.name || '未命名') + '-牌面.png');
    } finally {
      if (cardEl) { cardEl.innerHTML = saved; paintFace(); }
    }
    UI.toast(res.indexOf('失败') >= 0 ? res : ('已导出：' + res));
  }
  async function exportCardBack() {
    if (!bridgeOk()) { UI.toast('导出需在猫卡 App 内使用'); return; }
    const deck = D.findDeck(deckId);
    if (!deck) return;
    UI.toast('正在导出…');
    const cardEl = pageEl.querySelector('#ed-card');
    const saved = cardEl.innerHTML;
    const back = { image: deck.backImage, template: deck.backTemplate,
                   color: deck.backColor || '#8a7a3a', edge: deck.backEdge !== false };
    cardEl.innerHTML = UI.backHTML(deck.name, back);
    const res = await captureCardRegion('猫卡-' + (draft.name || deck.name) + '-牌背.png');
    cardEl.innerHTML = saved;
    bindGestures();
    UI.toast(res.indexOf('失败') >= 0 ? res : ('已导出：' + res));
  }

  /* ============================================================
   * 保存
   * ============================================================ */
  let savingCard = false;
  async function saveCard() {
    if (savingCard) return;
    /* ★ P0-08：新建空白卡不许静默入库（60→61 且 name="" 那种）。
       只拦「真的一张白纸」：卡名/关键词/牌义/图片全空；编辑已有卡不拦。 */
    const targetDeck = D.findDeck(deckId);
    if (!targetDeck || (cardId && !targetDeck.cards.some(function (c) { return c.id === cardId; }))) {
      persistSoon();
      UI.toast('保存失败：这张卡或牌组已不存在，草稿仍保留');
      return;
    }
    const nm0 = (draft.name || '').trim();
    /* 新卡可能沿用上一张的图片：那种「有图但一个字没填、也没动过」也算空白卡 */
    if (!cardId && !nm0 && !(draft.keyword || '').trim() && !(draft.meaning || '').trim() && (!draft.image || !dirty)) {
      savingCard = true;
      let ok;
      try { ok = await UI.confirmDialog({
        icon: '✎', title: '这张卡还是空白',
        sub: '这张卡还没有卡名、关键词或牌义，保存后只会是一张空白卡。要继续吗？',
        okText: '仍然保存', cancelText: '继续编辑'
      }); } finally { savingCard = false; }
      if (!ok) return;
    }
    savingCard = true;
    try {
    /* ★ 手写白名单（红线：卡片字段漏一处 = 保存后丢字段，历史上漏过 6 次）：
       id/name/keyword/symbol/symbolImg/faceText/meaning/color/image/imageHi/art/band
       + 全部样式字段 + faceBg/faceEdge/imgScale/imgX/imgY/imgFilter（2026-10-11） */
    const fields = {
      name: (draft.name || '').trim(),
      keyword: (draft.keyword || '').trim(),
      meaning: (draft.meaning || '').trim(),
      kwOn: draft.kwOn !== false,
      nameOn: draft.nameOn !== false,
      nameVy: draft.nameVy, nameH: draft.nameH, nameFs: draft.nameFs,
      nameBg: draft.nameBg, nameBgA: draft.nameBgA,
      kwVy: draft.kwVy, kwH: draft.kwH, kwFs: draft.kwFs,
      kwBg: draft.kwBg, kwBgA: draft.kwBgA,
      autoFit: draft.autoFit !== false,
      nameWeight: draft.nameWeight || 700,
      kwWeight: draft.kwWeight || 700,
      nameFont: draft.nameFont || 'sys',
      nameBgStyle: draft.nameBgStyle || 'soft',
      kwFont: draft.kwFont || 'sys',
      kwBgStyle: draft.kwBgStyle || 'soft',
      image: draft.image || null,
      imageHi: draft.imageHi || null,
      symbol: draft.symbol || '',
      symbolImg: draft.symbolImg || null,
      faceText: draft.faceText || '',
      art: draft.art || null,
      band: draft.band || null,
      faceBg: draft.faceBg || null,
      faceEdge: draft.faceEdge !== false,
      faceTex: draft.faceTex || null,
      faceTexA: (draft.faceTexA == null ? 45 : draft.faceTexA),
      nameColor: draft.nameColor || null,
      kwColor: draft.kwColor || null,
      imgScale: draft.imgScale || 100,
      imgX: draft.imgX || 0,
      imgY: draft.imgY || 0,
      imgFilter: draft.imgFilter || 'none'
    };
    let saved = null;
    if (cardId) saved = D.updateCard(deckId, cardId, fields);
    else saved = D.addCard(deckId, fields);
    if (!saved) {
      UI.toast('保存失败：这张卡或牌组已不存在，草稿仍保留');
      return;
    }
    const status = await D.flushPersist();
    if (!status || !status.ok || status.unresolvedImgs) {
      UI.toast('保存未能完整写入手机，草稿仍保留；请检查存储提示后重试', 4000);
      return;
    }
    if (!cardId) cardId = saved.id;
    clearDraft();
    dirty = false;
    UI.toast('已保存');
    L.goDeck(deckId);
    } finally { savingCard = false; }
  }

  /* ---------- 对外接口 ---------- */
  global.MoKa = global.MoKa || {};
  global.MoKa.editor = {
    init, open, resume, back,
    _buildDraft: buildDraft,
    // 自跑测试用
    _draft: function () { return draft; },
    _sel: function () { return sel; },
    /* 自跑测试用：坞档位 + 当前高度 + 可用高（断言"键盘只改可用高、不改档位"） */
    _dock: function () {
      const stage = pageEl && pageEl.querySelector('#ed-stage');
      const raw = parseFloat((stage && stage.style.getPropertyValue('--dock-scale')) || '');
      return {
        level: dockLevel,
        h: Math.round(parseFloat(pageEl && pageEl.style.getPropertyValue('--dock-h')) || 0),
        avail: Math.round(availBodyH()),
        half: halfDockH(availBodyH()),
        /* ★ 2026-11-19（抽屉缩放）：画布缩放也挂到自跑钩子上（--dock-scale 没写 = 1） */
        scale: isNaN(raw) ? 1 : Math.round(raw * 1000) / 1000
      };
    },
    /* 自跑测试用：缩放纯函数（stage 剩多高 / 牌多高 → 目标 scale） */
    _stageScale: stageScale,
    _undo: function () { return undoStack.length; },
    _redo: function () { return redoStack.length; },
    _dirty: function () { return dirty; },
    _imgMode: function () { return imgMode; }
  };
})(window);
