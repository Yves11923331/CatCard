/* ============================================================
 * 猫卡 · UI 公共层 (ui.js)
 * ------------------------------------------------------------
 * 职责:
 *   - HTML 转义 (所有用户文本必须经 esc 再入模板)
 *   - 卡片正面 / 背面 的模板渲染 (占卜桌与牌库共用)
 *   - toast / 确认框 / 文本输入弹窗
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------- HTML 转义 ---------- */
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- 卡片模板 ---------- */
  // card: {symbolImg,symbol,name,keyword,faceText,meaning,color}
  //   symbolImg: 符号图（assets/sym/*.svg）。当 mask 用 → 颜色由 card.color 决定，
  //              所以同一个图标能跟着每张牌的颜色走，也不会被机型字形坑（见 data.js 的注释）。
  //   symbol:    老的文字符号，留着兜底（用户自己建的牌组没有图）。
  // 十六进制 + 透明度(0-100) → rgba
  function hexA(hex, aPct) {
    var h = String(hex || '#000000').replace('#','');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    var r = parseInt(h.substring(0,2),16) || 0;
    var g = parseInt(h.substring(2,4),16) || 0;
    var b = parseInt(h.substring(4,6),16) || 0;
    var a = Math.max(0, Math.min(1, (aPct==null ? 60 : aPct) / 100));
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  // 依据背景色自动取文字颜色（亮底深字 / 暗底白字）
  function textOn(hex) {
    var h = String(hex || '#ffffff').replace('#','');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    var r = parseInt(h.substring(0,2),16) || 0;
    var g = parseInt(h.substring(2,4),16) || 0;
    var b = parseInt(h.substring(4,6),16) || 0;
    return ((0.299*r + 0.587*g + 0.114*b) / 255) > 0.6 ? '#1c2536' : '#ffffff';
  }

  // 牌面渲染（v3）：无符号/无主题色条/无简介
  // 内容 = 卡名(必显) + 关键词(单卡可开关)；
  // 各自可设 垂直位置%(0上~100下)、水平对齐(l/c/r)、字号%、文字背景色/透明度
  /* ---------- 「按文字长度自动适配」（2026-09-20 晚，用户要的）----------
     牌面可用文字宽度 = 牌宽的 62.2%；一个汉字的宽度 ≈ 字号。
     名字字号 = 牌宽 × 13/90、关键词 = × 10/90 → 一行分别放得下 4.3 / 5.6 个字。
     autoFit（默认开）：超过这个字数就按比例缩，**保证一行放得下**（最低缩到 25%，
     再长的极端情况才允许换行）；关掉就用用户设的字号（可能换行/顶出去）。
     ★ 只影响"画出来"，卡片数据一个字没动。 */
  /* ★ 2026-09-21 修 bug：以前按"一行能放几个字"估（名字 4.3 字），太乐观 ——
     5 个字缩到 86% 时刚好占满 62.1%，只剩 0.1% 余量，实际就折行了；
     名字块锚在"14%、中线对齐"，一折行就顶出牌面被裁掉 → 用户看到"显示不了"。
     现在改成**按可用宽度反推**：可用 62.2%，只用 60%（留安全余量），
     再长的极端情况才允许换行 —— 换行时 block() 会把它贴住上/下边，不再顶出去。 */
  /* 可用文字宽度：短名字用默认内边距（牌宽 62%）；
     超过 4 个字时 block() 会把外框缩进和内边距都收窄 → 可用宽度提到 **80%**。
     这样 5~6 个字**根本不用缩**（0.72 / 0.87 倍以内），更不存在"挤到折行被裁"。 */
  /* advance = 一个字的推进量 = 汉字 1.00 em（实测量过）+ 字距 .06em + 抗锯齿余量 ≈ 1.10 em */
  /* ★★ 2026-10-05：safe 从 0.60 收到 0.57 —— 内容是「文字 + 左右各 10% 牌宽的 padding」，
     border-box 之后可用内容宽是 82.2% - 20% = 62.2% 牌宽；原来按 60% 估只剩 2.2% 余量，
     真机字体比 Linux 稍宽就踩线（关键词 8 字＝易经「群贤毕至少长咸集」那批）。留 5.2% 余量。 */
  var FIT = { name: 13 / 90, kw: 10 / 90, safe: 0.57, floor: 0.25, adv: 1.10 };
  // 字号范围：20%~200%（2026-09-20 晚放宽下限，用户要求）
  function clampFs(v, fb) { v = parseFloat(v); return isNaN(v) ? fb : Math.max(20, Math.min(200, v)); }
  function textLen(txt) { return Array.from(String(txt || '')).length; }
  /* 返回 { fs, wrap }：fs 是"实际用的百分比"，wrap=true 表示缩到底还得换行 */
  function fitFs(kind, text, baseFs, autoFit, wrap2, wide) {
    var fs = clampFs(baseFs == null ? (kind === 'name' ? 100 : 76) : baseFs, 100);
    /* ★ 2026-09-21 修的坑：这里原来 autoFit===false 就直接 `return { fs: fs, wrap: true }`。
       而 `wrap:true` 在 block() 里的含义是"**缩到底还是放不下**，所以别按中线定位、贴边放" ——
       手动模式的用户明明是在自己摆位置（vy 滑条/拖动），却被当成"放不下"，
       于是 posStyle 走成 top:4% / bottom:4%，**用户设的 vy 整段丢掉**
       （编辑页预览用的是自己那套 top:vy%，所以"编辑页摆好的位置"和"台面上看到的"还不一样）。
       ★ 正解是把两件事分开：`wrap` 只表示"文字要不要换行"（手动模式仍然允许，长了不至于被裁），
         `pin` 才表示"要不要放弃 vy、贴边放"（手动模式一律 false）。
         以后再有"某个模式特殊处理"，记得看这两个字段各自被 block() 用在哪。 */
    /* ★★ 2026-09-28（用户："其实我还是想要一行排下的"）：
       手动模式（关掉「自动适配」）原来直接 `wrap:true` 就折行了 —— 可用户的诉求是**一行放下**。
       现在的规矩：**一行永远是第一目标，放不下就缩字号**；折行只在"缩到地板（25%）还不够"时兜底。
       手动模式仍然有区别：`kwWrap2` 牌组（英雄之旅那种"宁可折两行也别缩成蚂蚁"）的折行逻辑
       只在你开着「自动适配」时生效；关掉 = 字号你说了算，**但也不会让你溢出牌面**。 */
    var lim0 = FIT.safe / (Math.max(1, textLen(text)) * (kind === 'name' ? FIT.name : FIT.kw) * FIT.adv) * 100;
    if (wide) lim0 *= 0.94;                    // 楷/宋那两款内嵌字比系统黑体宽，留一手
    if (autoFit === false) {
      if (lim0 >= fs) return { fs: fs, wrap: false, pin: false };
      if (lim0 >= FIT.floor * 100) return { fs: lim0, wrap: false, pin: false };
      return { fs: FIT.floor * 100, wrap: true, pin: false };   // 缩到底还放不下 → 才折行
    }
    var base = kind === 'name' ? FIT.name : FIT.kw;      // 一个字 ≈ 字号 × base/字号比例
    var len = textLen(text);
    if (len <= 0) return { fs: fs, wrap: false };
    /* ★ 一张牌一张牌地缩：**字号不必一样**（用户 2026-09-21 的原话）。
       可用宽度 62.2%（实测量过：汉字 = 1.00 em/字），只用 60% 留余量。
       ★ 取 min(用户设的字号, 放得下所需的上限) —— 所以用户手动调小的字号**不会再被乘一遍**。 */
    /* ★ 2026-09-23（英雄之旅那副）：`wrap2` = 「宁可折两行，也别缩成蚂蚁」。
       有些牌组的关键词天生很长（如阶段名「跨越归返的门槛」7 个字），
       一行放得下要缩到 59% → 90px 牌面上只有 5.9px，等于看不清。
       这些卡在 JSON 里写 kwWrap2: true → 这里改成**按两行算可用宽度**：
       缩到两行放得下为止（最低仍受 FIT.floor 兜底），而不是一路缩到一行。 */
    if (wrap2) {
      var limit1 = FIT.safe / (len * base * FIT.adv) * 100;          // 一行放得下允许的最大字号
      if (limit1 >= fs) return { fs: fs, wrap: false };              // ★ 一行就放得下 → 照常按 vy 定位，别贴底
      var limit2 = (FIT.safe * 2) / (len * base * FIT.adv) * 100;    // 一行放不下 → 按两行算（可用宽度翻倍）
      if (limit2 >= fs) return { fs: fs, wrap: true };               // 原字号、两行放得下
      if (limit2 >= FIT.floor * 100) return { fs: limit2, wrap: true };
      return { fs: FIT.floor * 100, wrap: true };
    }
    var limit = FIT.safe / (len * base * FIT.adv) * 100;  // 一行放得下允许的最大字号（%）
    if (limit >= fs) return { fs: fs, wrap: false };      // 用户设的字号本来就放得下
    if (limit >= FIT.floor * 100) return { fs: limit, wrap: false };
    return { fs: FIT.floor * 100, wrap: true };           // 缩到底还放不下 → 换行（下面会贴边）
  }

  function clampW(v) { v = parseInt(v, 10); return [300, 400, 500, 600, 700, 800].indexOf(v) >= 0 ? v : 700; }

  /* ★ 2026-09-27：字号/底色之外，再加"字体"与"底色样式"两组外观字段。
     两者都是<class> 而不是行内 style —— 视觉全在 v3.css 里，这里只给类名。
     为什么要给类名：底色样式里有几种要**去掉底色**（无底/描边/下划线），
     而行内 background 会压过类，所以这类样式下**不写行内 background**。
     ★ 2026-10-11「鲸造」重构：这一整块从 faceHTML 体内提到模块级 ——
     编辑器的「样式实况预览」和台面渲染必须共用**同一份** chipHTML 策略，
     否则又是"编辑页看到的 ≠ 台面上看到的"（历史上整组踩过的坑）。 */
  /* 字体 id → 类名（11 款）。★ 三处必须同步：这里 / v3.css 的 .is-ft-<id> / editor.js 的 FONT_LIST */
  const FONT_CLS  = { sys: '', kai: ' is-ft-kai', song: ' is-ft-song', ming: ' is-ft-ming',
    mao: ' is-ft-mao', xing: ' is-ft-xing', shou: ' is-ft-shou', you: ' is-ft-you',
    deyi: ' is-ft-deyi', hei: ' is-ft-hei', wei: ' is-ft-wei' };
  /* ★ 行内策略分三类（写错一类就是"死样式"或"设计被行内压掉"）：
       ① BG_KEEPS_BG   —— 行内写 background + 对比色字（颜色/深浅对它有用）
       ② BG_WHITE_TXT  —— 不画底，行内只给白字（CSS 配黑光晕兜可读性）
       ③ 其余（plain + 第二批 30 款）—— **一个行内样式都不写**：配色是设计的一部分，
          写在 CSS 里，行内 background/color 会把它整个盖掉。 */
  const BG_WHITE_TXT = { outline: 1, underline: 1, none: 1 };
  /* 第二批（用户挑的 30 款）：全是**通条** —— 不管牌名几个字，那块底都是同一条。 */
  const BG_BAR = { scroll: 1, bamboo: 1, rice: 1, carve: 1, ledger: 1, label: 1, neon: 1, halo: 1,
    spot: 1, glass: 1, hex: 1, notch: 1, stripe: 1, dotgrid: 1, gridpaper: 1, sidebar: 1, double: 1,
    stitch: 1, ribbon2: 1, sqring: 1, twinline: 1, emboss: 1, deboss: 1, gold: 1, copper: 1,
    velvet: 1, papercut: 1, holo: 1, leather: 1, mist: 1 };
  const BG_STYLE  = Object.assign({ soft: 1, pill: 1, tag: 1, plate: 1, ribbon: 1, plain: 1 },
                                  BG_WHITE_TXT, BG_BAR);
  /* 只有这五种还画那块底；outline/underline/none 三种不画 ——
     写了行内 background 会压过 CSS 里的 transparent（描边会变成实心块）。 */
  const BG_KEEPS_BG = { soft: 1, pill: 1, tag: 1, plate: 1, ribbon: 1 };

  /* 一块文字的完整 chip 渲染（台面 faceHTML 与编辑器共用，唯一真源）。
     ★ 2026-09-28 的教训全在这一段里：折行必须显式 white-space:normal（CSS 基础是 nowrap），
     一行优先写死 nowrap；`max-width:100%` 在 CSS 上，折行后一定在牌面里。 */
  function chipHTMLFor(st, kind, h, fs, chipCls, bg, bga, text, weight, wrap) {
    const isName = (kind === 'name');
    const ft = String((isName ? st.nameFont : st.kwFont) || 'sys');
    const bs = String((isName ? st.nameBgStyle : st.kwBgStyle) || 'soft');
    const fontCls = FONT_CLS[ft] || '';
    const bgCls = (BG_STYLE[bs] ? (' is-bg-' + bs) : ' is-bg-soft') + (BG_BAR[bs] ? ' is-bar' : '');
    /* ★ 字号 = 相对牌面宽度的比例（基准 90px 牌宽：卡名 13px / 关键词 10px），
       设置页改牌面大小、字跟着等比放大。 */
    const ratio = (kind === 'name' ? 13 : 10) / 90 * (clampFs(fs, 100) / 100);
    /* ★ 2026-10-11：字色覆盖（朱砂/烫金/墨绿…）—— 排在样式策略**之后**，
       所以它压过自动对比色，但不动底块与光晕（可读性仍由 CSS 兜着）。 */
    const tc = (kind === 'name') ? st.nameColor : st.kwColor;
    /* ⚠ 必须带**前导分号**：前面拼的是 `font-weight:700`（没有尾分号，
       它的分号原来由后面的 white-space 分支提供）。2026-10-11 实测踩过：
       写成尾分号会拼出 `font-weight:700color:#a8302a` —— 整条作废，
       于是**字色和字重一起丢**（朱砂/烫金主题全变回默认深墨色＋不加粗）。 */
    const tcCss = (tc && typeof tc === 'string') ? (';color:' + esc(tc)) : '';
    return '<span class="fc-chip ' + chipCls + fontCls + bgCls + '" style="font-size:calc(var(--card-w, 90px) * ' + ratio.toFixed(5) +
      ');' + (BG_KEEPS_BG[bs]
                ? 'background:' + esc(hexA(bg, bga)) + ';color:' + esc(textOn(bg)) + ';'
                // 描边/下划线/无底：不画底，文字一律白＋CSS 光晕 ——
                // 不能再用 textOn(bg) 推色（那是"假设底画出来了"才成立的算法）
                : (BG_WHITE_TXT[bs] ? 'color:#fff;'
                   // plain + 第二批 30 款：一个行内样式都不写（配色是设计本身）
                   : '')) +
      'font-weight:' + (weight ? clampW(weight) : 700) + tcCss +
      (wrap === false ? ';white-space:nowrap' : ';white-space:normal;word-break:break-word') + '">' + esc(text) + '</span>';
  }

  /* ★ 2026-10-11「鲸造」编辑器：样式实况预览专用。
     给定一张卡（或含样式字段的对象）和一段文字，输出"这块文字在台面上的真实样子"的 chip HTML。
     编辑器的样式网格直接用它渲染每个格子的迷你预览 —— 保证预览 = 台面。 */
  function previewChip(kind, card, text) {
    const DD = (typeof global !== 'undefined' && global.MoKa && global.MoKa.data) ? global.MoKa.data : null;
    const st = DD ? DD.withCardStyle(card || {}) : (card || {});
    const P = kind === 'kw' ? 'kw' : 'name';
    const txt = String(text == null ? (P === 'kw' ? st.keyword : st.name) : text);
    const autoFit = st.autoFit !== false;
    const fit = fitFs(P, txt, st[P + 'Fs'], autoFit, P === 'kw' && st.kwWrap2 === true,
                      !!(st[P + 'Font'] && st[P + 'Font'] !== 'sys'));
    return chipHTMLFor(st, P, st[P + 'H'], fit.fs, P === 'kw' ? 'fc-keyword' : 'fc-name',
                       st[P + 'Bg'], st[P + 'BgA'], txt, st[P + 'Weight'], fit.wrap);
  }

  /* ★ 2026-10-11「鲸造」重构：图片图层。
     牌面图从"全幅背景"升级为**可平移/缩放/加滤镜的图层**：
       imgScale 100 = 铺满整卡（object-fit:cover 兜底），放大后 imgX/imgY 平移选景；
       滤镜走 CSS filter（人话档位：原图/压暗/更暗/模糊/黑白/暖调）。
     ⚠ 旧数据没有这些字段 → withCardStyle 补默认值，行为 = 旧的全幅图，零迁移成本。 */
  const IMG_FILTERS = { none: '', dim: 'brightness(.72)', dark: 'brightness(.48)',
    blur: 'blur(3px)', gray: 'grayscale(1)', warm: 'sepia(.35) saturate(1.25)' };
  function fcImgHTML(card, st) {
    const s = Math.max(50, Math.min(400, parseFloat(st.imgScale) || 100));
    const x = Math.max(-100, Math.min(100, parseFloat(st.imgX) || 0));
    const y = Math.max(-100, Math.min(100, parseFloat(st.imgY) || 0));
    const f = String(st.imgFilter || 'none');
    const fl = IMG_FILTERS[f] != null ? IMG_FILTERS[f] : '';
    const style = 'transform:translate(' + x + '%,' + y + '%) scale(' + (s / 100) + ');' +
      (fl ? ('filter:' + fl + ';') : '');
    return '<img src="' + esc(card.image) + '" alt="" style="' + style + '">';
  }

  /* ★ 2026-10-11 主题升级：牌面质感层。
     assets/tex/<id>.png = 程序化生成的灰度纹理（512×768，与牌面 1:1.5 同比例，cover 不变形）。
     叠在图片之上、文字之下（靠 DOM 顺序，不动任何 z-index —— 纸边(2)/文字(1) 的老层级一根手指没碰）。 */
  const TEX_IDS = { paper: 1, grain: 1, stone: 1, crack: 1, fiber: 1, brushed: 1,
    watercolor: 1, stars: 1, nebula: 1, frost: 1 };
  function texHTML(st) {
    const id = String(st.faceTex || '');
    if (!TEX_IDS[id]) return '';
    const a = Math.max(0, Math.min(100, parseFloat(st.faceTexA)));
    const op = (isNaN(a) ? 45 : a) / 100;
    if (op <= 0) return '';
    return '<div class="fc-tex is-tex-' + id + '" style="background-image:url(assets/tex/' + id + '.png);opacity:' + op.toFixed(2) + '"></div>';
  }

  function faceHTML(card, opts) {
    opts = opts || {};
    const c = card || {};
    const D = (typeof global !== 'undefined' && global.MoKa && global.MoKa.data) ? global.MoKa.data : null;
    const st = D ? D.withCardStyle(c) : c;   // 兼容旧卡缺失字段
    const name = String(c.name || '');
    /* ★ 2026-11-19：卡名/关键词各有一个上牌面开关（nameOn / kwOn）。
       缺字段（老数据）一律按"显示"处理；编辑页为了能调样式会强制两块都渲染，再压暗。 */
    const nameOn = st.nameOn !== false && name;
    const kwOn = st.kwOn !== false && c.keyword;

    function clampW(v) { v = parseInt(v, 10); return [300, 400, 500, 600, 700, 800].indexOf(v) >= 0 ? v : 700; }

    function chipHTML(kind, h, fs, chipCls, bg, bga, text, weight, wrap) {
      return chipHTMLFor(st, kind, h, fs, chipCls, bg, bga, text, weight, wrap);
    }

    function block(kind, vy, h, fs, chipCls, bg, bga, text, weight, wrap, pin) {
      if (!text) return '';
      const jc = h === 'l' ? 'flex-start' : (h === 'r' ? 'flex-end' : 'center');
      /* ★ 折行（wrap=true）时不能用"以中线对齐"的定位：两行会顶出牌面被裁。
         名字贴住上边、关键词贴住下边 —— 永远在牌面里。
         ⚠ pin=false（手动适配）时不贴边：用户自己设的 vy 说了算。 */
      const P = wrapPosStyle(kind, vy, wrap, pin);
      const posStyle = 'top:' + P.top + ';bottom:' + P.bottom + ';transform:' + P.transform;
      return '<div class="fc-wrap" data-kind="' + kind + '" style="' + posStyle + ';justify-content:' + jc + '">' +
        chipHTML(kind, h, fs, chipCls, bg, bga, text, weight, wrap) +
      '</div>';
    }

    const autoFit = st.autoFit !== false;
    // ★ 有层级条时名字药丸自动下移（条占掉牌顶那一条），不动用户存的 nameVy
    const bandOn = !!bandText(c);      // 有层级条：名字要下移，下面画条/符号也要让位
    const nameVy = effNameVy(c, st);   // ★ 位置算法抽成函数，编辑页的 paintBlock 也必须用同一个
    const fitN = fitFs('name', name, st.nameFs, autoFit, false,
                       !!(st.nameFont && st.nameFont !== 'sys'));
    let faceInner = nameOn ? block('name', nameVy, st.nameH, fitN.fs,
                                  'fc-name', st.nameBg, st.nameBgA, name, st.nameWeight, fitN.wrap, fitN.pin) : '';
    if (kwOn) {
      const fitK = fitFs('kw', c.keyword, st.kwFs, autoFit, st.kwWrap2 === true,
                         !!(st.kwFont && st.kwFont !== 'sys'));
      faceInner += block('kw', st.kwVy, st.kwH, fitK.fs,
                         'fc-keyword', st.kwBg, st.kwBgA, c.keyword, st.kwWeight, fitK.wrap, fitK.pin);
    }
    // 牌面纸边：牌组级（opts.edge，deck.faceEdge）+ 卡片级（st.faceEdge）"两者都开才画"。
    // ★ 2026-10-11「鲸造」重构：每张卡可单独关纸边（faceEdge:false）。
    const faceEdge = (opts.edge === false || st.faceEdge === false) ? '' : ' is-edge';
    /* ★ 2026-10-11「鲸造」重构：牌面底色走 CSS 变量 --fc-face。
       v3.css 的 .tcard-face 用 `background: var(--fc-face, #fff) !important` 兜底，
       所以行内设 --fc-face 就能覆盖，不必和 !important 打架；faceBg 为 null 时沿用默认（纸白/深色主题深底）。 */
    /* ★ 2026-11-17：牌面素字（.is-bg-plain）的墨色跟着**牌面底色**走，而不是跟着主题走。
       带自定义 faceBg 的卡（love/stories 那类固定深底）不吃主题那套，所以在这里把对比色
       按这块底算出来，行内写 --fc-plain-ink（v3.css 的 .is-bg-plain 读它，缺省仍 #1c2536）。
       没有 faceBg 的卡一个字节都不写 —— 浅色仍是 #1c2536、深色由主题那条给 var(--ink)。 */
    const faceBgStyle = (st.faceBg && typeof st.faceBg === 'string')
      ? ' style="--fc-face:' + esc(st.faceBg) + ';--fc-plain-ink:' + esc(textOn(st.faceBg)) + '"'
      : '';
    /* ★ 2026-09-23：牌面专属样式钩子。卡上写 styleKey:'hero' → 外壳多一个 is-fc-hero 类，
       v3.css 里就能只给这一副改版式（放大图形区、名字/关键词让位），不必写死类名去猜是哪副牌。 */
    const styleCls = c.styleKey ? ' is-fc-' + String(c.styleKey).replace(/[^a-z0-9_-]/gi, '') : '';
    return '' +
      '<div class="tcard-side tcard-face' + faceEdge + styleCls + '"' + faceBgStyle + '>' +
        (c.image ? '<div class="fc-img">' + fcImgHTML(c, st) + '</div>' : '') +
        texHTML(st) +
        // 符号：只有"有身份的卡"才画（星语那 12 个，见 symForCard）。
        // ★ 2026-09-18：**不再有"文字字形兜底"了** —— 原来认不出图就把 card.symbol 直接印上去，
        //   于是每张默认卡正中都长出一颗 '✦'（用户截图指着的那颗星就是它）。
        //   现在没有身份 = 没有徽记：牌面就是名字 / 关键词 / 图片，干净。
        // ★ 2026-09-27：**有整幅牌面图就不再画徽记**（整幅图优先，比如英雄之旅那副）——
        //   徽记是"居中叠上去"的，会正好压在画的正中央（用户要的是整幅画，不是画上加符号）。
        //   `sym` 字段仍然留着 —— 它是星语符号的身份判据，也是图挂掉时的降级方案。
        (!c.image && symSVG(symForCard(c))
          ? '<div class="fc-emblem" style="color:' + esc(palColor(c.color, '#6f7f9c')) + '">' +
            symSVG(symForCard(c)) + '</div>'
          : '') +
        (bandOn
          ? '<div class="fc-band" style="background:' + esc(palColor(c.color, '#6f7f9c')) + '"></div>'
          : '') +
        (cardArt(c)
          ? '<div class="fc-art' + (bandOn ? ' has-band' : '') + '" style="color:' + esc(palColor(c.color, '#343a45')) + '">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
            'stroke-linecap="round" stroke-linejoin="round">' + cardArt(c) + '</svg></div>'
          : '') +
        '<div class="face-stack">' + faceInner + '</div>' +
      '</div>';
  }

  /* 2026-09-20：又下架过一个内置牌背模板，画它的那几个函数全删了。 */




  /* 牌背**缩略**（牌库的牌盒缩略背 / 选牌台的小牌背共用）：
       跟着这副牌组自己的模板走 —— 盾印(aegis) / 三爻(guax) / 里程线(hero) 直接画那套图；
       其它模板（8 个通用纹）是叠层纹，保持 ✦ + 外层 CSS 的老样子。
     ★ 2026-09-20 修：这两处以前都**写死 ✦**，于是内置的划杠/盾印在缩略图上全丢了
       （牌库的牌盒、选牌台的小背都变成一颗星）——用户报的"没有同步他们自己的牌背"。 */
  // 缩略背要不要用"用户自己放的图"：看设置页那个开关（默认 own＝用）
  function thumbOwnImg(deck) {
    if (!deck || !deck.backImage) return null;
    var mode = 'own';
    try {
      var D0 = global.MoKa && global.MoKa.data;
      if (D0 && D0.getThumbBack) mode = D0.getThumbBack();
    } catch (e) {}
    return mode === 'default' ? null : deck.backImage;
  }
  /* ★★ 2026-10-05：内置牌背模板**只在这一张表里登记**。
     用户报过「主页底部栏的牌背 / 牌盒的牌背没同步更新」—— 根因就是这份名单原来在**四个地方各写了一遍**
     （缩略背分派、两个"有没有自己的设计"的判断、大背分派），加新模板漏一处就掉回兜底 ✦。
     以后加内置牌背：① 这里加一行；② 写 xxxBackSVG/Inner；③ ui.js 末尾导出；
     ④ library.js 的 BACK_TPL 登记（校验器会查那张表）。 */

  // 这几处缩略背"有没有自己的设计"（图片或内置模板）—— 用来决定还要不要画 ✦/▶
  function backThumbHasDesign(deck) {
    const DD = global.MoKa && global.MoKa.data;
    return !!(thumbOwnImg(deck) || (DD && DD.builtinBackSvg(deck && deck.backTemplate)));
  }

  /* art（内置符号语言的六爻/骨架）包成一段内联 <svg> —— 牌面和**牌组页缩略卡**共用。
     属性与 faceHTML 里那个完全一致（24×24、currentColor、1.8 描边）。
     ★ 2026-09-21：牌组页原先只认 symbolImg，于是 Aegis 那副的缩略卡中间是空的（用户截图报的）。 */
  function artSVG(card) {
    const a = cardArt(card);
    return a ? ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
                'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + a + '</svg>') : '';
  }

  function backThumbHasImg(deck) { return !!thumbOwnImg(deck); }
  /* ---------- 内联 CSS 里 url('…') 的统一安全化（2026-10-15）----------
     为什么不能只 esc：url() 是**单引号**包裹的，而 esc 把 ' 变成 &#39; ——
     HTML 解析属性值时会把它**还原成裸单引号**，于是 url(' 提前闭合，
     后面的内容直接变成 CSS 声明（背景图被换成任意 url / 覆盖别的属性）。
     合法值（data:image/…;base64,… 与 blob:）里本来就不含单引号，
     所以把 ' 换成 %27 对任何正常牌背图都是**零影响**，只让恶意串失效。
     ★ 三处调用：backThumbStyle / backThumbImg / backHTML —— 以后再加内联 url 也走这里。 */
  function cssUrl(v) { return esc(String(v == null ? '' : v).replace(/'/g, '%27')); }
  function backThumbStyle(deck) {
    const img = thumbOwnImg(deck);
    return img ? ("background-image:url('" + cssUrl(img) + "');background-size:cover;background-position:center") : '';
  }

  function backThumbInner(deck, tplCls, markCls) {
    // ★ 有自己放的牌背图 → 只画图，不再往图上压一颗 ✦（和 backHTML 同一个规矩）
    if (thumbOwnImg(deck)) return '';
    const t = deck && deck.backTemplate;
    const DD = global.MoKa && global.MoKa.data;
    const bsvg = DD && DD.builtinBackSvg(t);
    if (bsvg) return '<div class="' + (tplCls || 'dbb-tpl') + '">' + bsvg + '</div>';
    return '<span class="' + (markCls || 'dbb-mark') + '">✦</span>';
  }
  /* 缩略背的"图片层"：选牌台那种外层 background 带 !important 的地方，
     内联 background-image 会被压掉（牌盒踩过这个坑）——所以图片单独做一层子元素。 */
  function backThumbImg(deck, cls) {
    const img = thumbOwnImg(deck);
    if (!img) return '';
    return '<span class="' + (cls || 'tc-img') + '" style="background-image:url(\'' +
      cssUrl(img) + '\')"></span>';
  }
  function backThumbHasTpl(deck) {
    const t = deck && deck.backTemplate;
    const DD = global.MoKa && global.MoKa.data;
    return !!(!thumbOwnImg(deck) && DD && DD.builtinBackSvg(t));
  }

  /* ============================================================
   * 牌堆栏 · 一摞牌（占卜桌 / 周易页共用；2026-10-20 重构）
   * ------------------------------------------------------------
   * 病根：两页**各拼一份一模一样的 HTML**（数字角标 / 牌背图 / 内置模板 / ✦▶ 兜底
   * 四件事各写一遍，历史上就漏过 .ps-tpl）；而且"一摞"的厚度是靠 .pile-stack
   * 的 ::before / ::after 画的 —— 伪元素没有 z-index，画在 .ps-img / .ps-tpl
   * （z-index:1）**底下**。于是带整幅插画牌背的英雄之旅 / Overflow 把它整块盖住，
   * 只剩牌面外 2px 的淡边，在浅色底上根本看不见 —— 四副牌里两副是平的、
   * 两副（深色纯底 + 模板）看起来才是一摞（用户 2026-10-20 截图报的就是这个）。
   *
   * 现在：一摞牌 = N 层真实子元素（.ps-layer，厚度）+ 一层牌面（.ps-face，牌背图 /
   * 模板 / ✦▶）+ 一颗剩余张数角标（.ps-left）。谁盖谁由 CSS 层叠说了算，
   * 不依赖牌背图是"整幅"还是"纯色"。
   *
   * 层数跟**剩下几张**走（pileDepth）：抽到只剩一张就该是薄薄一张，
   * 牌还满着才是一摞。
   * ★ 2026-11-06（P8 注释纠偏）：厚度与角标是**分工**，不是二选一 ——
   *   厚度 = 量感（0/1/2 三档，回答"这摞还很满吗"），角标 = 精确数（回答"还剩几张"）。
   *   两者同源于 left（P3 后同源于 pileRemainingCards），不会互相打架；
   *   但厚度只有三档，12 张和 64 张一样厚 —— 所以厚度不能被读成精确张数。
   *   （旧注释写"厚度本身就是信息，不用再另写一行数字"，与下面仍渲染 .ps-left 的事实矛盾。）
   *
   * ★★ 厚度层的颜色**跟着这副牌自己的牌背主色**（deck.backColor）走，而且**朝白里调**：
   *   一摞牌的侧边就是一层"纸"，原版第三、四副露出来的就是这道很淡的纸边。
   *   四副牌都垫同一条黑边的话，紫插画（英雄之旅）/ 浅紫插画（Overflow）下面
   *   突然一条黑边，一眼就出戏（用户 2026-10-20：「下面的不能也是黑色的」）。
   *   牌背设定页选图后本来就会 extractColor 把主色写回 backColor，所以这个值可信。
   *   → 内联 --ps-tint / --ps-shade（主色朝白调两档），CSS 只负责画。
   * ============================================================ */
  /* 颜色混白：k = 原色占多少（0~1）。给"一摞牌的纸边"用 —— 比牌背浅、比纯白带色。 */
  function mixWhite(hex, k) {
    const h = String(hex || '').replace('#', '');
    if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h)) return '';
    const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
    const f = function (i) {
      const v = Math.round(parseInt(full.substr(i, 2), 16) * k + 255 * (1 - k));
      return ('0' + Math.max(0, Math.min(255, v)).toString(16)).slice(-2);
    };
    return '#' + f(0) + f(2) + f(4);
  }

  function pileDepth(left) {
    const n = Math.max(0, Math.floor(Number(left) || 0));
    if (n <= 1) return 0;      // 0 / 1 张：一张牌没有厚度
    if (n <= 11) return 1;     // 剩下不多：薄薄一层
    return 2;                  // 还满着：两层 —— 原版就是两层伪元素的量，再多就显笨
  }

  /* 只是那一摞（不含名字）。opts: { left, active } */
  function pileStackHTML(deck, opts) {
    opts = opts || {};
    const d = deck || {};
    const left = opts.left == null ? ((d.cards && d.cards.length) || 0) : opts.left;
    const depth = pileDepth(left);
    const active = !!opts.active;
    // 纸边色 = 这副牌牌背主色朝白调两档（没有 backColor 就交给 CSS 兜底）
    const tint = d.backColor ? mixWhite(d.backColor, .45) : '';
    const tintStyle = tint
      ? ' style="--ps-tint:' + esc(tint) + ';--ps-shade:' + esc(mixWhite(d.backColor, .34)) + '"'
      : '';
    let layers = '';
    // 远的先写、近的后写；再叠一层 z-index（--i 越大越靠下），桌面端 / WebView 都不会反
    for (let i = depth; i >= 1; i--) {
      layers += '<i class="ps-layer" style="--i:' + i + '" aria-hidden="true"></i>';
    }
    return '<div class="pile-stack' + (d.backEdge === false ? '' : ' is-edge') + '"' +
        ' data-depth="' + depth + '"' + tintStyle + '>' +
      layers +
      '<div class="ps-face">' +
        // ★ 2026-09-20 统一：桌上这一摞也跟牌背走（自己的图 > 内置模板 > ✦/▶）
        backThumbImg(d, 'ps-img') +
        (backThumbHasTpl(d) ? backThumbInner(d, 'ps-tpl', 'ps-mark') : '') +
        (backThumbHasDesign(d) ? '' : '<span class="ps-mark">' + (active ? '▶' : '✦') + '</span>') +
      '</div>' +
      '<span class="ps-left" aria-hidden="true">' + left + '</span>' +
    '</div>';
  }

  /* 一整项：那一摞 + 名字（名字带 title；触摸端看全名走顶栏，P5-B）。
     opts: { left, active, name, id } —— 两页现在都只调它。
     ★ 2026-11-06（P11）：补语义 —— role=button + aria-label（名字 + 剩余张数 +
       是否当前堆）+ aria-current；角标 aria-hidden（数字已经在 label 里，别读两遍）。
       不加 tabindex：触摸端 TalkBack 用"探索 + 双击"激活（会派发 click），
       没有键盘激活逻辑时给 tabindex 反而制造"能聚焦但按不动"的坑。 */
  function pileItemHTML(deck, opts) {
    opts = opts || {};
    const d = deck || {};
    const left = opts.left == null ? ((d.cards && d.cards.length) || 0) : opts.left;
    const name = opts.name == null ? (d.name || '') : opts.name;
    const id = opts.id == null ? (d.id || '') : opts.id;
    const label = esc(name) + '，剩 ' + left + ' 张' + (opts.active ? '，当前牌堆' : '');
    return '<div class="pile-item' + (opts.active ? ' is-active' : '') + (left === 0 ? ' pile-item-empty' : '') +
        '" data-id="' + esc(id) + '" role="button" aria-label="' + label + '"' +
        (opts.active ? ' aria-current="true"' : '') + '>' +
      pileStackHTML(d, { left: left, active: opts.active }) +
      '<div class="pile-item-name" title="' + esc(name) + '">' + esc(name) + '</div>' +
    '</div>';
  }

  function backHTML(deckName, back) {
    back = back || {};
    const color = back.color || '#2f6fed';
    const image = back.image || null;
    const DD = global.MoKa && global.MoKa.data;
    const bsvg = DD && DD.builtinBackSvg(back.template);
    let inner = '';
    if (image) {
      /* ★★ 2026-10-15 修（安全问题）：**这里原来漏了转义** ——
         同一个函数里 deckName / color / template 都转了，只有 image 没转。
         而 back.image 来自 deck.backImage，导入路径是"原样收下"
         （io.js 的纯文本 JSON 分支 → data.js 的 importDeck），
         于是串里带一个双引号就能闭合 style="…" 属性、把 <img onerror> 注入进来，
         每次渲染这张牌背都会执行（存储型：重启还在，只认删牌组才好）。
         现在统一走 cssUrl（= 转义 + 单引号转 %27），HTML 属性和 CSS url() 两层都闭合不出去。 */
      inner = '<div class="cb-img" style="background-image:url(\'' + cssUrl(image) + '\');background-size:cover;background-position:center"></div>';
    } else if (bsvg) {
      // ★ 内置牌背统一走注册表（decks/<key>/back.svg），只有图，不叠 ✦ 和牌名
      inner = '<div class="cb-tpl">' + bsvg + '</div>';
    } else {
      inner = '<div class="cb-logo">✦</div>' +
        '<div class="cb-name">' + esc(deckName || '猫卡') + '</div>';
    }
    const tpl = back.template ? ' is-tpl-' + esc(back.template) : '';
    // 纸边：每副牌组自己的设定（deck.backEdge），默认开；关了就不加这个类
    const edge = (back.edge === false) ? '' : ' is-edge';
    return '' +
      '<div class="tcard-side tcard-back' + tpl + edge + '" style="--bk:' + esc(color) + '">' +
        inner +
      '</div>';
  }


  /* 2026-09-20：下架过一整张符号表（那 24 条 path 不再进包）。 */

  /* 取"图形本体"：只认星语那 12 个的 SYM_PATH。
     ★ 只认 id，**不关心后缀**：老数据里可能是 .svg 也可能是 .png
       （别的版本一度把它们渲染成 PNG 图片），统一按 id 找表。 */
  function symInner(id) {
    const DD = global.MoKa && global.MoKa.data;
    return (id && DD && DD.builtinSym(id)) || null;
  }
  /* ---------- 内置「符号语言」（Aegis 那副，2026-09-20 晚）---------
     ★ 和符号（星语/Psyche）同一套机制：内联 SVG、不落图片文件、颜色走 currentColor。
     ★ 区别：符号是"图形的身份"（认名字），art 是**牌组自带的整段牌面符号**
       （8 种层级外框 + 15 副骨架 + 变量，见 设计-界面/38-Aegis符号语言-v2.md）。
     认法最简单：卡上带 art 就画，没带就不画 —— 不需要身份表，也不会误伤用户自己的卡。 */
  /* ★ 2026-09-23：从"必须以 < 开头"（等于只认单标签）放宽成**白名单片段**。
     为什么：易经牌组每张的 art 是 6~12 条 `<line>`（一幅卦画本来就是好几段），
     旧判据看到 `<line …/><line …/>` 一样以 < 开头、也能过，但那个写法本身是"任何以 < 开头的
     字符串都放行"，反倒把 <img>/<iframe>/on…= 也放进来了。现在**换成显式白名单**：
     ① 首尾都是标签（不许夹纯文本）；② 只认下面这些画图标签；③ 出现 <script/<img/<iframe/<svg
     或任何 on…= 事件属性，一律不画。 */
  /* ★★ 2026-10-02 修「64 卦符号没有颜色」：
     卡片上的 color 从第一天起就是 **PALETTE 的下标（数字）**（易经按上卦取 0~7、Aegis 8、
     Psyche/星语 0~3…），但渲染时被当成 CSS 颜色直接写进 style —— `.fc-art` 更是写死 #343a45。
     于是「color:3」这种无效值一直不生效、卦画全成了同一个深灰，数据里的颜色等于白存。
     这里统一解析：数字 → PALETTE[n]，'#xxx' → 原样，其余 → fallback。 */
  var _palCache = null;
  function palColor(v, fallback) {
    const fb = fallback || '#6f7f9c';
    if (v === null || v === undefined || v === '') return fb;
    if (typeof v === 'string' && v.charAt(0) === '#') return v;
    const n = parseInt(v, 10);
    if (isNaN(n)) return fb;
    if (!_palCache) {
      const DD = (typeof global !== 'undefined' && global.MoKa && global.MoKa.data) ? global.MoKa.data : null;
      if (DD && DD.pickPalette) _palCache = DD.pickPalette();
    }
    const p = _palCache;
    if (p && n >= 0 && n < p.length) return p[n];
    return fb;
  }

  var ART_TAGS = ['path', 'circle', 'rect', 'line', 'g', 'polyline', 'polygon', 'ellipse'];
  function cardArt(card) {
    const a = card && card.art;
    if (typeof a !== 'string') return null;
    const s = a.trim();
    if (s.charAt(0) !== '<' || s.charAt(s.length - 1) !== '>') return null;
    if (/<(script|img|iframe|svg|use|foreignObject)\b/i.test(s) || /\son[a-z]+\s*=/i.test(s)) return null;
    // 每个标签名都得在白名单里
    const tags = s.match(/<\/?([A-Za-z][A-Za-z0-9]*)/g) || [];
    if (!tags.length) return null;
    for (let i = 0; i < tags.length; i++) {
      const t = tags[i].replace(/[<\/]/g, '').toLowerCase();
      if (ART_TAGS.indexOf(t) < 0) return null;
    }
    return s;
  }

  /* 层级条（Aegis 那副）：卡上带 band 就画一条全宽色条（底色＝层级色、字自动反色）。
     ★ 判定只看"卡上有没有 band"，不绑牌组 —— 用户自己的牌以后想贴也能贴。 */
  /* ★★ 2026-09-27：**位置这件事只能有一份算法**。
     踩的坑（用户报的）：带 `band`（层级条）的卡，画牌面时名字要从 14% 下压到 26% 躲开那条；
     可编辑页的 paintBlock 是另写的一份，用的是原始 nameVy=14 ——
     于是"在编辑页换个样式，名字直接上移、上移到默认位置"（A字牌组 78 张全带层级条，一换就中）。
     现在 effNameVy / wrapPosStyle 都由这里出，两处共用。 */
  function effNameVy(card, st) {
    const s0 = st || ((D0() && D0().withCardStyle) ? D0().withCardStyle(card) : card) || {};
    const vy = s0.nameVy == null ? 14 : s0.nameVy;
    return bandText(card) ? Math.max(vy, 26) : vy;   // 条加粗后跟着下移
  }
  function D0() { return (typeof global !== 'undefined' && global.MoKa && global.MoKa.data) ? global.MoKa.data : null; }
  /* 贴边（wrap）时不能用"以中线对齐"的定位：两行会顶出牌面被裁 —— 名字贴上边、关键词贴下边。
     ⚠ pin=false（手动适配）时不贴边：用户自己设的 vy 说了算。 */
  function wrapPosStyle(kind, vy, wrap, pin) {
    if (wrap === true && pin !== false) {
      return (kind === 'name') ? { top: '4%', bottom: 'auto', transform: 'none' }
                               : { top: 'auto', bottom: '4%', transform: 'none' };
    }
    return { top: clampNum(vy, 50) + '%', bottom: 'auto', transform: 'translateY(-50%)' };
  }
  function clampNum(v, fb) { v = parseFloat(v); return isNaN(v) ? fb : Math.max(0, Math.min(100, v)); }

  function bandText(card) {
    const b = card && card.band;
    return (typeof b === 'string' && b.trim()) ? b.trim() : null;
  }

  function symId(src) {
    // ★ 允许连字符/下划线：Psyche 那套 id 是 libido-invest / high-n 这种（2026-09-20）
    const m = /([a-z0-9_-]+)(?:\.(?:svg|png))?$/i.exec(String(src || '').trim());
    return m ? m[1].toLowerCase() : null;
  }
  function symSVG(src) {
    const id = symId(src);
    const inner = symInner(id);
    if (!inner) return '';
    const w = '1.8';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + w + '" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }

  /* ---------- Toast ---------- */
  let _toastTimer = null;
  function toast(msg, ms) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('is-hidden');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { el.classList.add('is-hidden'); }, ms || 1800);
  }

  /* ★ 这张卡到底该画哪个符号 —— 渲染层的唯一入口。
     规则一句话：**只有"有身份的卡"才配符号** ——
       名字是星语那 12 个（启程/灯塔/…）→ 画星语自己的符号；其余一律**不画**
       （用户自己建的卡、导入进来的卡都属于这一类，牌面上干干净净）。
     为什么要有这道：早期版本给每张新建卡默认塞了 symbol:'✦'、迁移又把它变成 star4 图形，
     于是用户所有"本来没有符号"的卡正中都凭空多出一颗星（截图里那颗紫星）；更早还盖过符文。
     这里不看牌组、不看来源、也不认"数据里写了什么"，只认**名字有没有身份**。 */
  function symForCard(card) {
    const src = card && card.symbolImg;
    const id = symId(src);
    const DD = global.MoKa && global.MoKa.data;
    if (!id || !DD || !DD.builtinSym(id)) return null;   // 没有图 / 认不出的图 → 不画
    if (DD.isStarName && DD.isStarName(card.name)) return src;    // 星语那 12 张
    return null;                                                  // 其余：没有徽记
  }

  /* ---------- 通用遮罩容器 ---------- */
  const root = () => document.getElementById('overlay-root');
  function clearOverlay() { root().innerHTML = ''; }

  /* ---------- 确认框 ---------- */
  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      const mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.innerHTML =
        '<div class="dialog">' +
          (opts.icon ? '<div class="dialog-icon">' + esc(opts.icon) + '</div>' : '') +
          '<div class="dialog-title">' + esc(opts.title || '确认') + '</div>' +
          (opts.sub ? '<div class="dialog-sub">' + esc(opts.sub) + '</div>' : '') +
          '<button type="button" class="btn btn-primary btn-ok">' + esc(opts.okText || '确定') + '</button>' +
          (opts.cancelText !== false ? '<button type="button" class="btn btn-ghost btn-cancel">' + esc(opts.cancelText || '取消') + '</button>' : '') +
        '</div>';
      mask.querySelector('.btn-ok').addEventListener('click', function () {
        mask.remove(); resolve(true);
      });
      const cancel = mask.querySelector('.btn-cancel');
      if (cancel) cancel.addEventListener('click', function () { mask.remove(); resolve(false); });
      mask.addEventListener('click', function (e) { if (e.target === mask) { mask.remove(); resolve(false); } });
      root().appendChild(mask);
    });
  }

  /* ---------- 文本输入弹窗 ---------- */
  function promptDialog(opts) {
    return new Promise(function (resolve) {
      const mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.innerHTML =
        '<div class="dialog">' +
          '<div class="dialog-title">' + esc(opts.title || '输入') + '</div>' +
          '<div class="field" style="margin:14px 0 16px">' +
            '<input class="input" type="text" maxlength="' + (opts.maxlength || 30) + '" value="' + esc(opts.value || '') + '" placeholder="' + esc(opts.placeholder || '') + '">' +
          '</div>' +
          '<button type="button" class="btn btn-primary btn-ok">' + esc(opts.okText || '确定') + '</button>' +
          '<button type="button" class="btn btn-ghost btn-cancel">取消</button>' +
        '</div>';
      const input = mask.querySelector('.input');
      function submit() { mask.remove(); resolve(input.value.trim()); }
      mask.querySelector('.btn-ok').addEventListener('click', submit);
      mask.querySelector('.btn-cancel').addEventListener('click', function () { mask.remove(); resolve(null); });
      mask.addEventListener('click', function (e) { if (e.target === mask) { mask.remove(); resolve(null); } });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      root().appendChild(mask);
      setTimeout(function () { input.focus(); }, 60);
    });
  }

  // 从图片提取"主色"(取缩略画布的平均色调 → hex)
  function extractColor(src, cb) {
    const img = new Image();
    img.onload = function () {
      try {
        const c = document.createElement('canvas');
        const S = 24;
        c.width = S; c.height = S;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, S, S);
        const d = ctx.getImageData(0, 0, S, S).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
        }
        r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
        cb(rgbToHex(r, g, b));
      } catch (e) { cb('#8a7a3a'); }
    };
    img.onerror = function () { cb('#8a7a3a'); };
    img.src = src;
  }
  function rgbToHex(r, g, b) {
    function h(v) { var x = v.toString(16); return x.length < 2 ? '0' + x : x; }
    return '#' + h(r) + h(g) + h(b);
  }

  global.MoKa = global.MoKa || {};
  global.MoKa.ui = { esc, faceHTML, backHTML, hexA, textOn, toast, confirmDialog, promptDialog, clearOverlay, extractColor,
    symSVG: symSVG, symId: symId, symInner: symInner, symForCard: symForCard, cardArt: cardArt, bandText: bandText,
    textOn: textOn,
    // 编辑页要拿它算"设置 X% → 实际 Y%"（和画牌面用的是同一套算法）
    fitFs: fitFs, textLen: textLen, FIT: FIT,
    // ★ 牌面文字的**位置**只有这一份算法，编辑页的 paintBlock 也必须用它（2026-09-27）
    effNameVy: effNameVy, wrapPosStyle: wrapPosStyle,
    // ★ 2026-10-11「鲸造」编辑器：样式实况预览（与台面共用 chipHTMLFor，唯一真源）
    previewChip: previewChip,
    backThumbInner: backThumbInner, backThumbHasTpl: backThumbHasTpl, backThumbImg: backThumbImg,
    backThumbHasDesign: backThumbHasDesign,
    // ★ 牌堆栏：占卜桌 + 周易页共用同一份渲染（2026-10-20）
    pileDepth: pileDepth, pileStackHTML: pileStackHTML, pileItemHTML: pileItemHTML,
    mixWhite: mixWhite,
    backThumbStyle: backThumbStyle, backThumbHasImg: backThumbHasImg, artSVG: artSVG };
})(window);
