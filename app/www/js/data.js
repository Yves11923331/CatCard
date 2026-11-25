/* ============================================================
 * 猫卡 · 数据层 (data.js)
 * ------------------------------------------------------------
 * 职责:
 *   - 定义数据模型: 牌组(Deck) / 猫卡(Card)
 *   - localStorage 本地持久化
 *   - CRUD + 变更订阅
 *
 * 为将来扩展预留的字段(现在用不到, 但结构已支持):
 *   card.image —— 上传图片后的 dataURL (后续做"图片卡面")
 * ============================================================ */
(function (global) {
  'use strict';

  const RND = global.MoKa.random;        // 全 App 唯一随机源（js/random.js，crypto）

  const LS_DECKS = 'moka.decks.v1';      // 所有牌组
  const LS_ACTIVE = 'moka.activeDeckId'; // 当前选中的牌组
  const LS_ON_TABLE = 'moka.tableDecks'; // 【上占卜桌的牌组】= id 列表（**只存在这台手机上**，不写进牌组数据、不随导出走）
  /* 上一次落盘的结果（几十字节）。为什么要有它：lastSaveStatus 是模块级变量，
     冷启动恒为初值 {ok:true}，于是 app.js 那句"上次就没存上、一进来就该看到"永远空转。 */
  const LS_LAST_SAVE = 'moka.lastSave';

  /* ---------- 小工具 ---------- */
  /* id 的随机尾巴也走统一随机源 —— 同一毫秒连建两张卡也不会撞 */
  function uid(prefix) { return RND.uid(prefix); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  /* 牌面新设计默认值：卡名默认上部、关键词默认下部且开启；文字背景可调 */
  function cardStyleDefaults() {
    return {
      nameOn: true,        // 卡名是否上牌面（缺字段的老数据 = 显示）
      kwOn: true,          // 关键词是否上牌面
      // 兼容旧字段(上/中/下)
      namePos: 'top',
      kwPos: 'bottom',
      // 新灵活定位: 垂直百分比(0上~100下) + 水平对齐(l/c/r) + 字号(相对%)
      nameVy: 14, nameH: 'c', nameFs: 100,
      kwVy: 84, kwH: 'c', kwFs: 76,
      nameBg: '#ffffff', nameBgA: 62,
      kwBg: '#ffffff', kwBgA: 62,
      autoFit: true,            // 按文字长度自动缩字号，保证一行放得下（编辑页可关）
      nameWeight: 700, kwWeight: 700,  // 字重三档：常规 400 / 中 600 / 粗 700
      /* ★ 2026-09-27 新增两组外观字段（用户：「字体背景默认是胶囊，丑死了」）：
         font      = 字体：'sys' 系统默认 ／ 'kai' 霞鹜文楷（楷）／ 'song' 思源宋体（宋）
                     —— 后两款是**子集化后内嵌**的 woff2（只含本应用用得到的 2495 个汉字，
                     见 `www/assets/fonts/`）；缺的字自动回落到系统字体，不会出现豆腐块。
         bgStyle   = 文字底色的**预设样式**（不是颜色，是"怎么画这块底"）：
                     soft 柔光（默认）／pill 胶囊／tag 方签／plate 压暗条／ribbon 缎带
                     ／outline 描边／underline 下划线／none 无底（纯文字＋白字光晕）
                     ／plain 素字（不画底，文字用深墨色 —— 给"白卡"那种牌面用）
         ⚠ 加"卡片样式字段"要一次改全 5 处：这里 + STYLE_KEYS（复制样式到整副）
           + ui.js 的渲染 + 编辑页保存白名单 + 编辑页控件。漏一处就"草稿里在、保存后没了"。 */
      nameFont: 'sys', kwFont: 'sys',
      nameBgStyle: 'soft', kwBgStyle: 'soft',
      /* ★ 2026-10-11「鲸造」编辑器重构：牌面整体 + 图片图层字段（每张卡可独立设定）。
         faceBg    = 牌面底色：null = 默认（纸白 / 深色主题深底）；'#xxx' = 固定色。
                     渲染层走 CSS 变量 --fc-face（v3.css 的 .tcard-face 用 var() 兜底）。
         faceEdge  = 牌面纸边（默认开；和牌组级 deck.faceEdge 是"两者都开才画"）。
         imgScale  = 图片缩放 %（100 = 铺满整卡，50~400）；imgX/imgY = 平移偏移 %（±100）。
         imgFilter = 滤镜：'none' 原图 / 'dim' 压暗 / 'dark' 更暗 / 'blur' 模糊
                     / 'gray' 黑白 / 'warm' 暖调（CSS filter，见 ui.js fcImgHTML）。
         这 6 个都进 STYLE_KEYS ——「让整副都这样」= 完整外观（含图片排版）。 */
      faceBg: null,
      faceEdge: true,
      /* ★ 2026-10-11 主题升级：牌面质感层（程序化生成的灰度纹理，叠在底色/图片之上、文字之下）。
         faceTex  = 纹理 id（'paper'/'grain'/'stone'/'crack'/'fiber'/'brushed'/'watercolor'
                    /'stars'/'nebula'/'frost'；null = 不要质感）。图片在 assets/tex/<id>.png。
         faceTexA = 质感强度 0~100（CSS opacity；材质类走 soft-light、星云/星点走 screen）。 */
      faceTex: null,
      faceTexA: 45,
      /* ★ 2026-10-11：字色自由（朱砂字 / 烫金字 / 墨绿字…）。
         null = 按底色样式自动（浅底深字 / 深底白字 / 描边白字）；
         '#xxx' = 强制该色（行内写 color，排在样式策略之后 → 覆盖自动色）。
         主题靠它做出"古籍朱砂""矿物重彩"这些味道。 */
      nameColor: null,
      kwColor: null,
      imgScale: 100,
      imgX: 0,
      imgY: 0,
      imgFilter: 'none'
    };
  }
  var VY_OF_POS = { top: 14, mid: 50, bottom: 86 };
  function posOfVy(vy) { vy = +vy; return vy <= 33 ? 'top' : (vy <= 66 ? 'mid' : 'bottom'); }
  /* 合并旧卡字段 + 新样式默认值。
     styleBase = **这副牌出厂时的牌面样式**（注册表里 deck.cardStyle，见 builtinCard）。
     ★ 2026-09-27：以前只有"全局默认值"这一档，于是某副牌要特殊版式就只能写 CSS
       并用 !important 焊死（Psyche 那副就是这么干的，用户在编辑页怎么拖都不动 ——
       「就我们的p字头牌组，名词和关键词定死了」）。现在版式走数据：出厂值只是**默认值**，
       用户在「调整牌面」里改一个字就覆盖掉，和其它副牌完全一样。 */
  function withCardStyle(base, styleBase) {
    var d = cardStyleDefaults();
    if (styleBase) {
      Object.keys(styleBase).forEach(function (k) {
        if (STYLE_KEYS.indexOf(k) >= 0 && styleBase[k] !== undefined) d[k] = styleBase[k];
      });
    }
    if (!base) return d;
    var o = {};
    // ★ id 必须一起带走：漏掉它会让卡片的 id 变成 undefined，
    //   于是 drawn 集合里存的是 undefined，之后 drawn.has(c.id) 对所有卡都成立 →
    //   抽第一张之后就"永远没牌了"（内置示例牌组正是这条路径造出来的）。
    // ★ 这个白名单是"漏字段"的重灾区：id 漏过一次（§注释）、symbolImg 又漏过一次（2026-09-18：
    //   默认牌组挂上了符号图，结果被这里悄悄丢掉，界面上当然什么都看不见）。
    //   以后给卡片加字段，**必须**同时加进这一行。
    ['id','name','keyword','symbol','symbolImg','faceText','meaning','color','image','imageHi','art','band','builtinHash',
             'builtinImgHash','kwWrap2','styleKey','fx','fxStamp'].forEach(function (k) { if (base[k] !== undefined) o[k] = base[k]; });
    // 老数据只有 上/中/下 时, 推导新的垂直百分比
    if (base.namePos && base.nameVy == null) o.nameVy = VY_OF_POS[base.namePos] != null ? VY_OF_POS[base.namePos] : 14;
    if (base.kwPos && base.kwVy == null) o.kwVy = VY_OF_POS[base.kwPos] != null ? VY_OF_POS[base.kwPos] : 84;
    Object.keys(d).forEach(function (k) {
      if (base[k] === undefined || base[k] === null) { o[k] = d[k]; return; }
      // 旧版默认黑底(#16233d)自动换成新版白底
      if ((k === 'nameBg' || k === 'kwBg') && base[k] === '#16233d') { o[k] = d[k]; return; }
      o[k] = base[k];
    });
    // 同步旧字段镜像
    o.namePos = posOfVy(o.nameVy);
    o.kwPos = posOfVy(o.kwVy);
    return o;
  }

  /* ============================================================
     内置牌组（2026-09-20：内容与代码分家）
     ------------------------------------------------------------
     ★ 内容只写在 `app/decks/*.json`。跑
         python3 app/tools/内置牌组.py 生成
       生成 `js/builtin-decks.js`（注册表，排在 data.js **前面**加载）。
       这个文件里不再有任何一副牌的具体内容 —— 加内置牌组＝填一份 JSON，
       工作流程见 `app/decks/00-必读-内置牌组增删流程.md`。
     ★ 认牌组的判据始终是**名字 / 卡名**（"这是不是内置的那份东西"），
       不是"数据长什么样" —— 这样老装机迁移绝不会动用户自己的牌组
       （教训：早期按"有没有符号图"判，把用户那两副牌全盖满了 sowilo；现场就在 app/test/fixtures/）。
     ★ 卡片字段白名单在 withCardStyle 那一行；给内置卡加字段必须同时加进去。
     ============================================================ */
  var BUILTIN = (global.MoKaBuiltinDecks || []).slice();
  if (!BUILTIN.length) console.error('内置牌组注册表没装载：js/builtin-decks.js 必须排在 data.js 前面');
  var BUILTIN_BY_KEY = {};
  BUILTIN.forEach(function (e) { if (e && e.key) BUILTIN_BY_KEY[e.key] = e; });

  // ★ 2026-10-06：牌背 SVG 与符号表都**数据化**了（decks/<key>/back.svg 与 symbols.json 生成进注册表）。
  //   代码里不再写死 xxxBackSVG / SYM_PATH —— 渲染层（ui.js）从这里查。
  var BUILTIN_BACK = {};   // 牌背模板 id → 牌背 SVG 字符串
  var BUILTIN_SYMS = {};   // 符号 id → path 片段
  BUILTIN.forEach(function (e) {
    if (e.backSvg && e.back && e.back.template) BUILTIN_BACK[e.back.template] = e.backSvg;
    if (e.symTable) { Object.keys(e.symTable).forEach(function (k) { BUILTIN_SYMS[k] = e.symTable[k]; }); }
  });
  function builtinBackSvg(tpl) { return BUILTIN_BACK[tpl] || null; }
  function builtinSym(id) { return (id && BUILTIN_SYMS[id]) || null; }
  function symPathOf(sym) { return sym ? 'assets/sym/' + sym + '.svg' : null; }
  function symIdOfPath(src) { return String(src || '').replace(/^.*\//, '').replace(/\.(svg|png)$/i, ''); }

  var STAR_ENTRY = BUILTIN_BY_KEY.star || null;        // 星语牌组（新建装机的默认那副）
  var STAR_DECK_NAME = STAR_ENTRY ? STAR_ENTRY.name : '星语牌组';
  // 2026-09-20 下架过一副内置牌组（连它的符号表与内置牌背）—— 已经删干净，别再恢复。

  /* 卡名 → 注册表里的卡（"有身份的卡"就靠它认）。
     ★ 只收**带符号（sym）**的内置卡。这张表唯一的用途是回答"这张卡该不该留着符号"
       （见 cleanFakeSymbols），所以一副**不带符号**的内置牌组（symbols: none）的卡名
       **不能**进这张表 —— 否则用户自己那些同名卡（例如「焦虑」「抑郁」「移情·父」）
       会跟着被豁免，§54 清掉的假符号就清不掉了。
       这不是假想：用户那副 58 张的「精分牌组」58 张全被盖过 sowilo，其中 18 张的名字
       跟后来新增的 Psyche 牌组撞名（走查里拿他这份真实导出当回归用例，钉在
       `走查-内置牌组.js` 第 3c 组）。 */
  var BUILTIN_BY_NAME = {};
  BUILTIN.forEach(function (e) {
    // ★ 只有星语那套参与"认身份"（它的图形是身份的一部分）。
    //   Psyche 那 34 个图形只是**插画**：它如果也进这张表，用户自己那些同名卡
    //   （抑郁 / 焦虑 / 移情·父…）就会被豁免，好不容易清掉的 sowilo 又会回来。
    if (e.symbols !== 'star') return;
    (e.cards || []).forEach(function (c) { if (c && c.name && c.sym) BUILTIN_BY_NAME[c.name] = c; });
  });
  /* ★ 2026-09-27：**包内自带的牌面图**（英雄之旅那副，17 张 jpeg data URL）。
     这些图就写在 builtin-decks.js 里，跟着包走，**没有任何必要再存一份到手机上**：
       · 存进 IndexedDB → 白白多占几百 KB；
       · 存进 localStorage 兜底库 → 还会污染"兜底库里正好一条图"那条不变量（走查当场红）。
     所以分两半做：
       · 落盘时（buildMeta）见到"值就是注册表里那一张"的图 → 不写存储，字段写成 null；
       · 开机时（ensureBuiltinDecks）再把 null 的补回注册表里的那一张。
     ★ 认的是**图的字符串本身**，不是卡名 —— 用户自己换过图的卡，值对不上，照常落盘、照常不被碰。
     ⚠ 用户把自己那张图删了的话，下次开机这张内置图会回来（内置牌组本来就是这个语义）。 */
  var BUNDLED_IMGS = {};
  BUILTIN.forEach(function (e) {
    (e.cards || []).forEach(function (c) {
      if (c && typeof c.image === 'string' && c.image.indexOf('data:') === 0) BUNDLED_IMGS[c.image] = 1;
    });
  });

  /* ★ 2026-09-21：**卡文案的指纹**。
     背景（用户报"一些牌义显示的还是之前的，你是看着牌名相同就没有改吗"）：
     syncBuiltinCards 只在"这副牌里缺这张卡"时补进去，**同名的卡一根手指都不碰** ——
     那条规矩是为了护住"用户自己改过的卡"，可整副重做时它把 13 张同名卡的新文案全挡在门外
     （大他者／对象a／自恋·健康／自恋·病态／抱持／哀悼／四期里的三期／强迫性重复／高低神经质／欲望的主体）。
     修法：每张内置卡记一个"上次同步时它长什么样"的指纹（builtinHash）。
       · 指纹 == 当前内容  → 没人动过它 → 注册表变了就**刷新文案**（样式/图片/卡 id 全保留）
       · 指纹 != 当前内容  → 用户改过 → **永远不碰**
       · 没有指纹（这个机制之前建的卡）→ 当成"我们发的原版"，刷新一次并补上指纹
     ⚠ 指纹只算**内容**（名字/关键词/牌义/牌面句/符号/颜色），不算样式 ——
       用户只调字号字重、或给卡换图，都不算"改过文案"，下次照样能收到新文案。 */
  function cardContentHash(c) {
    if (!c) return '';
    var s = [c.name || '', c.keyword || '', c.meaning || '',
             c.faceText == null ? '' : c.faceText,
             c.symbol || '', c.symbolImg || '', String(c.color == null ? '' : c.color)].join('\u0001');
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h.toString(16);
  }

  // 注册表里的一张卡 → 卡片对象（卡 id 现生成；图片字段一律为空）
  /* ★ 2026-09-27：**牌面图的指纹**。
     为什么非要有它：牌面图必须能跟着新版更新（用户报「欲望的主体牌面没有更正成功」——
     辩证法在构建 111 换的、欲望的主体在 117 换的，而 restoreBuiltinImages 原来写的是
     `if (card.image) return;`：**图一旦生成就永远冻结**，所以 117 那张根本没上机）。
     但"能更新"不能变成"把用户自己换的图也盖掉" —— 两者都是 data: 值，光看值分不清。
     所以和文案一个套路：记一份"上次同步时这张图长什么样"，对不上就是用户换的。
     算法和 cardContentHash 同族（FNV-1a），但**隔 7 个字符采样一个**：图有几十 KB，
     逐字符算会把开机拖慢；采样后长度+样本一起进哈希，换图必然变。 */
  function imgHash(s) {
    if (!s || typeof s !== 'string') return null;
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i += 7) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return s.length + ':' + h.toString(16);
  }

  function builtinCard(c, deckStyle) {
    const palette = MoKa.data.pickPalette();
    const card = withCardStyle({
      id: uid('card'),
      name: c.name,
      keyword: c.keyword,
      symbol: c.symbol,
      symbolImg: symPathOf(c.sym),
      faceText: c.faceText,
      meaning: c.meaning,
      color: palette[(+c.color || 0) % palette.length],
      art: c.art || null,          // ★ 符号语言（Aegis 那副）：漏了这一行 → 牌面空白（2026-09-20 用户截图报的）
      band: c.band || null,        // ★ 层级条（同上一课：这里也是手写字段，必须一起带上）
      kwWrap2: c.kwWrap2 || null,  // ★ 关键词允许折两行（英雄之旅那副：阶段名长达 7 字，缩字号会缩到 6px 看不清）
      styleKey: c.styleKey || null,// ★ 牌面专属样式钩子（如 'hero' → .tcard-face.is-fc-hero 放大图形区）
      image: c.image || null,      // ★ 牌面图（英雄之旅那副：jpeg data URL，ui.js 的 .fc-img 铺满整张）
                                   //   这里原来是写死的 null —— 内置牌组永远拿不到图（2026-09-27 修的）
      builtinImgHash: c.image ? imgHash(c.image) : null   // ★ "我们发的这张图"的指纹（见 imgHash 上面）
    }, deckStyle);   // ★ 第二个参数 = 这副牌的出厂牌面样式（注册表 deck.cardStyle）
    card.builtinHash = cardContentHash(card);   // ★ 记下"我们发的这一版长什么样"（见 cardContentHash 上面的注释）
    return card;
  }

  // 注册表里的一副 → 一份新牌组（卡 id 每次现生成；图片字段一律为空 = 内置牌不带用户的图）
  function builtinDeck(entry) {
    if (!entry) return null;
    const palette = MoKa.data.pickPalette();
    const dk = {
      id: uid('deck'),
      name: entry.name,
      // ★ 2026-09-21：**身份标记**。内容同步（下线旧卡/补新卡/补 art）只认它 ——
      //   以前只按名字认，于是用户自建/导入一副同名（内置那副被删掉后名字就不冲突了）
      //   的牌组会被当成内置的改：自己的卡被 retiredNames 删掉、再塞进整套内置卡。
      //   克隆/导入不会带上这个字段，所以它们永远是"用户自己的牌组"，不会被碰。
      builtinKey: entry.key || null,
      createdAt: Date.now(),
      backImage: null,
      backTemplate: (entry.back && entry.back.template) || null,
      backColor: (entry.back && entry.back.color) || '#8a7a3a',
      useRev: false,
      hidden: !!entry.hidden,
      /* ★ 2026-11-17：**牌组级纸边**（导出包 deck.backEdge / deck.faceEdge）。
         缺省一律"开" —— 与 scenes/table.js、library.js 里的 `deck.backEdge !== false` 同一口径，
         所以注册表没写这两项的老牌组，行为一个字都不变。
         老装机（牌组早就在 localStorage 里）不靠这里，靠 applyBuiltinDeckFlags 迁移。 */
      backEdge: entry.backEdge !== false,
      faceEdge: entry.faceEdge !== false,
      cards: (entry.cards || []).map(function (c) { return builtinCard(c, entry.cardStyle); })
    };
    /* 注册表声明了纸边（= 我们发过非默认值）→ 顺手记下"这一版指纹"，
       老装机迁移（applyBuiltinDeckFlags）就不会再白写一次盘。没声明的牌组一个字段都不加。 */
    if (entryHasEdges(entry)) dk.edgeStamp = edgeStampOf(entry);
    return dk;
  }

  // 注册表坏掉时的兜底：给一副空牌组，别让 App 起不来（走查会立刻红）
  function emptyBuiltin(name) {
    return { id: uid('deck'), name: name, createdAt: Date.now(), backImage: null,
             backTemplate: null, backColor: '#8a7a3a', useRev: false, cards: [] };
  }
  /* 内置「星语牌组」（原来的"示例牌组"）：12 张，符号走 ui.js 的 SYM_PATH */
  function defaultDeck() { return builtinDeck(STAR_ENTRY) || emptyBuiltin(STAR_DECK_NAME); }
  /* 已下架那副牌的一整套 API 都删了；isStarName 留着（星语那 12 个名字仍是身份）。 */
  function isStarName(name) { return !!DEFAULT_SYM[name]; }

  /* 星语那 12 张：名字 → 符号 id（迁移补图用）
     ★ 只按名字补 —— 这里原来还有一条按字形（'✦' → star4）兜底，
       于是**用户自己的卡**只要 symbol 是 '✦' 就被补上一颗星（用户截图指着的那颗紫星）。 */
  var DEFAULT_SYM = {};
  ((STAR_ENTRY && STAR_ENTRY.cards) || []).forEach(function (c) {
    if (c && c.name && c.sym) DEFAULT_SYM[c.name] = c.sym;
  });

  /* 这个牌组是不是**某副内置牌组**（内置那副，或用户克隆/改名的那副）。
     ★ 判据是**卡名**，不是"有没有某个符号图" —— 用户自己的牌组被早期版本盖满了符文图
       （导出给我看的那两副：崩铁牌组 18 张 + 精分牌组 58 张，全是 sowilo），
       照"有没有符号图"来判，就会把用户的牌组当成内置那副，然后继续往上面配符号。 */
  function deckIsBuiltin(deck, entry) {
    if (!deck || !entry) return false;
    if (deck.name === entry.name) return true;
    var cards = deck.cards || [];
    if (!cards.length) return false;
    var hit = 0;
    cards.forEach(function (c) { if (c && nameIsOfEntry(c.name, entry)) hit++; });
    return hit >= Math.ceil(cards.length * 0.8);
  }
  /* ★ 2026-09-21：「这副牌是不是注册表里 entry 发的那一副」—— 用来决定**要不要改它的内容**。
     · 有身份标记（builtinKey，装机时 builtinDeck() 写的；克隆/导入不会带）→ 只认标记。
     · 老装机（构建 43 之前没有这个字段）→ 只能靠"样子"认，判据是**名字 + 卡名**：
         · 名字必须是这一副的名字或它用过的旧名（心甲牌组 → Aegis牌组 这种改名路径）；
         · **已存的卡里至少 80% 的名字能在注册表里对上**。
       ⚠ 为什么不能只看名字：用户完全可能自建/导入一副和内置同名的牌组
         （uniqueDeckName 只跟**现存**名字比，内置那副被删掉后名字就不冲突了）。
         实测过：只看名字会把用户那副 2 张卡的牌组认成内置的，然后 retiredNames 删掉他的卡、
         再把 36 张内置卡灌进去（2 → 37 张，用户自己的卡没了）。
         加了"卡名 80%"这条之后，探针里那副 2 张（1 张同名 = 50%）不再被误认；
         而老装机的真牌组（4 张全是内置卡名 = 100%）照样认得出来并补上标记。
       ⚠ 也不再用"牌背是不是这一副的专属牌背"当判据：用户把内置那副克隆出来
         （克隆默认带着同一个 backTemplate）就会命中，等于绕过卡名那条。
         认完立刻补标记，以后只认标记。
     以后再想加内置牌组，记住这条：**身份要写进数据里（builtinKey），别拿名字当主键。** */
  function isSameBuiltin(deck, entry) {
    if (!deck || !entry) return false;
    if (deck.builtinKey) return deck.builtinKey === entry.key;
    if (!nameIsOfEntryDeck(deck.name, entry)) return false;                  // 不是这一副的名字（含旧名）
    var cards = deck.cards || [];
    if (!cards.length) return false;
    var hit = 0;
    cards.forEach(function (c) {
      if (c && (nameIsOfEntry(c.name, entry) || nameIsRetiredOfEntry(c.name, entry))) hit++;
    });
    if (hit < Math.ceil(cards.length * 0.8)) return false;                   // 卡名对不上 → 不是内置那副
    // 认下来了就**顺手补上标记**（升级路径）：以后再判就只认标记，
    // 不用每次都拿"名字 + 卡名"去猜 —— 猜错一次就是改错用户的牌。
    if (entry.key) deck.builtinKey = entry.key;
    return true;
  }
  /* 这个名字是不是这一副内置牌组**用过的名字**（现在的 + oldNames） */
  function nameIsOfEntryDeck(name, entry) {
    if (!name || !entry) return false;
    if (name === entry.name) return true;
    return (entry.oldNames || []).indexOf(name) >= 0;
  }
  function nameIsOfEntry(name, entry) {
    return (entry.cards || []).some(function (c) { return c && c.name === name; });
  }
  /* ⚠ 判"卡名对得上"时**必须把 retiredNames（下线的旧卡名）也算进来**：
     正因为这些卡已经下线了，老装机那副里才正好是它们 —— 只认现役卡名的话，
     「抑郁 / 涵容 / 大他者 / 对象小a」这几张会被判成 3/5 = 60%，
     那副**真的**老 Psyche 牌组反而认不出来，内容同步（下线旧卡 + 补齐新卡）就此停摆。 */
  function nameIsRetiredOfEntry(name, entry) {
    return (entry.retiredNames || []).indexOf(name) >= 0;
  }
  /* 某张内置牌背模板属不属于这副牌组（界面用它决定模板列表给不给看）。
     以前是写死的判定，改成按注册表"谁声明了这个模板"判。 */
  function deckOwnsBack(deck, tplId) {
    if (!deck || !tplId) return false;
    for (var i = 0; i < BUILTIN.length; i++) {
      var e = BUILTIN[i];
      if (e.back && e.back.template === tplId && deckIsBuiltin(deck, e)) return true;
    }
    return false;
  }

  /* ★★ 拆掉的"凭空造符号"（用户截图指着的那颗紫星就是这个）：
     - 早期默认值给每张新建卡塞了 symbol:'✦'，迁移又把它映射成 star4 图形
       → **用户自己那些"本来没有符号"的卡，牌面正中凭空多出一颗星形徽记**；
     - 更早的版本还往用户牌组上盖过符号（崩铁的 18 张 + 精分的 58 张全是 sowilo）。
     现在规则一句话：**只有"有身份的卡"才配符号** —— 名字是内置牌组里任何一张
     **带符号的**内置卡的名字（星语那 12 个）。其余的卡：`symbolImg` 与 `symbol`
     都清掉 → 牌面上不画任何徽记（干干净净，只有名字/关键词/图）。
     ★ 判据用 BUILTIN_BY_NAME（只收带 sym 的卡）：不带符号的内置牌组不参与"认身份"。 */
  /* ⚠ 2026-10-01 用户：「每个都有符号，是过时的规则」—— 内置牌组现在允许有"还没配符号的卡"（新加的卡）。
     那种卡不在 BUILTIN_BY_NAME 里，cleanFakeSymbols 会把用户给它配的符号当"假符号"清掉。
     ⚠ 但保护必须**只对本副内置牌组自己的卡**生效：用户克隆/导出的牌组里，就算卡名撞上内置卡，
     那些"脏符号"**仍然要按老规矩清掉**（走查里有两条守卫正是盯这个 —— 放宽到"名字是内置卡就留"
     会把它们弄红，实测就是这么翻车的）。 */
  function cleanFakeSymbols(decks) {
    var n = 0;
    (decks || []).forEach(function (dk) {
      if (!dk || !Array.isArray(dk.cards)) return;
      /* 这副牌是不是"我们发的内置牌"？是的话，它自己的卡名（含还没配符号的新卡）都不清符号 */
      var entry = null, ownNames = null;
      (BUILTIN || []).forEach(function (e) { if (!entry && isSameBuiltin(dk, e)) entry = e; });
      if (entry) {
        ownNames = {};
        (entry.cards || []).forEach(function (c) { if (c && c.name) ownNames[c.name] = 1; });
      }
      dk.cards.forEach(function (c) {
        if (!c) return;
        if (c.name && BUILTIN_BY_NAME[c.name]) return;      // 有身份的卡（星语）：保留
        if (ownNames && c.name && ownNames[c.name]) return; // 本副内置牌自己的卡：保留
        if (!c.symbolImg && !c.symbol) return;           // 本来就干净的：不动
        c.symbolImg = null;
        c.symbol = '';
        n++;
      });
    });
    return n;
  }

  /* 老装机上可能已经有一副内置牌组（早期版本留下的），**不重复加**，
     只把里面认不出的符号按卡名认回来：卡名对得上就把 symbolImg 换成对的符号。
     ★ 已经指着一个真符号的卡，一根手指都不碰（用户可能自己换过）。 */
  function repairBuiltinSymbols(decks, entry) {
    if (!entry) return 0;
    var byName = {}, ids = {};
    (entry.cards || []).forEach(function (c) {
      if (c && c.name) byName[c.name] = c;
      if (c && c.sym) ids[c.sym] = 1;
    });
    var n = 0;
    (decks || []).forEach(function (dk) {
      if (!dk || dk.name !== entry.name || !Array.isArray(dk.cards)) return;
      dk.cards.forEach(function (c) {
        if (!c) return;
        var r = byName[c.name];
        if (!r || !r.sym) return;
        if (ids[symIdOfPath(c.symbolImg)]) return;
        c.symbolImg = symPathOf(r.sym);
        if (!c.symbol) c.symbol = r.symbol;
        n++;
      });
    });
    return n;
  }

  // 早期版本的内置牌组名 → 现在的名字（只改名字，牌组 id 不变，用户的编辑都还在）
  var DECK_RENAMES = {};
  BUILTIN.forEach(function (e) { (e.oldNames || []).forEach(function (n) { DECK_RENAMES[n] = e.name; }); });
  function renameBuiltinDecks(decks) {
    var n = 0;
    (decks || []).forEach(function (d) {
      if (!d || !DECK_RENAMES[d.name]) return;
      d.name = DECK_RENAMES[d.name];
      n++;
    });
    return n;
  }

  /* 内置牌组之间按注册表的 order 排（用户定的，见 decks/*.json 的 order）。
     ★ 只动内置这几副之间的相对位置，其它牌组之间的顺序一概不碰。 */
  function orderBuiltinDecks(decks) {
    if (!Array.isArray(decks)) return false;
    var changed = false;
    for (var i = 1; i < BUILTIN.length; i++) {
      var prev = BUILTIN[i - 1], cur = BUILTIN[i];
      var pi = idxOfDeck(decks, prev.name), ci = idxOfDeck(decks, cur.name);
      if (pi < 0 || ci < 0 || pi < ci) continue;         // 已经在前头了
      var moved = decks.splice(pi, 1)[0];
      var ci2 = idxOfDeck(decks, cur.name);
      decks.splice(ci2 < 0 ? 0 : ci2, 0, moved);
      changed = true;
    }
    return changed;
  }
  function idxOfDeck(decks, name) {
    for (var i = 0; i < decks.length; i++) { if (decks[i] && decks[i].name === name) return i; }
    return -1;
  }

  /* 内置牌背（Aegis「一盾两色」/ 易经「三爻」/ 英雄之旅「里程线」）：老装机上那副牌组的牌背还是空的 → 补上。
     ★ 用户自己设过牌背图的、自己挑过模板的，**一律不碰**。 */
  var OLD_DEFAULT_BACK_COLORS = ['#8a7a3a', '#5a6270'];   // 「新建牌组」用过的两个默认色
  function applyBuiltinBack(decks, entry) {
    if (!entry || !entry.back || !entry.back.template) return 0;
    var n = 0;
    (decks || []).forEach(function (d) {
      if (!d || d.name !== entry.name) return;
      if (d.backImage || d.backTemplate) return;
      d.backTemplate = entry.back.template;
      // 只有"从没动过颜色"才顺带换成这副牌的主色
      if (!d.backColor || OLD_DEFAULT_BACK_COLORS.indexOf(d.backColor) >= 0) d.backColor = entry.back.color;
      n++;
    });
    return n;
  }

  /* ★ 内置牌组的**内容同步**（2026-09-20）——
     背景：内置牌组是"装机时建一次"的，`ensureBuiltinDecks` 只补"缺的牌组"，
     所以**我们后来改了内容，老装机的手机上永远看不到**（用户报的"拆出来的三张没有呀"就是这个）。
     两条规则，判据都落在"这是不是我们发的那张卡"上（绝不碰用户自己的牌组）：
       ① **下线**：注册表里 `retiredNames` 声明的旧卡名 → 从这副牌里删掉（名字命中就删）
       ② **补齐**：注册表里有、这副牌里没有的内置卡 → 追加到末尾（已有的卡一根手指都不碰）
     只对"名字等于内置那副"的牌组做；用户自己改过名字的、克隆出来的，一概不动。 */
  function syncBuiltinCards(decks, entry) {
    if (!entry || !Array.isArray(decks)) return 0;
    var dk = null;
    /* ⚠ 只认**身份标记**（isSameBuiltin），不能只比名字：
       用户自建/导入一副和内置同名的牌组时（内置那副被删掉后名字就不冲突了），
       按名字找会把用户那副拿来改 —— 自己的卡被下、内置卡被塞进去（实测 3 张变 37 张）。 */
    for (var i = 0; i < decks.length; i++) {
      if (decks[i] && isSameBuiltin(decks[i], entry)) { dk = decks[i]; break; }
    }
    if (!dk || !Array.isArray(dk.cards)) return 0;
    var n = 0, names = {};
    /* ⚠ 2026-09-21：用户把内置卡**改了名**的，要按"这张还在"算 ——
       否则下面补齐那一步会认为原卡名缺了，把原版**再补一张**（等于凭空多一张，
       而改名那张的插图还会被 cleanFakeSymbols 清掉）。updateCard 改名时写的
       renamedFrom 就是给这里用的。 */
    dk.cards.forEach(function (c) {
      if (!c) return;
      if (c.name) names[c.name] = 1;
      if (c.renamedFrom) names[c.renamedFrom] = 1;
    });
    /* ★ 2026-11-06：**卡级 oldNames**（牌组 JSON 里 card.oldNames）——
       老装机上这张还叫旧名（共治），注册表已经叫新名（政府）。
       这里把"旧名"也记进 names，补齐那一步才不会认为"新名缺了"、把同一张卡再加一遍。
       真正的改名交给 syncBuiltinContent（它在**验过指纹之后**才写 name，用户改过的照旧不碰）。 */
    (entry.cards || []).forEach(function (c) {
      if (!c || !Array.isArray(c.oldNames)) return;
      c.oldNames.forEach(function (nm) { if (nm && names[nm]) names[c.name] = 1; });
    });
    /* ★ 2026-10-01（用户报的"拖完顺序、重启又变回去"的真凶就是这里）：
       退役名单里混进了**注册表现在还在用的名字**（当时误收了「被欲望位置」）——
       于是每次开机：先把这张卡删掉 → 下一步又把它当"缺失"补到**末尾** ⇒
       用户手拖的顺序**被静默顶掉**，而且保存得"很成功"（盘上确实按新位置存了）。
       防线：还在用的名字，退役名单里写了也不删。 */
    var curNames = {};
    (entry.cards || []).forEach(function (c) { if (c && c.name) curNames[c.name] = 1; });
    (entry.retiredNames || []).forEach(function (nm) {
      if (curNames[nm]) return;                     // ← 还在用：跳过（否则就是偷偷改牌序）
      for (var j = dk.cards.length - 1; j >= 0; j--) {
        if (dk.cards[j] && dk.cards[j].name === nm) { dk.cards.splice(j, 1); n++; }
      }
      delete names[nm];
    });
    /* ★ 2026-11-06（用户报「新牌默认落到最后一张、上卷只剩 25 张」）：
       补齐不能一律 push 到末尾 —— 那是"新增一张牌"被当成附录。
       现在按**注册表次序**找插入点：在这张卡之前、且已经存在于手机上的最后一张内置卡之后插入。
       这样新卡落在它在书里的位置（收藏 → 科幻与艺术之间），而用户自己拖过的其它卡一张都不动。
       找不到前驱（比如老装机只有后几卷）就放开头，仍然比"甩到末尾"合理。 */
    function insertBuiltinCard(deck, srcCard, allCards) {
      var card = builtinCard(srcCard, entry.cardStyle);
      var idx = allCards.findIndex(function (x) { return x === srcCard; });
      if (idx < 0) { deck.cards.push(card); return; }
      var anchor = -1;
      for (var k = idx - 1; k >= 0; k--) {
        var prevName = allCards[k] && allCards[k].name;
        if (!prevName) continue;
        for (var j = deck.cards.length - 1; j >= 0; j--) {
          if (deck.cards[j] && deck.cards[j].name === prevName) { anchor = j; break; }
        }
        if (anchor >= 0) break;
      }
      if (anchor >= 0) deck.cards.splice(anchor + 1, 0, card);
      else deck.cards.unshift(card);
    }
    (entry.cards || []).forEach(function (c) {
      if (!c || !c.name || names[c.name]) return;
      insertBuiltinCard(dk, c, entry.cards);
      names[c.name] = 1;
      n++;
    });
    /* ★ 2026-11-06：**尾部错位修正（一次性）**。
       背景：构建 293 的补齐是 `push` —— 用户装过那一版后，「收藏」被追加到了整副牌的最后
       （于是"上卷只剩 25 张"）。这一版改成了按次序插入，但那只在"卡片缺失"时生效，
       已经躺在末尾的那张不会自己回来。
       修法只做一件极窄的事，且**每台机器只跑一次**（localStorage 标记）：
         · 只看**当前排在最后**的那一张；
         · 只有当它是内置卡、且按注册表它在后面还有兄弟卡（而兄弟卡已经排在它前面）时，
           才把它挪到"注册表里它前一张"的后面。
       用户自己拖出来的顺序（哪怕很怪）只要不满足这两条，一根手指都不碰。 */
    try {
      var FIX_KEY = 'moka.fix.builtinTail.v1';
      if (!localStorage.getItem(FIX_KEY)) {
        var tail = dk.cards[dk.cards.length - 1];
        if (tail && tail.name) {
          var all = entry.cards || [];
          var ti = -1;
          for (var q = 0; q < all.length; q++) { if (all[q] && all[q].name === tail.name) { ti = q; break; } }
          if (ti >= 0) {
            var hasLaterSibling = false;
            for (var q2 = ti + 1; q2 < all.length && !hasLaterSibling; q2++) {
              var nm2 = all[q2] && all[q2].name;
              if (!nm2) continue;
              for (var q3 = 0; q3 < dk.cards.length - 1; q3++) {
                if (dk.cards[q3] && dk.cards[q3].name === nm2) { hasLaterSibling = true; break; }
              }
            }
            if (hasLaterSibling) {
              var anchorIdx = -1;
              for (var q4 = ti - 1; q4 >= 0 && anchorIdx < 0; q4--) {
                var pn = all[q4] && all[q4].name;
                if (!pn) continue;
                for (var q5 = 0; q5 < dk.cards.length - 1; q5++) {
                  if (dk.cards[q5] && dk.cards[q5].name === pn) { anchorIdx = q5; break; }
                }
              }
              dk.cards.pop();
              if (anchorIdx >= 0) dk.cards.splice(anchorIdx + 1, 0, tail);
              else dk.cards.unshift(tail);
              n++;
            }
          }
        }
        localStorage.setItem(FIX_KEY, '1');
      }
    } catch (e) {}

    /* ★ 2026-09-20 晚：补 art（**只补这一个字段**，别的一律不碰）。
       背景：构建 29 的 builtinCard() 手写字段时漏了 art → 老装机那副 Aegis 的 78 张全是空牌面；
       光修代码不会自己好（上面那一段只"追加缺的卡"，已有的一根手指都不碰），所以这里补一次。
       判据照旧落在"卡名是不是内置那张"上：用户改过名字的卡对不上 → 不动，不会误伤。 */
    var byName = {};
    (entry.cards || []).forEach(function (c) { if (c && c.name) byName[c.name] = c; });
    dk.cards.forEach(function (c) {
      if (!c || !c.name) return;
      var src = byName[c.name];
      if (!src) return;
      /* ★ 2026-10-02：art/band/styleKey 是内置字段（编辑器里用户改不动），跟注册表走，含「清空」这半边。
         原来只"有就补、没有不碰"，整副重做把 art/band 清掉时，老装机还留着旧的
         → 和整面图叠出两份（用户报「名字和符号都出现了两次」）。 */
      var na = src.art || null, nb = src.band || null, ns = src.styleKey || null;
      if (c.art !== na) { c.art = na; n++; }
      if (c.band !== nb) { c.band = nb; n++; }
      if (c.styleKey !== ns) { c.styleKey = ns; n++; }
    });
    return n;
  }

  /* ★★ 2026-09-21：内置牌的**文案刷新**（同名卡也要跟着改）。
     这是上面 syncBuiltinCards 漏掉的那半边，用户报「一些牌义显示的还是之前的，你是看着牌名相同就没有改吗」
     —— 整副重做时，13 张**名字没变**的卡（大他者／对象a／自恋·健康／自恋·病态／抱持／哀悼／
     口欲期／肛欲期／俄狄浦斯期／强迫性重复／高神经质／低神经质／欲望的主体）全部留着旧文案。
     规矩（判据仍是"这是不是我们发的卡"，绝不碰用户自己的牌组）：
       · 卡上没指纹（这机制之前建的）→ 当我们发的原版 → 按注册表刷新一次，补上指纹
       · 指纹 == 当前内容（没人动过）→ 注册表变了就刷新
       · 指纹 != 当前内容（用户改过文案）→ **一根手指都不碰**
     保留：卡 id、图片（image/imageHi）、以及全部样式字段（字号/字重/位置/底色…）——只换内容。
     覆盖：名字/关键词/牌义/牌面句/符号图/颜色。 */
  function syncBuiltinContent(decks, entry) {
    if (!entry || !Array.isArray(decks) || !Array.isArray(entry.cards)) return 0;
    var dk = null;
    for (var i = 0; i < decks.length; i++) {
      if (decks[i] && isSameBuiltin(decks[i], entry)) { dk = decks[i]; break; }
    }
    if (!dk || !Array.isArray(dk.cards)) return 0;
    const palette = MoKa.data.pickPalette();
    var byName = {};
    entry.cards.forEach(function (c) {
      if (!c || !c.name) return;
      byName[c.name] = c;
      /* ★ 2026-11-06：卡级 oldNames 也指向这张 —— 老装机上它叫旧名（共治），
         这里认出来之后，下面的 want.name 会把它**原地**改成新名（政府），
         位置、id、抽牌进度都不动；指纹校验仍在改名之前做，用户改过的照样不碰。 */
      (c.oldNames || []).forEach(function (nm) { if (nm) byName[nm] = c; });
    });
    var n = 0;
    dk.cards.forEach(function (card) {
      if (!card || !card.name) return;
      var src = byName[card.name];
      if (!src) return;                                     // 不是我们发的卡（或已被改名）→ 不碰
      if (card.builtinHash && card.builtinHash !== cardContentHash(card)) return;   // 用户改过 → 不碰
      var want = {
        name: src.name,
        keyword: src.keyword,
        symbol: src.symbol === undefined ? null : src.symbol,
        symbolImg: symPathOf(src.sym),
        faceText: src.faceText === undefined ? null : src.faceText,
        meaning: src.meaning,
        color: palette[(+src.color || 0) % palette.length]
      };
      var changed = false;
      Object.keys(want).forEach(function (k) {
        if (card[k] !== want[k]) { card[k] = want[k]; changed = true; }
      });
      var h = cardContentHash(card);
      if (card.builtinHash !== h) { card.builtinHash = h; changed = true; }
      if (changed) n++;
    });
    return n;
  }

  var _builtinChecked = false;
  /* 老装机（牌组早就存在 localStorage 里）：改名 → 补上缺的内置牌组 → 补符号 → 补牌背 → 排好顺序。
     只做一次；新装机走 seed，这里基本什么都不用做。绝不动用户自己的牌组。
     ★ 补不补由 deck JSON 的 addIfMissing 说了算：默认那副（星语）是 false ——
       用户自己删了就说明他不要，别每次进 App 又给他塞回来；
       后来才加的那几副是 true —— 老装机缺了要补上（§54）。 */
  function ensureBuiltinDecks() {
    if (_builtinChecked || !Array.isArray(cache)) return;
    _builtinChecked = true;
    var touched = renameBuiltinDecks(cache);
    BUILTIN.forEach(function (e) {
      if (e.addIfMissing === false) return;
      if (cache.some(function (d) { return d && d.name === e.name; })) return;
      var nd = builtinDeck(e);
      if (!nd) return;
      cache.push(nd);
      if (e.onTable) addToTable(nd.id);
      touched++;
    });
    touched = (touched || 0) + cleanFakeSymbols(cache);
    BUILTIN.forEach(function (e) {
      touched += syncBuiltinCards(cache, e);            // ★ 内容同步：下线旧卡 + 补齐新卡
      touched += syncBuiltinContent(cache, e);          // ★ 同名卡也要刷新文案（用户改过的不碰）
      touched += applyBuiltinCardStyle(cache, e);       // ★ 出厂牌面样式（版式走数据）
      touched += applyBuiltinDeckFlags(cache, e);       // ★ 牌组级纸边（牌背/牌面，2026-11-17）
      touched += applyBuiltinOnTable(cache, e);         // ★ 默认不上桌（易经，2026-11-19）
      touched += repairBuiltinSymbols(cache, e) + applyBuiltinBack(cache, e);
    });
    /* ★ 包内自带的牌面图：落盘时被写成 null，这里从注册表补回内存；**并且跟着新版更新**。
       （原来只补"空着的"，于是牌面图一旦生成就永远不更新 —— 用户报的
         「欲望的主体牌面没有更正成功」就是这么来的：辩证法在 111 换的，他那副牌是
         111 之后、117 之前新建的，所以从包里带出来的是三幕版 ✓、欲望的主体是旧版 ✗。）
       ⚠ 返回值 n 只数"盘上真的变了"的卡（换了图或补了图指纹）：图本身落盘时照样是 null
         （见 BUNDLED_IMGS），盘上没变却算进 touched 的话，等于每次开机白写一次盘。 */
    if (restoreBuiltinImages(cache)) touched++;
    if (orderBuiltinDecks(cache)) touched++;
    if (touched) persist();
  }

  /* ★ 2026-09-27：把注册表里的**出厂牌面样式**（deck.cardStyle）写到这副牌的卡上。
     为什么需要它：出厂版式以前是写死在 CSS 里的（.is-fc-psyche + !important），
     老装机那 37 张卡的样式字段一直是**全局默认值**（nameVy 14 / nameFs 100 / soft）。
     现在 CSS 撤了、改成读卡上的字段 —— 不给老卡补这一次，升级后那副牌会立刻变样。
     判据（不用新字段、也不用"改过一次"的标记）：**卡上的样式字段全等于全局默认值**
     = 从来没人调过 → 写上出厂样式；只要用户动过任何一个（比如把字号调成 123），
     整张卡就一个字都不碰。幂等：写完就不再等于默认值了，下次进来不会重复写。 */
  function applyBuiltinCardStyle(decks, entry) {
    var cs = entry && entry.cardStyle;
    if (!cs || typeof cs !== 'object') return 0;
    var d = cardStyleDefaults(), n = 0;
    /* ★★ 2026-09-28：**出厂样式要能一改再改**（用户报的："样式和位置用的是之前那个 p 字头"）。
       原来只认"卡上的样式字段全是**全局默认值**"= 从没被刷过的卡 ——
       可我们上一版已经刷过一次的卡，字段就不再是默认值了，于是**以后再改出厂样式它永远刷不动** ✗。
       现在多两个判据：
         · card.fxStamp === 这一次的 cardStyle 指纹 → 已经是这一版了，跳过；
         · card.fx（**上一次发出去的那份样式快照**）逐字段还对得上 → 说明用户没动过 → 可以再刷；
         · 都没有（老装机、从没刷过）→ 退回"全字段等于全局默认值"那条。
       另外注册表可以给 `cardStylePrev`（历史上发过的几版样式）—— 老装机上那些"我们刷过、但没留快照"
       的卡，只要**正好等于历史某一版**，也认成"没被动过"、跟着更新。 */
    var stamp = JSON.stringify(cs);
    var prevs = Array.isArray(entry.cardStylePrev) ? entry.cardStylePrev : [];
    function matchPrev(card, obj) {
      return Object.keys(obj).every(function (k) { return card[k] === obj[k]; });
    }
    decks.forEach(function (dk) {
      if (!isSameBuiltin(dk, entry) || !Array.isArray(dk.cards)) return;
      dk.cards.forEach(function (card) {
        if (!card || !card.name) return;
        if (card.fxStamp === stamp) return;                       // 已经是这一版
        var untouched;
        if (card.fx && typeof card.fx === 'object') {
          untouched = matchPrev(card, card.fx);            // 有快照：跟上次发的那份对得上就没被动过
        } else {
          // ⚠ 没有快照时，**两种都算"没被动过"**：
          //   · 各字段都是全局默认值（全新装机 / 刚建出来的卡）
          //   · 或者正好等于历史上发过的某一版（老装机：我们刷过、但没留快照）
          //   ★ 第一版这里写了 `else if (prevs.length)` —— 于是"有历史版本的牌组"里，
          //     全新默认卡被漏判成"用户改过"、永远刷不上（被走查当场抓住）。
          untouched = STYLE_KEYS.every(function (k) { return card[k] === undefined || card[k] === d[k]; }) ||
                      prevs.some(function (p0) { return matchPrev(card, p0); });
        }
        if (!untouched) return;                                   // 用户自己调过 → 一根手指都不碰
        STYLE_KEYS.forEach(function (k) { if (cs[k] !== undefined) card[k] = cs[k]; });
        card.namePos = posOfVy(card.nameVy);      // 兼容旧字段跟着同步
        card.kwPos = posOfVy(card.kwVy);
        card.fx = JSON.parse(stamp); card.fxStamp = stamp;         // 记下"这一版是我们发的"
        n++;
      });
    });
    return n;
  }

  /* ★ 2026-11-17：**牌组级纸边**（backEdge 牌背 / faceEdge 牌面）—— 出厂设定 + 老装机迁移。
     为什么要有：卡片之外的"出厂设定"以前只有 cardStyle 一条通道（版式走数据），
     纸边开关（table.js / library.js 都读 `deck.backEdge !== false`）**没有任何数据通道**：
     用户 2026-11-17 的导出包里两副牌都把纸边关了，工程这边却永远是开的。
     判据（比 applyBuiltinCardStyle 更保守 —— 纸边只有两个开关，用户点一下就是有意为之）：
       · deck.edgeStamp === 这一版的指纹 → 已经是这一版了，跳过（幂等，不白写盘）；
       · 两个开关**都还是默认开**（字段没写 / 是 null / 是 true）= 从来没人调过 → 写目标值；
       · 或者**已经等于目标值**（上一次迁移写的）→ 只补指纹，不重复写；
       · 其余情况（用户自己关了牌背、留着牌面…）→ 一根手指都不碰。
     ⚠ 只认 isSameBuiltin（我们发的那副）；用户自建 / 导入 / 克隆的牌组永远不碰。
     ⚠ 注册表没声明纸边的牌组（backEdge/faceEdge 都没有）直接返回 0 —— 其余牌组零影响。 */
  function edgeStampOf(entry) {
    return JSON.stringify({ backEdge: entry.backEdge !== false, faceEdge: entry.faceEdge !== false });
  }
  function entryHasEdges(entry) {
    return !!entry && (typeof entry.backEdge === 'boolean' || typeof entry.faceEdge === 'boolean');
  }
  function applyBuiltinDeckFlags(decks, entry) {
    if (!entryHasEdges(entry) || !Array.isArray(decks)) return 0;
    var wantBack = entry.backEdge !== false, wantFace = entry.faceEdge !== false;
    if (wantBack && wantFace) return 0;        // 目标就是默认值 → 没有可迁移的（也不必写指纹）
    var stamp = edgeStampOf(entry), n = 0;
    decks.forEach(function (dk) {
      if (!isSameBuiltin(dk, entry)) return;
      if (dk.edgeStamp === stamp) return;                              // 已经是这一版
      var untouched = (dk.backEdge === undefined || dk.backEdge === null || dk.backEdge === true)
                   && (dk.faceEdge === undefined || dk.faceEdge === null || dk.faceEdge === true);
      var atTarget = (dk.backEdge === wantBack) && (dk.faceEdge === wantFace);
      if (!untouched && !atTarget) return;                             // 用户自己调过 → 不动
      dk.backEdge = wantBack; dk.faceEdge = wantFace;
      dk.edgeStamp = stamp;                                            // 记下"这一版是我们发的"
      n++;
    });
    return n;
  }

  /* ★ 2026-11-19：牌组默认不上桌（entry.onTable === false）——
     新装机 seed 时就不加（见 ensureBuiltinDecks 的 if (e.onTable)）；
     老装机这里做一次性迁移：把内置那份从 moka.tableDecks 里去掉，记 tableOffStamp 防反复。
     只认 isSameBuiltin；用户之后自己勾回来，stamp 在 → 不再动。 */
  function applyBuiltinOnTable(decks, entry) {
    if (!entry || entry.onTable !== false || !Array.isArray(decks)) return 0;
    var n = 0;
    decks.forEach(function (dk) {
      if (!isSameBuiltin(dk, entry)) return;
      if (dk.tableOffStamp === 'v1') return;
      var ids = tableDeckIds();
      if (ids.indexOf(dk.id) >= 0) {
        writeOnTable(ids.filter(function (id) { return id !== dk.id; }));
      }
      dk.tableOffStamp = 'v1';
      n++;
    });
    return n;
  }

  /* ★ 2026-09-27：把"包内自带、落盘时被写成 null"的牌面图从注册表补回来。
     配合 buildMeta 里的 BUNDLED_IMGS 分支，两张合起来 =
     **内置牌面图不占用户存储，但每次开机都在**。
     用户自己编辑过这张卡（文案指纹对不上）就一根手指都不碰；没编辑过的，图跟着新版走。 */
  function restoreBuiltinImages(decks) {
    var n = 0;
    BUILTIN.forEach(function (e) {
      var imgs = {};
      (e.cards || []).forEach(function (c) { if (c && c.name && c.image) imgs[c.name] = c.image; });
      if (!Object.keys(imgs).length) return;
      decks.forEach(function (dk) {
        if (!isSameBuiltin(dk, e) || !Array.isArray(dk.cards)) return;
        dk.cards.forEach(function (card) {
          if (!card || !card.name) return;
          var src = imgs[card.name];
          if (!src) return;
          /* ★ 原来这里写的是 `if (card.image) return;` —— 于是牌面图一旦生成就永远冻结，
             这就是「欲望的主体牌面没有更正成功」的根。现在：**补空的 + 换旧的**，都不碰用户自己的。 */
          /* ⚠ 判指纹前必须先看"图是不是空的"：落盘时图被写成 null、**指纹却留着**
             （都在同一张卡上），拿 null 去对指纹必然对不上 → 图就再也补不回来了。
             空 = 没有图可保护，直接补。（这一条是被走查第 6 组"重启后 0/17"当场抓出来的。） */
          if (card.image) {
            if (card.builtinImgHash) {
              if (card.builtinImgHash !== imgHash(card.image)) return;  // 图指纹对不上 = 用户自己换的 → 不碰
            } else if (card.builtinHash && card.builtinHash !== cardContentHash(card)) {
              return;                                                   // 老卡（没图指纹）但文案改过 → 保守不动
            }
          }
          const nh = imgHash(src);
          /* ★★ 2026-10-15 修（**每次冷启动都白写一遍全量数据**）：
             原来这里 `if (card.image !== src) { …, ch = true; }` ——
             可 BUNDLED_IMGS 的图**落盘时按设计就写成 null**（见 buildMeta），
             所以每次开机从盘上读回来的 image 都是 null，这一行**恒为 true** →
             n 恒 ≥ 35 → ensureBuiltinDecks 里 `if (restoreBuiltinImages(cache)) touched++`
             → `if (touched) persist()`：每次冷启动白做一次全量 clone + 两次
             JSON.stringify + 两轮写盘，还把 `.bak`（丢图时最后一道防线）反复重写成当前内存态。
             上面 618 行那句注释早就写明白了——"盘上没变却算进 touched 的话，
             等于每次开机白写一次盘"——只是代码没照做；而走查只断言"17 张图回来了"，
             没断言"这一趟不该写盘"，所以一直是绿的。
             正解：**ch（盘上真的变了）只认指纹变化**；"盘上是 null"只补内存，不算盘上变化。 */
          let ch = false;
          if (card.image !== src) card.image = src;                     // 内存补回：空着的补上、我们发的旧图换新
          if (card.builtinImgHash !== nh) { card.builtinImgHash = nh; ch = true; }   // 指纹真的变了才算动过盘
          if (ch) n++;                                                  // n = 盘上真动过几张卡
        });
      });
    });
    return n;
  }

  /* ---------- 存储 ---------- */
  let cache = null;

  // ---- 图片存储(IndexedDB 优先, 失败自动回退内嵌) ----
  const IMG = (global.MoKa && global.MoKa.images) || null;
  const MARK = 'idb:';
  let useIdb = false;          // 本次会话 IndexedDB 是否可用
  let readyPromise = null;     // initImages() 的 Promise
  let lastHydrate = null;      // 最近一次图片补水的结果（{skipped, missing, total}）
  const imgMap = new Map();    // marker -> dataURL
  const revMap = new Map();    // dataURL -> 已确认可复用的 marker
  function rememberImage(marker, value) {
    imgMap.set(marker, value);
    revMap.set(value, marker);
  }
  function forgetImage(marker) {
    const value = imgMap.get(marker);
    imgMap.delete(marker);
    // 同图可能在不同地址都有副本；不移除指向别处的索引。
    if (revMap.get(value) === marker) revMap.delete(value);
  }
  /* ★ 内存里的图片是不是已经"补回来"了。
     只有补回来了，cache 里才是**真的原图**，写进 .bak 才有意义；
     否则写进去的是一堆 idb: 标记 —— 会把上一份好备份覆盖掉（升级时迁移先落盘就会踩到）。 */
  let imagesHydrated = false;

  /* ---------- ★ 2026-09-21：运行时图片兜底库 ----------
     背景（这条是"重启后改动整体回退"那条链的根）：
       图片正常存 IndexedDB，localStorage 里只放 `idb:xxx` 标记。
       可一旦 IndexedDB **这次没打开成功**（idb.js 冷启动有 2.5s 超时，历史上真出过），
       buildMeta() 就把图片**内嵌**进 meta —— 几百 KB 一张的 base64 灌进只有 ~5MB 的
       localStorage，于是**整份 meta 写不进去**：那次会话里所有改动（改个名字、编辑一张卡）
       全部静默失败，重启就回退。这就是"我明明保存了"的来源。
     现在改成两级兜底：IDB 不可用 → 图片**逐张**存进 localStorage 的独立键
       （`moka.img.ls.<id>`，标 `ls:` 前缀），meta 里只留标记 —— meta 又变回几十 KB，
       怎么写都写得进；图片各自占一个键，坏也只坏那一张。
       ⚠ 单张超 ~1.5MB 的图不往 localStorage 塞（一张就能吃满配额）→ 这种只能留在内存里，
         下次落盘会明确报"有 N 张图没能存下来"，不再静默。 */
  const LS_IMG_PREFIX = 'moka.img.ls.';
  /* ★ 2026-09-23：**整个 origin 的 localStorage 占用**（不含就看不见真正的大头 ——
     图片兜底库 moka.img.ls.* 一张就能到 1.5MB，以前设置页那个"数据占用"只统计 4 个键，会严重低报）。 */
  function lsBytes() {
    let n = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        n += (k || '').length + ((localStorage.getItem(k) || '').length);
      }
    } catch (e) {}
    return n;
  }
  const MARK_LS = 'ls:';
  const LS_IMG_MAX = 1.5 * 1024 * 1024;
  /* ★ 2026-10-11（用户拍板）：**清晰度优先，不降质** —— 手机运存足够。
     曾试过"兜底库压缩到 360 宽"被用户否了；兜底库（IndexedDB 不可用时的避风港）
     **原图直存**。容量问题靠 IDB 主库（配额 GB 级）+ 4s 打开超时（idb.js）解决；
     localStorage 的 5MB 只在 IDB 真不可用时才受制，用户接受这个取舍。 */
  function imgLsSet(key, dataUrl) {
    try {
      if (String(dataUrl || '').length > LS_IMG_MAX) return false;   // 只卡单张：一张就能吃满配额的才不收
      localStorage.setItem(LS_IMG_PREFIX + key, dataUrl);
      return true;
    } catch (e) { return false; }        // 配额满 → 交给上层报"没存下"
  }
  function imgLsBytes() {
    let n = 0;
    try {
      const keys = imgLsKeys();
      for (let i = 0; i < keys.length; i++) n += (localStorage.getItem(LS_IMG_PREFIX + keys[i]) || '').length;
    } catch (e) {}
    return n;
  }
  function imgLsGet(key) {
    try { return localStorage.getItem(LS_IMG_PREFIX + key) || null; } catch (e) { return null; }
  }
  function imgLsKeys() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(LS_IMG_PREFIX) === 0) out.push(k.substring(LS_IMG_PREFIX.length));
      }
    } catch (e) {}
    return out;
  }
  /* 统一写图：IDB 优先，失败/不可用就落到 localStorage 那张兜底表（原图直存，不降质）。
     返回标记字符串（'idb:xxx' 或 'ls:xxx'），两边都没写成 → null（调用方要报出来）。 */
  function setImageAsync(key, dataUrl) {
    if (useIdb && IMG) {
      let p;
      try { p = IMG.set(key, dataUrl); } catch (e) { p = null; }
      if (p && typeof p.then === 'function') {
        return p.then(function (okv) { return okv ? (MARK + key) : (imgLsSet(key, dataUrl) ? (MARK_LS + key) : null); },
                      function () { return imgLsSet(key, dataUrl) ? (MARK_LS + key) : null; });
      }
      if (p) return Promise.resolve(MARK + key);
    }
    return Promise.resolve(imgLsSet(key, dataUrl) ? (MARK_LS + key) : null);
  }
  /* 把已经内嵌在 meta 里的图搬进兜底库（meta 写不进去时的急救），返回搬成功的张数 */
  async function rescueInlineImages(meta) {
    let moved = 0;
    const all = [];
    (meta || []).forEach(function (deck) {
      if (!deck) return;
      if (typeof deck.backImage === 'string' && deck.backImage.indexOf('data:') === 0) all.push({ obj: deck, key: 'backImage' });
      (deck.cards || []).forEach(function (c) {
        if (!c) return;
        if (typeof c.image === 'string' && c.image.indexOf('data:') === 0) all.push({ obj: c, key: 'image' });
        if (typeof c.imageHi === 'string' && c.imageHi.indexOf('data:') === 0) all.push({ obj: c, key: 'imageHi' });
      });
    });
    for (const f of all) {
      const v = f.obj[f.key];
      const key = uid('img');
      const marker = await setImageAsync(key, v);
      if (marker) { rememberImage(marker, v); f.obj[f.key] = marker; moved++; }
    }
    return moved;
  }

  // 装载本地元数据(可能含 idb: 标记), 并异步取回图片
  async function initImages() {
    if (readyPromise) return readyPromise;
    readyPromise = (async function () {
      // ★ 顺手要一下"持久化存储"：拿不到也不影响用，但拿到了就不容易被系统在存储紧张时回收
      //   （猫卡的图都在 IndexedDB 里，"被回收"就等于丢图）。
      try {
        if (global.navigator && navigator.storage && navigator.storage.persist) navigator.storage.persist();
      } catch (e) {}
      if (IMG) { try { useIdb = await IMG.ensure(); } catch (e) { useIdb = false; } }
      loadDecks();
      const hyd = await hydrateImages();   // 一次性取回 + 逐字段备份兜底
      lastHydrate = hyd;
      // 这一趟没取回（库没打开成功）→ 说一声，但**数据一个都没动**，下次打开会自动重试
      if (hyd && hyd.skipped && hyd.total) {
        setTimeout(function () {
          try {
            const UI_ = global.MoKa && global.MoKa.ui;
            if (UI_ && UI_.toast) UI_.toast('图片这次没取回来（' + hyd.total + ' 张，数据没动），下次打开会自动重试');
          } catch (e) {}
        }, 1500);
      }
      return hyd;                        // ★ 返回本次补水结果，调用方能看到"补回几张/缺几张"
    })();
    return readyPromise;
  }
  function ready() { return readyPromise || initImages(); }

  /* 缩略牌背：选牌台 / 占卜桌 / 牌库 三处**小牌背**用「默认」还是「个性图片」
     （2026-09-20 用户要的开关）。own = 有自己放的牌背图就显示它（默认）；default = 一律默认样子。
     ★ 只影响这三处的缩略背；**翻开的那张牌**永远用这副牌组自己的牌背。 */
  var THUMB_BACK_KEY = 'moka.thumbBack';
  function getThumbBack() {
    try { return localStorage.getItem(THUMB_BACK_KEY) === 'default' ? 'default' : 'own'; }
    catch (e) { return 'own'; }
  }
  function setThumbBack(v) {
    v = (v === 'default') ? 'default' : 'own';
    try { localStorage.setItem(THUMB_BACK_KEY, v); } catch (e) {}
    return v;
  }

  /* 遍历所有牌组把 idb: 标记换成真实图片（一次全量拉取, 大量图片也快）;
     个别缺失时用 .bak 内嵌备份"逐字段"恢复, 不整份回滚。
     ★★ 2026-09-18 修的大坑（用户报"经常丢图"）：**读不到 ≠ 图没了**。
        原来自这里下去，只要"图片库这一趟没读成"（IndexedDB 打开超时 / 读游标报错），
        bucket 就是空的 → 每个 idb: 引用都被当成"图没了" → 置成 null →
        下一次任何落盘（改个名字、编辑一张卡）就把 null 写进 localStorage ——
        **图其实还好好躺在库里，引用却被写死了**。这就是"图会莫名其妙消失"的元凶。
        现在：库没打开成功、或取回失败 → **一个引用都不动**，留着标记等下次启动再取。 */
  async function hydrateImages() {
    const decks = cache || [];
    const wants = [];
    decks.forEach(function (deck) {
      if (!deck) return;
      const add = function (obj, key) {
        const v = obj[key];
        if (v && (v.indexOf(MARK) === 0 || v.indexOf(MARK_LS) === 0)) {
          wants.push({ deck: deck, obj: obj, key: key, marker: v });
        }
      };
      add(deck, 'backImage');
      (deck.cards || []).forEach(function (c) { if (c) { add(c, 'image'); add(c, 'imageHi'); } });
    });
    if (!wants.length) { imagesHydrated = true; return { skipped: false, missing: 0, total: 0 }; }

    // ★ 库没打开成功 / 取回失败 → 一个引用都不动（见上面那段注释）。
    //   ⚠ 但 `ls:` 标记的图**不归 IDB 管**，它们就躺在 localStorage 兜底库里，
    //     所以 IDB 不可用时不能整趟跳过 —— 下面仍要把 ls: 那些取回来。
    const bucket = (IMG && useIdb) ? await IMG.all() : null;
    const idbDown = (bucket == null);

    // 备份索引(按 deckId)
    let bakDecks = null;
    try {
      const raw = localStorage.getItem(LS_DECKS + '.bak');
      if (raw) { const b = JSON.parse(raw); if (Array.isArray(b)) { bakDecks = {}; b.forEach(function (dk) { if (dk) bakDecks[dk.id] = dk; }); } }
    } catch (e) { bakDecks = null; }

    let missing = 0;
    let skippedIdb = 0;      // 这一趟因为"图库没打开"而原样留着的引用数（见下面 idbDown 那条）
    wants.forEach(function (w) {
      // 'ls:' 标记 → 直接去 localStorage 兜底库拿（不经过 IDB）
      if (w.marker.indexOf(MARK_LS) === 0) {
        const lv = imgLsGet(w.marker.substr(MARK_LS.length));
        if (typeof lv === 'string' && lv.indexOf('data:') === 0) {
          rememberImage(w.marker, lv);
          w.obj[w.key] = lv;
        } else {
          missing++;
          w.obj[w.key] = null;     // 兜底库里也没有 → 真的没了
        }
        return;
      }
      // 'idb:' 标记，而图库这一趟没打开 → **一个引用都不动**，留给下次启动
      if (idbDown) { skippedIdb++; return; }
      const key = w.marker.substr(MARK.length);
      const val = bucket[key];
      if (typeof val === 'string') {
        rememberImage(w.marker, val);
        w.obj[w.key] = val;
        return;
      }
      // 缺失: 尝试从备份逐字段恢复
      let alt = null;
      const bd = bakDecks ? bakDecks[w.deck.id] : null;
      if (w.obj === w.deck) { if (bd) alt = bd.backImage || null; }
      else {
        const bc = bd && (bd.cards || []).find(function (c) { return c.id === w.obj.id; });
        // 按字段名取，image / imageHi 都走这一条
        if (bc) alt = bc[w.key] || null;
      }
      if (typeof alt === 'string' && alt.indexOf('data:') === 0) {
        w.obj[w.key] = alt;
        // 备份救回的是内存里的图，不是已提交的存储地址；下次保存走正常写图路径。
      } else {
        missing++;
        w.obj[w.key] = null;   // 真没有可恢复来源: 置空, 后续持久化会清掉该标记
      }
    });
    if (missing > 0) {
      try {
        const UI_ = global.MoKa && global.MoKa.ui;
        if (UI_ && UI_.toast) UI_.toast('有 ' + missing + ' 张图片未能恢复（可能已被系统清理），建议用导出备份');
      } catch (e) {}
    }
    /* ★★ 2026-10-15 修（两条同源）：
       ① `skipped` 原来是**硬编码 false**，全文没有一处把它设成 true ——
          而 initImages 里那句"图片这次没取回来（数据没动），下次打开会自动重试"
          的触发条件正是 `hyd.skipped`：**那条唯一的提示是死代码**。
          用户这次开机图全看不见，界面上一个字都没有。
       ② `imagesHydrated` 原来无条件置 true：图库没打开时内存里全是 `idb:` 标记、
          一张真图都没补回来，却照样被宣告"图片已补回内存" ——
          于是 persist 里 `if (imagesHydrated)` 成立，`.bak`（丢图时最后一道防线）
          被写成一串标记，把上一份含真图的备份就地覆盖掉。 */
    imagesHydrated = (skippedIdb === 0);
    if (skippedIdb > 0) {
      return { skipped: true, idbDown: true, missing: missing, total: wants.length, skippedCount: skippedIdb };
    }
    return { skipped: false, idbDown: false, missing: missing, total: wants.length, skippedCount: 0 };
  }

  /* 默认牌组的符号图：名字 → 图（assets/sym/*.svg，2026-09-18）
     ★ 为什么要迁移：符号是新加的能力，而**已经装过 App 的人牌组早就存在 localStorage 里**了，
       重新 seed 不会发生 → 不补这一刀，他们的默认牌永远看不到符号。
       只补"名字对得上默认那 12 个 + 还没有图"的卡，绝不碰用户自己建的卡。 */
  /* ★ 2026-09-20 打扫：这里原来还有**手抄的一份** DEFAULT_SYM（12 个名字→符号）和一个
     SYM_BY_GLYPH 字形兜底表。手抄那份会**覆盖**上面从注册表派生的那份 —— 两份内容当时一致，
     但留着就是两个真源（改注册表不会生效）。现在只留派生的那一份；字形兜底表早就没人调用了
     （它正是「自己建的卡凭空长出一颗星」的来源），一并删掉。 */
  function migrateSymbolImgs(decks) {
    var n = 0;
    (decks || []).forEach(function (dk) {
      if (!dk || !Array.isArray(dk.cards)) return;
      dk.cards.forEach(function (c) {
        if (!c || c.symbolImg) return;
        // ★ 只按**名字**补（星语那 12 张）。这里原来还有一条 `|| SYM_BY_GLYPH[c.symbol]`，
        //   于是任何 symbol 是 '✦' 的卡都会被补成 star4 —— 用户自己的卡就是这么长出一颗星的。
        var f = DEFAULT_SYM[c.name];
        if (f) { c.symbolImg = 'assets/sym/' + f + '.svg'; n++; }
      });
    });
    return n;
  }
  var _symFixed = false;
  function repairSymbolImgs() {
    if (_symFixed || !Array.isArray(cache)) return;
    _symFixed = true;
    if (migrateSymbolImgs(cache)) persist();
  }

  /* ★ 2026-09-21：下架的边框模板 id → 现在还在的那个。
     「斜纹」和「竖纹」在真机上来回切看不出区别，用户让把斜纹删了（v3.css / library.js 里
     那一款也删了）。但**老装机上已经有牌组存着 backTemplate:'diag'** —— 光删模板表不够：
     ui.js 照样会把 `is-tpl-diag` 写到牌背上，而 CSS 里已经没有那一款的画法，
     那些牌组会静默退化成"没有边框"（用户会以为又丢了一次设定）。
     所以在这里把它们接到「竖纹」上：显示上等于原来那条线还在，只是换了个画法。
     幂等：跑第二次一个都改不到。 */
  var DROPPED_BACKS = { diag: 'stripe' };
  function migrateDroppedBacks(decks) {
    var n = 0;
    (decks || []).forEach(function (dk) {
      if (!dk) return;
      var to = DROPPED_BACKS[dk.backTemplate];
      if (to) { dk.backTemplate = to; n++; }
    });
    return n;
  }
  var _backFixed = false;
  function repairDroppedBacks() {
    if (_backFixed || !Array.isArray(cache)) return;
    _backFixed = true;
    if (migrateDroppedBacks(cache)) persist();
  }

  /* ★★ 2026-10-15 重写 loadDecks 的"新装机"判据（旧写法会把用户数据盖掉）。
     旧判据是「解析结果不是非空数组」，于是两条真实路径都中招：
       ① 盘上的 JSON 读坏了（写盘被打断 / 存储异常）→ catch 把 cache 置 null
          → 直接 seed 内置牌组并 persist()，**把损坏的原数据就地覆盖** ——
          隔壁 `.bak` 全内嵌备份明明在，一次都没试过，用户连取证机会都没有；
       ② 用户把牌组删光是**合法操作**（盘上留下 `"[]"`）→ 重启被判成新装机。
     新判据：「**键不存在**」才是新装机 —— 和同文件 readOnTable 一直是同一套写法。
     键在、但读不出来 → 急救三件事：留残档 → 试 `.bak` → 都不行就进"只读态"（绝不写盘）。
     ⚠ 这就是 §2 第 1 条的老教训又犯了一次：**别拿"数据长什么样"当身份判据**。 */
  let _rescueReadonly = false;      // 数据读不出来 → 本次会话只读（persist 直接短路）
  let _rescueWarned = false;        // 只读警示只报一次，别每次 persist 都刷
  function rescueBrokenDecks(raw) {
    _rescueReadonly = true;
    // ① 留证：原文另存一份（配额满就存不下，尽力而为，绝不因为它失败而中断）
    try { localStorage.setItem(LS_DECKS + '.broken.' + Date.now(), raw); } catch (e) {}
    // ② 试备份：`.bak` 是"全内嵌图"那一份，结构完全一致，能顶上就直接用
    let bak = null;
    try {
      const b = localStorage.getItem(LS_DECKS + '.bak');
      if (b) { const j = JSON.parse(b); if (Array.isArray(j) && j.length) bak = j; }
    } catch (e) { bak = null; }
    try {
      const UI_ = global.MoKa && global.MoKa.ui;
      if (bak) {
        _rescueReadonly = false;      // 救回来了 → 允许继续写盘（等于把它迁回主键）
        if (UI_ && UI_.toast) UI_.toast('牌组数据读不出来，已从备份恢复（原数据留了一份残档）', 4000);
      } else if (UI_ && UI_.toast) {
        UI_.toast('牌组数据读不出来，已切到只读保护：先别改东西，请先导出取证', 6000);
      }
    } catch (e) {}
    return bak;
  }
  function loadDecks() {
    if (cache) return cache;
    let raw = null;
    try { raw = localStorage.getItem(LS_DECKS); } catch (e) { raw = null; }
    if (raw == null) {
      /* 新装机：按注册表建 seed !== false 的内置牌组（顺序 = order）。
         ★ seed === false 的（星语牌组）：**新装机不再建**（用户 2026-09-20：
           "星语牌组删掉吧，本来就是试用的"），但它的身份表还留在注册表里 ——
           所以老装机上那副的 12 个星形符号不会被 cleanFakeSymbols 当成假符号清掉。 */
      cache = BUILTIN.filter(function (e) { return e.seed !== false; })
                     .map(builtinDeck).filter(Boolean);
      persist();
    } else {
      /* 键在。**空数组也是合法状态**（用户把牌组删光了），不能替他"恢复"；
         读不出来才走急救（留证 → 试备份 → 只读）。 */
      let parsed = null, parseOk = true;
      try { parsed = JSON.parse(raw); } catch (e) { parseOk = false; }
      if (parseOk && Array.isArray(parsed)) cache = parsed;
      else cache = rescueBrokenDecks(raw) || [];
    }
    repairCardIds();
    repairSymbolImgs();
    repairDroppedBacks();
    ensureBuiltinDecks();
    return cache;
  }

  // 老版本把卡片的 id 丢过一次(withCardStyle 漏拷 id)，已经存进 localStorage 的牌组
  // 只能就地补回来；否则那些卡在牌堆里"看得见、抽不出来"。
  var _repaired = false;
  function repairCardIds() {
    if (_repaired || !Array.isArray(cache)) return;
    _repaired = true;
    var seen = {}, fixed = 0;
    cache.forEach(function (dk) {
      if (!dk || !Array.isArray(dk.cards)) return;
      dk.cards.forEach(function (c) {
        if (!c) return;
        if (typeof c.id !== 'string' || !c.id || seen[c.id]) { c.id = uid('card'); fixed++; }
        seen[c.id] = 1;
      });
    });
    if (fixed) {
      console.warn('修复了 ' + fixed + ' 张缺失/重复 id 的卡');
      persist();
    }
  }

  // 构造存盘副本: 图片字段改为 idb: 标记(新图先写 IDB); 失败的单张自动回退内嵌
  async function buildMeta() {
    const meta = clone(cache);
    const writes = [];
    let unresolvedImgs = 0;      // 图片两边都没存下的张数（调用方要报出来，别静默）
    (meta || []).forEach(function (deck) {
      const fields = [];
      if (deck && deck.backImage) fields.push({ obj: deck, key: 'backImage' });
      (deck && deck.cards || []).forEach(function (c) {
        if (!c) return;
        if (c.image) fields.push({ obj: c, key: 'image' });
        // ★ 高清大图必须一起换成 idb: 标记。漏了它 → 裸 dataURL 被 JSON 进 localStorage
        //   → 直接撑爆 5MB 上限 → 整个存盘失败（这是加这个功能最容易踩的坑）。
        if (c.imageHi) fields.push({ obj: c, key: 'imageHi' });
      });
      fields.forEach(function (f) {
        const v = f.obj[f.key];
        if (typeof v !== 'string') return;
        if (v.indexOf(MARK) === 0 || v.indexOf(MARK_LS) === 0) { /* 已是标记 */ return; }
        if (v.indexOf('data:') !== 0) return;
        /* ★ 2026-09-27：包内自带的图**不落盘**（见 BUNDLED_IMGS 的注释）。
           写成 null 而不是留 data: —— 留 data: 会跟着 meta 进 localStorage，几百 KB 直接顶配额。 */
        if (BUNDLED_IMGS[v]) { f.obj[f.key] = null; return; }
        const oldM = revMap.get(v);
        if (oldM) { f.obj[f.key] = oldM; return; }
        const key = uid('img');
        /* ★ 2026-09-21：这里原来写的是 `if (!useIdb) return;`（IDB 不可用就保持内嵌）——
           那正是"整份 meta 写不进 localStorage"的来源。现在无论 IDB 在不在，
           都往"标记 + 图片另存"这条路上走：IDB 不行就落 localStorage 兜底库。 */
        writes.push(setImageAsync(key, v).then(function (marker) {
          if (marker) { rememberImage(marker, v); f.obj[f.key] = marker; }
          else { unresolvedImgs++; }        // 两边都没存下 → 下一段落盘会明确报出来
        }));
      });
    });
    await Promise.all(writes);
    return { meta: meta, unresolvedImgs: unresolvedImgs };
  }

  let persistChain = Promise.resolve();   // 串行化写盘(图片走 IDB 是异步的)
  /* ★ 2026-09-21：写盘要**能报出结果**了。
     原来 persist() 把所有失败都吞在内部（只 toast 一句，还排在"已保存/已导入"后面），
     调用方一律以为写成功了 —— 内存和库就这么静默分叉，重启整体回退。
     现在返回 { ok, metaOk, bakOk, unresolvedImgs, err }，并把失败通过 onPersistError
     通知外壳（app.js 挂一条常驻黄条），用户当场就知道"这次没存上"。 */
  let lastSaveStatus = { ok: true, metaOk: true, bakOk: true, unresolvedImgs: 0, err: null };
  let _bakSkipLogged = false;      // 急救路径只在极端情况下走，日志别刷屏
  const persistErrorHandlers = [];
  function onPersistError(fn) { if (typeof fn === 'function') persistErrorHandlers.push(fn); }
  function emitPersistError(st) {
    persistErrorHandlers.forEach(function (fn) { try { fn(st); } catch (e) {} });
  }

  function persist() {
    /* ★ 2026-10-15：数据读不出来（只读急救态）→ 这一步**绝不能写盘**。
       否则 loadDecks 的急救分支一跑，损坏的原数据就被就地覆盖了 —— 那正是要防的事。
       警示走和普通写失败同一个出口（黄条 + onPersistError），只报一次。 */
    if (_rescueReadonly) {
      if (!_rescueWarned) {
        _rescueWarned = true;
        lastSaveStatus = { ok: false, metaOk: false, bakOk: false, unresolvedImgs: 0, err: new Error('rescue-readonly') };
        emitPersistError(lastSaveStatus);
      }
      return Promise.resolve(lastSaveStatus);
    }
    // ⚠ 这里必须把「返回 Promise 的函数」交给 .then，不能把已经执行起来的 Promise 塞进去：
    //   const doIt = (async()=>{...})();  → doIt 立刻开始跑，.then 只是把它取回来，
    //   于是每次 persist() 都是并发写盘（注释写着"串行化"其实没生效）。
    //   并发时两路 buildMeta 会同时写 IDB，且各自的"清理孤儿图片"可能删掉另一路刚写的图。
    const doIt = function () {
      return (async function () {
        let meta = null, unresolvedImgs = 0;
        try {
          const built = await buildMeta();
          meta = built.meta;
          unresolvedImgs = built.unresolvedImgs || 0;
        } catch (e) {
          console.error('构造存盘数据失败', e);
          lastSaveStatus = { ok: false, metaOk: false, bakOk: false, unresolvedImgs: 0, err: e };
          emitPersistError(lastSaveStatus);
          return lastSaveStatus;
        }
        const metaTxt = JSON.stringify(meta);
        let metaOk = false;
        try { localStorage.setItem(LS_DECKS, metaTxt); metaOk = true; }
        catch (metaErr) {
          /* meta 写不进（几乎只有"图片被内嵌进 meta 撑爆 5MB"这一种）→ 急救：
             把内嵌的图逐张搬到 localStorage 的兜底库（`ls:` 标记），让 meta 瘦下来再写一次。
             这一步以前没有 —— 于是配额一满，**整个会话的改动全部静默丢失**。 */
          try {
            const moved = await rescueInlineImages(meta);
            const leanTxt = JSON.stringify(meta);
            if (moved > 0) {
              if (!_bakSkipLogged) console.warn('meta 写不进，已把 ' + moved + ' 张图搬到兜底库', metaErr);
              try { localStorage.setItem(LS_DECKS, leanTxt); metaOk = true; }
              catch (e2) { metaOk = false; }
            }
            if (!metaOk) console.error('保存 meta 失败（急救后仍不行）', metaErr);
          } catch (e3) { console.error('保存 meta 失败（急救过程出错）', e3); }
        }
        /* 保险1: 容量允许时再留一份"全内嵌"备份, 供 IDB 意外读不到时恢复。
           ★ 只有当图片**真的补回内存**了才写：不然写进去的是一串 idb: 标记，
             会把上一份能救命的备份覆盖掉（迁移先落盘就会这样，实测踩到）。 */
        let bakOk = true;
        try {
          if (metaOk && imagesHydrated) {
            // 用本趟提交的快照恢复内嵌图，避免把等写盘期间的新编辑混进备份。
            const inline = clone(meta);
            inline.forEach(function (deck) {
              if (!deck) return;
              function inlineImage(obj, key) {
                if (imgMap.has(obj[key])) obj[key] = imgMap.get(obj[key]);
              }
              inlineImage(deck, 'backImage');
              (deck.cards || []).forEach(function (card) {
                if (card) { inlineImage(card, 'image'); inlineImage(card, 'imageHi'); }
              });
            });
            const inlineTxt = JSON.stringify(inline);
            /* ★ 2026-09-23 回退记录：这里一度把上限从 4MB 收到 1MB、还加了"总占用>4MB 就不写" ——
               理由是怀疑存储被顶满导致签文写不进去。用户不接受（少一份救命备份），已退回原样。 */
            if (inlineTxt.length <= 4 * 1024 * 1024) {
              localStorage.setItem(LS_DECKS + '.bak', inlineTxt);
            } else {
              bakOk = false;              // 太大写不下 → 报出来（这份备份是丢图时的最后一道）
            }
          }
        } catch (bakErr) { bakOk = false; }
        // 只按成功提交的主记录清理；写失败时，上次保存仍引用旧图。
        if (metaOk) try {
          const refs = {}, lsRefs = {};
          (meta || []).forEach(function (dk) {
            if (!dk) return;
            const note = function (v) {
              if (typeof v !== 'string') return;
              if (v.indexOf(MARK) === 0) refs[v] = 1;
              else if (v.indexOf(MARK_LS) === 0) lsRefs[v.substr(MARK_LS.length)] = 1;
            };
            note(dk.backImage);
            (dk.cards || []).forEach(function (c) {
              if (!c) return;
              /* ★ 2026-09-18 补：**imageHi 也必须算引用**。
                 原来这里只收 image，于是每次落盘都会把刚写进去的高清大图当"孤儿"删掉
                 （写了 → 同一趟就被删 → 下次启动读不到 → 丢图）。
                 谁"清孤儿"，谁就得把**所有**图片字段列全 —— 这是第二次踩"白名单漏字段"了。 */
              note(c.image); note(c.imageHi);
            });
          });
          if (IMG && useIdb) {
            const allKeys = await IMG.keys();
            await Promise.all(allKeys.filter(k => !refs[MARK + k]).map(async function (k) {
              // 下一趟 persist 开始前，删除和索引失效都要结束。
              forgetImage(MARK + k);
              try { await IMG.remove(k); } catch (e) {}
            }));
          }
          // localStorage 兜底库同样要清（它只放得下小图，更容易被塞满）
          imgLsKeys().forEach(function (k) {
            if (!lsRefs[k]) {
              forgetImage(MARK_LS + k);
              try { localStorage.removeItem(LS_IMG_PREFIX + k); } catch (e) {}
            }
          });
        } catch (e3) { /* 清理失败不影响主流程 */ }

        const ok = metaOk;
        lastSaveStatus = { ok: ok, metaOk: metaOk, bakOk: bakOk, unresolvedImgs: unresolvedImgs, err: null };
        /* ★★ 2026-10-15：**成功也要通知**（原来只在失败时 emit）。
           订阅方（app.js 的 #save-warn）靠"看到一次成功就把黄条收起来"，
           可成功从来不通知 → 那个"收起"分支**永远不可能执行**：
           黄条一旦出现就挂到用户手动点掉为止，挂久了人就脱敏，
           真警告也会被当成"又来了"（§5 要的是"写失败必须看得见"，不是"永远看得见"）。
           函数名仍叫 emitPersistError（外部只有 app.js 一处订阅，改名牵动太多），
           但语义已经是"每次落盘结果都通知一次"。 */
        emitPersistError(lastSaveStatus);
        /* ★ 顺手把结果落一个轻量键：lastSaveStatus 是模块级变量、冷启动恒为初值 {ok:true}，
           所以 app.js 首屏那句"上次就没存上、一进来就该看到"一直是空转。 */
        try {
          localStorage.setItem(LS_LAST_SAVE, JSON.stringify({
            ok: ok, metaOk: metaOk, bakOk: bakOk, unresolvedImgs: unresolvedImgs, t: Date.now()
          }));
        } catch (e0) {}
        return lastSaveStatus;
      })();
    };
    // 前一次失败也要继续排后面的（否则一次写失败会把后续写盘全卡住）
    persistChain = persistChain.then(doIt, doIt);
    return persistChain;
  }
  function flushPersist() {
    return _rescueReadonly ? Promise.resolve(lastSaveStatus) : persistChain;
  }

  /* ---------- 变更通知 ---------- */
  const listeners = [];
  function subscribe(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  /* ---------- 牌组操作 ---------- */
  function listDecks(includeHidden) {
    var d = loadDecks();
    if (!includeHidden) d = d.filter(function (x) { return !x || !x.hidden; });
    return clone(d);
  }
  function findDeck(id) { return loadDecks().find(d => d.id === id); }

  /* ---------- 「哪些牌组上占卜桌」（本地设置，不入牌组数据） ----------
   * 规则：
   *   · 键不存在（老用户第一次升级上来）→ **所有现有牌组都视为已勾选**（否则占卜桌会突然空掉）
   *   · 新建 / 克隆 / 导入进来的牌组 → **默认勾上**
   *   · 删牌组 → 顺手从列表里去掉
   *   · 允许一个都不勾（占卜桌会给引导）
   * ---------------------------------------------------------- */
  function readOnTable() {
    try {
      const raw = localStorage.getItem(LS_ON_TABLE);
      if (raw == null) return null;               // 从没设置过 → 走迁移
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) { return null; }
  }
  function writeOnTable(ids) {
    try { localStorage.setItem(LS_ON_TABLE, JSON.stringify(ids)); } catch (e) {}
    return ids;
  }
  function tableDeckIds() {
    const decks = loadDecks();
    const all = decks.map(function (d) { return d.id; });
    let ids = readOnTable();
    if (ids == null) { ids = decks.filter(function (d) { return !d.hidden; }).map(function (d) { return d.id; }); writeOnTable(ids); return ids; }   // 迁移：默认全选（hidden 牌组不上桌）
    const clean = ids.filter(function (id) { return all.indexOf(id) >= 0; }); // 顺手清掉已删除的
    if (clean.length !== ids.length) writeOnTable(clean);
    return clean;
  }
  function isOnTable(id) { return tableDeckIds().indexOf(id) >= 0; }
  function setOnTable(id, on) {
    let ids = tableDeckIds();
    const has = ids.indexOf(id) >= 0;
    if (on && !has) ids.push(id);
    else if (!on && has) ids = ids.filter(function (x) { return x !== id; });
    writeOnTable(ids); emit();
    return isOnTable(id);
  }
  function setAllOnTable(on) {
    const ids = on ? loadDecks().filter(function (d) { return !d.hidden; }).map(function (d) { return d.id; }) : [];
    writeOnTable(ids); emit();
    return ids;
  }
  // 勾选的牌组，按牌库列表顺序（不额外维护顺序）
  function tableDecks() {
    const on = tableDeckIds();
    return loadDecks().filter(function (d) { return on.indexOf(d.id) >= 0; });
  }
  function addToTable(id) { const ids = tableDeckIds(); if (ids.indexOf(id) < 0) { ids.push(id); writeOnTable(ids); } }
  function removeFromTable(id) { writeOnTable(tableDeckIds().filter(function (x) { return x !== id; })); }

  function createDeck(name) {
    const d = { id: uid('deck'), name: name || '未命名牌组', createdAt: Date.now(), backImage: null, backTemplate: null, backColor: '#8a7a3a', useRev: false, hiRes: false, cards: [] };
    loadDecks().push(d); persist(); addToTable(d.id); emit(); return clone(d);   // 新建默认上桌
  }

  /* 把一张卡的「文字样式」复制给这副牌的其它所有卡（2026-09-20，用户要"整副一起调"）。
     ★ 只复制样式，不碰内容（名字/关键词/牌义/图片）—— 内容一个字都不会被覆盖。 */
  var STYLE_KEYS = ['nameVy','nameH','nameFs','nameBg','nameBgA','nameFont','nameBgStyle',
                    'kwVy','kwH','kwFs','kwBg','kwBgA','kwFont','kwBgStyle',
                    'autoFit','nameWeight','kwWeight','nameOn','kwOn',
                    'faceBg','faceEdge','faceTex','faceTexA','nameColor','kwColor',
                    'imgScale','imgX','imgY','imgFilter'];
  function takeDeckStyles(deckId, exceptId) {
    const dk = findDeck(deckId);
    if (!dk || !Array.isArray(dk.cards)) return null;
    return dk.cards.filter(function (card) { return card && (!exceptId || card.id !== exceptId); }).map(function (card) {
      const values = {};
      STYLE_KEYS.forEach(function (key) { values[key] = card[key]; });
      return { id: card.id, values: values };
    });
  }
  function restoreDeckStyles(deckId, snapshot, exceptId) {
    const dk = findDeck(deckId);
    if (!dk || !Array.isArray(dk.cards) || !Array.isArray(snapshot)) return false;
    const byId = new Map(snapshot.map(function (item) { return [item.id, item.values]; }));
    dk.cards.forEach(function (card) {
      if (!card || (exceptId && card.id === exceptId)) return;
      const values = byId.get(card.id);
      if (values) STYLE_KEYS.forEach(function (key) { card[key] = values[key]; });
    });
    persist(); emit();
    return true;
  }
  // 把一份"样式"写到整副牌的所有卡（除了 exceptId）
  function applyStyleToDeck(deckId, style, exceptId) {
    const dk = findDeck(deckId);
    if (!dk || !Array.isArray(dk.cards) || !style) return 0;
    let n = 0;
    dk.cards.forEach(function (c) {
      if (!c || (exceptId && c.id === exceptId)) return;
      STYLE_KEYS.forEach(function (k) { c[k] = style[k]; });
      n++;
    });
    persist(); emit();
    return n;
  }
  function applyCardStyleToDeck(deckId, cardId) {
    const dk = findDeck(deckId);
    if (!dk || !Array.isArray(dk.cards)) return 0;
    const src = dk.cards.find(function (c) { return c && c.id === cardId; });
    if (!src) return 0;
    return applyStyleToDeck(deckId, withCardStyle(src), cardId);
  }

  function renameDeck(id, name) {
    const d = findDeck(id); if (!d) return null;
    d.name = name; persist(); emit(); return clone(d);
  }

  function deleteDeck(id) {
    const decks = loadDecks();
    const i = decks.findIndex(d => d.id === id);
    if (i < 0) return false;
    decks.splice(i, 1); removeFromTable(id); persist(); emit(); return true;   // 删了就从上桌列表去掉
  }


  // 导入: 把一组外部卡追加进某牌组(卡全部换新 id)
  function appendCardsToDeck(deckId, cards) {
    const d = findDeck(deckId); if (!d) return false;
    (cards || []).forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      var nc = withCardStyle(Object.assign({}, c));
      nc.id = uid('card');
      d.cards.push(nc);
    });
    /* ★ 追加进来的卡也要走那道清理（不是内置那副的话，卡上指着某个符号的图按它自己的
       symbol 认回来）。**这条路径上一版漏了** —— 用户的"导入 → 追加到当前牌组"就是走这里，
       于是牌面上还是那个索维鲁符文（2026-09-18 用户第二次报上来）。 */
    cleanFakeSymbols([d]);
    persist(); emit(); return true;
  }

  // 导入: 生成不重名的牌组名 (名字(2)/名字(3)…)
  function uniqueDeckName(base) {
    base = String(base || '未命名牌组').trim();
    const decks = loadDecks();
    const names = {};
    decks.forEach(function (d) { names[d.name] = true; });
    if (!names[base]) return base;
    let i = 2;
    while (names[base + '(' + i + ')']) i++;
    return base + '(' + i + ')';
  }

  // 导入: 新建一个牌组(含外部牌与牌背设置), 名字撞名时系统式加序号
  function importDeck(deckObj) {
    if (!deckObj || !Array.isArray(deckObj.cards)) return null;
    const copy = {
      id: uid('deck'),
      name: uniqueDeckName(deckObj.name),
      createdAt: Date.now(),
      backImage: deckObj.backImage || null,
      backTemplate: deckObj.backTemplate || null,
      backColor: deckObj.backColor || '#8a7a3a',
      // ★ 2026-09-21：纸边两个开关随导入一起走（缺字段的老包 → 按默认"开"）
      backEdge: deckObj.backEdge !== false,
      faceEdge: deckObj.faceEdge !== false,
      useRev: !!deckObj.useRev,
      hiRes: !!deckObj.hiRes,          // 牌组级：是否存高清大图（随导出/导入一起走）
      cards: (deckObj.cards || []).map(function (c) {
        var nc = withCardStyle(Object.assign({}, c));
        nc.id = uid('card');
        return nc;
      })
    };
    cleanFakeSymbols([copy]);                                          // 导入进来的也顺手清一遍
    loadDecks().push(copy); addToTable(copy.id); persist(); emit();   // 克隆出来的也默认上桌
    return clone(copy);
  }

  // 设置牌组是否启用“正逆位”
  function setUseRev(deckId, on) {
    const d = findDeck(deckId); if (!d) return false;
    d.useRev = !!on;
    persist(); emit();
    return true;
  }

  // 设置牌组是否「存牌面高清大图」（默认关）。
  // 只管"之后新选/重裁的图" —— 已经存过的小图不会因此变清晰，也补不出大图。
  function setDeckHiRes(deckId, on) {
    const d = findDeck(deckId); if (!d) return false;
    d.hiRes = !!on;
    persist(); emit();
    return true;
  }

  // 按"牌堆"为单位克隆整副牌组(所有猫卡一并复制, 全部换新 id)
  function cloneDeck(deckId) {
    const d = findDeck(deckId);
    if (!d) return null;
    // 统计同名牌堆已有几副, 决定副本序号
    const decks = loadDecks();
    const base = d.name.replace(/\s*[·×x]\d+\s*$/, '');
    const same = decks.filter(x => x.name === d.name || x.name.indexOf(base + ' ·') === 0).length;
    const copy = {
      id: uid('deck'),
      name: base + ' ·' + (same + 1),
      createdAt: Date.now(),
      backImage: d.backImage || null,
      backTemplate: d.backTemplate || null,
      backColor: d.backColor || '#8a7a3a',
      // ★ 2026-09-21：**纸边两个开关也要克隆**。原来漏了 → 用户把纸边关掉再克隆，
      //   副本又变回"开"（UI 按 `!== false` 判，undefined 就是开）—— 正是这个项目
      //   反复踩的"白名单漏字段：草稿还在、落盘就丢"。以后加牌组级字段记得三处一起加：
      //   这里、importDeck、io.js 的 buildSingleJson / buildZipManifest / hydrate*。
      backEdge: d.backEdge !== false,
      faceEdge: d.faceEdge !== false,
      useRev: !!d.useRev,
      hiRes: !!d.hiRes,
      cards: d.cards.map(function (c) {
        return Object.assign({}, c, { id: uid('card') });
      })
    };
    decks.push(copy); addToTable(copy.id);   // 导入进来的也默认上桌
    persist(); emit();
    return clone(copy);
  }

  /* ---------- 猫卡操作 ---------- */
  function addCard(deckId, fields) {
    const d = findDeck(deckId); if (!d) return null;
    const palette = MoKa.data.pickPalette();
    var card = withCardStyle(Object.assign({
      id: uid('card'),
      name: '未命名之卡', keyword: '', symbol: '',      // ★ 不给默认符号：没身份的卡就是没有徽记
      faceText: '', meaning: '',
      color: palette[d.cards.length % palette.length],
      image: null
    }, fields));
    card.id = uid('card');
    d.cards.push(card); persist(); emit(); return clone(card);
  }

  function updateCard(deckId, cardId, fields) {
    const d = findDeck(deckId); if (!d) return null;
    const c = d.cards.find(c => c.id === cardId); if (!c) return null;
    /* ★ 2026-09-21：内置卡被改名时，把**原名**记下来（renamedFrom）。
       内置牌组的内容同步是按"卡名"判下线/补齐的，用户把「力比多·投注」改成「投注」之后：
       同步找不到这个名字 → 当成"缺了"→ 把原版那张**又补一张**回来（36 → 37 张），
       而改名那张的插图还会被 cleanFakeSymbols 清掉。
       记下原名，同步就能认出"这张只是改了名，不是缺了"。 */
    if (fields && fields.name !== undefined && fields.name !== c.name) {
      const wasBuiltin = isBuiltinCardName(c.name);
      if (wasBuiltin) c.renamedFrom = wasBuiltin;
    }
    Object.assign(c, fields); persist(); emit(); return clone(c);
  }
  /* 这个名字是不是注册表里某张内置卡（用来判"用户改的是不是内置卡的名字"） */
  function isBuiltinCardName(name) {
    if (!name) return null;
    for (var i = 0; i < BUILTIN.length; i++) {
      var found = (BUILTIN[i].cards || []).filter(function (c) { return c && c.name === name; })[0];
      if (found) return name;
    }
    return null;
  }

  /* 把一张猫卡挪到指定位置（牌库手动排序，2026-09-18 用户选 G）
     ★ 说清楚它管什么：这里排的是**牌库里的顺序**（你翻牌组时看到的次序）。
       它**不等于抽牌顺序** —— 进选牌台仍然会自动洗一次（§32），抽到什么由洗牌决定。
       排序的意义是"找得到、看着顺"，以及以后真要做"按顺序发牌"时的地基。 */
  /* ★ 2026-10-01：**拖动瞬间的"顺序同步写回"**（用户拍板的方案：只保留一个真相源）。
     顺序的权威就是**牌组里的 cards 数组**（所以导出/导入/备份天然带着顺序，不需要额外维护）。
     但 `persist()` 是异步的：它要先 `await buildMeta()`（过图片/指纹，真机上几百 ms 到数秒），
     用户拖完顺序**紧接着清后台**时这一趟根本写不完 ⇒ 顺序丢（用户实测复现过两次）。
     所以拖动那一刻，**同步**把这份 payload 里"这副牌的 cards 顺序"重排一遍：
     只动顺序、不碰图片/指纹/任何其它字段，毫秒级完成 —— 清后台也来得及。
     张数对不上或 id 对不上（说明有增删）就不敢动，交回完整的 persist()。 */

  function persistOrderSync(deckId) {
    try {
      var d = findDeck(deckId);
      if (!d || !Array.isArray(d.cards)) { return false; }
      var raw = localStorage.getItem(LS_DECKS);
      if (!raw) { return false; }
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) { return false; }
      var target = null;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].id === deckId) { target = arr[i]; break; }
      }
      if (!target || !Array.isArray(target.cards)) { return false; }
      if (target.cards.length !== d.cards.length) {
        return false;
      }
      var byId = {};
      target.cards.forEach(function (c) { if (c && c.id) byId[c.id] = c; });
      var next = [];
      for (var k = 0; k < d.cards.length; k++) {
        var pc = byId[d.cards[k].id];
        if (!pc) { return false; }
        next.push(pc);
      }
      target.cards = next;
      localStorage.setItem(LS_DECKS, JSON.stringify(arr));
      return true;
    } catch (e) { return false; }
  }

  function moveCard(deckId, cardId, toIndex) {
    const d = findDeck(deckId); if (!d) return false;
    const from = d.cards.findIndex(c => c.id === cardId);
    if (from < 0) return false;
    let to = Math.round(Number(toIndex));
    if (!isFinite(to)) return false;
    to = Math.max(0, Math.min(d.cards.length - 1, to));
    if (to === from) return false;
    const one = d.cards.splice(from, 1)[0];
    d.cards.splice(to, 0, one);
    persistOrderSync(deckId);        // ★ 先同步把顺序写进盘（清后台也不怕），再走完整的异步 persist
    persist(); emit();
    return true;
  }

  function deleteCard(deckId, cardId) {
    const d = findDeck(deckId); if (!d) return false;
    const i = d.cards.findIndex(c => c.id === cardId);
    if (i < 0) return false;
    d.cards.splice(i, 1); persist(); emit(); return true;
  }

  // 克隆一张猫卡(插入到原卡后面), 名字自动带序号; 正式版可用作"快速做系列卡"
  function cloneCard(deckId, cardId) {
    const d = findDeck(deckId); if (!d) return null;
    const i = d.cards.findIndex(c => c.id === cardId);
    if (i < 0) return null;
    const src = d.cards[i];
    // 统计同前缀已有多少份, 决定克隆序号
    const base = src.name.replace(/\s*[·×x]\d+\s*$/, '');
    const copies = d.cards.filter(c => c.name === src.name || c.name.indexOf(base + ' ·') === 0).length;
    const card = Object.assign({}, src, {
      id: uid('card'),
      name: base + ' ·' + (copies + 1)
    });
    d.cards.splice(i + 1, 0, card);
    persist(); emit();
    return clone(card);
  }

  // 设置牌组牌背: { image, template, color } 可只传部分
  function setDeckBack(deckId, cfg) {
    const d = findDeck(deckId);
    if (!d) return false;
    if (cfg.image !== undefined) d.backImage = cfg.image || null;
    if (cfg.template !== undefined) d.backTemplate = cfg.template || null;
    if (cfg.color !== undefined) d.backColor = cfg.color || '#8a7a3a';
    // 纸边（2026-09-18）：每副牌组两个独立开关，都默认开
    //   backEdge = 牌背纸边 · faceEdge = 牌面纸边
    if (cfg.edge !== undefined) d.backEdge = !!cfg.edge;
    if (cfg.faceEdge !== undefined) d.faceEdge = !!cfg.faceEdge;
    persist(); emit();
    return true;
  }

  /* ---------- 当前牌组(记忆) ---------- */
  function exportDecks() { return clone(loadDecks()); }

  // 用导入的牌组整体替换；持久化失败(配额)时回滚并抛出
  function replaceDecks(list) {
    if (!Array.isArray(list)) throw new Error('bad-data');
    cleanFakeSymbols(list);             // 整库替换（导入备份）也走同一条清理
    const old = cache;
    cache = list;
    try { persist(); }
    catch (e) { cache = old; throw e; }
    emit();
    return true;
  }

  function getActiveDeckId() { return localStorage.getItem(LS_ACTIVE); }
  function setActiveDeckId(id) {
    if (id) localStorage.setItem(LS_ACTIVE, id);
    else localStorage.removeItem(LS_ACTIVE);
  }

    const PALETTE = ['#5b7cfa', '#8a5cf6', '#e2558c', '#f59f3e', '#2fb89a', '#e5484d', '#3e9ee8', '#a465c8', '#2b4bd0', '#8ab4f8', '#4caf7d', '#8a7cff', '#ff5fa2', '#ff5252', '#4a9eff', '#26d0ce', '#ffd93d', '#4cd964', '#ff9f1a', '#000000'];   // ★ 下标 11~18：易经「京房八宫」色（乾黑/兑银灰/离红/坎蓝/艮浅黄/坤正黄/巽浅绿/震深绿），2026-10-02 用户指定；★ 下标 19：Aegis 第四组「社会赞许性」黑（自我欺骗增强／印象管理，2026-10-06）

  global.MoKa = global.MoKa || {};
  global.MoKa.data = {
    uid, clone,
    initImages, ready, flushPersist,
    imageStoreMode: function () { return useIdb ? 'idb' : 'inline'; },   // 'idb'=IndexedDB 无容量限制；'inline'=内嵌 localStorage(约 5MB 上限)
    listDecks, findDeck, createDeck, renameDeck, deleteDeck, cloneDeck, setDeckBack,
    getThumbBack, setThumbBack,
    tableDeckIds, isOnTable, setOnTable, setAllOnTable, tableDecks,
    exportDecks, replaceDecks,
    appendCardsToDeck, uniqueDeckName, importDeck, withCardStyle, cardStyleDefaults, setUseRev, setDeckHiRes,
    addCard, updateCard, deleteCard, cloneCard, moveCard, applyCardStyleToDeck, applyStyleToDeck, takeDeckStyles, restoreDeckStyles,
    // 自跑测试用：默认牌组的原件 + 符号图迁移（纯函数）
    _defaultDeck: defaultDeck, _migrateSymbolImgs: migrateSymbolImgs,
    _migrateDroppedBacks: migrateDroppedBacks,      // 下架模板（diag→stripe）的老数据迁移
    // ★ 2026-09-21：写盘结果（走查与外壳都要用）
    onPersistError: onPersistError, lastSaveStatus: function () { return lastSaveStatus; },
    /* 冷启动用：上一次落盘的结果（app.js 首屏那句警示靠它） */
    storedSaveStatus: function () {
      try { const o = JSON.parse(localStorage.getItem(LS_LAST_SAVE) || 'null'); return (o && typeof o === 'object') ? o : null; }
      catch (e) { return null; }
    },
    lsBytes: lsBytes,
    lastHydrate: function () { return lastHydrate; },
    _buildMeta: buildMeta, _imgLsKeys: imgLsKeys, _imgLsGet: imgLsGet, _rescueInlineImages: rescueInlineImages,
    _imgLsSet: imgLsSet, _imgLsBytes: imgLsBytes,   // 走查用：兜底库的写入与总占用（配额防线）
    // ★ 走查用：直接调 hydrateImages（不经过 initImages 的 ensure 竞态 —— 那条 promise 在
    //   IDB 打开超时前不会 settled，走查 await 它会挂到进程退出，async 断言被整段丢掉）
    _hydrateImages: hydrateImages,
    isStarName, builtinBackSvg, builtinSym,
    _builtinSymTable: function () { return BUILTIN_SYMS; },
    _cleanFakeSymbols: cleanFakeSymbols, _syncBuiltinCards: syncBuiltinCards,
    _syncBuiltinContent: syncBuiltinContent, _cardContentHash: cardContentHash,
    deckOwnsBack: deckOwnsBack,
    // 自跑测试用：「有身份的卡名」= 只有带符号的内置卡才在这里（symbols:none 的整副不在）
    _builtinIdentityNames: function () { return Object.keys(BUILTIN_BY_NAME); },
    _builtinByKey: function (k) { return BUILTIN_BY_KEY[k] || null; },
    getActiveDeckId, setActiveDeckId,
    subscribe, pickPalette: () => PALETTE.slice(),
    // 自跑测试用：内置牌组的改名 / 排序 / 补牌背（都是纯函数）
    STAR_DECK_NAME,
    _renameBuiltinDecks: renameBuiltinDecks, _orderBuiltinDecks: orderBuiltinDecks,
    // 自跑测试用：包内自带的牌面图"落盘不写 / 开机补回"这两半（英雄之旅那副）
    _restoreBuiltinImages: restoreBuiltinImages, _imgHash: imgHash,
    _applyBuiltinCardStyle: applyBuiltinCardStyle, _applyBuiltinDeckFlags: applyBuiltinDeckFlags,
    _applyBuiltinOnTable: applyBuiltinOnTable,
    _bundledImgCount: function () { return Object.keys(BUNDLED_IMGS).length; }
  };
})(window);
