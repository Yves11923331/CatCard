/* ============================================================
 * 猫卡 · 占卜桌 headless 走查（jsdom）
 * ------------------------------------------------------------
 * 目的：改「选牌台自动洗牌」前后，用同一套断言验证行为。
 * 用法： node app/test/走查-占卜桌选牌台.js
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('/tmp/jt/node_modules/jsdom');

/* 前端目录：默认按**脚本自身位置**推导（app/test/../www = app/www），不再写死某个绝对路径 ——
   2026-11-05：原来写的是 `app/www`，项目搬到「A1项目-归档」后该目录已不存在，
   本套走查在 `tools/验证.py 全部` 里恒定红一条（ENOENT），把真红假红一起淹掉。
   要验「解包后的包内那份」时照旧用环境变量覆盖：WWW=/tmp/pkg/assets node … */
const WWW = process.env.WWW || path.join(__dirname, '..', 'www');
const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');

const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'outside-only',
  pretendToBeVisual: true
});
const { window } = dom;
const doc = window.document;

/* ---------- jsdom 没有指针捕获（真机有），补三个空实现 ----------
   不补的话 bindCardPointer 里 `if (!el.hasPointerCapture) return` 会直接吃掉 pointermove，
   "用手拖牌"这条路在走查里等于完全没测到（做摆牌辅助时才发现的这个盲区）。 */
if (!window.Element.prototype.setPointerCapture) window.Element.prototype.setPointerCapture = function () {};
if (!window.Element.prototype.hasPointerCapture) window.Element.prototype.hasPointerCapture = function () { return true; };
if (!window.Element.prototype.releasePointerCapture) window.Element.prototype.releasePointerCapture = function () {};

/* ---------- 抓所有未捕获异常 ---------- */
const errors = [];
window.addEventListener('error', e => errors.push('window.error: ' + (e.message || e.type)));
window.addEventListener('unhandledrejection', e => errors.push('unhandledrejection: ' + (e.reason && e.reason.message || e.reason)));

/* ---------- 按顺序加载（只加载跑得起来的这几支） ---------- */
['js/idb.js', 'js/builtin-decks.js', 'js/builtin-asks.js', 'js/random.js', 'js/data.js', 'js/ui.js', 'js/imagecrop.js', 'js/lot-shot.js', 'js/scenes/table.js', 'js/scenes/library.js', 'js/scenes/editor.js', 'js/scenes/settings.js', 'js/scenes/lots.js'].forEach(f => {
  window.eval(fs.readFileSync(path.join(WWW, f), 'utf8'));
});

const MoKa = window.MoKa;
const UI2 = window.MoKa.ui;
const D = MoKa.data;
const T = MoKa.table;

/* ---------- 断言小工具 ---------- */
let pass = 0, fail = 0;
const pending = [];        // 需要 await 的异步断言（见文件末尾统一收尾）
/* ★ 2026-10-12：**静默模式**（`MOKA_QUIET=1`）—— 只打失败与汇总。
   这套近 500 条、每条约 ✔ 一行，全量输出 600 行上下；小改动也让它刷屏的话，
   人和 agent 都得为那几百行付上下文。行为一个字没变，只是不打"通过"的那几百行。
   （段标题 `【N】` 留着 —— 出问题时能看出卡在哪一组。） */
const QUIET = !!process.env.MOKA_QUIET;
function ok(cond, msg, extra) {
  if (cond) { pass++; if (!QUIET) console.log('  ✔ ' + msg); }
  else { fail++; console.log('  ✘ ' + msg + (extra ? '   → ' + extra : '')); }
}
function eq(a, b, msg) { ok(a === b, msg, `实际 ${JSON.stringify(a)} / 期望 ${JSON.stringify(b)}`); }

console.log('\n【裁剪画布内存上限】');
const cropCap = MoKa.imagecrop._intermediateCanvasCap;
const getCropCanvas = MoKa.imagecrop._getCroppedCanvas;
function cropMock(canvas, cropBox) {
  return { getCanvasData: function () { return canvas; }, getCropBoxData: function () { return cropBox; } };
}
eq(JSON.stringify(cropCap(cropMock({ width: 400, height: 600, naturalWidth: 4000, naturalHeight: 6000 },
  { width: 400, height: 600 }), 1080, 1620)), JSON.stringify({ maxWidth: 1080, maxHeight: 1620 }),
  '★ 4000×6000 原图全幅裁剪：中间画布限制为成品尺寸');
eq(JSON.stringify(cropCap(cropMock({ width: 400, height: 600, naturalWidth: 4000, naturalHeight: 6000 },
  { width: 200, height: 300 }), 1080, 1620)), JSON.stringify({ maxWidth: 2160, maxHeight: 3240 }),
  '★ 2× 放大裁剪按 ROI 提高采样上限，不被固定成品尺寸压糊');
eq(JSON.stringify(cropCap(cropMock({ width: 600, height: 400, naturalWidth: 6000, naturalHeight: 4000 },
  { width: 266.6666666667, height: 400 }), 1080, 1620)), JSON.stringify({ maxWidth: 2430, maxHeight: 1620 }),
  '★ EXIF 旋转后的横向自然画布仍按旋转坐标计算采样上限');
eq(JSON.stringify(cropCap(cropMock({ width: 400, height: 600, naturalWidth: 800, naturalHeight: 1200 },
  { width: 400, height: 600 }), 1080, 1620)), JSON.stringify({ maxWidth: 1080, maxHeight: 1620 }),
  '★ 小于成品尺寸的原图保留 1080×1620 输出口径');
eq(cropCap(cropMock({ width: 400, height: 600, naturalWidth: 4000, naturalHeight: 6000 },
  { width: 0, height: 300 }), 1080, 1620), null,
  '★ 裁剪尺寸无效时返回安全回退，不生成零尺寸上限');
let cropOptions = null;
const cropResult = {};
const cropCall = cropMock({ width: 400, height: 600, naturalWidth: 4000, naturalHeight: 6000 },
  { width: 400, height: 600 });
cropCall.getCroppedCanvas = function (options) { cropOptions = options; return cropResult; };
eq(getCropCanvas(cropCall, 1080, 1620), cropResult, '★ 裁剪完成实际经限额封装调用 Cropper');
eq(JSON.stringify(cropOptions), JSON.stringify({ width: 1080, height: 1620, imageSmoothingQuality: 'high',
  fillColor: '#ffffff', maxWidth: 1080, maxHeight: 1620 }),
  '★★ 原图全幅裁剪把内存 cap 和原成品输出选项一并传给 Cropper');

/* ---------- 自给自足读 CSS 的那几条断言用它：查"某个选择器所在的规则体里有没有某条声明" ----------
   ★ 2026-10-15 修（这两条断言原来把选择器的**字面写法**锁死了）：
     正则写的是 `/\.dbb-tpl, \.tc-tpl \{/`，而 v3.css 早已按"同族人一起登记"的规矩
     合并成 `.dbb-tpl, .tc-tpl, .ps-tpl {` —— 功能从头到尾都是对的，
     红的只是断言。于是"给同族多登记一个兄弟选择器"这种**正确**的改动会被判成回归，
     真正的回归反而淹没在这条假警报里（这一次就红了 2 条，把基线弄脏了）。
   现在的判据是**语义**：这个选择器所在的那条规则里，有没有这条声明。
   仍然有牙 —— 删掉 position:absolute 必红（退回旧写法验过，见 §17）。 */
function cssRuleHas(css, sel, declRe) {
  // ★ 先剥注释：v3.css 的注释里会**引用选择器名**（比如"当初 `.ps-tpl` 漏了这条"），
  //   不剥的话正则从注释里那个名字起头、一路吃到后面第一条规则的 `{`，
  //   查的就成了别人的规则体（第一版就栽在这儿：查 `.ps-tpl` 查到了 .deck-box-back 身上）。
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 从选择器出现处往后**第一个**规则体（[^{}]* 不许跨过 { }，所以不会跑到别的规则里去）
  const m = new RegExp(esc + '[^{}]*\\{([^{}]*)\\}').exec(clean);
  return !!m && new RegExp(declRe).test(m[1]);
}

/* ---------- 启动（用 App 自己会给的那副牌，别硬塞 —— 免得断言拿错对象） ----------
   ★ 先写 moka.tut.reset：教程的 600ms 定时器会在第 12 组（长按扇）之前把扇关掉，
     那是**测试自己的竞态**，不是 App 的问题。教程单独在第 13 组测。 */
window.localStorage.setItem('moka.tut.reset', '1');
// 首次「往右拉这条线」提示：前面几组统一当「已经看过」，第 12f 组再单独验它
window.localStorage.setItem('moka.tut.pull.v1', '1');
T.init();
if (MoKa.library && MoKa.library.init) MoKa.library.init();   // 牌背设定页要用
if (MoKa.editor && MoKa.editor.init) MoKa.editor.init();
T.openTable();

const snap = () => T.snapshot_();
const pile0 = () => snap() && snap().piles[0];
const deckId = pile0().deckId;                       // 真正上了桌的那一副
const deck = D.findDeck(deckId);
const origOrder = deck.cards.map(c => c.id);         // 牌堆原顺序
const N = origOrder.length;

