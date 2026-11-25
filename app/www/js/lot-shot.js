/* ============================================================
 * 猫卡 · 签文截图 (lot-shot.js)  v5
 * ------------------------------------------------------------
 * 抽签（签文）页那枚相机键：把**屏幕上这一签**渲染成一张 1080 宽的 PNG。
 *
 * 做法照隔壁「星曜奇门」的 web/js/snapshot.js（同一套思路，不是同一份代码）：
 *   · 不引 html2canvas、不截 WebView —— 按签文卡片的设计用 Canvas 2D 重画一遍；
 *   · 好处：不受滚动位置 / 遮挡 / 屏幕尺寸影响，长签文能自己长高
 *     （DOM 截图做不到"比屏幕还长"的图），也不吃 Android 的截屏权限；
 *   · 画之前先等字体就绪（document.fonts.load），否则第一张会用回退字体画出来。
 *
 * 版式（★ 2026-10-12 用户从 12 版设计稿里选的「笔记卡片」）
 *   ┌ 页面（浅暖灰）                  ┐
 *   │ ┌ 卡片（圆角 + 三层柔影）      │
 *   │ ▍  ← 左侧一道朱砂色带（上下内缩）│
 *   │  ● 神签              2026.10.12 │
 *   │  所问 · xxxxx                   │
 *   │  签文正文……                     │
 *   │  「批注」← 自动认出来，朱砂色     │
 *   │  (猫卡 · 神签)        2026.10.12 │
 *   └─────────────────────────────────┘
 *   · 页面/卡片/字色**跟随主题**（暗色主题自动换深底卡，不会白得刺眼）；
 *   · 问题行按设计稿写「所问 · 」，不跟屏幕上的「问题：」走（屏幕文案会变，图是定稿）。
 *
 * ★ v4（2026-10-19）修两处排版病根：
 *   ① 批注被拆成两种字号：旧写法先按正文字号 52px 把整篇换行、再逐行看行首「，
 *      长批注从第 2 行起被当成正文（52px 墨色）。现在批注段整段按批注字号换行；
 *   ② 字距没算进换行：绘制加 3px 字距、换行不加，实测一行最多超内框 94px。
 *      现在量宽与画字走同一套（measureSpaced / drawSpaced：逐字宽 + 字间字距）。
 *
 * ★ v5（2026-10-19）把排版从"打补丁"升级成一个小引擎：
 *   · **批注按"引用块"认**：不只行首「 —— 引号在本段收尾才算批注；
 *     `「不忍万物靡费…」，将一切…` 这种"引用＋正文"不再被误染成朱砂；
 *     `「占得，…` 没闭合的批注会**跨硬换行**继续，直到出现 」/』（或文末）。
 *   · **西文整词不拆**：`Since 1952. Brooklyn` 不会再断成 `Brookl` + `yn`
 *     （词本身比一行还宽才退化成逐字，URL/长串不会撑爆）。
 *   · **字号自适应改二分**：52px 装不下时，在 30~52 里找**装得下的最大字号**，
 *     而不是按高度比例一刀切；真的还超才截断。
 *   · **截断点尽量落在标点**（。！？；，），末尾补「…」，不是硬切半个字。
 *   · 批注行高单独取 1.62（正文字距 1.76）—— 多行批注更紧凑，不像正文那么散。
 *   · 写盘前 toDataURL 兜错；分享兜底的 objectURL 1 秒后再回收。
 *
 * 落地：MoKa.io.saveImageFile → 原生桥 saveBinary（Download/猫卡/）+ 分享面板；
 *       不在 App 里（浏览器调试）时退回 navigator.share / a.download。
 *
 * 走查钩子：`_wrap_`（换行）/ `_layout_`（排版行）/ `_notePara_`（批注判据）/
 *           `_fit_`（字号自适应）/ `_qText_`（问题行文案）/ `_geom_` / `_fileName_`。
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 出图尺寸与版式（改这里就等于改设计）---------- */
  const W = 1080;                 // 逻辑宽 = 最终像素宽
  const PAGE_PAD_X = 92;          // 页面左右留白
  const PAGE_PAD_T = 96;
  const PAGE_PAD_B = 96;
  const CARD_R = 26;              // 卡片圆角
  /* ★ v5：卡片内的左右内边距对齐设计稿 B —— 文字起点 x=192、右边界 x=872，
     正文一行 12 字（52px + 3px 字距 = 657px，正好落在 680px 的正文宽里）。
     旧值 92 / 76 会让正文排到 13 字，比设计稿"满"一档。 */
  const CARD_PAD_L = 100;         // 卡内左（要让开色带）
  const CARD_PAD_R = 116;
  const CARD_PAD_T = 84;
  const CARD_PAD_B = 70;
  const BAR_W = 8;                // 左侧朱砂色带
  const BAR_INSET = 56;           // 色带上下内缩

  const HEAD_H = 26;              // 「● 神签」那一行
  const DOT_R = 5.5;
  const HEAD_FS = 20, HEAD_LS = 7;
  const FS_Q = 26, LH_Q = 1.6;    // 问题
  const FS_LOT = 52, LH_LOT = 1.76, LS_LOT = 3;   // 签文正文
  const FS_LOT_MIN = 30;          // 超长签文时正文能缩到的下限
  const NOTE_K = 0.73;            // 批注字号 = 正文 × 此值
  const NOTE_LH = 1.62;           // 批注行高（比正文紧一点，多行批注不散）
  const NOTE_LS = 2;

  const GAP_HQ = 42;              // 头部 → 问题
  const GAP_QL = 44;              // 问题 → 正文
  const NOTE_GAP = 40;            // 批注块前面多留的空（只加在块首）
  const GAP_FF = 80;              // 正文 → 页脚
  const FOOT_H = 46;              // 页脚（胶囊 + 日期）
  const CHIP_FS = 19, CHIP_PAD_X = 17, CHIP_PAD_Y = 12;
  const DATE_FS = 20;

  const Q_LABEL = '所问';         // ★ 设计稿的问题行文案（截图定稿，不跟屏幕）
  const Q_SEP = ' · ';            // 设计稿用「所问 · 」（不是冒号）

  const H_MAX = 13000;            // 画布高上限（超了先缩字号；Android 画布约 16k 就废了）
  const TIP_H = DATE_FS + 18;     // 截断提示那一行占的高度（定画布前就要算进来）

  const SERIF = '"MK-Song","Songti SC","Noto Serif CJK SC","STSong",serif';
  const SANS = '"MK-Hei","HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",sans-serif';

  function fontOfLot(fs) { return '400 ' + fs + 'px ' + SERIF; }
  function fontOfSans(fs) { return '400 ' + fs + 'px ' + SANS; }

  /* 两套配色：跟随主题的明暗（暗色主题下别糊一张白卡上去） */
  const LIGHT = {
    page: '#f2f2f0', card: '#fffefb', ink: '#1c2026', ink2: '#4a515a',
    dim: '#9aa1a9', accent: '#9d3a2c', accent2: '#c0473a', chip: '#f1efe9',
    sh1: 'rgba(20,24,30,.07)', sh2: 'rgba(20,24,30,.06)', edge: 'rgba(20,24,30,.035)'
  };
  const DARK = {
    page: '#0f1113', card: '#191b1f', ink: '#ece7dc', ink2: '#c3c8ce',
    dim: '#848b92', accent: '#c8604f', accent2: '#d0604e', chip: '#24272b',
    sh1: 'rgba(0,0,0,.42)', sh2: 'rgba(0,0,0,.34)', edge: 'rgba(255,255,255,.05)'
  };

  /* ---------------- 纯函数（可单测） ---------------- */

  /* 中文避头尾（禁则）：
     · 行首不许出现「，。、；：？！」这类收尾标点 —— 逐字断行最容易踩，读起来像断错了句；
     · 行末不许挂着「（「《」这类开引号。
     做法是最常见的"轻微悬挂/挪行"：标点宁可越过右边界一点点（卡片内边距还有富余），
     也不让它孤零零跑到下一行开头。
     ★ v5：英文的 , . ; : ! ? ) ] } 也算收尾标点（西文签文换行时别把逗号甩到行首）。 */
  const NO_START = '，。、；：？！）］｝〉》」』”’…·%‰℃°〕】,.;:!?)]}';
  const NO_END = '（［｛〈《「『“‘〔【';

  /* 西文 token：一个"词"尽量整体换行（v5）。词本身比一行还宽才退化成逐字。 */
  const WORD_RE = /[A-Za-z0-9'’._:@#%&+\/\-()]/;

  /* 行末标点太多、悬挂会压出卡片：把"最后一个字 + 它后面的标点"一起追到下一行。
     返回 [留在本行的部分, 追到下一行的部分]；整行都是标点（没字可追）返回 null。 */
  function pushBack(line) {
    const chars = Array.from(String(line == null ? '' : line));
    let i = chars.length - 1;
    while (i >= 0 && NO_START.indexOf(chars[i]) >= 0) i--;   // 越过行末的收尾标点
    if (i <= 0) return null;                                 // 没有"字"可追（或只剩一个字）
    const head = chars.slice(0, i).join('');
    const moved = chars.slice(i).join('');
    return [head, moved];
  }

  /* 一行放不下、要换行时：把行末的开引号（「《（…）摘下来，带到下一行行首。
     返回"要接着用的行首"；前半行已经 push 进 out。
     ★ v5 补的：西文整词换行时，`中文中文「abcdef` 以前会把「挂在行末。 */
  function carryOpenQuote(line, out) {
    const last = line.charAt(line.length - 1);
    if (NO_END.indexOf(last) >= 0) {
      if (line.length > 1) { out.push(line.slice(0, -1)); return last; }
      return last;                          // 行里只剩一个开引号：整行带走，不留空行
    }
    out.push(line);
    return '';
  }
  /* 往当前行塞一个字符；塞不下就换行（行末开引号强制跟字走，宁可略超也不落行末） */
  function putChar(line, c, maxW, measure, out) {
    if (!line) return c;
    if (NO_END.indexOf(line.charAt(line.length - 1)) >= 0) return line + c;
    if (measure(line + c) <= maxW) return line + c;
    out.push(line);
    return c;
  }

  /* 按宽度换行：中文逐字（带避头尾），西文按词。
     '\n' 是硬换行（照屏幕 #draw_box 的 pre-wrap 语义），空行照留。
     measure(str) → 宽度（走查里喂假的就行）。 */
  function wrapText(text, maxW, measure, hangLimit) {
    /* hangLimit：最多允许把标点悬挂出右边界多少 px（null = 不限制，兼容旧调用）。
       ★ 2026-10-19 自动扫出来的：连续标点（"。。。"）会被全部挂到行末，
         一行 678px 生生挂成 788px，压出卡片。超限就"追字"——把行末一个字
         连同标点一起挪到下一行，行首仍然是字，不是标点。 */
    const LIMIT = maxW + (hangLimit == null ? Infinity : Math.max(0, hangLimit));
    const paras = String(text == null ? '' : text).split('\n');
    const out = [];
    for (let i = 0; i < paras.length; i++) {
      const s = paras[i];
      if (!s) { out.push(''); continue; }
      const segStart = out.length;      // 本段第一行在 out 里的位置（段首缩进要保留）
      /* ★ 按**码点**迭代：emoji / 扩展汉字是代理对，按 charAt 会被拆成两半，
         量宽与绘制（drawSpaced 用 Array.from）就会对不上。 */
      const chars = Array.from(s);
      let line = '';
      let hang = false;                 // 本段上一行刚悬挂过收尾标点
      for (let k = 0; k < chars.length; k++) {
        const ch = chars[k];

        /* ---- 西文/数字：整词不拆（v5） ---- */
        if (WORD_RE.test(ch)) {
          let j = k;
          while (j < chars.length && WORD_RE.test(chars[j])) j++;
          const word = chars.slice(k, j).join('');
          k = j - 1;                     // 外层 for 会再 +1
          hang = false;
          /* ★ 单个西文收尾标点（`.` `:` `)` `]` `%` …）不跟着"整词"走：
             整词换行会把它甩成行首。交给悬挂规则 —— 宁可超一点，也不让句号当行首。 */
          if (line && word.length === 1 && NO_START.indexOf(word) >= 0) {
            out.push(line + word); line = ''; hang = true;
            continue;
          }
          if (measure(word) > maxW) {
            /* 词自己就超一行（URL / 长串）：只能退化成逐字 */
            if (line) line = carryOpenQuote(line, out);
            for (let q = 0; q < word.length; q++) line = putChar(line, word.charAt(q), maxW, measure, out);
          } else if (!line) {
            line = word;
          } else if (measure(line + word) <= maxW) {
            line += word;
          } else {
            /* 整词挪到下一行；行末要是开引号，得跟着词一起下去（避头尾） */
            line = carryOpenQuote(line, out);
            for (let q = 0; q < word.length; q++) line = putChar(line, word.charAt(q), maxW, measure, out);
          }
          continue;
        }

        if (!line) {
          /* 刚悬挂完又遇到收尾标点：继续挂回上一行末尾（不许行首标点） */
          if (hang && NO_START.indexOf(ch) >= 0) {
            if (out.length) {
              if (measure(out[out.length - 1] + ch) <= LIMIT) { out[out.length - 1] += ch; continue; }
              /* 上一行已经挂不下了：追字（把行末字+标点挪到新行） */
              const back = pushBack(out[out.length - 1]);
              if (back) { out[out.length - 1] = back[0]; line = back[1] + ch; }
              else { line = ch; }
            } else { line = ch; }
            hang = false;
            continue;
          }
          hang = false;
          line = ch;
          continue;
        }
        if (measure(line + ch) <= maxW) { line += ch; continue; }
        if (NO_START.indexOf(ch) >= 0) {          // 收尾标点：留在上一行（悬挂，不当行首）
          if (measure(line + ch) <= LIMIT) {
            out.push(line + ch); line = ''; hang = true;
          } else {                                 // 悬挂会压出卡片：追字，别硬挂
            const back = pushBack(line);
            if (back) { out.push(back[0]); line = back[1] + ch; }
            else { out.push(line); line = ch; }
            hang = false;
          }
        } else if (NO_END.indexOf(line.charAt(line.length - 1)) >= 0) {
          if (line.length === 1) {                // 只剩一个开引号：两个一起挪，别留空行
            out.push(line + ch); line = '';
          } else {
            const moved = line.charAt(line.length - 1);   // 开引号：跟着下一个字走，别留在行末
            out.push(line.slice(0, -1)); line = moved + ch;
          }
        } else { out.push(line); line = ch; }
      }
      if (line) out.push(line);
      /* ★ 换行恰好落在英文空格前时，下一行会以空格开头（视觉上整段缩进）。
         中文排版惯例：**行首半角空格删掉**；全角空格（　）是原文缩进，保留。 */
      for (let j = segStart + 1; j < out.length; j++) {
        out[j] = out[j].replace(/^ +/, '');
      }
    }
    while (out.length && !out[out.length - 1]) out.pop();   // 末尾空行不留
    return out.length ? out : [''];
  }

  /* 单行是否批注（旧判据，只用于兼容字符串行 / 旧的 _note_ 钩子） */
  function isNoteLine(t) {
    const c = String(t || '').charAt(0);
    return c === '「' || c === '『';
  }

  /* ★ v5：整段是否"引用块"（批注）。光看行首「不够——
     `「不忍万物靡费…」，将一切…` 是正文里的引用，不是批注；`「爱的方式」与…` 也是正文。
     判据：段首是「/『，且第一个配对引号一路走到**段尾**（或整段都没闭合 = 跨段引用）。 */
  function isNoteParagraph(s) {
    const str = String(s == null ? '' : s);
    if (!/^[「『]/.test(str)) return false;
    let depth = 0, closed = -1;
    for (let i = 0; i < str.length; i++) {
      const c = str.charAt(i);
      if (c === '「' || c === '『') depth++;
      else if (c === '」' || c === '』') { depth--; if (depth === 0) { closed = i; break; } }
    }
    if (closed < 0) return true;                    // 没闭合：本段是引用块的开头
    return closed === str.replace(/\s+$/, '').length - 1;   // 闭合在段尾：整段是引用
  }
  /* 本段是否以闭引号收尾（跨段引用块的结束判据） */
  function endsWithClose(s) {
    return /[」』]\s*$/.test(String(s == null ? '' : s));
  }

  /* 带字距的一行有多宽：逐字量 + 字间字距。
     ★ 不依赖 ctx.letterSpacing（Chrome 99+ 才有，且内核之间"measureText 算不算
       字距"并不统一）—— 这里自己算，drawSpaced 画的时候也用同一套，永远对得上。 */
  function measureSpaced(ctx, s, ls) {
    const chars = Array.from(String(s == null ? '' : s));
    let w = 0;
    for (let i = 0; i < chars.length; i++) {
      try { w += ctx.measureText(chars[i]).width; } catch (e) { w += 0; }
    }
    return w + (chars.length > 1 ? (chars.length - 1) * (ls || 0) : 0);
  }

  /* 逐字画一行（字距自己加），与 measureSpaced 同一套算式。
     ctx.textAlign 必须是 'left'；ctx.font 调用前设好。 */
  function drawSpaced(ctx, s, x, y, ls) {
    const chars = Array.from(String(s == null ? '' : s));
    let cx = x;
    for (let i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], cx, y);
      let adv = 0;
      try { adv = ctx.measureText(chars[i]).width; } catch (e) { adv = 0; }
      cx += adv + (ls || 0);
    }
  }

  /* ---- 签文排版：先按"段"分正文 / 批注块，再各自用**自己的字号与字距**换行 ----
     返回 [{ text, note, fs, gap }]：
       text 本行文字 / note 是否批注 / fs 本行字号 / gap 本行前面的额外留白
     ★ 批注块可以跨硬换行：`「占得，…\n吕雉不知道…」` 两段都算批注。 */
  function layoutLot(text, fsLot, maxW, ctx) {
    const fs = fsLot || FS_LOT;
    const fsNote = Math.max(1, Math.round(fs * NOTE_K));
    const paras = String(text == null ? '' : text).split('\n');
    const rows = [];
    let inNote = false;
    for (let i = 0; i < paras.length; i++) {
      const s = paras[i];
      if (!s) {
        rows.push({ text: '', note: inNote, fs: inNote ? fsNote : fs, gap: 0 });
        continue;
      }
      const noteStart = !inNote && isNoteParagraph(s);
      const note = inNote || noteStart;
      const f = note ? fsNote : fs;
      const ls = note ? NOTE_LS : LS_LOT;
      if (ctx) {
        ctx.font = fontOfLot(f);
        try { ctx.letterSpacing = '0px'; } catch (e) {}
      }
      const lines = wrapText(s, maxW, function (str) {
        return measureSpaced(ctx || { measureText: function (t) { return { width: String(t).length * f * 0.5 }; } }, str, ls);
      }, f * 1.1);   // 最多允许悬挂约一个标点的宽度
      for (let j = 0; j < lines.length; j++) {
        rows.push({ text: lines[j], note: note, fs: f, gap: (j === 0 && noteStart) ? NOTE_GAP : 0 });
      }
      /* 引用块收尾：本段以 」/』 结束就退出，否则下一段继续算批注 */
      if (note) inNote = !endsWithClose(s);
    }
    while (rows.length && !rows[rows.length - 1].text) rows.pop();   // 末尾空行不留
    return rows.length ? rows : [{ text: '', note: false, fs: fs, gap: 0 }];
  }

  /* 单行占的高度（含批注块前面的留白）—— 量高度和画的时候用的是同一个算式 */
  function rowAdvance(row, fsLot) {
    if (row && typeof row === 'object') {
      const fs = row.fs || fsLot || FS_LOT;
      return fs * (row.note ? NOTE_LH : LH_LOT) + (row.gap || 0);
    }
    /* 兼容：传进来的是一条**字符串**行（旧调用 / 走查）：批注行按批注字号算 */
    const t = String(row == null ? '' : row);
    const note = isNoteLine(t);
    const fs = fsLot || FS_LOT;
    return note ? Math.round(fs * NOTE_K) * NOTE_LH + NOTE_GAP : fs * LH_LOT;
  }
  function lotBlockHeight(lines, fsLot) {
    /* 兼容旧钩子：cardHeight(问题行数, 正文行数, 字号) 里正文行数是个数字 */
    if (typeof lines === 'number') return Math.max(0, lines) * (fsLot || FS_LOT) * LH_LOT;
    if (!Array.isArray(lines)) return 0;
    let h = 0;
    for (let i = 0; i < lines.length; i++) h += rowAdvance(lines[i], fsLot);
    return h;
  }

  /* 卡片高 / 整图高：和下面画的那套坐标是同一个算式，别再各算各的 */
  function cardHeight(qn, lotLines, fsLot, fsQ) {
    const fq = fsQ || FS_Q;
    /* qn=0（没有所问）时不画问题块，那 44px 的问题→正文间距也不该留着 */
    return CARD_PAD_T + HEAD_H + GAP_HQ + qn * fq * LH_Q + (qn ? GAP_QL : 0) +
      lotBlockHeight(lotLines, fsLot || FS_LOT) + GAP_FF + FOOT_H + CARD_PAD_B;
  }
  function totalHeight(cardH) { return PAGE_PAD_T + cardH + PAGE_PAD_B; }

  /* ★ v5：字号自适应。52px 装得下就用 52；装不下在 [30, 52) 里二分，
     找**装得下的最大字号**（比"按高度比例一刀切"准，也不会一上来就缩到底）。
     30px 还装不下才截断——截断点尽量落在标点，补「…」。 */
  function fitLot(lotText, qn, maxW, ctx) {
    const baseRows = layoutLot(lotText, FS_LOT, maxW, ctx);
    const baseCard = cardHeight(qn, baseRows, FS_LOT);
    const baseH = totalHeight(baseCard);
    if (baseH <= H_MAX) {
      return { fs: FS_LOT, rows: baseRows, cardH: baseCard, H: baseH, cut: false };
    }
    let lo = FS_LOT_MIN, hi = FS_LOT - 1, best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const rows = layoutLot(lotText, mid, maxW, ctx);
      const cardH = cardHeight(qn, rows, mid);
      const H = totalHeight(cardH);
      if (H <= H_MAX) { best = { fs: mid, rows: rows, cardH: cardH, H: H }; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (best) return { fs: best.fs, rows: best.rows, cardH: best.cardH, H: best.H, cut: false };

    /* 最小字号也装不下：按高度预算保留行数（O(n) 累加，不再 slice + 重算 O(n²)） */
    const rows = layoutLot(lotText, FS_LOT_MIN, maxW, ctx);
    const fixed = cardHeight(qn, [], FS_LOT_MIN);
    /* 预算按**整图**算：卡片高之外还有页面上下留白与截断提示那一行 */
    const budget = H_MAX - TIP_H - PAGE_PAD_T - PAGE_PAD_B;
    let h = fixed, keep = 0;
    for (let i = 0; i < rows.length; i++) {
      const adv = rowAdvance(rows[i], FS_LOT_MIN);
      if (h + adv > budget) break;
      h += adv; keep++;
    }
    const cutRows = rows.slice(0, Math.max(1, keep));
    const last = cutRows[cutRows.length - 1];
    last.text = trimForCut(last.text);
    const cardH = cardHeight(qn, cutRows, FS_LOT_MIN);
    return { fs: FS_LOT_MIN, rows: cutRows, cardH: cardH, H: totalHeight(cardH) + TIP_H, cut: true };
  }

  /* 截断时别硬切半个字：能退到最近的标点就退，末尾补一个「…」 */
  function trimForCut(text) {
    const s = String(text == null ? '' : text);
    if (!s) return '…';
    const chars = Array.from(s);
    const PUNC = '。！？；，、：,.!?;:';
    for (let i = chars.length - 1; i >= 2; i--) {
      if (PUNC.indexOf(chars[i]) >= 0) return chars.slice(0, i + 1).join('') + '…';
    }
    return chars.slice(0, Math.max(1, chars.length - 1)).join('') + '…';
  }

  /* 问题行文案：设计稿是「所问 · xxx」（不跟屏幕的「问题：」） */
  function questionText(question, label) {
    const q = String(question == null ? '' : question);
    return q ? (label || Q_LABEL) + Q_SEP + q : '';
  }

  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function fileName(dt) {
    return '猫卡-签文-' + dt.getFullYear() + p2(dt.getMonth() + 1) + p2(dt.getDate()) +
      '-' + p2(dt.getHours()) + p2(dt.getMinutes()) + '.png';
  }
  function dateText(dt) {
    return dt.getFullYear() + '.' + p2(dt.getMonth() + 1) + '.' + p2(dt.getDate());
  }

  /* ---------------- 颜色：跟着当前主题走（截图与屏幕同源） ---------------- */
  function lum(c) {
    let m = /^#([0-9a-f]{3})$/i.exec(String(c).trim());
    if (m) c = '#' + m[1][0] + m[1][0] + m[1][1] + m[1][1] + m[1][2] + m[1][2];
    m = /^#([0-9a-f]{6})/i.exec(String(c).trim());
    if (m) {
      const n = parseInt(m[1], 16);
      return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    }
    m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(String(c));
    if (m) return (0.2126 * (+m[1]) + 0.7152 * (+m[2]) + 0.0722 * (+m[3])) / 255;
    return -1;                        // 认不出（返回 -1，交给调用方按主题属性兜底）
  }
  /* ★ v5：先认 html 上的 data-ui-theme（App 里主题的唯一真源，app.js 写的就是它），
     再退回 --bg 的亮度。旧写法只认 --bg：变量取不到时暗色会糊一张白卡。 */
  function theme() {
    let dark = false;
    try {
      dark = document.documentElement.getAttribute('data-ui-theme') === 'dark';
    } catch (e) {}
    if (!dark) {
      try {
        const rs = getComputedStyle(document.documentElement);
        const s = String(rs.getPropertyValue('--bg') || '').trim();
        if (s) { const l = lum(s); if (l >= 0) dark = l < 0.45; }
      } catch (e) {}
    }
    return dark ? DARK : LIGHT;
  }

  /* ---------------- 画 ---------------- */
  function render(d) {
    d = d || {};
    const T = theme();
    const question = String(d.question == null ? '' : d.question);
    const qText = questionText(question, d.qLabel);
    const lotText = String(d.lot == null ? '' : d.lot);
    /* ★ 2026-10-12：正文与问题**一律左对齐**（用户选定的设计稿就是这么排的）。
       屏幕上"短签居中 / 长签顶格"那一档（lots.js 的 align）**不再传给截图** ——
       截图是拿去分享的一张图，排版跟设计稿走，不跟屏幕走。d.align 留着只为兼容旧调用。 */
    const now = d.date || new Date();

    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('这个环境没有 Canvas 2D');

    /* 字距：新内核支持 ctx.letterSpacing（Chrome 99+），老内核忽略即可 —— 不抛错。
       ★ 正文/批注不走它（走 drawSpaced 自己加），只有"神签"两个字的头部小字距用它。 */
    function ls(v) { try { ctx.letterSpacing = v + 'px'; } catch (e) {} }

    const cardW = W - PAGE_PAD_X * 2;
    const innerW = cardW - CARD_PAD_L - CARD_PAD_R;
    const F_Q = fontOfSans(FS_Q);

    /* ① 先量：换行 + 高度（量文字用的还是这块画布，尺寸等会儿才定） */
    ls(0);
    ctx.font = F_Q;
    const qLines = question
      ? wrapText(qText, innerW, function (s) { ctx.font = F_Q; return ctx.measureText(s).width; })
      : [];
    const fitted = fitLot(lotText, qLines.length, innerW, ctx);
    const rows = fitted.rows;
    const cardH = fitted.cardH;
    const H = fitted.H;
    const tip = fitted.cut;

    cv.width = W;
    cv.height = Math.round(H);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    /* ② 页面底色 */
    ctx.fillStyle = T.page;
    ctx.fillRect(0, 0, W, cv.height);

    /* ③ 卡片：三层柔影（canvas 一次只能一层，所以分两次 fill 叠出来）+ 一圈极淡描边 */
    const cardX = PAGE_PAD_X, cardY = PAGE_PAD_T;
    ctx.save();
    ctx.fillStyle = T.card;
    ctx.shadowColor = T.sh1; ctx.shadowBlur = 70; ctx.shadowOffsetY = 34;
    rrect(ctx, cardX, cardY, cardW, cardH, CARD_R); ctx.fill();
    ctx.shadowColor = T.sh2; ctx.shadowBlur = 26; ctx.shadowOffsetY = 12;
    rrect(ctx, cardX, cardY, cardW, cardH, CARD_R); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = T.edge; ctx.lineWidth = 1;
    rrect(ctx, cardX + 0.5, cardY + 0.5, cardW - 1, cardH - 1, CARD_R); ctx.stroke();

    /* ④ 左侧朱砂色带（上下内缩、只右侧圆角） */
    ctx.save();
    rrect(ctx, cardX, cardY, cardW, cardH, CARD_R);
    ctx.clip();                                  // 让色带乖乖待在卡片里
    const barH = cardH - BAR_INSET * 2;
    /* 色带用渐变；**拿不到渐变就退回纯色** —— 走查的 canvas 桩没实现 createLinearGradient，
       真机（Chrome/WebView）有。渲染代码不许因为"某个内核少一个 API"整张图崩掉。 */
    let barFill = T.accent;
    try {
      const g = ctx.createLinearGradient(0, cardY + BAR_INSET, 0, cardY + BAR_INSET + barH);
      if (g && typeof g.addColorStop === 'function') {
        g.addColorStop(0, T.accent2);
        g.addColorStop(1, T.accent);
        barFill = g;
      }
    } catch (e) {}
    ctx.fillStyle = barFill;
    barPath(ctx, cardX, cardY + BAR_INSET, BAR_W, barH, 8);
    ctx.fill();
    ctx.restore();

    /* ⑤ 内容（基线一行一槽地排，结构上不可能重叠） */
    const x0 = cardX + CARD_PAD_L;
    const xMax = cardX + cardW - CARD_PAD_R;
    let y = cardY + CARD_PAD_T;

    /* 头部：一个朱砂圆点 + 「神签」 */
    ls(HEAD_LS);
    ctx.font = fontOfSans(HEAD_FS);
    ctx.fillStyle = T.accent;
    ctx.beginPath();
    ctx.arc(x0 + DOT_R, y + HEAD_H / 2, DOT_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = T.dim;
    ctx.fillText('神签', x0 + DOT_R * 2 + 18, y + HEAD_H / 2 + HEAD_FS * 0.36);
    ls(0);
    y += HEAD_H + GAP_HQ;

    /* 问题（「所问 · 」是定稿文案；问题为空时整块不出现） */
    if (qLines.length) {
      ctx.font = F_Q;
      ctx.fillStyle = T.ink2;
      ctx.textAlign = 'left';
      for (let i = 0; i < qLines.length; i++) {
        ctx.fillText(qLines[i], x0, y + i * FS_Q * LH_Q + FS_Q * 0.8);
      }
      y += qLines.length * FS_Q * LH_Q + GAP_QL;
    }

    /* 签文：一段一段排。批注块整块朱砂小字（跨硬换行也继续），正文段落墨色大字；
       两种字号、字距、行高都由 layoutLot 算好，画的时候照抄。 */
    try { ctx.letterSpacing = '0px'; } catch (e) {}
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      y += r.gap || 0;
      ctx.font = fontOfLot(r.fs);
      ctx.fillStyle = r.note ? T.accent : T.ink;
      ctx.textAlign = 'left';
      if (r.text) drawSpaced(ctx, r.text, x0, y + r.fs * 0.82, r.note ? NOTE_LS : LS_LOT);
      y += r.fs * (r.note ? NOTE_LH : LH_LOT);
    }

    /* ⑥ 页脚：左「猫卡 · 神签」胶囊，右日期 */
    const fy = cardY + cardH - CARD_PAD_B - FOOT_H;
    ctx.font = fontOfSans(CHIP_FS);
    const chipText = '猫卡 · 神签';
    const chipW = ctx.measureText(chipText).width + CHIP_PAD_X * 2;
    const chipH = CHIP_FS + CHIP_PAD_Y * 2;
    ctx.fillStyle = T.chip;
    rrect(ctx, x0, fy + (FOOT_H - chipH) / 2, chipW, chipH, chipH / 2);
    ctx.fill();
    ctx.fillStyle = T.dim;
    ctx.textAlign = 'left';
    ctx.fillText(chipText, x0 + CHIP_PAD_X, fy + FOOT_H / 2 + CHIP_FS * 0.36);
    ctx.font = fontOfSans(DATE_FS);
    ctx.textAlign = 'right';
    ctx.fillText(dateText(now), xMax, fy + FOOT_H / 2 + DATE_FS * 0.36);

    if (tip) {
      ctx.textAlign = 'center';
      ctx.font = fontOfSans(DATE_FS - 2);
      ctx.fillStyle = T.dim;
      ctx.fillText('签文过长，这张图已截断 · 全文见 App', W / 2, cardY + cardH + 46);
    }
    return cv;
  }

  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* 左侧贴边、右侧圆角的竖条（用来画那道朱砂色带） */
  function barPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w, h / 2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
  }

  /* ---------------- 字体就绪（第一张别用回退字体画） ---------------- */
  function fontsReady() {
    try {
      const F = global.document && document.fonts;
      if (!F || !F.load) return Promise.resolve();
      return Promise.all([
        F.load('400 ' + HEAD_FS + 'px "MK-Hei"'),
        F.load('400 ' + FS_LOT + 'px "MK-Song"')
      ]).then(function () {}, function () {});
    } catch (e) { return Promise.resolve(); }   // 拿不到字体就算了，用回退字体画
  }

  /* ---------------- 出图 + 落地 ---------------- */
  function shot(d) {
    return fontsReady().then(function () {
      let cv;
      try { cv = render(d); }
      catch (e) { return { err: '截图失败：' + ((e && e.message) || e) }; }
      const name = fileName((d && d.date) || new Date());
      let url;
      try { url = cv.toDataURL('image/png'); }
      catch (e) { return { err: '截图失败：图片太大，手机内存不够' }; }
      const io = global.MoKa && global.MoKa.io;
      if (io && io.saveImageFile) {
        const r = io.saveImageFile(name, url);
        if (r && r.name) return { name: r.name };
        if (r && r.err) return { err: r.err };
      }
      return browserFallback(cv, name);
    });
  }

  /* 不在 App 里（浏览器/走查）时的退路：能分享就分享，否则下载 */
  function browserFallback(cv, name) {
    return new Promise(function (resolve) {
      if (!cv.toBlob) { resolve({ err: '这个环境不支持导出图片' }); return; }
      cv.toBlob(function (blob) {
        if (!blob) { resolve({ err: '截图失败' }); return; }
        let file = null;
        try { file = new File([blob], name, { type: 'image/png' }); } catch (e) {}
        if (file && global.navigator && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: '猫卡 · 神签' }).then(
            function () { resolve({ name: name, shared: true }); },
            function () { download(blob, name, resolve); });
          return;
        }
        download(blob, name, resolve);
      }, 'image/png');
    });
  }
  function download(blob, name, done) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a);
      a.click();
      /* 立刻 revoke 会让某些浏览器（Firefox / 老内核）下载还没开始就把 URL 收走 */
      setTimeout(function () {
        try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) {}
      }, 1000);
      done({ name: name, downloaded: true });
    } catch (e) { done({ err: '截图失败：' + ((e && e.message) || e) }); }
  }

  global.MoKa = global.MoKa || {};
  global.MoKa.lotShot = {
    shot: shot,
    render: render,
    fileName: fileName,
    // 走查钩子（下划线结尾 = 本项目的走查约定）
    _wrap_: wrapText,
    _note_: isNoteLine,
    _notePara_: isNoteParagraph,
    _layout_: layoutLot,
    _fit_: fitLot,
    _qText_: questionText,
    _geom_: { cardHeight: cardHeight, totalHeight: totalHeight, W: W, PAD: PAGE_PAD_X },
    _fileName_: fileName
  };
})(window);