console.log('\n【0】CSS 语法体检（注释提前闭合会把后面的规则整条吞掉，踩过）');
(function cssSanity(){
  ['css/v3.css', 'css/main.css'].forEach(function (f) {
    const css = fs.readFileSync(path.join(WWW, f), 'utf8');
    const nc = css.replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0, buf = '', bad = [];
    for (const ch of nc) {
      if (ch === '{') {
        if (depth === 0 && /[\u4e00-\u9fa5]/.test(buf)) bad.push(buf.trim().slice(0, 60));
        depth++; buf = '';
      } else if (ch === '}') { depth--; buf = ''; }
      else if (depth === 0) buf += ch;
    }
    ok(depth === 0, f + ' 的花括号是平衡的');
    ok(bad.length === 0, f + ' 没有"注释外露出来的裸文本"', bad.join(' / '));
  });

  /* ★★ 2026-10-05 修「关键词太长时文字冲出底色 / 块向右偏」（用户报的易经 8 字关键词）：
     病根有两个，都得钉住 ——
     ① Android WebView 的 **Font Boosting（文本自动放大）**：小字号 + 文本块接近容器宽时会
        自己把字放大。牌面小、关键词字号只有 6~14px、chip 又几乎占满容器，正好踩中 ——
        放大后 fitFs 估算的字号失效，而 white-space:nowrap 不让折行，文字就**直接从盒子里漏出去**；
     ② .fc-chip 原来不是 border-box：max-width:100% 只管内容宽，左右还各加 10% 牌宽的 padding，
        文字一长到触及 max-width，**块总宽能到 102.2% 牌宽（两边各冲出 1.1%）**。 */
  const v3src = fs.readFileSync(path.join(WWW, 'css/v3.css'), 'utf8');
  {
    ok(/-webkit-text-size-adjust:\s*100%/.test(v3src),
      '★★ 锁死了文本自动放大（不然 WebView 会把关键词的小字号抬大 → 冲出底色、块偏一边）');
    ok(/\.fc-chip\s*\{[\s\S]{0,1200}?box-sizing:\s*border-box/.test(v3src),
      '★★ .fc-chip 是 border-box（块的宽度永远不会超过容器）');
    ok(/safe:\s*0\.57/.test(fs.readFileSync(path.join(WWW, 'js/ui.js'), 'utf8')),
      '★ 宽度估算留了余量（FIT.safe = 0.57，不再贴着可用宽度 62.2% 的边）');
  }

  // 牌面阴影：小卡必须是"只留环境层"的平滑阴影，否则亚像素闪烁会回来
  const v3 = fs.readFileSync(path.join(WWW, 'css/v3.css'), 'utf8');
  const sm = v3.match(/--card-shadow-sm:\s*([^;]+);/);
  ok(!!sm, '定义了 --card-shadow-sm');
  const px = sm ? (sm[1].match(/(\d+)px/g) || []).map(function (x) { return parseInt(x, 10); }) : [];
  ok(px.length > 0 && Math.max.apply(null, px) >= 6,
     '小卡阴影的模糊半径 >= 6px（防"极细阴影"亚像素闪烁）', sm ? sm[1].trim() : '');
  // 只按顶层逗号切分 box-shadow 的图层（rgba(...) 里面也有逗号，不能硬 split）
  function layersOf(v){
    const out = []; let d = 0, cur = '';
    for (const ch of v) {
      if (ch === '(') d++;
      if (ch === ')') d--;
      if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function shadowOf(sel){
    const m = v3.match(new RegExp(sel + '\\s*\\{([^}]*)\\}'));
    if (!m) return null;
    const sm = m[1].match(/box-shadow:\s*([^;]+)/);
    return sm ? sm[1].trim() : null;
  }

  // 选牌台：默认**没有**阴影（那个会闪的灰影）；只有 is-edge 时才画内阴影式的纸边
  const trayBase = shadowOf('\\.tray-card');
  ok(/^none/.test(trayBase || ''), '.tray-card 默认不要阴影（会闪的那个）', trayBase);
  const trayEdge = shadowOf('\\.tray-card\\.is-edge');
  const trayL = trayEdge ? layersOf(trayEdge) : [];
  ok(trayL.length > 0 && trayL.every(function (x) { return x.indexOf('inset') === 0; }),
     '选牌台纸边全是内阴影（没有外投影，不会闪）', trayEdge);

  // 牌背纸边：挂在 .tcard-back::before 上，且只在 .is-edge 时渲染
  ok(/\.tcard-back::before \{ content: none/.test(v3), '纸边关掉时 ::before 不渲染（零残留）');
  const backBefore = v3.match(/\.tcard-back\.is-edge::before \{([^}]*)\}/);
  ok(!!backBefore, '.tcard-back.is-edge::before 存在（纸边画在这上面）');
  ok(!!backBefore && /inset 0 -\d+px/.test(backBefore[1]), '牌背纸边有底部内凹');
  ok(!!backBefore && /inset 0 1px 0/.test(backBefore[1]), '牌背纸边有顶部受光');
  ok(!!backBefore && /z-index:\s*2/.test(backBefore[1]), '纸边层在自设牌背图之上（z-index:2）');

  // 牌堆栏：外投影 + is-edge 时叠纸边（2026-10-20 重构：这两样从 .pile-stack
  // 搬到了牌面层 .ps-face 上，舞台本身不再画东西）
  ok(/\.pile-stack \.ps-face \{[^}]*--card-shadow-sm\)/.test(v3), '.ps-face 保留外投影');
  ok(/\.pile-stack\.is-edge \.ps-face \{[^}]*inset 0 -2px/.test(v3), '.pile-stack.is-edge 的纸边叠在 .ps-face 上');
  ok(/\.tcard-side \{[^}]*box-shadow:\s*var\(--card-shadow\)/.test(v3),
     '.tcard-side 用的是 --card-shadow');

  // 牌背设定页：纸边开关 + 排版规整
  const lib = fs.readFileSync(path.join(WWW, 'js/scenes/library.js'), 'utf8');
  ok(/id="edge-on"/.test(lib) && /id="edge-off"/.test(lib), '牌背设定页有纸边 开/关');
  ok(/edge:\s*backDraft\.edge/.test(lib), '保存时把纸边一起存进牌组');
  ok(/backEdge !== false/.test(lib), '没有 backEdge 字段的旧牌组默认开纸边');
  ok(lib.indexOf('display:flex;align-items:center;justify-content:space-between') === -1,
     '没有残留的重复 inline flex（已换成 .set-row）');
  ok(/class="set-row"/.test(lib) && /sec-card-actions/.test(lib), '用了 .set-row / .sec-card-actions 统一排版');
  ok(/class="sec-card-h"/.test(lib), '用了 .sec-card-h 分组标题（分区卡片化）');
  ok(/id="face-on"/.test(lib) && /id="face-off"/.test(lib), '有「牌面纸边」开关');
  ok(/faceEdge:\s*backDraft\.faceEdge/.test(lib), '保存时把牌面纸边一起存了');
  ok(lib.indexOf('tpl-thumb') === -1 && lib.indexOf('tpl-item') === -1,
     '边框模板的缩略图彻底不用了（换成 .tpl-chip）');
  const tplCount = (lib.match(/\{ id: '(?:[a-z]+)'|\{ id: null/g) || []).length;
  eq(tplCount, 7, '模板表 = 7 项（无边框 + 6 个通用纹）；内置牌背已数据化（back.svg），不再进这张表');
  // 通用模板在 CSS 里都要有画法，而且牌面 + 大预览两处都要覆盖
  ['frame','double','lozenge','corner','dotted','stripe'].forEach(function (t) {
    ok(v3.indexOf('.tcard-back.is-tpl-' + t + '::after') > -1, '模板 ' + t + ' 有牌背画法');
    ok(v3.indexOf('.back-preview.is-tpl-' + t + '::after') > -1, '模板 ' + t + ' 有大预览画法');
  });
  // ★ 2026-09-21：「斜纹」下架 —— 模板表和 CSS 里都不该再有它
  ok(lib.indexOf("'diag'") === -1 && v3.indexOf('.is-tpl-diag') === -1,
     '★ 下架的「斜纹」在模板表和 CSS 里都清干净了');
  ok(/\.cb-tpl, \.bp-tpl \{/.test(v3),
     '★ 内置牌背共用 .cb-tpl/.bp-tpl 定位样式');
  ok(/\.tpl-chip\s*\{/.test(v3) && /\.tpl-chip\.is-sel/.test(v3), '.tpl-chip 有样式和选中态');
  ok(/\.back-preview \.bp-img \{ box-shadow: none !important/.test(v3),
     '关掉了老画法（.bp-img 的 inset 阴影），不然两套会叠');

  // ★ 全项目扫描：grid-template-columns 里的 fr 必须写在 minmax(...) 里。
  //   1fr 其实是 minmax(auto, 1fr) —— 列宽压不到内容 min-content 以下，
  //   一句 white-space:nowrap 的长文字就能把它那一列撑宽（管理页微缩卡就是这么被撑歪的）。
  const cssFiles = fs.readdirSync(path.join(WWW, 'css')).filter(function (f) { return /\.css$/.test(f); });
  const badGrid = [];
  cssFiles.forEach(function (f) {
    const css = fs.readFileSync(path.join(WWW, 'css', f), 'utf8');
    const re = /grid-template-columns\s*:\s*([^;}]+)/g;
    let m;
    while ((m = re.exec(css))) {
      const v = m[1];
      const stripped = v.replace(/minmax\([^)]*\)/g, 'M');
      if (/\d*\.?\d*fr/.test(stripped)) badGrid.push(f + ' → ' + v.trim());
    }
  });
  ok(badGrid.length === 0,
     '没有裸的 1fr（列宽必须 minmax(0, 1fr)，防长文字把整列撑宽）', badGrid.join(' ｜ '));

  // ★ 同一类：flex:1 + white-space:nowrap 的元素必须写 min-width:0，
  //   否则 min-width:auto（= 内容的 min-content）让它**压不下去**，长文字会把整行顶开。
  //   注意要**按选择器合并所有声明**再判 —— 这类写法经常 flex 和 nowrap 分散在两个文件里。
  const merged = {};
  cssFiles.forEach(function (f) {
    const css = fs.readFileSync(path.join(WWW, 'css', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m2;
    while ((m2 = re.exec(css))) {
      m2[1].split(',').forEach(function (raw) {
        const sel = raw.trim().replace(/\s+/g, ' ');
        if (!sel || sel.charAt(0) === '@' || sel.indexOf('{') > -1) return;
        merged[sel] = (merged[sel] || '') + ';' + m2[2];
      });
    }
  });
  const badFlex = Object.keys(merged).filter(function (sel) {
    const b = merged[sel];
    return /flex\s*:\s*1(?![^;]*min-width)/.test(b) &&
           /white-space\s*:\s*nowrap/.test(b) &&
           !/min-width\s*:\s*0/.test(b);
  });
  ok(badFlex.length === 0,
     '没有「flex:1 + nowrap 却没写 min-width:0」的元素（长文字会把整行顶开）', badFlex.join(' ｜ '));

  // 工具浮层已经撤掉（工具搬到右栏），别只留半套
  const htmlAll = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  const tableJs = fs.readFileSync(path.join(WWW, 'js/scenes/table.js'), 'utf8');
  ok(htmlAll.indexOf('id="tray-tools"') === -1, 'index.html 里没有 #tray-tools 了');
  ok(htmlAll.indexOf('id="btn-back-top"') === -1 && htmlAll.indexOf('id="btn-set-origin"') === -1,
     '旧的 #btn-back-top / #btn-set-origin 没有复活');
  ok(htmlAll.indexOf('id="tray-tools"') === -1 && tableJs.indexOf("getElementById('tray-tools')") === -1,
     'JS 里也不再找 #tray-tools');
  ok(!/\.tray-fan\s*\{/.test(v3) && !/\.fan-bg\s*\{/.test(v3), 'CSS 里的扇形浮层规则也清了');
  // 「起点」按钮整颗下架（2026-09-18；回到起点 + 新建起点都交给"视野一动就自动锚定"）——
  //   整条功能退役、防复活探针已清，这里只留正向的那条 ensureOrigin()。
  ok(/function ensureOrigin\(\)/.test(tableJs), '改成自动锚定：ensureOrigin()');

  // 牌面纸边
  const faceBefore = v3.match(/\.tcard-face\.is-edge::before \{([^}]*)\}/);
  ok(!!faceBefore, '.tcard-face.is-edge::before 存在（牌面纸边画在这上面）');
  ok(!!faceBefore && /inset 0 0 0 1px/.test(faceBefore[1]), '牌面纸边有内描边');
  ok(!!faceBefore && /z-index:\s*2/.test(faceBefore[1]), '牌面纸边压在 .fc-img 之上');
})();

// ★ 渲染性能守卫（§24 的结论 + 2026-09-18 复查）：
//   牌桌上"会动"的东西一律不许上 filter / backdrop-filter —— 那是滑动掉帧最典型的来源。
//   做法：把 CSS 拆成一条条规则，凡是选择器涉及牌桌、又声明了活的 filter/backdrop 的，全部点名。
(function renderingGuards() {
  const v3 = fs.readFileSync(path.join(WWW, 'css/v3.css'), 'utf8');   // 自给自足，别去借外面那个闭包
  // ★ 注释必须先剥掉：注释里到处在讲"filter: drop-shadow"这件事（§24 的解释就是），
  //   不剥的话全是自己吓自己的误报（第一版就踩了，报出来的是注释原文）。
  const v3nc = v3.replace(/\/\*[\s\S]*?\*\//g, '');
  const liveBad = [];
  const tableSel = /\.tcard|\.desk-canvas|\.world-ground|\.pile-(strip|item|stack)|\.table-bar|\.tabbar|\.tray-btn|\.tray-card|\.edge-pull/;
  const movingSel = /\.tcard|\.desk-canvas|\.world-ground|\.tray-card/;
  // ★ 别用 (?!none) 这种负向前瞻判"是不是 none" —— \s* 会回溯，结果 "filter: none" 也会被当成
  //   活的 filter（第一版就这么误报了 §24 自己那两条规则）。老实用捕获 + trim 判断。
  const declared = function (body, prop) {
    const m = body.match(new RegExp('(?:^|[^-])' + prop + '\\s*:\\s*([^;!]+)'));
    if (!m) return null;
    const v = m[1].trim();
    return /^none\b/.test(v) ? null : v;
  };
  (v3nc.match(/[^{}]+\{[^}]*\}/g) || []).forEach(function (r) {
    const sel = r.split('{')[0], body = r.split('{')[1] || '';
    if (declared(body, 'backdrop-filter') && tableSel.test(sel)) liveBad.push('backdrop-filter ← ' + sel.trim());
    if (declared(body, 'filter') && movingSel.test(sel)) liveBad.push('filter ← ' + sel.trim());
  });
  eq(liveBad.join(' ｜ '), '', '★ 牌桌上没有活的 filter / backdrop-filter（§24 的结论不许被推翻）');
  ok(/\.tcard \{ filter: none !important; \}/.test(v3), '§24 那条 .tcard{filter:none} 还在');
  ok(/\.table-bar, \.lib-head, \.tabbar, \.pile-strip-wrap \{[^}]*backdrop-filter: none/.test(v3),
     '§24 那条 bars{backdrop-filter:none} 还在');
  // 毛玻璃只准留在"下面不动"的浮层上
  const blurSels = [];
  (v3nc.match(/[^{}]+\{[^}]*\}/g) || []).forEach(function (r) {
    const sel = r.split('{')[0], body = r.split('{')[1] || '';
    if (declared(body, 'backdrop-filter')) blurSels.push(sel.trim());
  });
  ok(blurSels.length > 0 && blurSels.every(function (s2) {
    return /\.tray-layer|\.meaning-layer|\.modal-mask|\.drawer|\.dialog|\.meaning-panel|\.toast/.test(s2);
  }), '★ 毛玻璃只出现在"弹出且下面不动"的浮层上（' + blurSels.length + ' 处）', blurSels.join(' ｜ '));
})();

console.log('\n【1】进入占卜桌后的初始状态');
ok(!!snap(), '开了会话');
eq(pile0().deckId, deckId, '牌堆栏里有这副牌');
ok(N > 1, '这副牌有 ' + N + ' 张，够测洗牌');

console.log('\n【2】点开选牌台（期望：自动洗牌）');
T.trayOpen_();
// 内部状态从 DOM 反推：洗过牌 = 槽位顺序里没有「空槽夹在中间」
const cellsAfterOpen = [...doc.querySelectorAll('#tray-grid > *')].map(n => n.className);
const slotCount = cellsAfterOpen.filter(c => c.includes('tray-slot')).length;
const cardCount = cellsAfterOpen.filter(c => c.includes('tray-card')).length;
eq(cellsAfterOpen.length, N, '槽位总数 = 牌堆张数');
eq(cardCount, N, '一张没抽时，全是可点的牌');
eq(slotCount, 0, '没有空槽');

console.log('\n【3】洗牌必须真的换了顺序（不能等于牌堆原顺序）');
// 从渲染出来的 DOM 顺序反推「这一局的抽牌顺序」
const orderOf = () => [...doc.querySelectorAll('#tray-grid .tray-card')].map(n => n.dataset.id);
const shown = orderOf();
ok(shown.length === N, '能读到 ' + N + ' 张');
const sameAsOriginal = JSON.stringify(shown) === JSON.stringify(origOrder);
ok(!sameAsOriginal, '选牌台里的顺序 ≠ 牌堆原顺序（说明洗过了）',
   '原: ' + origOrder.slice(0, 3) + '…  现: ' + shown.slice(0, 3) + '…');

console.log('\n【4】"洗牌"按钮应该已经拿掉');
ok(doc.getElementById('btn-tray-fill') === null, '#btn-tray-fill 不存在');
ok(!/洗牌/.test(doc.querySelector('.tray-top').textContent), '选牌台顶部没有「洗牌」两个字');

console.log('\n【5】抽走一张：其余牌不能动，空槽留在原位');
const firstId = orderOf()[0];
[...doc.querySelectorAll('#tray-grid .tray-card')][0].click();
const cellsAfterDraw = [...doc.querySelectorAll('#tray-grid > *')].map(n => n.className);
eq(cellsAfterDraw[0].includes('tray-slot'), true, '第 1 格变成空槽');
eq(cellsAfterDraw.filter(c => c.includes('tray-slot')).length, 1, '只有一个空槽');
const after = orderOf();
eq(JSON.stringify(after), JSON.stringify(shown.slice(1)), '其余 ' + (N - 1) + ' 张原地不动');
ok(deck.cards.some(c => c.id === firstId), '抽走的那张确实是这副里的');

console.log('\n【5b】桌面牌上确实有 .tcard-back（纸边就挂在它身上）');
ok(!!doc.querySelector('.tcard .tcard-back'), '发出来的牌里有 .tcard-back');
ok(!!doc.querySelector('.tcard .tcard-back .cb-logo, .tcard .tcard-back .cb-tpl'),
   '牌背上有图形（内置牌背 / ✦ 都算；符环已随卢恩下架）');

console.log('\n【6】重来 → 再进选牌台（期望：又洗一次，且顺序换了）');
T.trayClose();
T.resetSession(false);           // 不带确认，直接重开
T.trayOpen_();
const second = orderOf();
eq(second.length, N, '重来后又是满副 ' + N + ' 张');
ok(JSON.stringify(second) !== JSON.stringify(shown), '重来后又洗了一次（顺序与上一局不同）',
   '上一局: ' + shown.slice(0, 3) + '…  这一局: ' + second.slice(0, 3) + '…');

console.log('\n【7】不重来、只是关掉再打开选牌台：不能反复洗（洗牌是一次性的）');
T.trayClose();
T.trayOpen_();
eq(JSON.stringify(orderOf()), JSON.stringify(second), '同一个会话里再打开，顺序不变');

console.log('\n【8】中途给牌堆加一张卡（会触发 syncPiles）→ 不能因此重洗');
T.trayClose();
const before = orderOf();
D.addCard(deckId, { name: '新加的卡', keyword: '新', meaning: '新' });   // 触发 D.subscribe → syncPiles
T.trayOpen_();
const afterAdd = orderOf();
eq(afterAdd.length, before.length + 1, '多了一张，总槽位 +1');
eq(JSON.stringify(afterAdd.slice(0, before.length)), JSON.stringify(before), '已洗好的顺序没被打乱');
ok(afterAdd[afterAdd.length - 1] !== before[0], '新加的牌接在最后，没插进前面');

console.log('\n【9】把这一堆抽完，再点选牌台：只提示、不能炸');
const all = orderOf().length;
for (let i = 0; i < all; i++) {
  const c = doc.querySelector('#tray-grid .tray-card');
  if (!c) break;
  c.click();
}
eq(doc.querySelectorAll('#tray-grid .tray-card').length, 0, '全抽完了（可点的牌为 0）');
T.trayClose();
T.trayOpen_();
ok(doc.getElementById('tray-layer').classList.contains('is-hidden'), '抽完后点开选牌台：不展开，只给提示');
// ★ 删掉【8】组加的测试卡（deckId 现在可能是 Aegis，别污染后面「19 格」那类断言）
{ const _tc = D.findDeck(deckId).cards.filter(function(c){return c.name==='新加的卡';})[0];
  if (_tc) D.deleteCard(deckId, _tc.id); }

console.log('\n【10】连做 8 局：每局都重洗，且顺序不能每次都一样');
const seen = new Set();
for (let i = 0; i < 8; i++) {
  T.resetSession(false);
  T.trayOpen_();
  seen.add(JSON.stringify(orderOf()));
  T.trayClose();
}
ok(seen.size >= 6, '8 局里出现了 ' + seen.size + ' 种不同顺序（≥6 才算真随机）');

/* ---------- 下面几组要等定时器（教程 600ms / 长按 450ms），异步跑 ---------- */
const wait = ms => new Promise(r => setTimeout(r, ms));

(async function () {
  console.log('\n【11】选牌台：保留 5 列，牌缩小、间距拉开');
  const css = fs.readFileSync(path.join(WWW, 'css/v3.css'), 'utf8');
  const cols = css.match(/\.tray-grid[^}]*grid-template-columns\s*:\s*([^;!]+)/);
  ok(!!cols && /repeat\(\s*5\s*,/.test(cols[1]), 'CSS 里 .tray-grid 仍是 5 列', cols ? cols[1].trim() : '没找到');
  const w = css.match(/\.tray-grid\s*>\s*\*\s*\{[^}]*width\s*:\s*(\d+)px/);
  ok(!!w && Number(w[1]) <= 60, 'CSS 里牌缩小到 56px', w ? w[1] : '没找到');
  const gp = css.match(/\.tray-grid[^}]*gap\s*:\s*([^;!]+)/);
  ok(!!gp && /1[0-9]px/.test(gp[1] || ''), 'CSS 里列间距拉开到 10px', gp ? gp[1].trim() : '没找到');

  console.log('\n【12】选牌台按钮：单动作，没有隐藏手势');
  const orbEl = doc.getElementById('btn-tray');
  const trayLayer = doc.getElementById('tray-layer');
  ok(!!orbEl, '选牌台按钮在');
  ok(!doc.getElementById('tray-tools'), '工具浮层已经撤掉（工具搬到右栏了）');
  ok(orbEl.title === '选牌台', '按钮提示就是「选牌台」（不再提长按/双击）');
  orbEl.click();                       // 单击应当**立刻**进选牌台（没有双击窗口的延迟）
  ok(!trayLayer.classList.contains('is-hidden'), '点一下立刻进选牌台');
  T.trayClose();

  console.log('\n【12b】右侧栏整条删掉：重来搬进左边缘「拉线」抽屉');
  ok(!doc.querySelector('.table-side-extra'), '右栏容器已经删掉');
  ok(!doc.querySelector('.side-tool') && !doc.getElementById('btn-reset'), '旧那颗「重来」元素也不在了');
  const cssNoCmt = css.replace(/\/\*[\s\S]*?\*\//g, '');
  /* ★ 右栏（.table-side-extra / .side-tool）整条删掉后，那几条"临时测试按钮"的死 CSS 也清干净了。
     ⚠ 2026-10-13：这条原来**只扫 v3.css**（那几条其实住在 main.css）—— 假绿，现在两个文件一起扫。 */
  const mainCssNoCmt = fs.readFileSync(path.join(WWW, 'css/main.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/\.side-tool\s*\{/.test(cssNoCmt) && !/\.table-side-extra\s*\{/.test(cssNoCmt) &&
     !/\.side-tool\s*\{/.test(mainCssNoCmt) && !/\.table-side-extra\s*\{/.test(mainCssNoCmt),
     '★ 右栏那几条死 CSS 也清了（v3.css + main.css 两个文件都不许留）');

  const pullEl = doc.getElementById('edge-pull');
  ok(!!pullEl && !!doc.getElementById('pull-drawer'), '左边缘有拉线，也有抽屉容器');
  ok(!!doc.getElementById('pd-panel') && !!doc.getElementById('pd-mask') && !!doc.getElementById('pd-cnt'),
     '抽屉 = 面板 + 遮罩 + 状态行');
  ok(!!doc.getElementById('pd-reset'), '抽屉里有「重来」');
  // A 款那三笔：1px / 两端渐隐 / 中段断口
  const epb = css.match(/\.edge-pull::before \{([^}]*)\}/);
  ok(!!epb, '.edge-pull::before 就是那条线');
  ok(!!epb && /width: 1px/.test(epb[1]), '线宽 1px');
  ok(!!epb && /linear-gradient\(180deg/.test(epb[1]), '靠竖向渐变把两端化成透明');
  ok(!!epb && /transparent 45%, transparent 55%/.test(epb[1]), '中段 45%~55% 留了断口给箭头');
  const ep = css.match(/\.edge-pull \{([^}]*touch-action: none[^}]*)\}/);
  ok(!!ep, '§40 里有一条 .edge-pull 的完整规则（别被别处同名规则抢先）');
  ok(!!ep && /touch-action: none/.test(ep[1]), '拉线自己接管这一条的手指（否则会同时拖动桌面）');
  ok(!!ep && /top: 20%/.test(ep[1]) && /bottom: 20%/.test(ep[1]), '只在桌面中段 60% 的高度上吃手指');
  /* ★ 2026-10-15：**线必须贴在屏幕最左边**。
     曾经为了躲 Android 手势导航的返回感应区，把整颗按钮 left 从 0 挪到 14px ——
     线跟着从 x=3 跑到 x=17，用户当场说「还是更喜欢之前的，看上去更简洁」，已回退。
     要加宽热区请改 width（往屏幕内侧长），**别动 left**。
     退回旧写法（left: 14px）这条必红。 */
  ok(!!ep && /left: 0;/.test(ep[1]),
     '★★ 拉线贴在屏幕最左边（left:0）—— 用户要的"简洁"，别为了躲系统手势区整体右挪');
  const htmlPull = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  ok(/id="edge-pull"[\s\S]{0,420}?stroke-width="1\.9"/.test(htmlPull), '箭头是 1.9 描边（和顶栏图标同一套线）');
  ok(/closePullDrawer/.test(htmlPull), '系统返回键会先收抽屉（不然按返回就直接退 App 了）');

  console.log('\n【12c】顶栏模式按钮（A6：单按钮循环）');
  const modeBtn = doc.getElementById('btn-nav-lock');
  const modeLab = doc.getElementById('mode-label');
  const modeIco = doc.getElementById('mode-ico');
  ok(!!modeBtn && !!modeLab && !!modeIco, '顶栏有模式按钮（图标 + 文字两块）');
  ok(!!modeBtn.closest('.table-tools'), '它在顶栏的 .table-tools 里');
  eq(modeLab.textContent, '固界', '默认档位是「固界」');
  ok(/<svg/.test(modeIco.innerHTML), '图标是内联 SVG');
  ok(/stroke-width="1\.9"/.test(modeIco.innerHTML), '描边 1.9 —— 和顶栏的月亮同一套线');
  const ico0 = modeIco.innerHTML;
  modeBtn.click();
  eq(modeLab.textContent, '开放', '点一下 → 开放');
  ok(modeIco.innerHTML !== ico0, '图标跟着档位一起换了');
  modeBtn.click();
  eq(modeLab.textContent, '固牌', '再点一下 → 固牌');
  modeBtn.click();
  eq(modeLab.textContent, '固界', '再点一下 → 回到固界（三档循环）');
  ok(modeBtn.title.indexOf('固界') > -1, 'title 跟着更新');
  // 三档名字都得是 2 个字（原来 开放/牌固定/界固定 是 2/3/3，放进胶囊会一宽一窄）
  const modeNames = /label: '([^']+)'/g; let mm, names = [];
  const tj = fs.readFileSync(path.join(WWW, 'js/scenes/table.js'), 'utf8');
  while ((mm = modeNames.exec(tj))) names.push(mm[1]);
  eq(names.join(','), '开放,固牌,固界', '三档名字都是 2 个字');
  ok(names.every(function (n) { return n.length === 2; }), '没有 3 个字的档位了');

  console.log('\n【12d】起点全自动：视野一动，新牌就从新视野中心开始发');
  T.resetSession(false);
  const cardPos = function () {
    const els2 = doc.querySelectorAll('#desk-canvas .tcard');
    const el = els2[els2.length - 1];
    return el ? { x: parseFloat(el.style.left), y: parseFloat(el.style.top) } : null;
  };
  // 先把这一局的第一张抽出来（此时起点锚在当前视野中心）
  T.trayOpen_();
  Array.prototype.slice.call(doc.querySelectorAll('#tray-grid .tray-card'))[0].click();
  T.trayClose();
  const posA = cardPos();
  ok(!!posA, '第一张牌发出来了');

  // ★ 牌的**中心**要落在视野正中，而不是"左上角搁在正中"
  //   （后者整张牌会偏右下半个身位，用户看到的就是"牌没在屏幕中间"）
  const cardCenter = function () {
    const els2 = doc.querySelectorAll('#desk-canvas .tcard');
    const el = els2[els2.length - 1];
    if (!el) return null;
    return {
      x: parseFloat(el.style.left) + parseFloat(el.style.width) / 2,
      y: parseFloat(el.style.top) + parseFloat(el.style.height) / 2
    };
  };
  const cA = cardCenter(), camNow = T.snapshot_().cam;
  ok(!!cA && Math.abs(cA.x - camNow.x) < 1 && Math.abs(cA.y - camNow.y) < 1,
     '第一张牌的中心就压在视野正中（±1px）',
     '牌心=(' + cA.x.toFixed(1) + ',' + cA.y.toFixed(1) + ') 视野中心=(' +
     camNow.x.toFixed(1) + ',' + camNow.y.toFixed(1) + ')');

  // 切到「开放」才能平移；往左拖 60px —— 这就是"移动屏幕"
  modeBtn.click();                                  // 固界 → 开放
  eq(modeLab.textContent, '开放', '切到开放，准备平移');
  const camA = T.snapshot_().cam;
  const pf = doc.getElementById('playfield');
  pf.dispatchEvent(new window.MouseEvent('pointerdown', { clientX: 0, clientY: 0, bubbles: true }));
  pf.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 60, clientY: 0, bubbles: true }));
  pf.dispatchEvent(new window.MouseEvent('pointerup', { clientX: 60, clientY: 0, bubbles: true }));
  const camB = T.snapshot_().cam;
  ok(camA.x - camB.x > 20, '视野确实往左移了（cam.x 变小）',
     'camA.x=' + camA.x.toFixed(1) + ' camB.x=' + camB.x.toFixed(1));
  modeBtn.click(); modeBtn.click();                 // 转回固界（后面还要用默认档）

  // 再抽一张：应当落在**新视野中心**，而不是接着上一张错位 +10
  T.trayOpen_();
  Array.prototype.slice.call(doc.querySelectorAll('#tray-grid .tray-card'))[0].click();
  T.trayClose();
  const posB = cardPos();
  ok(!!posB, '第二张牌发出来了');
  // 精确关系：新牌相对第一张的位移，必须**正好等于镜头平移量**
  //   （不是"大概往左"，而是"起点真的跟到新视野中心去了"）
  const want = posA.x + (camB.x - camA.x);
  ok(Math.abs(posB.x - want) < 2,
     '新牌正好落在新视野中心（位移 == 镜头位移）',
     'A=' + posA.x + ' B=' + posB.x + ' 应为 ' + want.toFixed(1));
  ok(Math.abs(posB.x - (posA.x + 10)) > 20,
     '不再是接着上次的错位叠放（旧的错位是 +10）');
  // y 方向同理（这一组只平移了 x，所以 y 应当原地不动）
  ok(Math.abs(posB.y - (posA.y + (camB.y - camA.y))) < 2,
     '新牌纵向也跟住了视野（y 位移 == 镜头 y 位移 = 0）',
     'A=' + posA.y + ' B=' + posB.y);

  console.log('\n【12e】拉线：跟手拖出 / 松手判定 / 不抢桌面手势');
  T.resetSession(false);
  const dealOne = function () {
    T.trayOpen_();
    Array.prototype.slice.call(doc.querySelectorAll('#tray-grid .tray-card'))[0].click();
    T.trayClose();
  };
  dealOne(); dealOne();
  const pdPanel = doc.getElementById('pd-panel'), pdMask = doc.getElementById('pd-mask');
  const pev = function (type, x) {
    pullEl.dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: 320, bubbles: true }));
  };
  const pdX = function () { return parseFloat((pdPanel.style.transform.match(/-?[\d.]+/) || [0])[0]); };

  // ★ 先切到「开放」：固界档下桌面本来就拖不动，不切的话这条断言等于没测
  modeBtn.click();
  eq(modeLab.textContent, '开放', '切到开放（否则桌面本来就是锁着的，测不出抢手势）');
  const camBefore = T.snapshot_().cam.x;
  // ★ 直接盯"事件到底有没有冒到桌面上"：在 #playfield 上挂一个探针，
  //   按拉线时它必须一次都收不到（指针平移那半句只挡得住 move，挡不住 down）
  let pfGot = 0;
  const spy = function () { pfGot += 1; };
  doc.getElementById('playfield').addEventListener('pointerdown', spy);
  pev('pointerdown', 0);
  ok(pfGot === 0, '★ 按拉线时，桌面的手柄收不到 pointerdown（down 也 stopPropagation 了）');
  doc.getElementById('playfield').removeEventListener('pointerdown', spy);
  pev('pointermove', 118);
  ok(Math.abs(pdX() - (-236 + 118)) < 4, '面板跟手：拖 118px 就露出 118px', pdPanel.style.transform);
  pev('pointerup', 118);
  ok(Math.abs(pdX()) < 1, '松手过半 → 展开到底', pdPanel.style.transform);
  eq(T.snapshot_().cam.x, camBefore, '★ 拉抽屉没有把桌面一起推走（stopPropagation 生效）');
  // 对照组：同样的位移落在桌面上，镜头**必须**动 —— 证明上面那条不是"本来就动不了"
  const pf2 = doc.getElementById('playfield');
  pf2.dispatchEvent(new window.MouseEvent('pointerdown', { clientX: 100, clientY: 320, bubbles: true }));
  pf2.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 200, clientY: 320, bubbles: true }));
  pf2.dispatchEvent(new window.MouseEvent('pointerup', { clientX: 200, clientY: 320, bubbles: true }));
  ok(T.snapshot_().cam.x < camBefore - 20, '对照组：拖桌面本身 → 镜头确实会动',
     'cam.x ' + camBefore.toFixed(1) + ' → ' + T.snapshot_().cam.x.toFixed(1));
  modeBtn.click(); modeBtn.click();          // 转回固界（默认档，后面还要用）

  pdMask.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  ok(Math.abs(pdX() + 236) < 1, '点面板外 → 收回', pdPanel.style.transform);

  // 点一下（没动）= 开关
  pev('pointerdown', 0);
  pev('pointerup', 0);
  ok(Math.abs(pdX()) < 1, '点一下拉线 → 展开');
  eq(doc.getElementById('pd-cnt').textContent.indexOf('2') > -1, true, '状态行报出了桌上的张数（2 张）');

  // 抽屉里的「重来」= 原来那颗，仍然要确认
  doc.getElementById('pd-reset').click();
  const pdMaskEl = doc.querySelector('#overlay-root .modal-mask');
  ok(!!pdMaskEl, '点「重来」照旧弹确认框（有牌时）');
  ok(Math.abs(pdX() + 236) < 1, '弹确认框前抽屉已经收回');
  if (pdMaskEl) pdMaskEl.querySelector('.btn-cancel').click();
  await wait(30);
  eq(T.snapshot_().tableCards, 2, '点了取消 → 桌上的牌一张没少');

  console.log('\n【12f】首次提示：教一次「往右拉这条线」');
  const etKey = T._pullTutKey;
  const etEl = doc.getElementById('et-layer');
  ok(!!etEl && !!doc.querySelector('.et-card') && !!doc.querySelector('.et-ring'), '提示层：遮罩 + 光圈 + 卡片都在');
  // ★ 类名绝不能借 .tut-*（那是神签自己的，上次撞名把神签排版盖掉了）
  ok(!/class="[^"]*\btut-/.test(doc.body.innerHTML), '提示没有用任何 .tut-* 类名');
  const etCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
  ['et-layer', 'et-scrim', 'et-ring', 'et-card', 'et-ok'].forEach(function (c) {
    const n = (etCss.match(new RegExp('\\.' + c + '\\s*[,\\{]', 'g')) || []).length;
    ok(n >= 1, '.' + c + ' 有样式（' + n + ' 条）');
  });
  // 提示的遮罩必须压在拉线下面，否则提示亮着的时候线拉不动
  const zPull = css.match(/\.edge-pull \{([^}]*touch-action: none[^}]*)\}/);
  const zEt = css.match(/\.et-layer \{([^}]*)\}/);
  ok(!!zPull && /z-index: 40/.test(zPull[1]), '拉线 z-index 提到 40（在提示遮罩之上）');
  ok(!!zEt && /z-index: 30/.test(zEt[1]), '提示层 z-index 30（压在线的下面）');

  window.localStorage.removeItem(etKey);
  T.closePullTut(false);
  T.showPullTut_();
  ok(!etEl.classList.contains('is-hidden'), '提示弹出来了');
  eq(doc.querySelector('.et-title').textContent, '往右拉这条线', '标题就是那句人话');
  ok(doc.getElementById('edge-pull').classList.contains('is-demo'), '那条线自己在「探头」（走两遍动画）');

  /* ★ 2026-09-26 新规则：提示亮着先锁 5 秒（有人下意识点一下就把教程跳过了）。
     锁着的时候：点「知道了」/ 点提示外 / 按返回 一律无效；锁没满就溜掉（切场景）也不算看过。 */
  const etOkBtn = doc.getElementById('et-ok');
  ok(T._tutLockMs === 5000, '锁 5 秒（实为 ' + T._tutLockMs + 'ms）');
  ok(/知道了/.test(etOkBtn.textContent) && /\d/.test(etOkBtn.textContent), '按钮上带倒计时：' + etOkBtn.textContent);
  ok(etOkBtn.classList.contains('is-wait'), '倒计时期间按钮是"灰的"（.is-wait）');

  // ① 锁着点「知道了」—— 不关、也不记看过
  etOkBtn.click();
  ok(!etEl.classList.contains('is-hidden'), '★★ 锁着点「知道了」→ 不收起');
  eq(window.localStorage.getItem(etKey), null, '★★ 也不记为看过');
  ok(doc.getElementById('edge-pull').classList.contains('is-demo'), '探头动画照旧在走');

  // ② 锁着点提示外 —— 同样无效
  doc.getElementById('et-scrim').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  ok(!etEl.classList.contains('is-hidden'), '★★ 锁着点提示外 → 不收起');
  eq(window.localStorage.getItem(etKey), null, '也不记看过');

  // ③ 锁走完（走查里把 5 秒拨过去）→ 按钮恢复，点它才关、才记看过
  T._tutUnlockNow();
  ok(!etOkBtn.classList.contains('is-wait'), '★ 锁满后按钮恢复可点');
  etOkBtn.click();
  ok(etEl.classList.contains('is-hidden'), '★ 解锁后点「知道了」→ 收起');
  eq(window.localStorage.getItem(etKey), '1', '并记为「看过」');
  ok(!doc.getElementById('edge-pull').classList.contains('is-demo'), '探头动画也停了');

  // ④ 锁没满就被强制收掉（切场景那条路）→ 不算看过，下次进来还得过一遍锁
  window.localStorage.removeItem(etKey);
  T.showPullTut_();
  T.closePullTut(true, true);
  ok(etEl.classList.contains('is-hidden'), '切场景能强制收起提示');
  eq(window.localStorage.getItem(etKey), null, '★★ 但不算看过 → 下次进来仍要过 5 秒锁');

  // ⑤ 直接拉一下：这是"真学会了" → 提示让路、抽屉开、记看过
  window.localStorage.removeItem(etKey);
  T._tutUnlockNow();
  T.closePullTut(false); T.showPullTut_();
  ok(!etEl.classList.contains('is-hidden'), '（再弹一次，准备验证「直接拉」）');
  pev('pointerdown', 0);
  pev('pointermove', 150);
  pev('pointerup', 150);
  ok(etEl.classList.contains('is-hidden'), '★ 不点按钮、直接拉 → 提示立刻让路');
  ok(Math.abs(pdX()) < 1, '而且抽屉真的开了');
  eq(window.localStorage.getItem(etKey), '1', '★ 自己拉出来 = 真学会了 → 记为看过');
  eq(window.localStorage.getItem(etKey), '1', '也算看过');
  pdMask.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  /* ⑤b ★ 2026-10-15：**用户自己动手抽牌 / 开选牌台**也算"上手了" —— 提示层必须让路。
     原来这条路上没人收它：牌堆栏在 #playfield 之外所以点得到，可牌一落到桌面就被
     .et-scrim（inset:0 / z-index:30）整个罩住，点不翻也拖不动
     （真 Chromium 实测：elementFromPoint 打在牌心，命中的是 et-scrim），
     而 5 秒锁里点「知道了」/点空白/按返回又全都无效 —— 新装首启第一次抽牌就像卡死。
     退回旧写法（去掉 onDraw / trayOpen_ 里那两句）这两条必红。 */
  window.localStorage.removeItem(etKey);
  T._tutUnlockNow();
  T.closePullTut(false); T.showPullTut_();
  ok(!etEl.classList.contains('is-hidden'), '（再弹一次，准备验证「直接去抽牌」）');
  let piActive = doc.querySelector('#pile-strip .pile-item.is-active');
  if (!piActive) {
    doc.querySelector('#pile-strip .pile-item').click();      // 先切到这一堆
    piActive = doc.querySelector('#pile-strip .pile-item.is-active');
  }
  ok(!!piActive, '牌堆栏有激活的牌堆（点它 = 抽一张）');
  if (piActive) piActive.click();
  ok(etEl.classList.contains('is-hidden'), '★★ 直接去抽牌 → 提示层让路（不再罩着刚发出的牌）');
  eq(window.localStorage.getItem(etKey), '1', '★★ 抽牌也算「用过一次」，不再反复弹');

  window.localStorage.removeItem(etKey);
  T._tutUnlockNow();
  T.closePullTut(false); T.showPullTut_();
  T.trayOpen_();
  ok(etEl.classList.contains('is-hidden'), '★★ 直接开选牌台 → 提示层同样让路');
  eq(window.localStorage.getItem(etKey), '1', '★★ 开选牌台也算「用过一次」');
  T.trayClose();

  // ④ 看过之后，回占卜桌不再弹
  T.openTable();
  await wait(1000);
  ok(etEl.classList.contains('is-hidden'), '★ 看过之后，再进占卜桌不会又弹（不然就是骚扰）');

  console.log('\n【12f0】牌组页：牌面网格（B）+ 长按拖动排序（G）');
  const D2 = window.MoKa.data, LIB = window.MoKa.library;
  const deck0 = D2.listDecks()[0];
  ok(!!deck0 && deck0.cards.length >= 3, '默认牌组里有牌（' + (deck0 ? deck0.cards.length : 0) + ' 张）');
  LIB.goDeck(deck0.id);
  await wait(30);
  const gridEl = doc.querySelector('#lib-deck .deck-grid');
  ok(!!gridEl, '牌组页用的是 .deck-grid');
  const dcCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const dc = dcCss.match(/\.deck-card \{([^}]*)\}/);
  ok(!!dc && /aspect-ratio:\s*1 \/ 1\.45/.test(dc[1]), '★ B：小牌是 1:1.45 的牌面比例（不是方瓷砖）');
  ok(!!dc && /min-height:\s*0/.test(dc[1]), '压掉了 main.css 的 min-height，别把牌撑方');
  const tiles0 = gridEl.querySelectorAll('.deck-card');
  eq(tiles0.length, deck0.cards.length, '每张牌一个格子');
  const t0 = tiles0[0];
  // ★ 2026-09-21（用户选的方案 B）：格子画的**就是牌面**（和占卜桌同一个渲染器 faceHTML），
  //   不再自己拼"色条/名字/符号"三件套 —— 那样每加一种图案都得再补一遍（漏过三次）。
  ok(!!t0.querySelector('.tcard-side.tcard-face'), '★ 每格画的就是牌面（.tcard-face，与占卜桌同一渲染器）');
  eq((t0.querySelector('.fc-chip.fc-name') || {}).textContent, deck0.cards[0].name, '第一格名字是数据里的第一张');
  // （原先这里有一条 `… || true` 的占位断言，永远为真、什么都没验 —— 2026-10-13 清掉；
  //   符号/符号语言的真实验证在下面 12f0b 与 15d 两组里。）
  ok(!!gridEl.style.getPropertyValue('--card-w'), '整栏设了 --card-w（牌面按它算尺寸）');
  ok(!!gridEl.querySelector('.deck-add'), '末尾那颗「＋ 添加猫卡」还在（同一格比例，虚线）');

  // G：落点索引是纯函数 —— 直接喂一个 3×2 的假网格
  const fake = [];
  for (let r2 = 0; r2 < 2; r2++) for (let c2 = 0; c2 < 3; c2++) {
    fake.push({ l: 12 + c2 * 106, t: 120 + r2 * 149, r: 12 + c2 * 106 + 96, b: 120 + r2 * 149 + 139 });
  }
  eq(LIB._dropIndex(fake, 12 + 106 + 48, 120 + 70), 1, '落在第 2 格中心 → 索引 1');
  eq(LIB._dropIndex(fake, 12 + 106 * 2 + 48, 120 + 149 + 70), 5, '落在右下角 → 索引 5');
  eq(LIB._dropIndex(fake, 9999, -9999), 2, '离得最远时也有个确定的答案（取最近的，不抛错）');

  // G：数据层 moveCard（真顺序 + 落盘）
  const names0 = deck0.cards.map(function (c) { return c.name; });
  const movedId = deck0.cards[0].id;
  ok(D2.moveCard(deck0.id, movedId, 2) === true, 'moveCard 把第 1 张挪到第 3 位');
  const deck1 = D2.findDeck(deck0.id);
  eq(deck1.cards[2].id, movedId, '数据里真的到了第 3 位');
  eq(deck1.cards.map(function (c) { return c.name; }).length, names0.length, '张数没变（是移动不是复制/删除）');
  await wait(150);
  ok(JSON.parse(window.localStorage.getItem('moka.decks.v1')).filter(function (d) { return d.id === deck0.id; })[0]
       .cards[2].id === movedId, '★ 顺序落盘了（重开 App 也在）');
  eq(D2.moveCard(deck0.id, movedId, 2), false, '挪到原地 → 返回 false（不白写一次存储）');

  // G：长按 → 抬起（jsdom 量不到尺寸时走"只抬起、不重排"的兜底）
  LIB.goDeck(deck0.id); await wait(30);
  const g2 = doc.querySelector('#lib-deck .deck-grid');
  const first = g2.querySelector('.deck-card');
  first.dispatchEvent(new window.MouseEvent('pointerdown', { clientX: 40, clientY: 200, bubbles: true }));
  await wait(400);
  ok(first.classList.contains('is-lift'), '★ 长按 360ms 之后牌被"抬起"（is-lift）');
  ok(!!g2.querySelector('.deck-slot'), '原位留了一个虚线槽位');
  first.dispatchEvent(new window.MouseEvent('pointerup', { clientX: 40, clientY: 200, bubbles: true }));
  await wait(30);
  ok(!doc.querySelector('.deck-card.is-lift'), '松手后抬起态清掉');
  eq(D2.findDeck(deck0.id).cards[2].id, movedId, '★ 量不到尺寸时**不重排**（宁可不动也别乱动）');
  const order2 = D2.findDeck(deck0.id).cards.map(function (c) { return c.name; });
  ok(order2.length === names0.length, '顺序仍然是完整的一副');

  // G：**有几何时真的能换位** —— 给每格喂一个假的 3 列网格 rect，走完整条拖拽链路
  LIB.goDeck(deck0.id); await wait(30);
  const g3 = doc.querySelector('#lib-deck .deck-grid');
  const tl = Array.prototype.slice.call(g3.querySelectorAll('.deck-card'));
  const TW = 96, TH = 139, GAP = 10;
  tl.forEach(function (el, i) {
    const c = i % 3, r = Math.floor(i / 3);
    const l = 12 + c * (TW + GAP), t = 120 + r * (TH + GAP);
    el.getBoundingClientRect = function () {
      return { left: l, top: t, right: l + TW, bottom: t + TH, width: TW, height: TH, x: l, y: t };
    };
  });
  const orderBefore = D2.findDeck(deck0.id).cards.map(function (c) { return c.id; });
  const dragEl = tl[0], tr4 = tl[4].getBoundingClientRect();
  dragEl.dispatchEvent(new window.MouseEvent('pointerdown', {
    clientX: dragEl.getBoundingClientRect().left + 48,
    clientY: dragEl.getBoundingClientRect().top + 70, bubbles: true }));
  await wait(400);
  dragEl.dispatchEvent(new window.MouseEvent('pointermove', {
    clientX: tr4.left + TW * 0.9, clientY: tr4.top + TH / 2, bubbles: true }));
  dragEl.dispatchEvent(new window.MouseEvent('pointerup', {
    clientX: tr4.left + TW * 0.9, clientY: tr4.top + TH / 2, bubbles: true }));
  await wait(40);
  const orderAfter = D2.findDeck(deck0.id).cards.map(function (c) { return c.id; });
  eq(orderAfter[4], orderBefore[0], '★ 拖到第 5 格右半边 → 第 1 张落到索引 4（真的换位了）');
  eq(orderAfter.length, orderBefore.length, '张数没变');
  ok(!doc.querySelector('.deck-card.is-lift'), '松手后没有残留的抬起态');

  console.log('\n【12f0b】符号通道（卢恩 2026-09-20 整副铲掉、Psyche 2026-10-06 也删了，现在只剩星语那 12 个）');
  // ★ 符号通道的通用判据：认不出的 id 一律不画（图形必须能在"包里没有 assets/sym 目录"的前提下画出来）。
  eq(UI2.symSVG('assets/sym/not-a-real-symbol.svg'), '', '★ 不认识的符号 id → 什么都不画');

  // ★ 图形是代码里的矢量路径：不依赖任何图片文件
  ok(!fs.existsSync(path.join(WWW, 'assets/sym')), '★ 前端里**没有** assets/sym 这个目录（图形不落文件）');
  eq(UI2.symSVG('assets/sym/notreal.svg'), '', '认不出的 id 返回空（不许硬画）');
  eq(UI2.symSVG('assets/sym/star4.png'), UI2.symSVG('assets/sym/star4.svg'),
     '★ 老数据的 .png 后缀也认（只看 id，不看后缀）');
  eq(UI2.symSVG('star4'), UI2.symSVG('assets/sym/star4.svg'), '裸 id 也认');
  eq(UI2.symSVG('').indexOf('<svg'), -1, '空值不画东西');


  // ★ 星语那副：用它原本那 12 个符号；而且必须是**描边**风格
  const starDeck = D2._defaultDeck();
  const starIds = starDeck.cards.map(function (c) { return /([a-z0-9]+)\.svg$/.exec(c.symbolImg)[1]; });
  eq(starIds.join(','), 'star4,beacon,wave,seed,bridge,echo,flame,compass,mist,ember,moon,ring',
     '★ 星语 12 张 = 原本那 12 个符号（顺序都对得上）');
  ok(starIds.every(function (id) { return UI2.symSVG('assets/sym/' + id + '.svg').indexOf('<svg ') === 0; }),
     '★ 这 12 个星语符号也都画得出来');
  ok(starIds.every(function (id) { return UI2.symSVG('assets/sym/' + id + '.svg').indexOf('fill="currentColor"') < 0; }),
     '★ 星语保持自己的描边风格（没被别的表的填色轮廓带跑）');
  const starFace = UI2.faceHTML(starDeck.cards[0]);
  ok(starFace.indexOf('fc-emblem') > -1 && starFace.indexOf('<svg ') > -1, '星语牌面上是它自己的符号');

  // 迁移（星语那 12 个：认得出就不动，认不出按名字/字形兜底）
  eq(D2._migrateSymbolImgs([{ cards: [
    { name: '启程', symbolImg: 'assets/sym/star4.svg' },   // 已经有了 → 不动
    { name: '灯塔', symbolImg: '' },                        // 空 → 按名字补 beacon
    { name: '财富', symbolImg: 'assets/sym/fehu.svg' }      // 用户数据里可能还留着旧符文引用：更不许动
  ] }]), 1, '★ 迁移只补"没有符号的星语卡"，已有的 / 用户数据里别的图一律不动');
  eq(D2._migrateSymbolImgs([{ cards: [{ name: '启程' }, { name: '自己建的卡', symbol: '✦' }] }]), 1,
     '★ 迁移只按**名字**补星语那 12 张；自己建的卡不再被塞一颗星（字形兜底已拆）');



  // 编辑一张卡：符号不能因为"编辑"被弄丢（save 的 fields 白名单）
  const editId = deck0.cards[0].id;
  const before = D2.findDeck(deck0.id).cards.filter(function (c) { return c.id === editId; })[0].symbolImg;
  LIB.goCard(deck0.id, editId);
  await wait(40);
  eq(doc.querySelectorAll('.sym-chip').length, 0, '符号选择器是撤掉的（用户不需要）');
  ok(!!doc.querySelector('#lib-editor.is-active'), '★ 进的是单屏编辑页 #lib-editor');
  doc.getElementById('ed-save').click();
  await wait(160);
  eq(D2.findDeck(deck0.id).cards.filter(function (c) { return c.id === editId; })[0].symbolImg, before,
     '★ 编辑保存之后符号还在（fields 白名单里留着 symbol/symbolImg）');

  // 牌组页格子
  LIB.goDeck(deck0.id); await wait(30);
  const g4 = doc.querySelector('#lib-deck .deck-grid');
  ok(g4.querySelectorAll('.tcard-face').length > 0,
     '牌组页格子画的是牌面（' + g4.querySelectorAll('.tcard-face').length + ' 格）');
  eq(g4.querySelectorAll('.fc-emblem img, .fc-emblem > img').length, 0,
     '徽记走内联 svg（不靠 <img> 图片文件）');

  console.log('\n【12f0c】翻牌：轻点翻面 / 再点看牌义（之前 271 条里一条都没覆盖过）');
  // ★ 用户报"把牌面翻开无变化"时才发现：走查里**从来没测过翻牌**。
  //   现在从三个层面钉住：JS 状态、CSS 翻牌链、以及牌面上有没有东西可看。
  T.resetSession(false); T.openTable();
  T.trayOpen_();
  Array.prototype.slice.call(doc.querySelectorAll('#tray-grid .tray-card'))[0].click();
  T.trayClose();
  const ce = doc.querySelector('#desk-canvas .tcard');
  ok(!!ce, '发出来一张牌');
  const tapOn = function (el) {
    el.dispatchEvent(new window.MouseEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    el.dispatchEvent(new window.MouseEvent('pointerup', { clientX: 101, clientY: 101, bubbles: true }));
  };
  ok(!ce.classList.contains('flipped'), '发牌时是背面朝上');
  tapOn(ce);
  ok(ce.classList.contains('flipped'), '★ 轻点一下 → 加 .flipped（翻面这个状态真的发生了）');
  tapOn(ce);
  ok(!doc.getElementById('meaning-layer').classList.contains('is-hidden'), '再点一下 → 打开牌义层');
  window.MoKa.table.hideMeaning();

  // CSS 翻牌链：任何一环断了都会"点了没反应"
  const mcss = fs.readFileSync(path.join(WWW, 'css/main.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/\.tcard\.flipped \.tcard-inner \{[^}]*rotateY\(180deg\)/.test(mcss), '★ .flipped 把 .tcard-inner 转 180°');
  ok(/\.tcard-inner \{[^}]*transform-style:\s*preserve-3d/.test(mcss), '.tcard-inner 是 preserve-3d（不然后面两面都会透出来）');
  ok(/\.tcard-side \{[^}]*backface-visibility:\s*hidden/.test(mcss), '.tcard-side 隐藏背面（不隐藏就会看到镜像的牌面）');
  // ★ filter 会把 3D 拍平 → 翻牌会"点了没反应"。所以必须是 v3 那条 !important 的 none 说了算。
  //   （2026-11-13 起 main.css 的 .tcard.is-drag 也不再给 filter：拖动中牌面保持原样；
  //    这里要验的是"**最终生效的那条**是 none"，不是"文件里没出现过 filter"。）
  ok(/\.tcard \{ filter: none !important; \}/.test(css),
     '★ v3 那条 .tcard{filter:none!important} 在 —— 它压住其它 filter，3D 才不被拍平');
  // （"v3 里还有没有别的活 filter" 由前面那组《渲染性能守卫》统一负责 —— 那边做了
  //   注释剥离 + 捕获值判断，别在这里用 (?!none) 再写一遍：\s* 会回溯，会误报自己。）

  // 牌面上确实有东西：名字 / 关键词 / 符号（图或文字兜底）
  const cface = ce.querySelector('.tcard-face');
  ok(!!cface.querySelector('.fc-name'), '牌面上有名字');
  // 符号只剩星语那 12 个（symbols:star），直接拿符号表验，不赌 listDecks()[0] 有没有带符号的牌组
  ok(Object.keys(D2._builtinSymTable()).length >= 12, '★ 符号表有星语 12 个（builtinSym 数据化）');
  const symCard = { name: '启程', symbolImg: 'assets/sym/beacon.svg', image: null, color: '#333' };
  ok(UI2.faceHTML(symCard).indexOf('fc-emblem') > -1,
     '★ 有身份的卡（启程）画符号图（无整幅图时走徽记）');
  ok(UI2.faceHTML(Object.assign({}, symCard, { image: 'data:image/png;base64,AA==' })).indexOf('fc-emblem') === -1,
     '★ 有整幅图就不画徽记（.fc-img 在、.fc-emblem 不在）');

  console.log('\n【12f1】场景冒烟：四个页面点开都不能是空白');
  // ★ 这一组是被一次真事故逼出来的：撤功能时我用"块首→下一个注释"来切代码，
  //   顺手把 settings.js 里三行常量一起切掉了 → 点「设置」整页空白（用户 18:26 报的）。
  //   当时走查里**唯一**会渲染设置页的那几行也一起被撤了，所以它没被拦住。
  //   教训：每个场景至少要有一次"真的 render 一遍并看到内容"的断言。
  const scenes = [
    ['占卜桌', '#pile-strip', function () { T.resetSession(false); T.openTable(); }],
    ['牌库', '#lib-home', function () { window.MoKa.library.renderHome(); }],
    ['设置', '#set-page', function () { window.MoKa.settings.render(); }],
    ['神签', '#lots-page', function () { window.MoKa.lots.render(); }]
  ];
  scenes.forEach(function (sc) {
    const name = sc[0], sel = sc[1], draw = sc[2];
    try {
      draw();
      const el = doc.querySelector(sel);
      const n = el ? el.innerHTML.replace(/\s/g, '').length : 0;
      ok(n > 40, '★ ' + name + ' 渲染之后真的有内容（' + n + ' 字符，不是空白）',
         el ? el.id : '找不到 ' + sel);
    } catch (e) {
      ok(false, '★ ' + name + ' 渲染抛错了：' + e.message);
    }
  });

  console.log('\n【12f2】牌堆栏：间距必须等距（不能让名字长短决定项宽）');
  // ★ 用户报的："牌堆栏他们的间距好像不一样"。
  //   根因：.pile-item 只有 min-width，真实宽度由名字长短决定 → gap 固定也没用，
  //   相邻牌堆的中心距忽大忽小。这里从 CSS 层面卡死"宽度写死 + 名字只能在框内省略"。
  const pileCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const pi = pileCss.match(/\.pile-item \{([^}]*)\}/);
  ok(!!pi, '.pile-item 有规则');
  // ★ 2026-11-06（C06）：58 → 64。名字框从 46 → 52（四个 11px 汉字 44px 不卡临界）；
  //   gap 同步 14 → 8，**中心距仍是 72**，整排密度不变（这条别只改一半）。
  ok(!!pi && /width:\s*64px/.test(pi[1]), '★ .pile-item 宽度写死 64px（不是只给 min-width）');
  ok(!!pi && /min-width:\s*64px/.test(pi[1]) && /box-sizing:\s*border-box/.test(pi[1]),
     'min-width 与 width 一致 + border-box（内边距不会再加宽）');
  const pin = pileCss.match(/\.pile-item-name \{([^}]*)\}/);
  ok(!!pin && /max-width:\s*100%/.test(pin[1]) && /min-width:\s*0/.test(pin[1]),
     '名字最多占满牌堆项，撑不宽外面');
  const ps = pileCss.match(/\.pile-strip \{([^}]*)\}/);
  ok(!!ps && /gap:\s*8px/.test(ps[1]), '牌堆栏 gap 是 8px（64+8=72 中心距，唯一一处，没被别处覆盖）');
  ok(pileCss.search(/\.pile-item\.is-active \{[^}]*width:/) === -1,
     '激活态不许改宽度（否则切一下堆，整排就跳一下）');
  // 数量角标是绝对定位的 —— 不然"12"两位数会把项撑宽，间距又不一样了
  // 数量角标是绝对定位的（定义在 main.css，v3 只覆盖 top/right）——
  // 不然"12"两位数会把项撑宽，间距又不一样了
  const mainCss = fs.readFileSync(path.join(WWW, 'css/main.css'), 'utf8');
  const psLeft = mainCss.match(/\.pile-stack \.ps-left \{([^}]*)\}/);
  ok(!!psLeft && /position:\s*absolute/.test(psLeft[1]), '剩余张数角标绝对定位（两位数也撑不宽牌堆项）');

  console.log('\n【12f2b】牌堆栏新交互：toast 不吞点击（P1）/ 顶栏全名（P5-B）');
  (function () {
    /* —— P5-B：顶栏当前牌堆全名，切堆跟着变 —— */
    const nameEl = doc.getElementById('table-deck-name');
    const curId = T.snapshot_().activePileId;
    const curDeck = D.findDeck(curId);
    ok(!!nameEl && !!curDeck && nameEl.textContent === curDeck.name,
       '★ 顶栏显示当前牌堆全名（52px 名字框里被省略掉的那截，这里能看全）');
    ok(!!nameEl && nameEl.title === curDeck.name, '★ 顶栏名字的 title 也是全名（长名可悬停/读屏）');
    const otherItem = Array.prototype.slice.call(doc.querySelectorAll('#pile-strip .pile-item'))
      .filter(function (n) { return n.dataset.id !== curId; })[0];
    ok(!!otherItem, '牌堆栏至少有两堆可切（否则"切堆名字跟着变"这条验不到）');
    if (otherItem) {
      const otherDeck = D.findDeck(otherItem.dataset.id);
      otherItem.click();
      eq(nameEl.textContent, otherDeck.name, '★ 切到另一堆 → 顶栏名字立刻跟着换');
      doc.querySelector('#pile-strip .pile-item[data-id="' + curId + '"]').click();
      eq(nameEl.textContent, curDeck.name, '★ 切回原堆 → 顶栏名字也切回来');
    }

    /* —— P1：toast 是纯文字，整条不接指针 ——
       jsdom 没有布局，elementFromPoint 量不出来（量出来也不是真机），所以钉**CSS 契约**：
       toast 这条规则里必须有 pointer-events:none，且没有后来的规则把它改回 auto。 */
    ok(cssRuleHas(mainCss, '.toast', 'pointer-events:\\s*none'),
       '★ toast 整条 pointer-events:none —— 它压在牌堆栏上时，点名字照样切堆/抽牌（P1）');
    ok(!/\.toast[^{}]*\{[^{}]*pointer-events:\s*auto/.test(cssNoCmt + mainCssNoCmt) &&
       !/#toast[^{}]*\{[^{}]*pointer-events:\s*auto/.test(cssNoCmt + mainCssNoCmt),
       '★ 没有哪条 .toast / #toast 规则又把它改回 pointer-events:auto');
  })();

  console.log('\n【12f3】牌堆栏：一摞牌 = 厚度层 + 牌面层（2026-10-20 重构）');
  /* ★ 用户报的：「第三第四个牌组做出了堆叠效果，第一第二个只有平面」。
     根因：厚度是 .pile-stack::before / ::after 画的 —— 伪元素没有 z-index，
     画在 .ps-img / .ps-tpl（z-index:1）**底下**，带整幅插画牌背的英雄之旅 / Overflow
     把它整块盖住，只在牌面外留 2px 淡边，浅色底上看不见。
     现在厚度必须是**真实子元素** .ps-layer（可排序、可测），牌面在 .ps-face 上。 */
  // ★ 先剥注释再查：两份 CSS 的注释里都**引用**过这个选择器（"以前是 .pile-stack::before/::after"），
  //   不剥的话查到的永远是注释，跟自己写得对不对没关系（这套走查里踩过好几回）。
  const mainCssNoC = mainCss.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/\.pile-stack::(before|after)\s*\{/.test(pileCss) && !/\.pile-stack::(before|after)\s*\{/.test(mainCssNoC),
     '★ 牌堆厚度不再用 ::before/::after 画（会被图片层盖住）');
  ok(/\.ps-layer \{[^}]*var\(--ps-tint/.test(pileCss + mainCssNoC),
     '★ 厚度层颜色来自 --ps-tint（每副牌自己的牌背主色），不是写死的一条黑边');
  ok(/\.ps-layer \{[^}]*z-index:\s*calc\(1 - var\(--i/.test(mainCssNoC),
     '厚度层按 --i 排序（数字越大越靠下，层叠顺序可控）');
  ok(/\.pile-stack \{[^}]*isolation:\s*isolate/.test(pileCss) ||
     /\.pile-stack \{[^}]*isolation:\s*isolate/.test(mainCssNoC),
     '★ .pile-stack 有 isolation（厚度层的 z-index 不会掉到页面底下）');
  // 纯函数：层数跟剩余张数走
  const UIP = window.MoKa.ui;
  eq(UIP.pileDepth(0), 0, '0 张 → 没有厚度');
  eq(UIP.pileDepth(1), 0, '1 张 → 就是一张牌，不装一摞');
  eq(UIP.pileDepth(6), 1, '6 张 → 薄薄一层');
  eq(UIP.pileDepth(40), 2, '40 张 → 两层（再多就显笨，原版也是这个量）');
  ok(typeof UIP.pileItemHTML === 'function' && typeof UIP.pileStackHTML === 'function',
     '★ 两页共用 UI.pileItemHTML / UI.pileStackHTML');
  // 渲染：每摞都有厚度层 + 牌面层，层数 = pileDepth(剩余张数)
  T.resetSession(false);
  T.openTable();
  const stacks = [].slice.call(doc.querySelectorAll('#pile-strip .pile-stack'));
  ok(stacks.length > 0, '牌堆栏有牌堆可查');
  ok(stacks.every(function (s) { return !!s.querySelector('.ps-layer') && !!s.querySelector('.ps-face'); }),
     '★★ 每一摞都有厚度层和牌面层 —— 带插画的英雄之旅 / Overflow 也一样');
  ok(stacks.every(function (s) {
    const left = parseInt(((s.querySelector('.ps-left') || {}).textContent) || '0', 10) || 0;
    return s.querySelectorAll('.ps-layer').length === UIP.pileDepth(left);
  }), '厚度层数 = pileDepth(剩余张数)');
  ok(stacks.every(function (s) { return /--ps-tint:#/.test(s.getAttribute('style') || ''); }),
     '★ 每一摞都把纸边色内联成 --ps-tint（跟着自己的牌背走）');
  // 选中态：名字下一条 14px 圆头短线（用户从 5 版里选的 D），不再是粗黑环
  ok(/\.pile-item\.is-active::after \{[^}]*width:\s*14px/.test(pileCss),
     '★ 选中态 = 名字下方 14px 短线');
  ok(/\.pile-item\.is-active::after \{[^}]*position:\s*absolute/.test(pileCss) &&
     /\.pile-item \{[^}]*position:\s*relative/.test(pileCss),
     '★ 短线绝对定位挂在 .pile-item 上（切牌堆时整排不跳高度）');
  ok(!/\.pile-item\.is-active \.pile-stack \.ps-face/.test(pileCss),
     '★★ 选中态不再给牌面套环 —— 外环/内环都会压住 0~3.5px 的厚度纸边');
  // 单一真源：两页不许再各拼一份
  const tableSrc = fs.readFileSync(path.join(WWW, 'js/scenes/table.js'), 'utf8');
  const zyTableSrc = fs.readFileSync(path.join(WWW, 'js/scenes/zhouyi-table.js'), 'utf8');
  ok(tableSrc.indexOf('UI.pileItemHTML') > 0 && zyTableSrc.indexOf('UI.pileItemHTML') > 0,
     '★ 占卜桌 / 周易页都调同一个 UI.pileItemHTML');
  ok(tableSrc.indexOf('ps-img') === -1 && zyTableSrc.indexOf('ps-img') === -1,
     '★★ 两页都不再各拼一份牌堆 HTML（ps-img / ps-tpl 只在 ui.js 里出现）');

  console.log('\n【12g】用手真的拖一张牌（补走查的一个大盲区）');
  // ★ 为什么单独留这一组：jsdom 没有指针捕获，而 bindCardPointer 里有
  //   `if (!el.hasPointerCapture) return` —— 不补 shim 的话，"用手拖牌"这条路
  //   在走查里会**静默跳过**（以前一直靠 trayOpen_ 之类的钩子绕开，从没测到）。
  //   这组不依赖任何辅助功能，只盯"拖了到底动不动"。
  T.resetSession(false);
  const cardEl = function (i) { return doc.querySelectorAll('#desk-canvas .tcard')[i]; };
  const xyz = function (i) {
    const el = cardEl(i);
    return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
  };
  dealOne(); dealOne();
  const el0 = cardEl(0), p0 = xyz(0);
  const ev0 = function (type, x, y) { el0.dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true })); };
  ev0('pointerdown', 100, 100);
  ev0('pointermove', 140, 130);
  ok(!!el0.style.transform && Math.abs(parseFloat(el0.style.left) - p0.x) < 0.6,
     '拖动中是走 transform 的，left/top 还停在原处（走查读位置要记得这点）');
  /* ★ 2026-11-13 用户两条要求，在这里钉住：
     ① 拖起来的那张必须压在最上层 —— 发牌时每张牌都有内联 z-index，
        光靠 CSS 的 `.tcard.is-drag{z-index:999}` 压不过内联值，必须真的抬高内联值；
     ② 拖动中牌面保持原样 —— 不描边、不透明、不加 filter。 */
  const zOther = parseInt(cardEl(1).style.zIndex, 10) || 0;
  ok(parseInt(el0.style.zIndex, 10) > zOther,
     '★★ 拖动一开始就把这张牌抬到最上层（内联 z-index 高过其它牌）',
     el0.style.zIndex + ' vs ' + zOther);
  const dragCss = (mcss + fs.readFileSync(path.join(WWW, 'css/v3.css'), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const dragBlocks = dragCss.match(/\.tcard\.is-drag\s*\{[^}]*\}/g) || [];
  ok(dragBlocks.length > 0 && dragBlocks.every(function (b) {
    return !/opacity\s*:|filter\s*:|box-shadow\s*:/.test(b);
  }), '★★ 拖动中的牌不描边、不半透明、不变亮（.tcard.is-drag 只剩 transition/cursor）');
  ev0('pointerup', 140, 130);
  const p1 = xyz(0);
  ok(Math.abs(p1.x - (p0.x + 40)) < 2 && Math.abs(p1.y - (p0.y + 30)) < 2,
     '★ 手指拖 40/30，牌就移动 40/30（真的走通了整条拖动链路）',
     '(' + p0.x + ',' + p0.y + ') → (' + p1.x + ',' + p1.y + ')');
  ok(!el0.style.transform, '松手后 transform 清空');
  ok(el0.classList.contains('is-settle'), '松手瞬间挂上了落定动画的类');
  await wait(260);
  ok(!el0.classList.contains('is-settle'), '200ms 后自己摘掉（不然牌会一直保持"高亮"状态）');

  /* ★ 用户追加：置顶不只对拖动，点击也要（A/B/C/D 叠着，点 A 时 A 也要在最上）。
     拖动刚把 el0 抬到 el1 上面；现在轻点 el1，它必须反超 el0。 */
  const el1 = cardEl(1);
  const ev1 = function (type, x, y) { el1.dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true })); };
  ev1('pointerdown', 300, 300);
  ev1('pointerup', 300, 300);
  ok(parseInt(el1.style.zIndex, 10) > parseInt(el0.style.zIndex, 10),
     '★★ 轻点一张牌也会把它抬到最上层（点击/拖动同一条置顶路径）',
     el1.style.zIndex + ' vs ' + el0.style.zIndex);

  console.log('\n【13】神签的教程类名：不许被通用规则污染（全局那套新手教程早已整段删除）');
  // ★ 这一组类名和**神签自己的教程**撞过（.tut-step / .tut-t）——
  //   新手教程那版把神签的字号/字重盖掉了（真踩过），所以只准留神签那一条。
  ['tut-step', 'tut-t', 'tut-head', 'tut-divider'].forEach(function (c) {
    const n = (css.match(new RegExp('\\.' + c + '\\s*\\{', 'g')) || []).length;
    eq(n, 1, '.' + c + ' 只剩一条规则（神签那条，没被通用规则污染）');
  });
  ok(/\.tut-step \{ padding: \.3rem 0; \}/.test(css), '神签的 .tut-step 原样保留');

  console.log('\n【14】牌背设定页：纸边开关 + 排版');
  const backPage = doc.getElementById('lib-back');
  MoKa.library.goDeck(deckId);
  ok(!!doc.getElementById('btn-deck-settings'), '牌组页有「设定」入口');
  doc.getElementById('btn-deck-settings').click();
  ok(backPage.classList.contains('is-active'), '进入了牌背设定页');
  // 牌背设定页：三组分区卡（牌背外观 / 纸边 / 牌面与翻牌），底部另有一张操作卡
  eq(backPage.querySelectorAll('.sec-card:not(.sec-card-actions)').length, 4,
     '四组 .sec-card（外观 / 纸边 / 牌面 / 缩略牌背——2026-10-11 从设置页搬来）');
  ok(!!backPage.querySelector('#tb-seg'), '★ 缩略牌背开关在牌背页（设置页不再有第二处"牌背"）');
  ok(!doc.querySelector('#set-page #tb-seg'), '\u2605 \u8bbe\u7f6e\u9875\u91cc\u6ca1\u6709\u7f29\u7565\u724c\u80cc\u5f00\u5173\uff08\u4e0d\u518d\u6709\u4e24\u5904\u724c\u80cc\uff09');
  eq(backPage.querySelectorAll('#tpl-row .tpl-chip').length, 7,
     '★ 牌背界面有 7 个 chip（无边框 + 6 个通用纹；内置牌背已数据化，不再进这张表）');
  // 再验一次"不跨界"：临时建一副普通牌组 → 只能看到 7 个（「划杠」不给它），验完删掉
  const plainId = MoKa.data.createDeck('走查-普通牌组').id;
  MoKa.library.goDeck(plainId);
  doc.getElementById('btn-deck-settings').click();      // 必须重进一次设定页才会按新牌组重画
  eq(backPage.querySelectorAll('#tpl-row .tpl-chip').length, 7,
     '★ 普通牌组也是 7 个 chip（通用模板人人可用，内置牌背不跨界显示）');
  MoKa.library.goDeck(deckId);
  doc.getElementById('btn-deck-settings').click();      // 切回原牌组，后面的断言照旧
  MoKa.data.deleteDeck(plainId);
  eq(backPage.querySelectorAll('#tpl-row .tpl-thumb').length, 0, '缩略图确实没了');
  ok(backPage.querySelector('.set-lb') && backPage.querySelectorAll('.seg').length >= 4,
     '四个开关用的是同一种 .seg 控件');
  const chips = backPage.querySelectorAll('#tpl-row .tpl-chip');
  chips[4].click();
  ok(chips[4].classList.contains('is-sel'), '点第 5 个模板 → 选中');
  ok(backPage.querySelector('.back-preview').classList.contains('is-tpl-corner'),
     '大预览立刻换成「四角」');
  chips[0].click();
  ok(!/is-tpl-/.test(backPage.querySelector('.back-preview').className), '点「无边框」→ 预览没有模板类');
  ok(!!backPage.querySelector('.sec-card-actions'), '底部统一是 .sec-card-actions');
  ok(!!backPage.querySelector('#back-fb'), '预览下面那行「当前边框模板」在');
  ok(backPage.querySelector('.back-preview').classList.contains('is-edge'), '默认纸边是「开」');
  ok(backPage.querySelector('#edge-on').classList.contains('is-sel'), '「开」是选中态');

  ok(backPage.querySelector('#face-on').classList.contains('is-sel'), '牌面纸边默认也是「开」');
  backPage.querySelector('#edge-off').click();
  ok(!backPage.querySelector('.back-preview').classList.contains('is-edge'), '点「关」→ 预览立刻没纸边');
  ok(backPage.querySelector('#edge-off').classList.contains('is-sel'), '「关」变选中态');
  backPage.querySelector('#face-off').click();
  ok(backPage.querySelector('#face-off').classList.contains('is-sel'), '牌面纸边「关」也选中了');
  backPage.querySelector('#btn-back-save').click();
  eq(D.findDeck(deckId).backEdge, false, '保存后牌组 backEdge = false');
  eq(D.findDeck(deckId).faceEdge, false, '保存后牌组 faceEdge = false');
  await wait(150);   // persist() 是异步串行的（见 data.js 里那段注释），要等它落盘
  const rawDecks = JSON.parse(window.localStorage.getItem('moka.decks.v1')) || [];
  eq((rawDecks.filter(function (d) { return d.id === deckId; })[0] || {}).backEdge, false, '并且已经落盘');

  T.trayClose();
  T.resetSession(false);
  T.trayOpen_();
  Array.prototype.slice.call(doc.querySelectorAll('#tray-grid .tray-card'))[0].click();
  const backEl = doc.querySelector('.tcard .tcard-back');
  ok(!!backEl, '发出来一张牌');
  ok(!backEl.classList.contains('is-edge'), '纸边关了 → 桌面牌背没有 is-edge');
  ok(!doc.querySelector('.tray-card').classList.contains('is-edge'), '选牌台卡片也没有 is-edge');
  ok(!doc.querySelector('.pile-stack').classList.contains('is-edge'), '牌堆栏方块也没有 is-edge');
  const faceEl = doc.querySelector('.tcard .tcard-face');
  ok(!!faceEl, '桌面牌有 .tcard-face');
  ok(!faceEl.classList.contains('is-edge'), '牌面纸边关了 → 牌面没有 is-edge');

  MoKa.library.goDeck(deckId);
  doc.getElementById('btn-deck-settings').click();
  backPage.querySelector('#edge-on').click();
  backPage.querySelector('#face-on').click();
  backPage.querySelector('#btn-back-save').click();
  eq(D.findDeck(deckId).backEdge, true, '改回「开」也能存');
  eq(D.findDeck(deckId).faceEdge, true, '牌面也改回「开」');
  T.resetSession(false);
  T.trayOpen_();
  Array.prototype.slice.call(doc.querySelectorAll('#tray-grid .tray-card'))[0].click();
  ok(doc.querySelector('.tcard .tcard-back').classList.contains('is-edge'), '开回来 → 牌背又有 is-edge');
  ok(doc.querySelector('.tcard .tcard-face').classList.contains('is-edge'), '开回来 → 牌面也有 is-edge');

  console.log('\n【15】导航：子页面要回「它进来的地方」');
  const lib = MoKa.library;
  const isActive = function (id) { return doc.getElementById(id).classList.contains('is-active'); };

  // ① 首页 → 设定 → 保存设定 → 必须回首页（用户报的 bug 就是这个）
  lib.goHome();
  ok(isActive('lib-home'), '先回到「我的牌组」');
  doc.querySelector('#lib-home .btn-deck-back').click();
  ok(isActive('lib-back'), '首页点「设定」→ 进牌背设定页');
  doc.getElementById('btn-back-save').click();
  ok(isActive('lib-home'), '保存设定 → 回「首页」✔');
  ok(!isActive('lib-deck'), '没有掉到「管理」之后的那个牌组页（修的就是这个）');

  // ② 首页 → 设定 → 「返回」 → 首页
  doc.querySelector('#lib-home .btn-deck-back').click();
  doc.getElementById('btn-back-home2').click();
  ok(isActive('lib-home'), '「返回」按钮也回首页');

  // ③ 首页 → 设定 → 系统返回键 → 首页
  doc.querySelector('#lib-home .btn-deck-back').click();
  eq(lib.back(), true, '系统返回键被这一层吃掉（不退出 App）');
  ok(isActive('lib-home'), '系统返回键也回首页');

  // ④ 牌组页 → 设定 → 保存 → 回牌组页（另一条来路不能被改坏）
  lib.goDeck(deckId);
  doc.getElementById('btn-deck-settings').click();
  ok(isActive('lib-back'), '牌组页点「设定」→ 进牌背设定页');
  doc.getElementById('btn-back-save').click();
  ok(isActive('lib-deck'), '从牌组页进的 → 保存后回牌组页 ✔');
  lib.goHome();

  console.log('\n【15b】切场景 + 导入回来：占卜桌视角不能被弄偏（用户报的 bug）');
  (function () {
    // ★ 真机行为：占卜桌隐藏（display:none）时 playfield 量出来就是 0×0。
    //   jsdom 里所有元素都量成 0，所以这里要按"场景是否显示"手动区分，才可能复现这个 bug。
    const dom2 = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
    const w2 = dom2.window, d2 = w2.document;
    w2.Element.prototype.setPointerCapture = function () {};
    w2.Element.prototype.hasPointerCapture = function () { return true; };
    w2.Element.prototype.releasePointerCapture = function () {};
    const SCR = { w: 393, h: 760 };
    const pf2 = d2.getElementById('playfield');
    pf2.getBoundingClientRect = function () {
      const on = d2.getElementById('scene-table').classList.contains('is-active');
      return on
        ? { left: 0, top: 0, right: SCR.w, bottom: SCR.h, width: SCR.w, height: SCR.h, x: 0, y: 0 }
        : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
    };
    const FILES2 = ['js/idb.js', 'js/builtin-decks.js', 'js/random.js', 'js/data.js', 'js/ui.js', 'js/lot-shot.js', 'js/scenes/table.js', 'js/scenes/library.js', 'js/scenes/editor.js', 'js/scenes/settings.js', 'js/scenes/lots.js'];
    FILES2.forEach(function (f) { w2.eval(fs.readFileSync(path.join(WWW, f), 'utf8')); });
    const M2 = w2.MoKa, T2 = M2.table, D2b = M2.data;
    T2.init(); M2.library.init(); M2.editor.init(); M2.settings.init();
    // app.gotoScene 对占卜桌做的就是这两件事（这里不引 app.js，免得它的 init 跟手动 init 打架）
    const goto2 = function (name) {
      d2.querySelectorAll('.scene').forEach(function (s) { s.classList.toggle('is-active', s.dataset.scene === name); });
      if (name === 'table') T2.openTable();
    };
    const canvas2 = d2.getElementById('desk-canvas');
    /* ★ 2026-11-05：比较前把变换**规范化成「函数名 | 数值序列」**再比。
       运行时会把内联变换规范成 `translate3d(a, b, 0px)`（逗号后加空格、`0` → `0px`），
       而这里拼的期望值是 `translate3d(a,b,0)` —— 不规范化，这条断言在**一行代码都没改**
       的情况下也会红（`验证.py 全部` 里恒定 2 条假红，把真红一起淹掉）。
       规范化只吃掉排版差异（空格 / 省略单位 / 尾零）；**函数名、参数个数、数值照样逐字比**，
       真实的偏移（哪怕 1px）仍然红 —— 这条断言保护的还是「牌中心压在视野正中」。 */
    const normTf = function (s) {
      const raw = String(s || '');
      const fn = (raw.match(/translate3d|scale/g) || []).join('/');
      const nums = (raw.match(/-?\d+(?:\.\d+)?/g) || [])
        .map(function (n) { return Math.round(parseFloat(n) * 100) / 100; }).join(',');
      return fn + '|' + nums;
    };
    const tf2 = function () { return normTf(canvas2.style.transform); };
    // 画布变换里"居中"那两项 = 半屏尺寸 - cam（applyCam 就是这么算的）
    const expectTf = function () {
      const c = T2.snapshot_().cam;
      return normTf('translate3d(' + (SCR.w / 2 - c.x) + 'px,' + (SCR.h / 2 - c.y) + 'px,0) scale(' + c.scale + ')');
    };
    const deal2 = function () {
      T2.trayOpen_();
      const c = d2.querySelectorAll('#tray-grid .tray-card')[0];
      if (c) c.click();
      T2.trayClose();
    };

    goto2('table');
    T2.resetSession(false);
    deal2();
    const good = tf2();
    eq(good, expectTf(), '占卜桌上画布是"按半屏居中"的');

    // ★ 牌库点「导入」要选文件，选完回来 WebView 会发一次 resize —— 而这时占卜桌是隐藏的
    goto2('library');
    D2b.importDeck(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', '导出-崩铁牌组.json'), 'utf8')).deck);
    M2.library.goHome();
    w2.dispatchEvent(new w2.Event('resize'));
    eq(tf2(), good, '★ 隐藏状态下那次 resize 不许把画布的居中量弄坏');

    goto2('table');
    eq(tf2(), good, '★ 切回占卜桌，视角和切走时**一模一样**（用户报的偏移就是这里）');

    // 隐藏期间尺寸真的变了（横竖屏/分屏/从后台回来）→ 回来要按新尺寸重新居中
    SCR.w = 800; SCR.h = 600;
    goto2('library');
    w2.dispatchEvent(new w2.Event('resize'));
    goto2('table');
    eq(tf2(), expectTf(), '★ 隐藏期间尺寸变了（800×600）→ 回桌面按新尺寸重新居中');
  })();

  console.log('\n【15b2】内置牌组的缩略背：牌库的牌盒 + 选牌台的小背都得跟着模板走');
  // ★ 2026-09-20 用户报的：「牌库那个界面 内置的两个牌组没有同步他们自己的牌背」。
  //   根因两处都**写死 ✦**：牌库 renderHome 从没接过模板；选牌台的小背在删卢恩时被我改成了固定值。
  //   现在两处共用 UI.backThumbInner()。
  (function () {
    const D3 = window.MoKa.data, LIB3 = window.MoKa.library;
    // ★ 前面【14】组把第一副上桌牌（现为 Love & Armour）的牌背点成了「无边框」，这里恢复成它的内置牌背
    const _la0 = D3.listDecks().filter(function (d) { return d.name === 'Love & Armour'; })[0];
    if (_la0) { D3.setDeckBack(_la0.id, { image: null, template: 'lovearmour', color: '#2e5447' }); }
    LIB3.renderHome();
    const boxOf = function (nm) {
      const b = [].slice.call(doc.querySelectorAll('.deck-box')).filter(function (x) {
        return ((x.querySelector('.deck-box-name') || {}).textContent || '') === nm;
      })[0];
      return b ? b.querySelector('.deck-box-back') : null;
    };
    const ag = boxOf('Love & Armour');
    ok(!!ag && ag.className.indexOf('has-tpl') >= 0 && ag.innerHTML.indexOf('deckimg/lovearmour/_back.jpg') >= 0,
       '★ 牌库：Love & Armour 的牌盒缩略背画的是玫瑰心结盘（外置图，不再是 ✦）');
    const mine = D3.createDeck('走查-我的牌');
    LIB3.renderHome();
    const mb = boxOf('走查-我的牌');
    ok(!!mb && mb.innerHTML.indexOf('dbb-mark') >= 0 && mb.className.indexOf('has-tpl') < 0,
       '★ 用户自己的牌组仍然是一颗 ✦（内置模板只属于那两副）');
    D3.deleteDeck(mine.id);
    // 选牌台：点 Aegis 那堆 → 小背也得是盾印
    const agDeck = D3.listDecks().filter(function (d) { return d.name === 'Love & Armour'; })[0];
    const pileEl = [].slice.call(doc.querySelectorAll('#pile-strip .pile-item')).filter(function (x) {
      return x.dataset.id === agDeck.id;
    })[0];
    ok(!!pileEl, '（占卜桌上有 Love & Armour 那一堆，才验得到小背）');
    if (pileEl) {
      pileEl.click();
      T.trayOpen_();
      const car = doc.querySelector('#tray-grid .tray-card');
      ok(!!car && car.innerHTML.indexOf('deckimg/lovearmour/_back.jpg') >= 0,
         '★ 选牌台：Love & Armour 那一堆的小牌背画的是玫瑰心结盘');
      T.trayClose();
    }
    // ★ 用户自己放的牌背图：选牌台也要显示（2026-09-20 用户报：「我自己用图片做的牌背
    //   在选牌台界面 不显示」）。克隆一副内置的来验（自带 35 张卡，不然选牌台是空的）。
    const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const clone = D3.cloneDeck(agDeck.id);   // 副本名是自动的（Aegis牌组 · 2）
    D3.setDeckBack(clone.id, { image: IMG, template: null, color: '#8a7a3a' });
    T.trayClose();
    T.openTable();
    const pEl = [].slice.call(doc.querySelectorAll('#pile-strip .pile-item')).filter(function (x) {
      return x.dataset.id === clone.id;
    })[0];
    ok(!!pEl, '（占卜桌上有「图背」那一堆，才验得到小背）');
    if (pEl) {
      pEl.click();
      T.trayOpen_();
      const c2 = doc.querySelector('#tray-grid .tray-card');
      ok(!!c2 && c2.innerHTML.indexOf('tc-img') >= 0 && c2.innerHTML.indexOf('data:image/png') >= 0,
         '★ 选牌台：用户自己放的牌背图**会显示**（.tc-img 层）——以前这里是空的');
      ok(!!c2 && c2.innerHTML.indexOf('tc-logo') < 0 && c2.innerHTML.indexOf('dbb-mark') < 0,
         '★ 有图时不往图上压 ✦（和牌面大背同一规矩）');
      T.trayClose();
    }
    LIB3.renderHome();
    const ib = boxOf(clone.name);
    ok(!!ib && ib.className.indexOf('has-img') >= 0 &&
       (ib.getAttribute('style') || '').indexOf('background-image') >= 0 && ib.innerHTML.indexOf('dbb-mark') < 0,
       '★ 牌库：有图的那副，牌盒只画图、不压 ✦');
    D3.deleteDeck(clone.id);

    // 缩略图那层的定位：模板层要能铺满盒/小背（自给自足地读 CSS，别借外面的闭包）
    const v3t = require('fs').readFileSync(require('path').join(WWW, 'css/v3.css'), 'utf8');
    ok(cssRuleHas(v3t, '.dbb-tpl', 'position:\\s*absolute') &&
       cssRuleHas(v3t, '.tc-tpl', 'position:\\s*absolute') &&
       /\.deck-box-back \{[^}]*position:\s*relative/.test(v3t),
       '★ .dbb-tpl/.tc-tpl 有定位样式（绝对铺满缩略盒），且牌盒是 position:relative');
  })();

  console.log('\n【15c】缩略牌背开关：选牌台 / 占卜桌 / 牌库 三处统一，默认/个性图片两档');
  // ★ 2026-09-20 用户要的：三处小牌背统一跟牌背走，并加一个设置项决定「默认」还是「个性图片」。
  (function () {
    const D4 = window.MoKa.data, UI4 = window.MoKa.ui, T4 = window.MoKa.table;
    const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    ok(D4.getThumbBack && D4.setThumbBack, '★ 有 getThumbBack/setThumbBack 这个设置项');
    eq(D4.getThumbBack(), 'own', '★ 默认值是「个性图片」（own）—— 用户报的就是图不显示');
    const agD = D4.listDecks().filter(function (d) { return d.name === 'Love & Armour'; })[0];
    const cl = D4.cloneDeck(agD.id);
    D4.setDeckBack(cl.id, { image: IMG, template: 'lovearmour', color: '#2e5447' });
    const mine2 = D4.createDeck('走查-素背');   // 既没图也没模板 → 应该一直是 ✦

    const probe = function () {
      T4.openTable();
      const pi = [].slice.call(doc.querySelectorAll('#pile-strip .pile-item')).filter(function (x) { return x.dataset.id === cl.id; })[0];
      pi.click();
      T4.trayOpen_();
      const tray = doc.querySelector('#tray-grid .tray-card');
      window.MoKa.library.renderHome();
      const box = [].slice.call(doc.querySelectorAll('.deck-box')).filter(function (b) {
        return ((b.querySelector('.deck-box-name') || {}).textContent || '') === cl.name;
      })[0].querySelector('.deck-box-back');
      const stack = pi.querySelector('.pile-stack');
      T4.trayClose();
      return { tray: tray ? tray.innerHTML : '', stack: stack ? stack.innerHTML : '',
               box: box, boxStyle: box ? (box.getAttribute('style') || '') : '', boxHTML: box ? box.innerHTML : '' };
    };

    D4.setThumbBack('own');
    let r = probe();
    ok(r.stack.indexOf('ps-img') >= 0, '★ 占卜桌那一摞：显示自己放的图（ps-img 层）');
    ok(r.tray.indexOf('tc-img') >= 0 && r.tray.indexOf(IMG) >= 0, '★ 选牌台小背：显示自己放的图（tc-img 层）');
    ok(r.boxStyle.indexOf('background-image') >= 0, '★ 牌库牌盒：显示自己放的图');

    D4.setThumbBack('default');
    r = probe();
    ok(r.stack.indexOf('ps-img') < 0 && r.tray.indexOf('tc-img') < 0 && r.boxStyle.indexOf('background-image') < 0,
       '★ 选「默认」→ 三处都不再显示自己的图');
    ok(r.stack.indexOf('ps-tpl') >= 0 && r.tray.indexOf('tc-tpl') >= 0 && r.boxHTML.indexOf('dbb-tpl') >= 0,
       '★ 选「默认」时内置模板顶上来（一盾两色），三处都不空');
    ok(r.stack.indexOf('ps-mark') < 0 && r.tray.indexOf('tc-logo') < 0 && r.boxHTML.indexOf('dbb-mark') < 0,
       '★ 有模板时不再叠 ✦/▶（大背也是这个规矩）');
    D4.setThumbBack('own');

    // 素背（没图没模板）：两档都应该还是 ✦
    T4.openTable();
    const ps2 = [].slice.call(doc.querySelectorAll('#pile-strip .pile-item')).filter(function (x) { return x.dataset.id === mine2.id; })[0];
    ok(!!ps2 && ps2.querySelector('.pile-stack').innerHTML.indexOf('ps-mark') >= 0,
       '★ 既没图也没模板的牌组：牌堆仍然是 ✦/▶');

    // 设置页那一节真的画出来了
    window.MoKa.settings.render();
    const seg = doc.querySelector('#tb-seg');
    ok(!!seg && seg.querySelectorAll('button').length === 2 &&
       seg.querySelector('[data-tb="own"]').className.indexOf('is-sel') >= 0,
       '★ 设置页有「缩略牌背」这一节，默认选中「个性图片」');
    const v3t2 = require('fs').readFileSync(require('path').join(WWW, 'css/v3.css'), 'utf8');
    ok(cssRuleHas(v3t2, '.ps-img', 'position:\\s*absolute') &&
       cssRuleHas(v3t2, '.ps-tpl', 'position:\\s*absolute') &&
       /\.pile-stack \{[^}]*position:\s*relative/.test(v3t2),
       '★ 牌堆里的图/模板层有定位样式（绝对铺满 .pile-stack）');
    // ★ 2026-09-21 用户报「切到默认时数字角标跑偏」：根因是我给 .ps-mark/.ps-left 写了 position:relative，
    //   把 main.css 里的绝对定位顶掉了（角标掉进正常流）。这条钉住：v3 里只许抬 z-index。
    const base = require('fs').readFileSync(require('path').join(WWW, 'css/main.css'), 'utf8');
    ok(/\.pile-stack \.ps-left \{[^}]*position:\s*absolute/.test(base) &&
       /\.pile-stack \.ps-mark \{[^}]*position:\s*absolute/.test(base),
       '★ main.css 里 .ps-mark/.ps-left 仍是绝对定位（底层规矩）');
    ok(!/\.pile-stack \.ps-(mark|left)[^{]*\{[^}]*position:\s*(relative|static)/.test(v3t2),
       '★★ v3.css 里**不许**再给 .ps-mark/.ps-left 改 position（只能加 z-index）');
    D4.deleteDeck(cl.id);
    D4.deleteDeck(mine2.id);
    D4.setThumbBack('own');
  })();

  console.log('\n【15d】牌组页的缩略卡＝缩小的牌面（一次渲染，不再两套）');
  // ★ 2026-09-21 用户选的方案 B。之前牌盒自己拼一套固定 px 小布局，导致同一个东西有两个真源：
  //   牌背、自定义牌面图、层级条都先后漏过（"改了牌面忘了牌盒"）。现在牌盒直接调 UI.faceHTML(card)。
  (function () {
    const D5 = window.MoKa.data, LIB5 = window.MoKa.library, UI5 = window.MoKa.ui;
    const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const libSrc = require('fs').readFileSync(require('path').join(WWW, 'js/scenes/library.js'), 'utf8');
    const v3s = require('fs').readFileSync(require('path').join(WWW, 'css/v3.css'), 'utf8');

    // ① 一次渲染：decCardHTML 调的就是 faceHTML
    ok(libSrc.indexOf('UI.faceHTML(card)') > 0, '★★ deckCardHTML 调的就是 UI.faceHTML(card)（同一个渲染器）');
    ok(!/\.deck-card \.dc-(bar|band|emblem|img|name|kw|sym)\b/.test(v3s),
       '★★ v3.css 里那套自拼的 .dc-* 规则已删干净（不留第二个真源）');

    // ② Love & Armour：牌面里设计的东西自动全在（外置牌面图 + 文字层牌名）
    const ag = D5.listDecks().filter(function (d) { return d.name === 'Love & Armour'; })[0];
    LIB5.goDeck(ag.id);
    const agTiles = [].slice.call(doc.querySelectorAll('.deck-card.dc-face-tile'));
    ok(agTiles.length === 61, '（Love & Armour 61 格：爱情 26 + 防御 35）');
    ok(agTiles.every(function (t) { return !!t.querySelector('.tcard-side.tcard-face'); }),
       '★ 每格都是牌面（.tcard-face）');
    ok(agTiles.every(function (t) { return !!t.querySelector('.fc-img'); }),
       '★★ 牌面图（.fc-img）自动出现在每一格（来自牌面 —— 以前牌盒里根本没有它）');
    ok(!!agTiles[0].querySelector('.dc-no'), '序号仍浮在牌面上（.dc-no）');
    ok(!!agTiles[0].querySelector('.fc-chip.fc-name'), '名字走牌面的药丸（.fc-chip.fc-name）');

    // ②b ★ 实机踩到的两条硬条件（jsdom 不算渲染，只能钉 CSS 文本）：
    //     牌面是 3D 翻转牌的"背面"（rotateY(180deg) + backface-visibility:hidden），
    //     直接塞进牌盒会背面朝我们、被整个藏掉 → 牌盒必须把翻转中和掉；且容器要绝对定位铺满。
    ok(/\.dc-face-tile \.tcard-side,[\s\S]{0,120}backface-visibility: visible !important/.test(v3s),
       '★★ 牌盒里把牌面的 backface-visibility 改成 visible（否则整格空白）');
    ok(/\.dc-face-tile \.tcard-inner \{ transform: none !important/.test(v3s) &&
       /\.dc-face-tile \.tcard-side,[\s\S]{0,80}transform: none !important/.test(v3s),
       '★★ 牌盒里把翻转用的 rotateY(180deg) 中和掉');
    ok(/\.dc-facebox \{ position: absolute !important; inset: 0; \}/.test(v3s),
       '★ .dc-facebox 绝对定位铺满（不用 height:100%，flex 列里可能解析成 0）');

    // ③ 缩放：量一次格子宽度设给整栏（jsdom 量不到 → 兜底 104px）
    const grid = doc.querySelector('.deck-grid');
    ok(grid.style.getPropertyValue('--card-w') === '104px' && grid.style.getPropertyValue('--card-h') === '151px',
       '★ 整栏设了 --card-w/--card-h（量不到时兜底 104；真机上按实际格子宽度）');

    // ④ 整面牌面图：插画在、没有层级条
    const agDeck5 = D5.listDecks().filter(function (d) { return d.name === 'Love & Armour'; })[0];
    LIB5.goDeck(agDeck5.id);
    const agTiles5 = [].slice.call(doc.querySelectorAll('.deck-card.dc-face-tile'));
    ok(agTiles5.length > 0 && agTiles5[0].querySelector('.fc-img') && !agTiles5[0].querySelector('.fc-band'),
       '★ 整面牌面图（.fc-img）在、没有层级条（Aegis 没有 band）');

    // ⑤ 自定义牌面图：牌面自己会画（.fc-img），牌盒不用管
    const mine = D5.createDeck('走查-带图');
    const dkMine = D5.findDeck(mine.id);
    dkMine.cards = [{ id: 'x1', name: '开拓', keyword: '开路', image: IMG, color: '#5b7cfa' },
                    { id: 'x2', name: '存护', keyword: '守住', color: '#8a5cf6' }];
    LIB5.goDeck(mine.id);
    const t1 = doc.querySelector('.deck-card.dc-face-tile');
    ok(!!t1 && !!t1.querySelector('.fc-img') && t1.innerHTML.indexOf('data:image/png') >= 0,
       '★★ 自己配了牌面图的卡：图自动出现（牌面画的，牌盒一行都不用写）');
    D5.deleteDeck(mine.id);
  })();

  console.log('\n【15e】边框模板：每个按钮都必须真的画得出东西（不许有"死按钮"）');
  // ★ 2026-09-21 用户报「设定→边框模板→斜纹 似乎是个无效按钮」。根因：
  //   v3.css 里那条给 content/定位 的规则只列了 frame/double/lozenge，
  //   后面 corner/dotted/stripe/diag 的 ::after 规则只写了 inset/border/background ——
  //   **没有 content 的 ::after 不会生成**，所以那四款一直是死按钮。
  //   这条守卫按"模板表里的 id"逐个核对 CSS，以后再加模板忘了写 content 就会红。
  (function () {
    const fs2 = require('fs'), path2 = require('path');
    const lib = fs2.readFileSync(path2.join(WWW, 'js/scenes/library.js'), 'utf8');
    const v3c = fs2.readFileSync(path2.join(WWW, 'css/v3.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const ids = [];
    lib.replace(/\{ id: '([a-z]+)',\s*name: '([^']+)'/g, function (m, id) {
      // 内置那几面牌背（aegis / guax / hero…）是 SVG 数据（back.svg → backSvg），不在这张模板表里
      ids.push(id);
      return m;
    });
    // 通用模板 6 款（frame/double/lozenge/corner/dotted/stripe）；「斜纹」2026-09-21 下架
  ok(ids.length >= 6, '（模板表里通用边框 ' + ids.length + ' 款：' + ids.join(' / ') + '）');
    // ⚠ content 有两条来源：① 每款自己的 `.is-tpl-X::after`；
    //   ② 通用属性选择器 `.tcard-back[class*="is-tpl-"]::after`（§「模板画法」那段一次给全部）。
    //   只搜 ① 会误判成"死按钮" —— 这正是 2026-09-21 我踩的坑，所以这条守卫两条都认。
    const generic = /\[class\*="is-tpl-"\]::after[^{]*\{[^}]*content:\s*""/.test(v3c);
    ok(generic, '★ 通用属性选择器给了 is-tpl-* 的 content（[class*="is-tpl-"]::after）');
    const withContent = {}, withPattern = {};
    v3c.replace(/([^{}]+)\{([^{}]*)\}/g, function (m, sel, body) {
      (sel.match(/is-tpl-([a-z]+)::after/g) || []).forEach(function (s2) {
        const id = s2.replace(/.*is-tpl-([a-z]+)::after/, '$1');
        if (body.indexOf('content: ""') >= 0) withContent[id] = true;
        if (/background:|border:/.test(body)) withPattern[id] = true;      // 每款自己的画法
      });
      return m;
    });
    const noDraw = ids.filter(function (id) { return !withPattern[id]; });
    ok(noDraw.length === 0,
       '★★ 每款边框模板都有自己的画法（inset + border/background）' + (noDraw.length ? '｜没画法的：' + noDraw.join(' / ') : ''));
    const noContent = ids.filter(function (id) { return !withContent[id] && !generic; });
    ok(noContent.length === 0, '★★ 每款的 ::after 都会真的生成（自己有 content，或通用规则兜住）');
    // 竖纹这种"细到看不见"的也要防：白色兜底线不许淡于 .5（28% 那版就是看不见的元凶）
    const stripeRules = v3c.match(/\.is-tpl-stripe::after[^{]*\{([^}]*)\}/g) || [];
    const thin = stripeRules.filter(function (r) { return /rgba\(255, 255, 255, \.[0-4]\d?\)/.test(r); });
    ok(stripeRules.length >= 1 && thin.length === 0,
       '★ 竖纹的纹理不许淡到看不见（白色兜底线透明度须 ≥ .5）');
  })();

  /* ★★ 2026-09-21：竖纹这一款前后修了三次，把"哪里会坏"钉成一组几何/对比守卫。
     背景见 v3.css §34 的注释：① 周期落在"双位置色标"的第二个位置上 → 解读权在浏览器手里，
     写错一次就退化成"整块透明/只有左边一条线"；② 28% 白线叠蓝底只有 ~1.2:1 对比，
     112px 的小预览里等于看不见（用户："竖纹没什么反应"）；③ 换成 --bk 主色更糟（1.13:1），
     因为 --bk 是强调色、底色不归它管。最后钉在 **70% 白线**上。
     ⚠ 「斜纹」已于同日下架（和竖纹切换看不出区别），模板表里只剩竖纹一款纹理。 */
  console.log('\n【15f】竖纹：周期可算、白线够实、三种底上都看得见、不靠浏览器猜');
  (function () {
    const fs3 = require('fs'), path3 = require('path');
    const css3 = fs3.readFileSync(path3.join(WWW, 'css/v3.css'), 'utf8');
    // 带选择器的规则表（先挖掉注释，否则注释里那些"历史写法"会被当成真规则）
    const bare = css3.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [];
    const reR = /([^{}]+)\{([^{}]*)\}/g;
    let rm;
    while ((rm = reR.exec(bare))) rules.push({ sel: rm[1].trim(), body: rm[2] });
    const rule = rules.filter(function (r) {
      return /\.is-tpl-stripe::after/.test(r.sel) && /repeating-linear-gradient/.test(r.body);
    })[0];
    ok(!!rule, '★★ 竖纹这条 ::after 有 repeating-linear-gradient 画法');

    // 对比度工具（WCAG 相对亮度）
    function lum(c) {
      const g = c.map(function (v) { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); });
      return .2126 * g[0] + .7152 * g[1] + .0722 * g[2];
    }
    function contrast(a2, b2) { const l1 = lum(a2), l2 = lum(b2); return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05); }
    function mix(fg, bg2, a2) { return fg.map(function (v, i) { return Math.round(v * a2 + bg2[i] * (1 - a2)); }); }

    if (rule) {
      // 色标解析：⚠ 不能按逗号 split —— `rgba(255, 255, 255, .7)` 自己就带逗号，
      //   一条色标会被切成四段（这里踩过两次）。改成整串正则扫描色标。
      function parseStops(param) {
        const re = /(rgba\(255,\s*255,\s*255,\s*([\d.]+)\)|transparent)((?:\s+0|\s+[\d.]+px|\s+[\d.]+%){1,2})?/g;
        const out = [];
        let mm;
        while ((mm = re.exec(param))) {
          out.push({
            kind: mm[2] !== undefined ? 'white' : 'clear',
            alpha: mm[2] !== undefined ? parseFloat(mm[2]) : 0,
            // ⚠ 位置里的 "0" 是没单位的（CSS 里 `rgba(…) 0` 合法），parseFloat 照样认
            pos: mm[3] ? mm[3].trim().split(/\s+/).map(function (x) { return parseFloat(x); }) : []
          });
          if (re.lastIndex === mm.index) re.lastIndex++;             // 防零长匹配死循环
        }
        return out;
      }
      // 一个属性写了多条时只有最后一条生效
      const decls = rule.body.match(/background\s*:\s*[\s\S]*?;/g) || [];
      const g = decls.length ? decls[decls.length - 1].match(/repeating-linear-gradient\(([\s\S]*?)\)\s*;/) : null;
      ok(!!g, '★★ 竖纹的色标写法能被解析出来');
      if (g) {
        const stops = parseStops(g[1]);
        const whites = stops.filter(function (s2) { return s2.kind === 'white' && s2.pos.length; });
        const gaps = stops.filter(function (s2) { return s2.kind === 'clear' && s2.pos.length; });
        const deg = parseFloat((g[1].match(/(-?\d+(?:\.\d+)?)deg/) || [])[1]);

        // ① 竖着画，线宽和周期都写死，别靠浏览器猜
        eq(deg, 90, '★ 竖纹就是 90deg 竖着画');
        eq(stops.length, 4, '★★ 4 个单位置色标（周期明确：线 → 空 → 线）');
        ok(whites.length === 2 && whites[0].pos[0] === 0 && whites[1].pos[0] === 1.5,
           '★★ 线写在 0 → 1.5px（起始补 0：90deg 从左起，不补左边缘会掉半条）',
           JSON.stringify(whites));
        const tail = stops[stops.length - 1];
        ok(tail && tail.kind === 'clear' && tail.pos.length === 1,
           '★★ 收尾是单位置的 transparent（双位置收尾时周期解读权在浏览器手里 → 会退化成"看不见"）',
           JSON.stringify(tail));
        const period = gaps.length ? gaps[gaps.length - 1].pos[gaps[gaps.length - 1].pos.length - 1] : null;
        eq(period, 6, '★ 竖纹周期 6px（项目记录 §34 的规格）');

        // ② 线必须是"够实的白"：≥ .6（28% 那一版就是反面教材）
        ok(whites.length && whites[0].alpha >= .6,
           '★★ 线的白色浓度 ≥ .6（实际 ' + (whites[0] && whites[0].alpha) + '；28% 那版叠蓝底 ≈ 1.2:1，等于看不见）');

        // ③ 三种真实底色上都要看得见（阈值 1.5：1.5px 的细线，1.5:1 已明显可见）
        const a3 = whites[0].alpha;
        const onPreview = contrast(mix([255, 255, 255], [77, 122, 247], a3), [77, 122, 247]);  // 预览亮蓝 #4d7af7
        const onGold    = contrast(mix([255, 255, 255], [217, 168, 58], a3), [217, 168, 58]);  // 旧金底 #d9a83a
        const onCard    = contrast(mix([255, 255, 255], [58, 72, 88], a3), [58, 72, 88]);       // 牌背深蓝黑
        ok(onPreview >= 1.5, '★★ 预览亮蓝底上白线对比 ≥1.5:1（实际 ' + onPreview.toFixed(2) + '）');
        ok(onGold >= 1.5,    '★★ 金底上白线对比 ≥1.5:1（实际 ' + onGold.toFixed(2) + '）');
        ok(onCard >= 3,      '★★ 深色牌背底上白线对比 ≥3:1（实际 ' + onCard.toFixed(2) + '）');
      }
    }
  })();

  /* ============================================================
     【15g】2026-09-21 三份代码审查里**实测复现**过的数据层 bug，一条一条钉住。
     每条都先在这套走查里跑出过"错的结果"，再改代码，所以它们是真的有牙：
       · 身份全押在名字上 → 用户同名牌组被内置内容同步改写（卡被删、被灌）
       · 牌组级字段白名单漏了纸边 → 克隆/导出导入一圈就回默认
       · 下载导出把 idb: 图片当"没有图" → 备份是个没有图的空壳
     ============================================================ */
  console.log('\n【15g】数据层回归：同名不误伤 / 纸边不丢 / idb 图不静默丢');
  (function () {
    const FILES_ = ['js/idb.js', 'js/builtin-decks.js', 'js/random.js', 'js/data.js', 'js/ui.js', 'js/jszip.min.js',
                    'js/io.js', 'js/lot-shot.js', 'js/cropper.min.js', 'js/imagecrop.js'];
    function boot2(storage) {
      const dom3 = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
      const w3 = dom3.window;
      if (storage) Object.keys(storage).forEach(function (k) { w3.localStorage.setItem(k, storage[k]); });
      FILES_.forEach(function (f) { w3.eval(fs.readFileSync(path.join(WWW, f), 'utf8')); });
      return w3;
    }

    // ---- 1) 用户自建一副和内置同名的牌组：内容同步不许碰它 ----
    (function () {
      // 先正常起一次，拿一份真注册表 + 真实内置牌组数据
      const w0 = boot2(null);
      w0.MoKa.data.listDecks();                 // 装机时建内置牌组（会异步落盘，这里只要内存那份）
      const builtinName = 'Love & Armour';
      const inner = w0.MoKa.data.listDecks().find(function (d) { return d.name === builtinName; });
      ok(!!inner, '（拿内置「' + builtinName + '」当对照，' + (inner ? inner.cards.length : 0) + ' 张）');
      // 造一副"用户自己写的、恰好同名"的牌组：没有身份标记、只有自己两张卡
      const mine = {
        id: 'deck-user-mine', name: builtinName, createdAt: 1, backImage: null,
        backTemplate: null, backColor: '#8a7a3a', useRev: false,
        cards: [
          { id: 'u1', name: '我自己写的卡', keyword: 'x', meaning: 'a', color: '#fff', image: null },
          { id: 'u2', name: '焦虑信号', keyword: 'y', meaning: 'b', color: '#fff', image: null }
        ]
      };
      const storage = {};
      storage['moka.decks.v1'] = JSON.stringify([mine]);
      const w1 = boot2(storage);
      const d1 = w1.MoKa.data.listDecks().find(function (d) { return d.id === 'deck-user-mine'; });
      ok(!!d1, '同名那副还在');
      ok(d1 && d1.cards.length === 2,
        '★★ 用户自建的同名牌组不会被内置内容同步改写（卡数仍是 2，不是被灌成 37）',
        d1 && ('实际 ' + d1.cards.length));
      ok(d1 && d1.cards.some(function (c) { return c.name === '我自己写的卡'; }) &&
              d1.cards.some(function (c) { return c.name === '焦虑信号'; }),
        '★★ 用户自己的两张卡一张都没少（旧逻辑会把「焦虑信号」按 retiredNames 删掉）');
      ok(d1 && !d1.builtinKey, '★ 它没被误打上内置身份标记（builtinKey）');
    })();

    // ---- 2) 真·老装机（无 builtinKey）的内置牌组：还得认得出来并补上标记 ----
    (function () {
      const w0 = boot2(null);
      w0.MoKa.data.listDecks();
      const inner = w0.MoKa.data.listDecks().find(function (d) { return d.name === 'Love & Armour'; });
      const old = JSON.parse(JSON.stringify(inner));
      delete old.builtinKey;                    // 老装机：那时候还没有这个字段
      const storage = {};
      storage['moka.decks.v1'] = JSON.stringify([old]);
      const w1 = boot2(storage);
      const after = w1.MoKa.data.listDecks().find(function (d) { return d.id === old.id; });
      ok(after && after.builtinKey === 'lovearmour',
        '★★ 老装机的真内置牌组仍认得出（卡名 80% 对得上）并补上 builtinKey',
        after && ('builtinKey=' + after.builtinKey));
      ok(after && after.cards.length === inner.cards.length,
        '★ 认出来之后内容同步照旧（卡数 ' + (after && after.cards.length) + '）');
    })();

    // ---- 3) 克隆 / 导出 / 导入：两条「纸边」开关不许丢 ----
    (function () {
      const w = boot2(null);
      const D3 = w.MoKa.data, IO3 = w.MoKa.io;
      const dk = D3.createDeck('走查-纸边');
      D3.setDeckBack(dk.id, { template: 'frame', color: '#8a7a3a', edge: false, faceEdge: false });
      const cl = D3.cloneDeck(dk.id);
      ok(cl && cl.backEdge === false && cl.faceEdge === false,
        '★★ 克隆牌组：两条纸边开关一起过去（旧逻辑漏字段 → 副本又变回"开"）',
        cl && ('backEdge=' + cl.backEdge + ' faceEdge=' + cl.faceEdge));
      const man = IO3.buildZipManifest_(D3.findDeck(dk.id), function () {});
      ok(man.deck.backEdge === false && man.deck.faceEdge === false,
        '★★ ZIP 导出清单里带着两条纸边开关');
      const back = D3.importDeck(man.deck);
      ok(back && back.backEdge === false && back.faceEdge === false,
        '★★ 导入回来的新牌组也是"关"（导出→导入一圈不许回默认）',
        back && ('backEdge=' + back.backEdge));
    })();

    // ---- 4) 导出时图片还是 idb: 标记（没补回内存）→ 必须明说，不许静默丢图 ----
    (function () {
      const w = boot2(null);
      const D4 = w.MoKa.data, IO4 = w.MoKa.io;
      const dk = D4.createDeck('走查-idb图');
      const d = D4.findDeck(dk.id);
      d.cards.push({ id: 'c1', name: 'A', keyword: '', meaning: '', color: '#fff', image: 'idb:img-1' });
      const man = IO4.buildZipManifest_(d, function (dataUrl, holder, key, imgs) {
        if (String(dataUrl || '').indexOf('data:') !== 0) { holder[key] = null; return; }
        imgs['images/0.jpg'] = 'image/jpeg'; holder[key] = 'images/0.jpg';
      });
      ok(man.deck.cards[0].imagePath === null, '（前提：idb: 图片确实进不了包 —— 这是现状）');
      ok(typeof IO4.exportBlockReason_ === 'function' && !!IO4.exportBlockReason_(d),
        '★★ 导出前能检查出"有图片还是 idb: 标记"，并给出明确原因（不许静默导出空壳备份）',
        typeof IO4.exportBlockReason_ === 'function' ? String(IO4.exportBlockReason_(d)) : '没有这个钩子');
      const clean = { name: 'x', cards: [{ id: 'c2', name: 'B', image: 'data:image/jpeg;base64,AAAA' }] };
      ok(IO4.exportBlockReason_(clean) === null, '★ 图片都在内存里时，导出照常（不拦）');
    })();
  })();

  /* ============================================================
     【15h】写盘语义（2026-09-21）：IndexedDB 不可用时不许把图内嵌进 meta 撑爆 5MB，
     否则整份 meta 写不进 → 那次会话的改动**静默回退**。现在两级兜底 + 明确报错。
     ⚠ 这一组要等落盘链（异步）跑完才算得准，所以它把自己挂进 `pending`，
       由文件末尾统一 await（同步跑完就 process.exit 的话，异步断言会被丢掉 —— 踩过）。
     ============================================================ */
  console.log('\n【15h】写盘：图不进 meta、写不进要报出来、重启能补回');
  (function () {
    const FILES_S = ['js/idb.js', 'js/builtin-decks.js', 'js/random.js', 'js/data.js', 'js/ui.js'];
    function bootS(storage) {
      const domS = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
      const wS = domS.window;
      if (storage) Object.keys(storage).forEach(function (k) { wS.localStorage.setItem(k, storage[k]); });
      FILES_S.forEach(function (f) { wS.eval(fs.readFileSync(path.join(WWW, f), 'utf8')); });
      return wS;
    }
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    const SMALL = 'data:image/jpeg;base64,' + 'B'.repeat(40000);
    const HUGE = 'data:image/jpeg;base64,' + 'C'.repeat(2 * 1024 * 1024);

    const w = bootS(null);
    const D5 = w.MoKa.data;
    D5.listDecks();
    const dk = D5.createDeck('走查-写盘');
    const metaKey = 'moka.decks.v1';

    // 同步部分：页面里有没有那条常驻提示条
    ok(!!doc.getElementById('save-warn') && !!doc.getElementById('save-warn-txt'),
      '★★ 页面里有常驻的"这次改动没存到手机上"提示条（#save-warn）');

    pending.push((async function () {
      // 1) 图存进兜底库、meta 里只留标记
      D5.addCard(dk.id, { name: '小图', image: SMALL });
      await wait(300);
      const metaTxt = w.localStorage.getItem(metaKey) || '';
      const card = (JSON.parse(metaTxt).find(function (d) { return d.name === '走查-写盘'; }) || { cards: [] }).cards[0];
      ok(card && String(card.image).indexOf('ls:') === 0,
        '★★ 图库不可用时，图落到 localStorage 兜底库，meta 里只留 `ls:` 标记（不再内嵌 base64）',
        card && String(card.image).slice(0, 16));
      ok(metaTxt.length < 300 * 1024,
        '★★ meta 保持"轻"（' + Math.round(metaTxt.length / 1024) + 'KB）—— 内嵌那张图光自己就 39KB，几张就把 5MB 吃光',
        metaTxt.length + ' 字节');
      ok(D5._imgLsKeys().length === 1, '★ 兜底库里正好一条图');

      // 2) 两边都存不下的超大图 → 必须报出来
      D5.addCard(dk.id, { name: '巨图', image: HUGE });
      await wait(500);
      const st = D5.lastSaveStatus();
      ok(st && st.unresolvedImgs >= 1,
        '★★ 两边都存不下的图要**报出来**（unresolvedImgs=' + (st && st.unresolvedImgs) + '）—— 旧逻辑是静默丢',
        JSON.stringify(st));

      /* 3) 重启：兜底库里的图要能补回来。
         ⚠ 这里**故意不调 initImages()** —— 它会 await idb.ensure()，而那个 Promise
           在"IndexedDB 打开超时"（2.5s）之前不会 settled，走查 await 它会挂到进程退出，
           async 断言被整段丢掉（第一版就是这么假绿的）。直接调内部的 hydrateImages。 */
      // ⚠ 兜底库的图在 `moka.img.ls.*` 这些**独立键**里，重启要连它们一起带过去
      //   （只搬 moka.decks.v1 的话，等于把图留在了上一台手机）
      const snapshot = {};
      for (let i = 0; i < w.localStorage.length; i++) {
        const kk = w.localStorage.key(i);
        snapshot[kk] = w.localStorage.getItem(kk);
      }
      const w2 = bootS(snapshot);
      const D6 = w2.MoKa.data;
      D6.listDecks();
      const hyd = await D6._hydrateImages();
      ok(hyd && hyd.skipped === false,
        '★★ IDB 不可用时，水合**不能整趟跳过**（ls: 那批图就在 localStorage 里等着取）',
        JSON.stringify(hyd));
      const d2 = D6.findDeck(dk.id);
      ok(d2 && d2.cards[0] && String(d2.cards[0].image || '').indexOf('data:image') === 0,
        '★★ 重启后小图从兜底库补回来了（' + String((d2 && d2.cards[0] && d2.cards[0].image) || '').length + ' 字节）');
    })());
  })();

  /* ============================================================
     【15i】神签（签文）的存储防线 —— 用户报「更新之后签文会丢」（2026-09-23）
     ------------------------------------------------------------
     四条：① 主键丢了能从「第二份」自己回来；② 数据读不出来时**不许**被空包盖掉；
           ③ 正常保存要把「第二份 + Download/猫卡 自动备份文件」都写上；
           ④ 图片兜底库（moka.img.ls.*）有**总预算**，不许把 5MB 配额吃光
              —— 这条正是"内置牌组一变、签文就写不进去"那条线的根。
     ============================================================ */
  console.log('\n【15i】神签签文：丢了能自己找回来，读不出来绝不许被空包盖掉');
  (function () {
    const FILES_L = ['js/idb.js', 'js/builtin-decks.js', 'js/builtin-lots.js', 'js/builtin-asks.js', 'js/random.js', 'js/data.js', 'js/ui.js', 'js/jszip.min.js', 'js/io.js', 'js/lot-shot.js',
                     'js/cropper.min.js', 'js/imagecrop.js', 'js/scenes/table.js', 'js/scenes/library.js',
                     'js/scenes/editor.js', 'js/scenes/settings.js', 'js/scenes/lots.js', 'js/app.js'];
                     /* ★ 2026-10-12 补：这串原来漏了 editor.js，而 app.js 第 185 行是**无条件**
                        `global.MoKa.editor.init()`（settings/lots 都有守卫，editor 没有）——
                        15i 一跑就 TypeError，整份走查当场断在半路。 */
    function bootL(storage) {
      const domL = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
      const wL = domL.window;
      if (storage) Object.keys(storage).forEach(function (k) { wL.localStorage.setItem(k, storage[k]); });
      FILES_L.forEach(function (f) { wL.eval(fs.readFileSync(path.join(WWW, f), 'utf8')); });
      return wL;
    }
    const K = 'moka.lots.packs', KBAK = 'moka.lots.packs.bak';
    const GOOD = JSON.stringify([{ name: '我的签包', lots: ['第一条', '第二条', '第三条'] }]);

    // ① 主键被删、第二份还在 → 自动恢复 + 回写主键
    (function () {
      const w = bootL({ [KBAK]: GOOD, 'moka.lots.active': '0' });
      ok(w.MoKa.lots.stats().lots === 3 && w.localStorage.getItem(K) === GOOD,
        '★ 签文主键被删掉时，从「第二份」自动恢复并回写主键（' + w.MoKa.lots.stats().lots + ' 条）');
    })();

    // ② 主键损坏 → 拒写（老写法会静默换成空包，随后被随写随存盖掉）
    (function () {
      const BAD = '{"packs":[';
      const w = bootL({ [K]: BAD, 'moka.lots.active': '0' });
      try { w.MoKa.lots.init(); w.MoKa.lots.go('write'); } catch (e) {}
      const b = w.document.querySelector('#btn_lot_add');
      if (b) b.click();
      ok(w.localStorage.getItem(K) === BAD,
        '★ 签文读不出来时，写签页怎么动都不会把真数据盖成空包（拒绝写入）');
    })();

    // ③ 正常保存：主键 + 第二份 + 文件备份
    (function () {
      // seed 标记置上 = 这台机器早就播过内置包了，别让它搅进这条断言（那条另有 6 条断言在管）
      const w = bootL({ [K]: GOOD, 'moka.lots.active': '0', 'moka.lots.seed': '1' });
      const calls = [];
      w.MoKa.io.saveTextFile = function (n) { calls.push(n); return {}; };
      try { w.MoKa.lots.init(); w.MoKa.lots.go('write'); } catch (e) {}
      const b = w.document.querySelector('#btn_lot_add');
      if (b) b.click();
      ok(w.MoKa.lots.packs()[0].lots.length === 4 &&
         (w.localStorage.getItem(KBAK) || '').indexOf('我的签包') >= 0 &&
         calls.indexOf('签文-自动备份.json') >= 0,
        '★ 正常保存：主键 + 第二份 + Download/猫卡/签文-自动备份.json 都写了');
    })();

    // ④ 自动备份不许弹分享面板（用户报：初始化进软件弹出来一个分享）
    (function () {
      const w = bootL({ [K]: GOOD, 'moka.lots.active': '0', 'moka.lots.seed': '1' });
      const calls = { save: 0, share: 0 };
      w.LotFile = {
        saveText: function () { calls.save++; return 'OK:签文-自动备份.txt'; },
        saveBinary: function () { calls.save++; return 'OK:1000085540'; },
        shareSavedFile: function () { calls.share++; },
        shareFile: function () { calls.share++; }
      };
      try { w.MoKa.lots.init(); w.MoKa.lots.go('write'); } catch (e) {}
      const b = w.document.querySelector('#btn_lot_add');
      if (b) b.click();
      ok(calls.save >= 1 && calls.share === 0,
        '★★ 自动备份：文件写了 ' + calls.save + ' 次，分享面板弹出 ' + calls.share + ' 次（必须是 0）');
    })();

    // ④ 内置签文包（内容在 app/lots/*.txt → builtin-lots.js）：新机自带 / 老机缺了才补 / 删了不塞回来
    (function () {
      const BL = (function () { const w = bootL({}); return w.MoKaBuiltinLots; })();
      const blTotal = BL.reduce(function (a, b) { return a + b.lots.length; }, 0);
      ok(Array.isArray(BL) && BL.length >= 1 && blTotal >= 100,
        '★ 内置签文包注册表在（' + BL.map(function (b) { return b.name + ' ' + b.lots.length; }).join(' / ') + '）');
      ok(BL.some(function (b) { return b.name === '红楼签文' && b.lots.length === 108; }),
        '★★ 内置包：红楼签文 108 条');

      // 新装机：空 → 全铺上，第一个成为当前包
      const wNew = bootL({});
      wNew.MoKa.lots.init();
      const stNew = wNew.MoKa.lots.stats();
      ok(stNew.packs === BL.length && stNew.activeName === BL[0].name && stNew.lots === blTotal,
        '★★ 新装机：' + BL.length + ' 个内置包全铺上、第一个选为当前包（共 ' + stNew.lots + ' 条）');

      // 老装机：有用户自己的包 → 追加内置包，不动用户那份、不抢当前包
      const mine = JSON.stringify([{ name: '我自己的签包', lots: ['自己的第一条', '自己的第二条'] }]);
      const wOld = bootL({ [K]: mine, 'moka.lots.active': '0' });
      wOld.MoKa.lots.init();
      const packsOld = wOld.MoKa.lots.packs();
      const mineAfter = packsOld.filter(function (x) { return x.name === '我自己的签包'; })[0];
      ok(!!mineAfter && mineAfter.lots.length === 2 && mineAfter.lots[0] === '自己的第一条',
        '★★ 老装机：用户自己的包一字未动');
      ok(BL.every(function (b) { return packsOld.some(function (x) { return x.name === b.name; }); }) &&
         wOld.MoKa.lots.stats().activeName === '我自己的签包',
        '★★ 老装机：' + BL.length + ' 个内置包都补进来了，但没抢当前选中的包');

      // 同名包已存在（内容不一样）→ 不覆盖
      const sameName = JSON.stringify([{ name: BL[0].name, lots: ['我自己改过的'] }]);
      const wSame = bootL({ [K]: sameName, 'moka.lots.active': '0' });
      wSame.MoKa.lots.init();
      const kept = wSame.MoKa.lots.packs().filter(function (x) { return x.name === BL[0].name; })[0];
      ok(kept.lots.length === 1 && kept.lots[0] === '我自己改过的',
        '★★ 已经有同名包：一个字都不动（不覆盖用户内容）');

      // 删掉之后：不再自动塞回来（标记生效），但能手动恢复
      const wDel = bootL({ [K]: sameName, 'moka.lots.active': '0' });
      wDel.MoKa.lots.init();
      const np = wDel.MoKa.lots.packs().filter(function (x) { return x.name !== BL[0].name; });
      wDel.localStorage.setItem(K, JSON.stringify(np.length ? np : [{ name: '留一个空包', lots: [] }]));
      wDel.MoKa.lots.init();                       // 再"启动"一次
      ok(!wDel.MoKa.lots.packs().some(function (x) { return x.name === BL[0].name; }),
        '★★ 用户删掉内置包之后：不再自动塞回来');
      ok(wDel.MoKa.lots.restoreBuiltin() === 1 &&
         wDel.MoKa.lots.packs().some(function (x) { return x.name === BL[0].name; }),
        '★ 但「恢复内置签文包」能手动要回来');
    })();

    // ④ 图片兜底库的总预算（不许把 localStorage 配额吃光）
    (function () {
      const w = bootL({});
      const D = w.MoKa.data;
      // ★ 2026-09-23：这里一度加过"兜底库总预算/整库红线"的断言 —— 用户不接受那个副作用
      //   （宁可多存一张图），已回退。现在只钉原来那条：**只卡单张大小**。
      ok(D._imgLsSet('small', 'data:image/png;base64,' + 'Z'.repeat(200 * 1024)) === true,
        '★ 单张 200KB 的图照样收（图片兜底库不加总量限制）');
      ok(D._imgLsSet('huge', 'data:image/png;base64,' + 'Z'.repeat(1.6 * 1024 * 1024)) === false,
        '★ 单张超 1.5MB 的图不收（一张就能吃满配额的那种，上层会报「有 N 张图没能存下来」）');
    })();
  })();

  /* ============================================================
     【15j】签文截图（2026-10-12）：抽签页的相机键 + Canvas 自绘出图
     ------------------------------------------------------------
     用户要求：「新增一个截图的按钮（用符号表示，不用汉字）」＋
               「把两个按钮（截图 再来一次）做的美观一点」；
     出图逻辑照隔壁星曜奇门的 web/js/snapshot.js（Canvas 2D 重画，不截 WebView）。
     这一组钉住五条不变量：
       ① 模块接线：js/lot-shot.js 在 index.html 与走查加载表里，MoKa.lotShot 在；
       ② 出图算式是纯函数（换行 / 高度 / 文件名），脱离 canvas 也能验；
       ③ 抽签页两颗键：并排、类名对、截图键里**一个字都不许有**（纯 SVG 符号）；
       ④ 点截图键**不重新抽签**（截的必须是屏幕上看到的那一条），无桥时只提示不抛错；
       ⑤ CSS：两颗键的排法（并排 / 同高 46px / 描边键窄）。
     ============================================================ */
  console.log('\n【15j】签文截图：相机键（纯符号）+ Canvas 自绘，不重抽、无桥只提示');
  {
    const LS = window.MoKa.lotShot;
    ok(!!LS, '★ MoKa.lotShot 在（js/lot-shot.js 加载成功）');
    ok(/js\/lot-shot\.js/.test(html), '★ index.html 引了 js/lot-shot.js');

    // ① 换行纯函数：中文逐字断 + '\n' 硬换行 + 末尾空行不留
    const m1 = function (s) { return s.length * 10; };
    eq(LS._wrap_('一二三四五', 30, m1).join('|'), '一二三|四五', '换行：满宽就断（30px 宽 = 3 字）');
    eq(LS._wrap_('上\n\n下', 100, m1).join('|'), '上||下', '换行：硬换行与空行照 pre-wrap 语义保留');
    eq(LS._wrap_('一二三\n', 100, m1).join('|'), '一二三', '换行：末尾空行不留（卡片里别拖一条白条）');
    eq(LS._wrap_('', 100, m1).length, 1, '换行：空文本也给一行（不返回空数组，画的时候不空转）');
    eq(LS._wrap_('一二三四，五六', 40, m1).join('|'), '一二三四，|五六',
      '★ 中文避头尾：收尾标点不落行首（宁可悬在上一行末尾）');
    eq(LS._wrap_('一二三「四五', 40, m1).join('|'), '一二三|「四五',
      '★ 中文避头尾：开引号不落行末（跟着下一个字挪下去）');
    // ★ v4（2026-10-19）：连续收尾标点一起悬挂 —— 旧写法只挪第一个，
    //   第二个（"……」/ "。」"）会变成行首；只剩一个开引号时也不许先留空行。
    eq(LS._wrap_('一二三四五……', 50, m1).join('|'), '一二三四五……',
      '★ 避头尾：连续收尾标点一起悬挂（第二个省略号不许落行首）');
    eq(LS._wrap_('一二三四五。」', 50, m1).join('|'), '一二三四五。」',
      '★ 避头尾：。」连着悬挂，行首不出现标点');
    eq(LS._wrap_('「一二', 10, m1).join('|'), '「一|二',
      '★ 避头尾：行里只剩一个开引号时，连字一起挪下去（不留空行）');

    // ★ v5（2026-10-19）：西文整词不拆 —— `Brooklyn` 不许断成 `Brookl` + `yn`
    eq(LS._wrap_('中文中文abcdefgh', 100, m1).join('|'), '中文中文|abcdefgh',
      '★ 西文整词换行（词放不下就整词挪到下一行）');
    eq(LS._wrap_('abcdefgh', 50, m1).join('|'), 'abcde|fgh',
      '词自己比一行还宽时才退化成逐字（URL / 长串不会撑爆）');

    // ★ v5：问题行按设计稿是「所问 · 」，不跟屏幕的「问题：」走
    eq(LS._qText_('今晚这件事能成吗'), '所问 · 今晚这件事能成吗',
      '★ 问题行 =「所问 · xxx」（设计稿文案，不跟屏幕）');
    eq(LS._qText_(''), '', '问题为空时整块不出现（不留一条空行）');
    eq(LS._qText_('今晚能成吗', '所问'), '所问 · 今晚能成吗', '标签可被调用方覆盖（默认「所问」）');

    // ★ v5 自审补的三个边界（2026-10-19 第二轮）
    eq(LS._wrap_('中文中文「abcdef', 100, m1).join('|'), '中文中文|「abcdef',
      '★ 西文整词换行时，行末的开引号要带到下一行（不许挂在行末）');
    eq(LS._wrap_('一二三四五.六', 50, m1).join('|'), '一二三四五.|六',
      '★ 单个西文收尾标点（. : ) % …）跟着上一行走，不许落行首');
    eq(LS._wrap_('一句. 二句.', 30, m1).join('|'), '一句.|二句.',
      '★ 换行落在英文空格前：下一行不留行首空格（整段不会莫名缩进）');
    eq(LS._wrap_('一二三四五。。', 50, m1, 5).join('|'), '一二三四|五。。',
      '★ 悬挂上限：标点挂出太多就"追字"（字+标点一起挪下一行，别压出卡片）');
    eq(LS._wrap_('一二三四五。。', 50, m1).join('|'), '一二三四五。。',
      '不传悬挂上限时保持旧行为（兼容旧调用）');
    const mEmoji = function (s) { return Array.from(s).length * 10; };
    eq(LS._wrap_('😀😀😀', 25, mEmoji).join('|'), '😀😀|😀',
      '★ 按码点断行（emoji / 扩展汉字是代理对，不许被拆成两半）');

    // ★ v5：批注判据按"引用块"认，不只看行首「
    ok(LS._notePara_('「占罪犯，将再作乱。」') === true, '批注：整段引用（引号在段尾闭合）');
    ok(LS._notePara_('「占得，自恋导向+汉初时期，…迁都') === true, '批注：引号没闭合（跨段引用块的开头）');
    ok(LS._notePara_('「爱的方式」与「爱的深度」，哪一个更重要呢？') === false,
      '★ 正文里的引用（引号在句中闭合）不算批注，别染成朱砂小字');
    ok(LS._notePara_('「不忍万物靡费，必善尽其巧工」，将一切无用之物…') === false,
      '★ 「引用」+正文同段时不算批注（旧判据会误染）');

    // ② 高度算式 + 文件名（render 用的是同一份，别再各算各的）
    const G = LS._geom_;
    eq(G.W, 1080, '出图宽 1080（用户定的）');
    ok(G.cardHeight(3, 5, 34) > G.cardHeight(1, 1, 34) &&
       G.totalHeight(G.cardHeight(1, 1, 34)) > G.cardHeight(1, 1, 34),
      '卡片高随行数长、整图高 = 卡片 + 页脚 + 上下留白');
    ok(/^猫卡-签文-\d{8}-\d{4}\.png$/.test(LS._fileName_(new Date(2026, 9, 12, 5, 30))),
      '文件名：猫卡-签文-YYYYMMDD-HHMM.png');
    eq(Math.round(G.cardHeight(0, [], 52) + 26 * 1.6 + 44), Math.round(G.cardHeight(1, [], 52)),
      '★ 空所问：不画问题行，那 44px 问题→正文间距也不留（高度账与绘制同一套）');

    // ★ jsdom 没有 canvas：给它一个"够用"的假 2D 上下文，好把 render 真的跑一遍
    //   （只桩 getContext / toDataURL，别的都不碰；组末还原）
    const proto = window.HTMLCanvasElement.prototype;
    const realGet = proto.getContext, realURL = proto.toDataURL;
    proto.getContext = function (kind) {
      if (kind !== '2d') return realGet ? realGet.call(this, kind) : null;
      return new Proxy({}, {
        get(t, k) {
          if (k === 'measureText') return function (s) { return { width: String(s).length * 30 }; };
          if (k in t) return t[k];
          return function () {};
        },
        set(t, k, v) { t[k] = v; return true; }
      });
    };
    proto.toDataURL = function () { return 'data:image/png;base64,AAAA'; };

    try {
      const cv1 = LS.render({ question: '今晚这件事能成吗', lot: '上上签', pack: '红楼签文', align: 'center' });
      eq(cv1.width, 1080, '★ 画布宽 1080');
      const h1 = cv1.height;
      const cv2 = LS.render({ question: '今晚这件事能成吗', lot: '长长长长长长'.repeat(120), pack: '红楼签文', align: 'left' });
      ok(cv2.height > h1, '★ 长签文自己长高（DOM 截图做不到这一点 —— 正是自绘的理由）');
      const cv3 = LS.render({ question: '答', lot: '长'.repeat(9000), pack: '大包', align: 'left' });
      ok(cv3.height <= 13000 + 60, '★ 超长签文有画布高上限（宁截断，不许把画布撑爆）');

      /* ★ v4（2026-10-19）排版两条不变量：
         ① 批注段落整段一个字号 —— 旧写法先按 52px 把整篇换行、再逐行看行首「，
            长批注从第 2 行起被当成正文（52px 墨色），一条批注裂成两种字号；
         ② 换行要把字距算进去 —— 旧写法绘制加 3px 字距、换行不加，实测一行
            最多超内框 94px，压出卡片右边。这两条都用纯函数 _layout_ 验，不靠看。 */
      const fakeCtx = { font: '', letterSpacing: '0px', measureText: function (s) { return { width: String(s).length * 30 }; } };
      const longNote = '『' + '批注'.repeat(40) + '』';
      const rowsN = LS._layout_('正文'.repeat(30) + '\n' + longNote, 52, 728, fakeCtx);
      const noteRows = rowsN.filter(function (r) { return r.note; });
      ok(noteRows.length > 1, '★ 长批注会换行（' + noteRows.length + ' 行，换行后仍按批注排）');
      ok(noteRows.every(function (r) { return r.fs === Math.round(52 * 0.73); }),
        '★ 批注的每一行都是批注字号（52×0.73=38px），续行不掉回正文');
      ok(rowsN.filter(function (r) { return !r.note; }).every(function (r) { return r.fs === 52; }),
        '正文段落仍是正文字号');
      eq(noteRows.filter(function (r) { return r.gap; }).length, 1,
        '★ 批注段前的留白只加一次（换行续行不重复加）');

      // 桩是 30px/字：不带字距每行能放 24 字，带 3px 字距只剩 22 字 —— 行长就是证据
      const rowsW = LS._layout_('中'.repeat(200), 52, 728, fakeCtx);
      ok(rowsW.every(function (r) { return r.text.length <= 22; }),
        '★ 换行按「字宽 + 字距」量（不把 3px 字距漏掉，行尾不会溢到卡片外）');

      /* ★ v5（2026-10-19）：批注块可以跨硬换行 —— `「占得，…` 没闭合时，
         下一段（吕雉…）继续按批注排；段前留白只加一次。 */
      const rowsCross = LS._layout_('正文正文\n「占得，自恋导向+汉初\n吕雉不知道皇后怎么当。现实导向。」', 52, 728, fakeCtx);
      ok(rowsCross.filter(function (r) { return r.note; }).length >= 2,
        '★ 跨段批注：没闭合的「…」会跨硬换行继续（' + rowsCross.filter(function (r) { return r.note; }).length + ' 行批注）');
      eq(rowsCross.filter(function (r) { return r.gap; }).length, 1,
        '★ 跨段批注的段前留白也只加一次');
      ok(rowsCross.some(function (r) { return r.text.indexOf('现实导向') >= 0 && r.note; }),
        '★ 批注块最后一段（以」收尾）仍按批注排');

      /* ★ v5：字号自适应 = 在 30~52 里找"装得下的最大字号"，真的还超才截断 */
      const fitShort = LS._fit_('上上签', 1, 728, fakeCtx);
      eq(fitShort.fs, 52, '短签用 52px（不用缩）');
      ok(!fitShort.cut, '短签不截断');
      const fitMid = LS._fit_('长'.repeat(4000), 1, 728, fakeCtx);
      ok(fitMid.fs < 52 && fitMid.fs >= 30 && !fitMid.cut,
        '★ 中等超长：在 30~52 里找装得下的最大字号（' + fitMid.fs + 'px，不截断）');
      const fitHuge = LS._fit_('长'.repeat(9000), 1, 728, fakeCtx);
      ok(fitHuge.cut, '★ 9000 字：最小字号也装不下才截断');
      ok(fitHuge.H <= 13000 + 60, '截断后画布仍在上限内（' + Math.round(fitHuge.H) + 'px）');

      // ③ 抽签页两颗键（走真实路径：填问题 → 点「抽签」）
      window.MoKa.lots.go('god');
      const q = doc.getElementById('god_question');
      ok(!!q, '求签页有输入框');
      if (q) {
        q.value = '今晚这件事能成吗';
        q.dispatchEvent(new window.Event('input'));
        doc.getElementById('btn_god_draw').click();
      }
      const shot = doc.getElementById('btn_draw_shot');
      const again = doc.getElementById('btn_draw_again');
      ok(!!shot && !!again, '★ 抽签页有两颗键：#btn_draw_shot / #btn_draw_again');
      ok(!!shot && !!shot.parentNode && shot.parentNode.classList.contains('draw-acts') &&
         !!again && again.parentNode === shot.parentNode,
        '★ 两颗键并排装在同一个 .draw-acts 里（不是一上一下）');
      ok(!!shot && /<svg[\s\S]*<path[\s\S]*<circle/.test(shot.innerHTML),
        '截图键画的是相机 SVG（机身 path + 镜头圆）');
      eq(shot ? (shot.textContent || '').trim() : '（没有截图键）', '',
        '★ 截图键里一个字都没有（用户要求：用符号，不用汉字）');
      ok(!!shot && shot.classList.contains('btn-shot') && !!again && again.classList.contains('btn-primary'),
        '截图＝次（窄描边图标键）/ 再来一次＝主（实心墨黑 .btn-primary）');
      ok(!!shot && /stroke-width="1\.8"/.test(shot.innerHTML) && /currentColor/.test(shot.innerHTML),
        '图标与写签页那套同一规格（1.8 描边 + currentColor，内联 SVG 不引外部文件）');

      // ④ 点截图键：屏幕上那一条原样不动 + 不抛错（无桥 → 只提示）
      const box = doc.getElementById('draw_box');
      const before = box ? box.textContent : '';
      let threw = null;
      try { if (shot) shot.click(); } catch (e) { threw = e; }
      ok(!threw, '点截图键不抛错（没有文件桥时走"只提示"那条路）', threw && threw.message);
      const box2 = doc.getElementById('draw_box');
      eq(box2 ? box2.textContent : '', before, '★ 截图不重新抽签：屏幕上那一条原样不动');
    } finally {
      proto.getContext = realGet;
      proto.toDataURL = realURL;
    }

  /* 【15k】求签页的「常问」（2026-10-13 构建 251；刷新时机同日改）
     用户要求：不用手打就能直接问签 + 词库轮流随机显示（**不是**把全部铺出来）。
     ★ 2026-10-13 改刷新逻辑，用户原话：「常问的刷新逻辑…改为 点进神签页（区分抽签页）
       自动刷新一次」—— 旧行为是 setInterval 每 4 秒自动换一批，现在撤掉，
       只在**进求签页**（renderGod 重建）时随机一批；抽签页 / 写签页不碰它。
       下面最后三条就是钉这个时机的（其中"等 4.6 秒"专门用来证明自动轮换真的没了）。 */
  console.log('\n【15k】求签页的常问：词库 + 一次只端 6 句 + 进主页刷新一次 + 点一句只填输入框');
  {
    const A = window.MoKaBuiltinAsks;
    ok(Array.isArray(A) && A.length >= 10, '★ 常问词库注册表在（MoKaBuiltinAsks，' + ((A || []).length) + ' 类）');
    const all = [];
    (A || []).forEach(function (g) { (g.asks || []).forEach(function (q) { all.push(q); }); });
    ok(all.length >= 60, '★★ 词库够量（' + all.length + ' 句）');
    ok(new Set(all).size === all.length, '★★ 全局无重复句');
    const longq = all.filter(function (q) { return q.length > 24 || /[。！？，]$/.test(q); });
    ok(longq.length === 0, '★ 都是短问句、不带句末标点' + (longq.length ? '：' + longq.slice(0, 2).join('/') : ''));

    MoKa.lots.go('god');
    const box = doc.getElementById('god_asks');
    ok(!!box, '★★ 求签页有常问块（#god_asks）');
    eq(box ? box.querySelectorAll('.lk').length : 0, 6, '★★ 一次只端 6 句（不是把一百多句铺出来）');
    const first = box ? box.querySelector('.lk') : null;
    const q = first ? first.getAttribute('data-q') : '';
    ok(!!q, '常问按钮带 data-q（点它就知道要问什么）');
    if (first) first.click();
    const inp = doc.getElementById('god_question');
    eq(inp ? inp.value : '', q, '★★ 点一句 → 只填进输入框（用户明确：不要直接抽签）');
    ok(!!doc.getElementById('god_asks'),
      '★★ 点完还留在求签页（没有直接跳去抽签页）');

    /* ---- 刷新时机（2026-10-13 改）----
       取当前这一批的"指纹"（6 句的先后也算），用来比对换没换。
       「不许定时轮换」不再靠"白等 4.6 秒看它变不变"去证 —— 改成这段末尾那一条源码护栏。 */
    const batch = function () {
      const b = doc.getElementById('god_asks');
      if (!b) return null;
      return Array.prototype.map.call(b.querySelectorAll('.lk'), function (x) {
        return x.getAttribute('data-q');
      }).join('｜');
    };
    const b1 = batch();
    eq((b1 || '').split('｜').length, 6, '★ 进主页这一批是 6 句');

    MoKa.lots.go('draw');
    ok(!doc.getElementById('god_asks'), '★ 抽签页没有常问块（用户点名要跟主页区分开）');
    MoKa.lots.go('god');
    const b2 = batch();
    eq((b2 || '').split('｜').length, 6, '★ 再进主页：常问又是 6 句');
    ok(!!b2 && b2 !== b1, '★★ 再进神签主页：换了一批（= 进页面刷新一次）');

    // 从抽签页按「‹」返回主页：也算"进了一次主页" → 同样刷新
    MoKa.lots.go('draw');
    const backBtn = doc.getElementById('lots-back');
    ok(!!backBtn, '抽签页有返回键（#lots-back）');
    if (backBtn) backBtn.click();
    const b3 = batch();
    eq((b3 || '').split('｜').length, 6, '★ 返回主页：常问在（6 句）');
    ok(!!b3 && !!b2 && b3 !== b2, '★★ 从抽签页返回主页：同样刷新一批');

    /* ★ 不许定时轮换（2026-10-13 用户：「改为 点进神签页自动刷新一次」）：
       以前得等 4.6 秒才证明得了，每次走查都白等；改成源码护栏 —— 谁把定时器挂回来谁红。 */
    const lotsAskSrc = fs.readFileSync(path.join(WWW, 'js/scenes/lots.js'), 'utf8');
    ok(!/startAskLoop|ASK_EVERY|askTimer/.test(lotsAskSrc),
      '★★ 常问没有定时轮换的代码残留（只有"进主页刷新一次"）');
  }

    /* ★ 2026-10-19 用户附抽签页截图报「第二段字体/对齐不对」：
       那条签文数据是一行 21 字，窄屏被浏览器自动折成两行，第二行单独居中。
       修法 = 渲染后按真实高度/行高复测，折行（视觉行数 > 原文段数）就改顶格。
       这里钉纯函数与源码护栏（jsdom 没有布局，量不到 offsetHeight）。 */
    const LV = MoKa.lots._visualLines_;
    ok(typeof LV === 'function', '★ MoKa.lots._visualLines_ 在（折行复测的纯函数）');
    eq(LV(57.12, 28.56), 2, '折行复测：高度/行高 → 2 行');
    eq(LV(28.56, 28.56), 1, '折行复测：一行');
    eq(LV(0, 28.56), 0, '拿不到高度 → 0（不改原判据，jsdom 也照旧）');
    const lotsSrcDraw = fs.readFileSync(path.join(WWW, 'js/scenes/lots.js'), 'utf8');
    ok(/id="draw_lot"/.test(lotsSrcDraw) && /offsetHeight/.test(lotsSrcDraw),
      '★ 抽签页签文按真实行数复测（自动折行就改顶格，第二行不许单独居中）');

    // ⑤ CSS
    ok(/#scene-lots \.draw-acts \{[^}]*display:\s*flex/.test(cssNoCmt), '★ CSS：两键 flex 并排');
    const sr = cssNoCmt.match(/#scene-lots \.btn-shot \{([^}]*)\}/);
    ok(!!sr && /flex:\s*0 0 54px/.test(sr[1]) && /1\.5px solid var\(--ink\)/.test(sr[1]),
      '★ CSS：截图键 = 窄的墨线描边图标键（与主键同一套线）');
    ok(/#scene-lots \.draw-acts \.btn \{[^}]*height:\s*46px/.test(cssNoCmt),
      'CSS：两键同高 46px（并排才不会一高一矮）');
  }

  /* ============================================================
     【15c2】鲸造编辑器（2026-10-11 重构）：39 样式 + 撤销重做 + 双击改字 + 草稿 + 保存白名单
     ------------------------------------------------------------
     构建 120 的教训：编辑页过去是走查盲区（样式表被写进函数体都没人拦）。
     这一组钉住四条不变量：
       ① **编辑页看到的 = 台面上看到的**（39 款逐个点，类名 + 行内策略 + 字色对齐）
       ② 每个离散操作 = 一步撤销（改坏了能回来；回到原状 dirty=false）
       ③ 草稿自动保存 / 保存后清掉（中途退出不丢、保存不留痕）
       ④ 保存白名单一次写全（faceBg/faceEdge/imgScale/imgX/imgY/imgFilter + 旧字段不丢）
     旧的 #cv-pbar/#cv-panels/#btn-goto-canvas/#btn-save-card 断言随「两屏合并」一起下线。
     ============================================================ */
  console.log('\n【15c2】鲸造编辑器：39 款样式逐个点 + 撤销重做 + 双击改字 + 草稿 + 白名单');
  {
    const D = MoKa.data, UI = MoKa.ui, L = MoKa.library, ED = MoKa.editor;
    const BD = D.findDeck(deckId);
    const card0 = BD.cards[0];
    const origStyle = card0.nameBgStyle || 'soft';
    const origSym = card0.symbolImg;
    const click = function (el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); };
    const errBefore = errors.length;
    L.goCard(deckId, card0.id);
    await wait(40);

    /* —— 单屏结构 —— */
    ok(!!doc.querySelector('#lib-editor.is-active'), '★ 单屏编辑页 #lib-editor 已激活');
    ok(!doc.querySelector('#lib-card') && !doc.querySelector('#lib-canvas'), '★ 旧「信息屏 / 画布屏」节点已下线');
    ok(!!doc.querySelector('#ed-card .tcard-face'), '★ 画布上真画着一张牌（faceHTML 直出）');
    ok(!!doc.querySelector('.ed-dock') && !!doc.querySelector('.ed-scroll'), '★ 工具坞在（限高 + 内部滚动）');
    ok(!!doc.querySelector('#ed-undo') && !!doc.querySelector('#ed-redo'), '★ 顶栏有撤销 / 重做');

    /* —— 起手式「底子」 —— */
    eq(doc.querySelectorAll('#ed-themes .ed-theme').length, 17, '★ 底子组 17 个主题（8 路风格：星象/东方/暗夜/版画/自然/银蓝/极简/矿物）');
    eq(doc.querySelectorAll('#ed-font .ed-font').length, 11, '★ 字体 11 款（每个按钮用自己字形渲染）');
    eq(doc.querySelectorAll('#ed-texes .ed-tex').length, 11, '★ 质感 11 项（10 张程序生成纹理 + 无）');
    ok(!!doc.querySelector('#ed-textcolor'), '★ 字色行在（朱砂/烫金/墨绿…）');
    ok(!!doc.querySelector('#ed-themes .ed-theme .tcard-face'), '★ 主题预览是整卡渲染（不是色块）');
    ok(!!doc.querySelector('#ed-theme-all'), '★ 「让整副都这样」就在底子组');

    /* ★ 2026-11-14（第二轮）：外观页摊平 —— 四组不再折叠，改成小标题 + 控件 + 右侧当前值。
       为什么钉：上一轮把九个折叠组塞进了三个页签，外观页里还是四个折叠行，
       想换质感得先点「牌面」展开；这轮照预览稿 A2 摊平，别又退回折叠。 */
    eq(doc.querySelectorAll('.ed-pane[data-pane="look"] details').length, 0,
       '★ 外观页平铺：四组不再折叠（不用先展开才看得见控件）');
    ['#ed-look-theme', '#ed-look-style', '#ed-look-face', '#ed-look-img'].forEach(function (id) {
      ok(!!doc.querySelector(id), '★ 外观页分区在：' + id);
    });
    ok(!!doc.querySelector('#ed-look-theme .ed-look-h .ed-look-v') &&
       !!doc.querySelector('#ed-look-face .ed-look-h .ed-look-v'),
       '★ 分区小标题 + 右侧当前值（底子 / 牌面）');
    ok(!!doc.querySelector('#ed-look-style #ed-bgstyle') && !!doc.querySelector('#ed-look-face #ed-swatches'),
       '★ 样式网格 / 牌面底色都落在各自分区里');
    /* ★ 2026-11-14（第三轮）：用户原话「我不明白你为什么要搞那么多折叠？字体那玩意不需要折叠」
       —— 整个编辑器**一个折叠组都不留**了，三层页签里全是常显内容。 */
    eq(doc.querySelectorAll('#lib-editor details').length, 0, '★ 编辑器里没有任何折叠组（第三轮全平铺）');
    ok(!!doc.querySelector('#ed-sec-font #ed-font') && !!doc.querySelector('#ed-sec-meaning #ed-meaning'),
       '★ 字体 / 牌义是常显 section（不再是 details）');
    ok(!!doc.querySelector('#ed-yruler[role="slider"]') && doc.querySelector('#ed-yruler').getAttribute('aria-valuemax') === '96',
       '★ 位置尺是 slider（可操作），不再是纯展示');
    ok(!!doc.querySelector('#ed-more') && !!doc.querySelector('#ed-sheet') && doc.querySelector('#ed-sheet').hidden,
       '★ 顶栏 ⋯ + 更多面板（默认隐藏）');
    ['ed-export-face', 'ed-export-back', 'ed-goto-back', 'ed-clone-card', 'ed-del-card'].forEach(function (id) {
      ok(!!doc.getElementById(id), '★ 更多面板动作在：' + id);
    });
    ok(!!doc.querySelector('#ed-quick #ed-name'), '★ 卡名输入框在坞顶固定区（P1：改字 0 屏）');
    ok(doc.querySelector('#ed-quick').parentElement === doc.querySelector('.ed-dock'),
       '★ 坞顶改字区是 .ed-dock 的直接子节点（不随坞滚动）');
    ok(!doc.querySelector('#ed-quick').closest('.ed-scroll'),
       '★ 坞顶改字区不在滚动区里（打开任何折叠组都不影响它）');
    ok(!!doc.querySelector('#ed-quick #ed-keyword') && !doc.querySelector('#ed-quick #ed-keyword').closest('details'),
       '★ 关键词输入框也不在折叠组里');
    ok(doc.querySelector('#ed-quick').nextElementSibling === doc.querySelector('.ed-scroll'),
       '★ 坞顶改字区紧挨在滚动区之前（首屏可见的结构保证；jsdom 无布局，用结构钉）');

    /* —— t11：软键盘 / 焦点跟随 / aria（jsdom 没有真实键盘，改用可视高 mock + 事件） —— */
    const pageEl = doc.getElementById('lib-editor');
    const vvOrig = window.visualViewport;
    const mockVV = function (h) {
      Object.defineProperty(window, 'visualViewport', {
        configurable: true, writable: true,
        value: { height: h, addEventListener: function () {}, removeEventListener: function () {} }
      });
      window.dispatchEvent(new window.Event('resize'));
    };
    try {
      mockVV(500);
      ok(pageEl.classList.contains('is-kb'), '★ 可视高 < 基线×0.82 → .ed-page.is-kb');
      eq(pageEl.style.getPropertyValue('--ed-vh'), '500px', '★ --ed-vh = 键盘后的可视高');
      mockVV(window.innerHeight);
      ok(!pageEl.classList.contains('is-kb'), '★ 收起键盘 → 摘掉 .is-kb');
    } finally {
      Object.defineProperty(window, 'visualViewport', { configurable: true, writable: true, value: vvOrig });
      window.dispatchEvent(new window.Event('resize'));
    }
    /* 点「关键词」→ 焦点跟着走；回车 → 收起；aria-pressed 同步 */
    const targetKwBtn = doc.querySelector('#ed-target [data-target="kw"]');
    targetKwBtn.click();
    await wait(20);
    ok(doc.activeElement === doc.querySelector('#ed-keyword'), '★ 切到关键词 → 焦点跟到关键词框');
    eq(targetKwBtn.getAttribute('aria-pressed'), 'true', '★ 目标切换有 aria-pressed');
    const kwInput = doc.querySelector('#ed-keyword');
    kwInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    ok(doc.activeElement !== kwInput, '★ 回车收起输入（enterkeyhint=done，不换行）');
    const kwTogEl = doc.querySelector('#ed-kw-toggle');
    const togBefore = kwTogEl.getAttribute('aria-pressed');
    kwTogEl.click();
    await wait(20);
    ok(kwTogEl.getAttribute('aria-pressed') !== togBefore, '★ 「上牌面」aria-pressed 跟着开/关');
    if (kwTogEl.getAttribute('aria-pressed') !== togBefore) kwTogEl.click();   // 还原
    doc.querySelector('#ed-target [data-target="name"]').click();             // 还原目标，别影响后面的 39 款样式
    await wait(20);

    /* ★ 2026-11-19 问题1：上牌面开关跟当前目标走（nameOn / kwOn 两个字段，一个按钮） */
    const nameTog = doc.querySelector('#ed-kw-toggle');
    ok(/卡名/.test(nameTog.textContent), '★ 问题1：目标=卡名 → 开关文案跟到卡名');
    const kwBeforeQ1 = ED._draft().kwOn !== false;
    const nameBeforeQ1 = ED._draft().nameOn !== false;
    nameTog.click();
    await wait(20);
    ok((ED._draft().nameOn !== false) === !nameBeforeQ1, '★ 问题1：目标=卡名 → 点开关改的是 nameOn');
    ok((ED._draft().kwOn !== false) === kwBeforeQ1, '★ 问题1：关卡名不动关键词开关');
    ok(!!doc.querySelector('#ed-card .fc-wrap[data-kind="name"].is-off'),
       '★ 问题1：编辑页卡名仍显示（is-off 压暗，方便继续调样式）');
    const faceQ1 = UI.faceHTML(D.withCardStyle(Object.assign({}, ED._draft())), {});
    ok(!/data-kind="name"/.test(faceQ1), '★ 问题1：台面真值 nameOn=false 时不渲染卡名块');
    ok(/#ed-card \.fc-wrap\.is-off\s*\{[^}]*opacity:\s*\.35/.test(cssNoCmt),
       '★ 问题1 CSS：关掉的块压暗 .35 由 CSS 管（不写行内）');
    eq(D.withCardStyle({}).nameOn, true, '★ 问题1：nameOn 缺字段默认 true（老数据=显示）');
    eq(D.withCardStyle({ nameOn: false }).nameOn, false, '★ 问题1：nameOn=false 不被默认值盖回');
    const edSrcQ1 = fs.readFileSync(path.join(WWW, 'js/scenes/editor.js'), 'utf8');
    ok(/nameOn:\s*draft\.nameOn !== false/.test(edSrcQ1), '★ 问题1：保存白名单带上 nameOn');
    nameTog.click();                            // 还原 nameOn
    await wait(20);
    doc.querySelector('#ed-target [data-target="kw"]').click();
    await wait(20);
    ok(/关键词/.test(doc.querySelector('#ed-kw-toggle').textContent),
       '★ 问题1：目标=关键词 → 开关文案跟到关键词');
    doc.querySelector('#ed-target [data-target="name"]').click();
    await wait(20);

    /* 上面这些行为断言会留下撤销步；清回干净状态，别污染后面「39 次点击 = 39 步可撤销」 */
    let _g = 0;
    while (ED._undo() > 0 && _g++ < 40) doc.querySelector('#ed-undo').click();
    await wait(20);

    /* —— 三个页签：只切 hidden，不重建 DOM（切完字不丢、滚动回顶部） ——
       ★ 2026-11-14（第二轮）：外观页摊平后这条更关键 —— 四个分区的控件都是常驻节点，
         切页若走"重建 innerHTML"会把滚动位置、正在输入的焦点全弄丢（交接里第 5 条坑）。 */
    const tabNameEl = doc.querySelector('#ed-name');
    tabNameEl.focus();
    tabNameEl.value = '页签切换测试';
    tabNameEl.dispatchEvent(new window.Event('input', { bubbles: true }));
    tabNameEl.blur();
    await wait(20);
    const scTab = doc.querySelector('.ed-scroll');
    scTab.scrollTop = 120;
    doc.querySelector('#ed-tabs .ed-tab[data-pane="look"]').click();
    await wait(10);
    ok(!doc.querySelector('.ed-pane[data-pane="look"]').hidden, '★ 页签：点「外观」→ 外观面板显示');
    ok(doc.querySelector('.ed-pane[data-pane="text"]').hidden, '★ 页签：文字面板收起（hidden，不是删掉）');
    eq(scTab.scrollTop, 0, '★ 页签：切完滚动回顶部');
    eq(doc.querySelector('#ed-name').value, '页签切换测试', '★ 页签：输入框里的字没丢（DOM 没重建）');
    ok(!!doc.querySelector('#ed-look-theme .ed-themes'), '★ 页签：外观面板的 DOM 一直在（只是 hidden）');
    doc.querySelector('#ed-tabs .ed-tab[data-pane="text"]').click();
    await wait(10);
    eq(scTab.scrollTop, 120, '★ 回到文字页恢复原滚动位置');
    eq(doc.querySelector('#ed-name').value, '页签切换测试', '★ 页签：切回来字还在');
    doc.querySelector('#ed-undo').click();
    await wait(20);
    eq(ED._draft().name, card0.name, '★ 页签测试收尾：撤销回原名');

    /* —— 第三轮：上滑铺满 / 位置尺可操作 / ⋯ 更多面板 ——
       （尺子的**指针拖拽**在无头 Chromium 里测；jsdom 没布局，这里钉键盘与结构） */
    const dockfull = function () { return doc.querySelector('#lib-editor').classList.contains('is-dockfull'); };
    const grabEl = doc.querySelector('#ed-grab');
    const pev = function (type, el, y) {
      el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientY: y }));
    };
    /* 上滑：pointerup 后浏览器会补一个 click —— 必须被吃掉，不能来回切 */
    pev('pointerdown', grabEl, 600); pev('pointermove', grabEl, 540); pev('pointerup', grabEl, 540);
    click(grabEl);
    await wait(500);
    ok(dockfull(), '★ 上滑抓手 → 面板铺满（补发的 click 被吃掉）');
    pev('pointerdown', grabEl, 100); pev('pointermove', grabEl, 160); pev('pointerup', grabEl, 160);
    click(grabEl);
    await wait(20);
    ok(!dockfull(), '★ 下滑抓手 → 面板收回');
    click(grabEl); await wait(500);
    ok(dockfull(), '★ 点抓手 → 铺满');
    click(grabEl); await wait(20);
    ok(!dockfull(), '★ 再点 → 收回');

    /* ★ 2026-11-19 问题2：坞高单一来源；键盘只改可用高，不改档位、不压坞。
       旧版 bug：.is-dockfull 的 height:100% 被后写的 .is-kb max-height 压成
       「可视高 − 59 − 84 − 8」，看着就是抽屉自己掉下去。 */
    const dockRuleQ2 = (cssNoCmt.match(/\.ed-dock\s*\{([^}]*)\}/) || [])[1] || '';
    ok(/height:\s*var\(--dock-h/.test(dockRuleQ2) && /max-height:\s*none/.test(dockRuleQ2),
       '★ 问题2 CSS：坞高只读 --dock-h（单一来源）');
    ok(!/\.is-kb[^{}]*\.ed-dock\s*\{[^}]*max-height/.test(cssNoCmt),
       '★ 问题2 CSS：键盘规则不再改坞高');
    ok(!/\.is-dockfull[^{}]*\.ed-dock\s*\{[^}]*height/.test(cssNoCmt),
       '★ 问题2 CSS：铺满档不再自己写坞高');

    click(grabEl); await wait(500);                 // 铺满
    ok(dockfull(), '问题2 前置：铺满');
    const fullNoKbQ2 = ED._dock().h;
    mockVV(500);
    await wait(30);
    ok(pageEl.classList.contains('is-dockfull'), '★ 问题2：键盘弹起不改铺满档位');
    eq(ED._dock().level, 'full', '★ 问题2：内部档位仍是 full');
    eq(ED._dock().h, 441, '★ 问题2：铺满 + 键盘 → --dock-h = 可视高 − 顶栏（不是再减 151）');
    mockVV(window.innerHeight);
    await wait(30);
    eq(ED._dock().h, fullNoKbQ2, '★ 问题2：收起键盘 → 铺满高度回原值');

    click(grabEl); await wait(500);                 // 半屏
    ok(!dockfull(), '问题2 前置：半屏');
    const halfNoKbQ2 = ED._dock().h;
    mockVV(500);
    await wait(30);
    eq(ED._dock().level, 'half', '★ 问题2：半屏 + 键盘 → 档位不变');
    ok(ED._dock().h > 0 && ED._dock().avail - ED._dock().h >= 120,
       '★ 半屏 + 键盘 → 给牌面保留空间，工具坞不越出可视区');
    mockVV(window.innerHeight);
    await wait(30);
    eq(ED._dock().h, halfNoKbQ2, '★ 问题2：键盘收起 → 半屏高度不变');

    /* 拖动中弹键盘：档位仍是 dragging，不被键盘改档 */
    pev('pointerdown', grabEl, 600); pev('pointermove', grabEl, 540);
    await wait(10);
    mockVV(500);
    await wait(20);
    eq(ED._dock().level, 'dragging', '★ 问题2：拖动中弹键盘 → 档位仍是 dragging');
    pev('pointerup', grabEl, 540);
    click(grabEl);                                  // 浏览器补发的 click：吃掉 gsuppress，别让它吃掉收尾那下
    await wait(400);
    mockVV(window.innerHeight);
    await wait(400);
    click(grabEl); await wait(500);                 // 收尾回半屏，别影响后面的尺子/样式测试
    ok(!dockfull(), '问题2 收尾：回半屏');

    /* ★ 2026-11-19（抽屉缩放）：用户原话「抽屉上拉的时候，画布的缩放也有bug」。
       旧算法 clamp((H1 − 坞高 − 12) / 牌高, 硬下限, 1)：
       ① H0/H1 是绕开 --dock-h 另算的一套高度；② 那个硬下限让牌在铺满前缩不下去，
       被画布 overflow:hidden 裁成一条；③ 吸附目标写死成下限，和坞的终点对不上。
       现在只有一条公式：stage 剩多高 / 牌多高 —— 纯函数，可断言。 */
    const scaleFn = ED._stageScale;
    ok(typeof scaleFn === 'function', '★ 缩放：算法是纯函数（MoKa.editor._stageScale）');
    eq(scaleFn(336, 336), 1, '★ 缩放：stage 和牌一样高 → 原尺寸');
    eq(scaleFn(500, 336), 1, '★ 缩放：stage 比牌高 → 也不放大（封顶 1）');
    eq(scaleFn(168, 336), 0.5, '★ 缩放：stage 剩一半 → 正好缩一半');
    eq(scaleFn(0, 336), 0, '★ 缩放：stage 收缩到 0（铺满）→ scale 0，不再留一条被裁的牌边');
    ok(scaleFn(20, 336) < 0.15, '★ 缩放：只剩一窄条时允许 < .15（旧的硬下限就是裁切根因）');
    eq(scaleFn(-40, 336), 0, '★ 缩放：量到负高也不出负数');
    eq(scaleFn(120, 0), 1, '★ 缩放：拿不到牌高 → 不动（宁可不缩，也别把牌缩没）');

    /* 结构：缩放只有一个写入口，旧的第二套高度算术必须绝迹 */
    const edSrcDock = fs.readFileSync(path.join(WWW, 'js/scenes/editor.js'), 'utf8');
    eq((edSrcDock.match(/setProperty\('--dock-scale'/g) || []).length, 1,
       '★ 缩放：--dock-scale 只有 syncDockScale() 一个写入口');
    ok(!/removeProperty\('--dock-scale'/.test(edSrcDock), '★ 缩放：别处不再"删掉缩放"（删一次牌就跳一下）');
    ok(!/const scaleFor|setDockScale =/.test(edSrcDock), '★ 缩放：旧的 scaleFor(H0,H1) / setDockScale 已拆掉');
    ok(!/0\.15/.test(edSrcDock), '★ 缩放：15% 的硬下限不在了');
    ok(/const SNAP_MS = 260/.test(edSrcDock), '★ 缩放：吸附收尾 260ms = CSS 的 .24s + 余量');

    /* CSS：只缩画布那张牌；坞高和缩放同一条曲线 */
    ok(/#ed-card\s*\{[^{}]*transform:\s*scale\(var\(--dock-scale/.test(cssNoCmt),
       '★ 缩放 CSS：缩放只作用在 #ed-card（坞里的主题缩略图不该跟着缩）');
    ok(!/\.is-dockdrag \.cv-card|\.is-docksnap \.cv-card/.test(cssNoCmt),
       '★ 缩放 CSS：不再拿 .cv-card 泛选（会连坞内缩略图一起缩）');
    const dockSnapRule = (cssNoCmt.match(/\.ed-page\.is-docksnap \.ed-dock \{([^}]*)\}/) || [])[1] || '';
    const cardSnapRule = (cssNoCmt.match(/\.ed-page\.is-docksnap #ed-card \{([^}]*transition[^}]*)\}/) || [])[1] || '';
    ok(/height \.24s/.test(dockSnapRule) && /transform \.24s/.test(cardSnapRule),
       '★ 缩放 CSS：坞高和牌缩放同一条 .24s 曲线（线性关系才不错位）');

    /* 行为①：铺满 → 下拉 → 半屏 */
    const scaleNow = function () { return ED._dock().scale; };
    const grabEv = function (type, y) { pev(type, grabEl, y); };
    click(grabEl); await wait(500);                       // 半屏 → 铺满
    ok(dockfull(), '缩放 前置：铺满');
    eq(scaleNow(), 0, '★ 缩放：铺满态 scale 正好 0（牌完全让开，不留一条）');
    grabEv('pointerdown', 700);                           // 从铺满起手
    eq(scaleNow(), 0, '★ 缩放：从铺满抓住手，第一帧不跳（scale 还是 0）');
    ok(!pageEl.classList.contains('is-docksnap') && pageEl.classList.contains('is-dockdrag'),
       '★ 缩放：这一抓接管了抽屉（吸附过渡类摘掉、拖动类挂上）');
    grabEv('pointermove', 760);                           // 往下拖 60px
    await new Promise(resolve => window.requestAnimationFrame(resolve));
    const scDrag = scaleNow();
    ok(scDrag > 0 && scDrag < 1, '★ 缩放：下拉途中牌跟着长（0 < scale < 1，实际 ' + scDrag + '）');
    grabEv('pointerup', 760);
    click(grabEl);                                        // 补发的 click 吃掉，别来回切
    await wait(450);
    eq(ED._dock().level, 'half', '★ 缩放：铺满 → 下拉 → 回到半屏');
    eq(scaleNow(), 1, '★ 缩放：回半屏 scale 回到 1（fitBigCard 之后重算）');

    /* 行为②：吸附还没结束又抓手 —— 旧 timer 不许再改任何状态 */
    click(grabEl);                                        // 开始吸附铺满，260ms 没走完
    ok(pageEl.classList.contains('is-docksnap'), '缩放 前置：正在吸附');
    await wait(20);
    grabEv('pointerdown', 700);                           // 半路又抓住手
    await wait(300);                                      // 旧 timer 该到点了
    eq(ED._dock().level, 'dragging', '★ 缩放：吸附未结束又抓 → 老 timer 不会偷改档位');
    ok(pageEl.classList.contains('is-dockdrag') && !pageEl.classList.contains('is-docksnap'),
       '★ 缩放：拖动类还在、吸附过渡类已摘（拖起来不"软"）');
    eq(scaleNow(), 0, '★ 缩放：老 timer 也不会把 --dock-scale 删掉（仍是铺满的 0）');
    grabEv('pointerup', 700);                             // 没位移 → 退回原档
    click(grabEl);                                        // 这一下切回半屏
    await wait(450);
    eq(ED._dock().level, 'half', '缩放 收尾：回到半屏');
    eq(scaleNow(), 1, '缩放 收尾：半屏 scale = 1');

    /* 行为③：拖动中弹键盘 —— 可用高变小，缩放要跟着重算（不是一个死数） */
    grabEv('pointerdown', 600); grabEv('pointermove', 500);   // 往上拖 100
    const scNoKb = scaleNow();
    mockVV(500);
    await wait(30);
    eq(ED._dock().level, 'dragging', '★ 缩放：拖动中弹键盘 → 档位仍是 dragging');
    ok(ED._dock().scale < scNoKb, '★ 缩放：键盘把可用高变矮 → scale 跟着变小（同源，不是死数）');
    grabEv('pointercancel', 500);                          // 手势被系统掐掉
    await wait(450);
    ok(!pageEl.classList.contains('is-dockdrag'), '★ 缩放：pointercancel 之后拖动类收干净');
    ok(ED._dock().level === 'full' || ED._dock().level === 'half', '★ 缩放：pointercancel 也按松手吸附收尾');
    mockVV(window.innerHeight);
    await wait(30);
    if (dockfull()) { click(grabEl); await wait(450); }
    ok(!dockfull(), '★ 缩放 收尾：回到半屏（后面的尺子/样式断言要这个状态）');

    const yrEl2 = doc.querySelector('#ed-yruler');
    const vy0 = ED._draft().nameVy;
    yrEl2.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    eq(ED._draft().nameVy, vy0 - 1, '★ 位置尺：↑ 键把上下位置减 1%');
    yrEl2.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    eq(ED._draft().nameVy, vy0, '★ 位置尺：↓ 键加回 1%');
    doc.querySelector('#ed-undo').click(); doc.querySelector('#ed-undo').click();
    await wait(20);

    const sheetEl = doc.querySelector('#ed-sheet');
    click(doc.querySelector('#ed-more'));
    await wait(30);
    ok(!sheetEl.hidden, '★ 点 ⋯ → 更多面板打开');
    click(doc.querySelector('#ed-sheet-mask'));
    await wait(500);
    ok(sheetEl.hidden, '★ 点遮罩 → 面板关闭');

    /* —— 39 款样式逐个点（实况网格 = 台面） —— */
    const IDS = ['soft','pill','tag','plate','ribbon','outline','underline','none','plain',
      'scroll','bamboo','rice','carve','ledger','label','neon','halo','spot','glass','hex','notch',
      'stripe','dotgrid','gridpaper','sidebar','double','stitch','ribbon2','sqring','twinline',
      'emboss','deboss','gold','copper','velvet','papercut','holo','leather','mist'];
    const BARS = IDS.slice(9);            // 第二批 30 款 = 通条
    eq(doc.querySelectorAll('#ed-bgstyle .ed-bgcell').length, 39, '★ 正好 39 个样式格子（实况预览）');
    /* ★ 2026-11-14（第二轮）：网格 3 列 → 5 列（照预览稿 A2）；主题缩略图不许投阴影 */
    ok(/\.ed-bggrid[^{}]*\{[^{}]*grid-template-columns:\s*repeat\(5/.test(cssNoCmt),
       '★ CSS：样式网格 5 列（照预览稿 A2）');
    const themePvRule = (cssNoCmt.match(/\.ed-theme-pv\s*\{([^}]*)\}/) || [])[1] || '';
    ok(!!themePvRule && !/box-shadow/.test(themePvRule), '★ CSS：主题缩略图不投阴影（靠 1px 边线分层）');

    const tmp = doc.createElement('div');
    const bad = [];
    /* ★ 2026-11-06：量**增量**而不是绝对值。这一组前面新增的交互（双击改字 / 坞顶输入 /
       「上牌面」aria 切换 / 键盘 visualViewport 复位）本身就会在撤销栈里留步；清理循环
       只要漏掉几步（异步落盘、焦点回写会补上），`ED._undo() === 39` 就变成 42 —— 红的
       不是产品（无头 Chromium 与 jsdom 实测：39 个格子逐个点，每个正好 +1 步）。
       这里循环前后各取一次水位，只钉"39 次点击 = 39 步"这件事本身。
       有牙：退回绝对值写法（循环前已有 3 步时会红）；或让任一格子 commit 两次（增量 40）也红。 */
    const undo0 = ED._undo();
    IDS.forEach(function (id) {
      const b = doc.querySelector('#ed-bgstyle .ed-bgcell[data-bgstyle="' + id + '"]');
      if (!b) { bad.push(id + '：格子不在'); return; }
      click(b);
      const edChip = doc.querySelector('#ed-card .fc-chip.fc-name');
      if (!edChip || !edChip.classList.contains('is-bg-' + id)) { bad.push(id + '：预览没换到 is-bg-' + id); return; }
      const isBar = edChip.classList.contains('is-bar');
      if ((BARS.indexOf(id) >= 0) !== isBar) bad.push(id + '：is-bar 不对（' + isBar + '）');
      // 和台面渲染对齐
      tmp.innerHTML = UI.faceHTML(Object.assign({}, card0, { nameBgStyle: id, kwBgStyle: id }));
      const realChip = tmp.querySelector('.fc-chip.fc-name');
      const cls = function (el) { return Array.prototype.slice.call(el.classList).filter(function (c) { return c.indexOf('is-') === 0; }).sort().join(' '); };
      if (cls(realChip) !== cls(edChip)) bad.push(id + '：类名和台面不一致（台面 ' + cls(realChip) + '／编辑页 ' + cls(edChip) + '）');
      const bgA = edChip.style.background || '', bgB = realChip.style.background || '';
      const coA = edChip.style.color || '', coB = realChip.style.color || '';
      if ((!!bgA) !== (!!bgB) || (!!coA) !== (!!coB)) bad.push(id + '：行内策略和台面不一致（编辑页 bg=' + bgA + ' color=' + coA + '／台面 bg=' + bgB + ' color=' + coB + '）');
      if (coA !== coB) bad.push(id + '：字色不一致（编辑页 ' + coA + '／台面 ' + coB + '）');
    });
    ok(bad.length === 0, '★★ 39 款逐个点过：编辑页 = 台面（类名 + 行内策略 + 字色）'
      + (bad.length ? '　→ ' + bad.slice(0, 6).join('；') : ''));
    ok(errors.length === errBefore, '★★ 点这 39 下没有 JS 报错'
      + (errors.length > errBefore ? '　→ ' + errors.slice(errBefore).join(' | ') : ''));

    /* —— 撤销 / 重做（每个离散操作 = 一步） —— */
    eq(ED._undo() - undo0, 39, '★ 39 次点击 = 39 步可撤销（每次正好 1 步，不多不少）');
    doc.querySelector('#ed-undo').click();
    eq(ED._draft().nameBgStyle, 'leather', '★ 撤销一步回到上一款（leather）');
    doc.querySelector('#ed-redo').click();
    eq(ED._draft().nameBgStyle, 'mist', '★ 重做恢复（mist）');
    let guard = 0;
    while (ED._undo() > 0 && guard++ < 60) doc.querySelector('#ed-undo').click();
    eq(ED._draft().nameBgStyle, origStyle, '★ 一路撤销回到最初（' + origStyle + '）');
    ok(ED._dirty() === false, '★ 回到最初状态 → 不算有改动（dirty=false）');
    guard = 0;
    while (ED._redo() > 0 && guard++ < 60) doc.querySelector('#ed-redo').click();
    eq(ED._draft().nameBgStyle, 'mist', '★ 一路重做回到最后（mist）');
    guard = 0;
    while (ED._undo() > 0 && guard++ < 60) doc.querySelector('#ed-undo').click();

    /* —— 颜色拖动只绘主牌；17 张主题预览等 change/提交再统一刷新 —— */
    click(doc.querySelector('#ed-bgcat .seg-btn[data-bgcat="药丸"]'));
    click(doc.querySelector('#ed-bgstyle .ed-bgcell[data-bgstyle="soft"]'));
    const liveBg = doc.querySelector('#ed-bg');
    const liveChip = doc.querySelector('#ed-card .fc-wrap[data-kind="' + ED._sel() + '"] .fc-chip');
    const oldBg = liveBg.value, oldPreviewChip = UI.previewChip, oldFaceHTML = UI.faceHTML;
    let liveChipPaints = 0, liveFacePaints = 0;
    UI.previewChip = function () { liveChipPaints++; return oldPreviewChip.apply(this, arguments); };
    UI.faceHTML = function () { liveFacePaints++; return oldFaceHTML.apply(this, arguments); };
    const colorUndo = ED._undo();
    for (let i = 0; i < 20; i++) {
      liveBg.value = i === 19 ? '#315a7d' : '#315a' + String(i).padStart(2, '0');
      liveBg.dispatchEvent(new window.Event('input', { bubbles: true }));
    }
    eq(liveChipPaints, 20, '★★ 颜色拖动 20 帧只生成 20 个主牌字块预览，不重建样式网格');
    eq(liveFacePaints, 0, '★★ 颜色拖动期间不重建 17 张主题整卡');
    ok(liveChip.style.background !== '', '★ 颜色拖动仍即时更新主牌底色',
      '选中=' + ED._sel() + ' bg=' + liveChip.style.background + ' 草稿=' + ED._draft()[ED._sel() + 'Bg']);
    liveBg.dispatchEvent(new window.Event('change', { bubbles: true }));
    eq(liveFacePaints, 17, '★★ 颜色提交时才刷新 17 张主题预览');
    eq(ED._undo(), colorUndo + 1, '★ 一次颜色拖动仍只占一步撤销');
    doc.querySelector('#ed-undo').click();
    doc.querySelector('#ed-undo').click();
    liveBg.value = oldBg;
    UI.previewChip = oldPreviewChip;
    UI.faceHTML = oldFaceHTML;

    /* —— 置灰：自带配色的那些，"颜色/深浅"行必须是灰的 —— */
    const bgrow = function () { return doc.querySelector('#ed-bgrow'); };
    click(doc.querySelector('#ed-bgstyle .ed-bgcell[data-bgstyle="deboss"]'));
    ok(!!bgrow() && bgrow().classList.contains('is-off'), '★ 凹刻（自带配色）：颜色行置灰');
    click(doc.querySelector('#ed-bgstyle .ed-bgcell[data-bgstyle="soft"]'));
    ok(!!bgrow() && !bgrow().classList.contains('is-off'), '★ 柔光（跟颜色走）：颜色行可用');
    doc.querySelector('#ed-undo').click();
    doc.querySelector('#ed-undo').click();      // 撤销这两次点击，回干净状态

    /* —— 双击改字（画布上直接改，不回旧"信息屏"） —— */
    const nameWrap = function () { return doc.querySelector('#ed-card .fc-wrap[data-kind="name"]'); };
    const tapP = function (el, x, y) {
      el.dispatchEvent(new window.MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
      el.dispatchEvent(new window.MouseEvent('pointerup', { clientX: x, clientY: y, bubbles: true }));
    };
    /* ★ 2026-11-06（修间歇性红）：双击判定读的是 `Date.now()`（editor.js onWrapDown 的
       「同块 / 320ms 内 / 位移 <12px」）。这里原来两次 tap 之间是 `await wait(40)` —— 走查跑在
       **墙上时钟**上，机器一忙（同机还跑着无头 Chromium / 别的走查）这两次 setTimeout 就可能
       被拖到 320ms 之外，第二次 tap 被判成"又一次单击" → 弹窗根本没出现 → 下一行
       `querySelector('.dialog .input').value` 在 null 上赋值，抛 TypeError 把整组断言带崩
       （实测 3 次红 1 次；无头 Chromium 同样序列稳定成功）。
       结论：**不是产品逻辑问题**（人手双击典型 80~250ms，320ms 窗口足够宽；产品不用改），
       是测试把墙上时钟当输入。现在把编辑器看到的 Date.now() 钉死：两次 tap 只走 80ms 虚拟时间，
       真实等待只留给弹窗渲染 —— 间隔是确定的，机器忙不忙都一样。
       ★ 别退回 `await wait(40)`：那等于把这条断言重新交给调度器抽签。 */
    const realNow = window.Date.now;
    const tTap0 = realNow();
    tapP(nameWrap(), 120, 150);
    let fakeNow = tTap0 + 80;                 // 人手一次双击的典型间隔，远小于 320ms 窗口
    window.Date.now = function () { return fakeNow; };
    try {
      tapP(nameWrap(), 121, 151);             // 同块、位移 2px、间隔 80ms → 双击
    } finally {
      window.Date.now = realNow;              // 别把假时钟漏给后面的断言
    }
    await wait(40);                            // 只等弹窗渲染（promptDialog 是同步插 DOM）
    ok(!!doc.querySelector('#overlay-root .dialog .input'),
       '★ 双击文字块弹出改字框（同块 / 位移 2px / 间隔 80ms < 320ms 窗口，虚拟时钟）');
    doc.querySelector('#overlay-root .dialog .input').value = '改过的名';
    doc.querySelector('#overlay-root .dialog .btn-ok').click();
    await wait(25);
    eq(ED._draft().name, '改过的名', '★ 双击改的字进了草稿');
    eq(doc.querySelector('#ed-name').value, '改过的名', '★ 坞顶固定区输入框同步');
    eq(doc.querySelector('#ed-card .fc-chip.fc-name').textContent, '改过的名', '★ 牌面上同步');
    doc.querySelector('#ed-undo').click();
    eq(ED._draft().name, card0.name, '★ 撤销一步：名字改回去');
    /* ★ 坞顶输入框必须跟草稿一起回滚（编辑器把输入框搬出 details 后新增的守卫） */
    const quickName = doc.querySelector('#ed-name');
    quickName.focus(); quickName.value = '坞顶改的名'; quickName.dispatchEvent(new window.Event('input', { bubbles: true })); quickName.blur();
    await wait(20);
    doc.querySelector('#ed-undo').click();
    await wait(20);
    eq(doc.querySelector('#ed-name').value, card0.name, '★ 撤销后坞顶输入框同步回旧值');

    /* —— P1 承诺②：0 屏也能改卡名 —— */
    eq(doc.querySelectorAll('#lib-editor details').length, 0,
       '★ 编辑器里没有折叠组（改卡名不靠展开任何组）');
    const zeroName = doc.querySelector('#ed-quick #ed-name');
    zeroName.focus();
    zeroName.value = '0屏改名';
    zeroName.dispatchEvent(new window.Event('input', { bubbles: true }));
    zeroName.blur();
    await wait(20);
    eq(ED._draft().name, '0屏改名', '★ 零折叠也能改卡名（坞顶固定区，0 屏）');
    eq(doc.querySelector('#ed-card .fc-chip.fc-name').textContent, '0屏改名', '★ 牌面同步');
    doc.querySelector('#ed-undo').click();
    await wait(20);
    eq(ED._draft().name, card0.name, '★ 0 屏改名也能一步撤销');

    /* —— P0 承诺③：字号滑条拖即转手动（不用先点「手动」） —— */
    const fsEl2 = doc.querySelector('#ed-fs');
    ok(!fsEl2.disabled, '★ 字号滑条不再 disabled（自动适配时也能拖）');
    ok(ED._draft().autoFit !== false, '★ 拖之前是自动适配');
    fsEl2.value = '120';
    fsEl2.dispatchEvent(new window.Event('input', { bubbles: true }));
    fsEl2.dispatchEvent(new window.Event('change', { bubbles: true }));
    await wait(20);
    ok(ED._draft().autoFit === false, '★ 拖一下字号 = 自动转手动（省掉先点「手动」那一步）');
    eq(ED._draft().nameFs, 120, '★ 拖到 120% 真的写进草稿');
    doc.querySelector('#ed-undo').click();
    await wait(20);
    ok(ED._draft().autoFit !== false, '★ 撤销回到自动适配');

    /* —— 字号滑条（2026-11-17 修）：手动模式绑**草稿值**，标签带「实际生效值」 ——
       bug 现场：滑条被拽回 fitFs 的实际字号，拖到 200 松手就弹回 179；
       标签只有裸草稿值，看不出「我设了 200、画出来只有 179」。
       规矩没变：画布仍被牌宽上限钳住（fitFs 一个字未改），改的只是 UI 绑定。 */
    const setName2 = function (v) {
      const n = doc.querySelector('#ed-name');
      n.focus(); n.value = v;
      n.dispatchEvent(new window.Event('input', { bubbles: true }));
      n.blur();
    };
    const dragFs = function (v) {
      fsEl2.value = String(v);
      fsEl2.dispatchEvent(new window.Event('input', { bubbles: true }));
      fsEl2.dispatchEvent(new window.Event('change', { bubbles: true }));
    };
    /* chip 上记的是"相对牌宽的比例"（ui.js chipHTMLFor），换算回字号百分比再跟上限比 */
    const chipPct = function (kind) {
      const chip = doc.querySelector('#ed-card .fc-wrap[data-kind="' + kind + '"] .fc-chip');
      const m = /--card-w, 90px\) \* ([0-9.]+)/.exec((chip && chip.getAttribute('style')) || '');
      return m ? parseFloat(m[1]) * 100 / ({ name: 13 / 90, kw: 10 / 90 }[kind]) : NaN;
    };
    const fsLab = function () { return doc.querySelector('#ed-fs-v').textContent; };

    /* ① 2 字：上限 ≈179% —— 拖到 200 后滑条必须停在 200 */
    setName2('师生');
    await wait(20);
    ok(/^\d+% 自动$/.test(fsLab()), '★ 自动适配：标签仍是「xx% 自动」，滑条显示实际适配值');
    dragFs(200);
    await wait(20);
    eq(fsEl2.value, '200', '★ 手动模式滑条 = 草稿值：拖到 200 就停在 200（不再被拽回 179）');
    ok(/200%/.test(fsLab()) && /实际 179%/.test(fsLab()),
       '★ 被上限压住时标签两个数都给（草稿 200 / 实际 179）：' + fsLab());
    ok(chipPct('name') <= UI.fitFs('name', '师生', 200, false).fs + 1e-6,
       '★ 牌面字号仍被宽度上限钳住（≤179%，画布不溢出）');

    /* ② 7 字：上限 ≈51% —— 改名后滑条还是 200，标签换成「实际 51%」 */
    setName2('跨越归返的门槛');
    await wait(20);
    eq(fsEl2.value, '200', '★ 改名后滑条仍是草稿值 200（长名字不把滑条拽回去）');
    ok(/200%/.test(fsLab()) && /实际 51%/.test(fsLab()),
       '★ 改名后「实际」跟着字数更新（7 字 → 51%）：' + fsLab());
    ok(chipPct('name') <= UI.fitFs('name', '跨越归返的门槛', 200, false).fs + 1e-6,
       '★ 7 字牌面字号仍 ≤ fitFs 上限');

    /* ③ 2 字拖到 120（没到上限）：滑条 120、标签只报一个数、牌面真变大 */
    setName2('师生');
    await wait(20);
    dragFs(120);
    await wait(20);
    eq(fsEl2.value, '120', '★ 未触上限时滑条 = 草稿值 120');
    eq(fsLab(), '120% 手动', '★ 未触上限时标签不画蛇添足写「实际」');
    ok(chipPct('name') > 100 && chipPct('name') <= UI.fitFs('name', '师生', 120, false).fs + 1e-6,
       '★ 牌面字号跟着滑条落到 120%（不超过上限）');

    /* ④ 切到「关键词」目标：滑条同样绑关键词草稿值（不是名字那一边的实际值） */
    doc.querySelector('#ed-target [data-target="kw"]').click();
    await wait(20);
    eq(fsEl2.value, String(Math.max(20, Math.min(200, Math.round(ED._draft().kwFs)))),
       '★ 切「关键词」目标后滑条 = 关键词草稿值');
    doc.querySelector('#ed-target [data-target="name"]').click();
    await wait(20);

    /* 收尾：把这几步撤销干净，下面「主题/样式」从干净状态接着跑 */
    let _g2 = 0;
    while (ED._undo() > 0 && _g2++ < 40) doc.querySelector('#ed-undo').click();
    await wait(20);
    eq(ED._draft().name, card0.name, '★ 字号滑条测试收尾：撤销回原名');


    /* —— 主题一键套用 + 牌面底色 + 纸边 —— */
    const themeSec = doc.querySelector('#ed-look-theme');
    ok(!!themeSec && !themeSec.closest('details'), '★ 底子分区平铺（不是折叠组，直接能点）');
    click(doc.querySelector('#ed-themes .ed-theme[data-theme="xingye"]'));
    eq(ED._draft().faceBg, '#141a2e', '★ 主题「星野」：牌面底色');
    eq(ED._draft().nameBgStyle, 'none', '★ 主题「星野」：文字样式');
    eq(ED._draft().faceTex, 'nebula', '★ 主题「星野」：质感层（星云）');
    ok(doc.querySelector('#ed-themes .ed-theme[data-theme="xingye"]').classList.contains('is-sel'), '★ 主题选中态');
    ok((doc.querySelector('#ed-card .tcard-face').getAttribute('style') || '').indexOf('--fc-face:#141a2e') >= 0,
      '★ 牌面行内 --fc-face（渲染层跟上了）');
    ok(!!doc.querySelector('#ed-card .fc-tex.is-tex-nebula'), '★ 主题带来的质感层真的画在牌面上');
    doc.querySelector('#ed-undo').click();
    ok(!ED._draft().faceBg, '★ 撤销回默认底色');
    eq(doc.querySelectorAll('#ed-look-theme .ed-theme').length, 17,
       '★ 撤销只回滚草稿，不重建底子横条（17 个主题还在）');

    /* —— 质感层（程序生成的灰度纹理，叠在底色上、文字下） —— */
    click(doc.querySelector('#ed-texes .ed-tex[data-tex="nebula"]'));
    eq(ED._draft().faceTex, 'nebula', '★ 选质感「星云」进草稿');
    const texEl = doc.querySelector('#ed-card .fc-tex');
    ok(!!texEl && texEl.classList.contains('is-tex-nebula'), '★ 牌面出现质感层 .fc-tex.is-tex-nebula');
    ok((texEl.getAttribute('style') || '').indexOf('assets/tex/nebula.png') >= 0, '★ 质感层指向 assets/tex（本地文件，不联网）');
    click(doc.querySelector('#ed-texes .ed-tex[data-tex=""]'));
    ok(!ED._draft().faceTex && !doc.querySelector('#ed-card .fc-tex'), '★ 选「无」→ 质感层消失');
    doc.querySelector('#ed-undo').click();
    doc.querySelector('#ed-undo').click();

    /* —— 字色自由（朱砂字 / 烫金字） —— */
    click(doc.querySelector('#ed-textcolor .ed-cbtn[data-tc="#c8a45a"]'));
    eq(ED._draft().nameColor, '#c8a45a', '★ 选字色「金」进草稿');
    ok((doc.querySelector('#ed-card .fc-chip.fc-name').getAttribute('style') || '').indexOf('color:#c8a45a') >= 0,
      '★ 牌面 chip 行内写出该字色');
    click(doc.querySelector('#ed-textcolor .ed-cbtn[data-tc=""]'));
    ok(!ED._draft().nameColor, '★ 选「自动」→ 回到按样式取色');
    doc.querySelector('#ed-undo').click();
    doc.querySelector('#ed-undo').click();
    click(doc.querySelector('#ed-edge .seg-btn[data-edge="0"]'));
    ok(!doc.querySelector('#ed-card .tcard-face').classList.contains('is-edge'), '★ 关纸边：牌面没纸边');
    doc.querySelector('#ed-undo').click();

    /* —— 图片图层：渲染 <img> + 保存白名单一次写全（新字段） —— */
    const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    ED._draft().image = IMG;
    ED._draft().imgScale = 150; ED._draft().imgX = 10; ED._draft().imgY = -10; ED._draft().imgFilter = 'dim';
    ED._draft().faceTex = 'grain'; ED._draft().faceTexA = 50;
    ED._draft().nameColor = '#c8a45a'; ED._draft().kwColor = '#c8a45a';
    /* 用「点质感」触发一次全量重画（⚠ 别用点主题触发：主题 patch 会把上面设的值覆盖掉） */
    click(doc.querySelector('#ed-texes .ed-tex[data-tex="grain"]'));
    await wait(10);
    const imgEl = doc.querySelector('#ed-card .fc-img img');
    ok(!!imgEl, '★ 图片层渲染成 <img> 图层（可平移缩放）');
    const imgStyle = imgEl.getAttribute('style') || '';
    ok(imgStyle.indexOf('translate(10%,-10%)') >= 0, '★ img 平移写在行内（imgX/imgY）');
    ok(imgStyle.indexOf('scale(1.5)') >= 0, '★ img 缩放写在行内（imgScale）');
    ok(imgStyle.indexOf('brightness(.72)') >= 0, '★ img 滤镜写在行内（imgFilter）');

    /* —— ★★ 图片层双指缩放（2026-10-12 用户报「双指缩放无效」的回归钉子） ——
       病根：iPinch 建立时漏了 img 字段，而 onWindowMove/onWindowUp 全靠
       `gPtr[id].img === iPinch.img` 认手指 → 过滤结果永远是空 → 捏合凑不齐两根手指，
       划过去一点反应都没有（文字块捏合有 wrap 字段，所以那半边是好的 —— 对比着才看出来）。
       这里两条都钉：两指都在图上、以及第二指搭在牌外灰底（真机上最常见的那种）。 */
    click(doc.querySelector('#ed-img-adjust'));
    ok(ED._imgMode(), '★ 「调整图片位置与大小」进图片调整模式');
    const pev2 = function (type, el, id, x, y) {
      const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
      Object.defineProperty(e, 'pointerId', { value: id });
      el.dispatchEvent(e);
    };
    const fcimg = doc.querySelector('#ed-card .fc-img');
    const stage2 = doc.querySelector('#ed-stage');
    ED._draft().imgScale = 100;
    pev2('pointerdown', fcimg, 101, 100, 300);
    pev2('pointerdown', stage2, 102, 300, 900);        // 第二指压在牌外的灰底上
    pev2('pointermove', window, 101, 60, 300);
    pev2('pointermove', window, 102, 360, 900);
    await new Promise(resolve => window.requestAnimationFrame(resolve));
    ok(ED._draft().imgScale > 100,
      '★★ 图片层双指张开 → imgScale 变大（第二指在牌外灰底也算，实际 ' + ED._draft().imgScale + '）');
    const uImg = ED._undo();
    pev2('pointerup', window, 101, 60, 300);
    pev2('pointerup', window, 102, 360, 900);
    ok(ED._undo() === uImg + 1, '★ 图片捏合一次 = 一步撤销');
    doc.querySelector('#ed-undo').click();
    ok(ED._draft().imgScale === 100, '★ 撤销把缩放退回 100（捏合的 before 快照真的记上了）');
    click(doc.querySelector('#ed-img-done'));
    ok(!ED._imgMode(), '★ 「完成」退出图片调整模式');
    ED._draft().imgScale = 150;                        // 还原，下面白名单那段还指望 150
    doc.querySelector('#ed-save').click();
    await wait(160);
    const savedCard = D.findDeck(deckId).cards.filter(function (c) { return c.id === card0.id; })[0];
    eq(savedCard.imgScale, 150, '★ 保存白名单：imgScale');
    eq(savedCard.imgX, 10, '★ 保存白名单：imgX');
    eq(savedCard.imgY, -10, '★ 保存白名单：imgY');
    eq(savedCard.imgFilter, 'dim', '★ 保存白名单：imgFilter');
    eq(savedCard.faceEdge, true, '★ 保存白名单：faceEdge');
    eq(savedCard.faceTex, 'grain', '★ 保存白名单：faceTex');
    eq(savedCard.nameColor, '#c8a45a', '★ 保存白名单：nameColor');
    eq(savedCard.kwColor, '#c8a45a', '★ 保存白名单：kwColor');
    eq(savedCard.symbolImg, origSym, '★ 保存白名单：symbolImg 前后一致（没被新白名单挤掉）');

    /* —— 草稿自动保存 / 保存后清掉 —— */
    L.goCard(deckId, card0.id);
    await wait(40);
    click(doc.querySelector('#ed-bgstyle .ed-bgcell[data-bgstyle="gold"]'));
    await wait(750);   // debounce 500ms
    const ls = doc.defaultView.localStorage;
    const draftRaw = ls.getItem('catcard.editor.draft.v1');
    ok(!!draftRaw, '★ 改动后草稿自动落 localStorage');
    const draftObj = JSON.parse(draftRaw);
    eq(draftObj.deckId, deckId, '★ 草稿带牌组 id');
    eq(draftObj.draft.nameBgStyle, 'gold', '★ 草稿内容是当前草稿');
    ok(draftObj.draft.imageHi == null, '★ 草稿剥离高清大图（防配额）');
    doc.querySelector('#ed-save').click();
    await wait(160);
    ok(ls.getItem('catcard.editor.draft.v1') == null, '★ 保存成功 → 草稿清除');
    eq(D.findDeck(deckId).cards.filter(function (c) { return c.id === card0.id; })[0].nameBgStyle, 'gold', '★ 保存真的生效');

    /* —— 草稿恢复弹窗（上次没保存 → 再打开要问） —— */
    L.goCard(deckId, card0.id);
    await wait(40);
    click(doc.querySelector('#ed-bgstyle .ed-bgcell[data-bgstyle="plate"]'));
    await wait(750);
    L.goDeck(deckId); await wait(20);        // 不保存直接走（dirty → back 才弹确认；这里直接切页模拟"丢下"）
    L.goCard(deckId, card0.id);
    await wait(40);
    const dlg = doc.querySelector('#overlay-root .dialog');
    ok(!!dlg, '★ 再次打开编辑页：弹出「恢复上次未保存的编辑？」');
    const cancelDlg = doc.querySelector('#overlay-root .dialog .btn-cancel');
    if (cancelDlg) cancelDlg.click();        // 「不要了」→ 草稿清除，用库里的卡
    await wait(40);
    ok(ls.getItem('catcard.editor.draft.v1') == null, '★ 选「不要了」→ 草稿清除');
    ok(!!doc.querySelector('#ed-card .tcard-face'), '★ 编辑页照常打开');
    eq(ED._draft().nameBgStyle, 'gold', '★ 用库里的卡（plate 没保存就没生效）');

    /* —— 导出按钮（jsdom 无 CatCard 桥 → 提示不报错） —— */
    const errBefore2 = errors.length;
    doc.querySelector('#ed-export-face').click();
    await wait(30);
    ok(errors.length === errBefore2, '★ 导出按钮：无桥环境点击不报错（toast 提示）');

    /* —— 还牌组一个干净状态（gold → soft） —— */
    click(doc.querySelector('#ed-bgstyle .ed-bgcell[data-bgstyle="soft"]'));
    doc.querySelector('#ed-save').click();
    await wait(160);
    eq(D.findDeck(deckId).cards.filter(function (c) { return c.id === card0.id; })[0].nameBgStyle, 'soft', '★ 收尾：样式还原');

    /* —— 空白新卡保存确认（P0-08） —— */
    const deckNow = D.findDeck(deckId);
    const nBeforeEmpty = deckNow.cards.length;
    L.goCard(deckId, null);
    await wait(40);
    doc.querySelector('#ed-save').click();
    await wait(40);
    const emptyDlg = doc.querySelector('#overlay-root .dialog');
    ok(!!emptyDlg && /空白/.test((emptyDlg.querySelector('.dialog-title') || {}).textContent || ''),
       '★ 空白新卡点「完成」→ 弹「这张卡还是空白」确认');
    const cancelEmpty = emptyDlg && emptyDlg.querySelector('.btn-cancel');
    if (cancelEmpty) cancelEmpty.click();
    await wait(40);
    eq(D.findDeck(deckId).cards.length, nBeforeEmpty, '★ 取消后不入库（不会静默多一张空卡）');
    ok(!!doc.querySelector('#lib-editor.is-active'), '★ 取消后仍留在编辑页');
    L.goDeck(deckId);
    await wait(20);

    L.goHome();
  }

  console.log('\n【16】跑完没有未捕获异常');
  ok(errors.length === 0, '没有 JS 报错', errors.join(' | '));

  /* ★ 2026-09-21：有几组断言必须等异步（落盘链 / IndexedDB 兜底）才有结果，
     它们挂在 pending 上。以前同步跑完就 process.exit，那些断言会被整组丢掉 ——
     看起来"全过"其实是根本没跑。这里统一等完再算总分。 */
  Promise.all(pending.map(function (p) { return p.catch(function (e) { ok(false, '异步走查抛错：' + e); }); }))
    .then(function () {
      if (errors.length) ok(false, '异步阶段有未捕获异常', errors.join(' | '));
      console.log('\n========================================');
      console.log(`  通过 ${pass} 条，失败 ${fail} 条`);
      console.log('========================================');
      process.exit(fail ? 1 : 0);
    });
})();
