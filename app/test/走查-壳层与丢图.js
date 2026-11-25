/* 猫卡 · 壳层与丢图走查（从「走查-卢恩牌组.js」里搬出来的通用护栏）
 *
 * 为什么单独成一个文件：2026-09-20 用户要求把内置「卢恩符文」连代码一起铲掉，
 * 那份 360 条的走查要跟着删——但里面**第 8/9/10 组跟卢恩无关**，是全项目的护栏：
 *   8. 用户自己的牌组不该被盖上符号（拿他真实导出的两份当回归）
 *   9. 壳层：WebView 不许吃缓存 + 不许碰用户数据
 *  10. 丢图那颗雷：图片库读不到时，一个引用都不许动
 * 删文件不能连它们一起删，所以先搬到这里，再删那份。
 *
 * 用法：node 走查-壳层与丢图.js [前端目录]   缺省 = 源码 www；给个解包目录就能验包内那份
 */
const fs = require('fs'), path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { ({ JSDOM } = require('/root/dsh-dom/node_modules/jsdom')); }

const ROOT = process.argv[2] || path.join(__dirname, '..', 'www');
let pass = 0, fail = 0; const fails = [];
function ok(cond, msg) { if (cond) { pass++; } else { fail++; fails.push(msg); } }
function group(name) { console.log('\n== ' + name); }

(async function () {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const FILES = ['js/idb.js', 'js/builtin-decks.js', 'js/random.js', 'js/data.js', 'js/ui.js', 'js/jszip.min.js', 'js/io.js', 'js/lot-shot.js',
    'js/cropper.min.js', 'js/imagecrop.js', 'js/scenes/table.js', 'js/scenes/library.js', 'js/scenes/editor.js',
    'js/scenes/settings.js', 'js/scenes/lots.js'];

  group('1. 回归：用户自己的牌组不该被盖上符号（用真实导出文件）');
  (function () {
    // ★ 用户报的 bug：占卜桌上"其他牌组"出现奇怪的符号。
    //   真凶：早期版本的"新建卡自动配一个没用过的符文"把符文盖到了**所有**牌组上 ——
    //   下面这两份就是用户导出的真实文件，每张卡都带着 assets/sym/sowilo.png。
    //   （卢恩牌组已下架，但这条护栏照旧：用户的数据里还有这些脏符号，导入/新建都必须清干净。）
    const fixDir = path.join(__dirname, 'fixtures');
    ['导出-崩铁牌组.json', '导出-精分牌组.json'].forEach(function (fn) {
      const man = JSON.parse(fs.readFileSync(path.join(fixDir, fn), 'utf8'));
      const raw = man.deck;
      const bad = raw.cards.filter(function (c) { return /sowilo/.test(String(c.symbolImg || '')); }).length;
      ok(bad === raw.cards.length && raw.cards.length > 0,
        fn + '：导出文件里 ' + raw.cards.length + ' 张卡**全是** sowilo（bug 现场就在这份数据里）');

      const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
      const w = dom.window;
      w.localStorage.setItem('moka.decks.v1', JSON.stringify([raw]));
      FILES.forEach(function (f) { w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n//# sourceURL=' + f); });
      const Dx = w.MoKa.data, Ux = w.MoKa.ui, Lx = w.MoKa.library, Ex = w.MoKa.editor;
      const d = Dx.listDecks().filter(function (x) { return x.name === raw.name; })[0];
      ok(d.cards.length === raw.cards.length, fn + '：牌还在（' + d.cards.length + ' 张）');
      const stillDirty = d.cards.filter(function (c) { return /sowilo/.test(String(c.symbolImg || '')); }).length;
      ok(stillDirty === 0, '★ ' + fn + '：加载后卡上**一张脏符号都不剩**（实为 ' + stillDirty + ' 张）');
      ok(d.cards.every(function (c) { return !c.symbolImg && !c.symbol; }),
        '★★ ' + fn + '：符号被彻底清掉（不凭空补一颗星）');
      const face = Ux.faceHTML(d.cards[0]);
      ok(face.indexOf('fc-emblem') < 0 && face.indexOf('fc-symbol') < 0,
        '★★ ' + fn + '：牌面上**什么都不画**（没有符文、也没有凭空一颗星）');
      ok(face.indexOf('8.2 16.5') < 0, '★ ' + fn + '：当然更没有索维鲁那个"闪电/S"');
      // 新建卡也不许再配符号
      const draft = Ex._buildDraft(d, null);
      ok(!draft.symbolImg && !draft.symbol, '★ ' + fn + '：在里面新建卡，不会再配任何符号（实为 ' + draft.symbolImg + '）');
    });

    // 纯函数也直接验一遍
    const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
    const w = dom.window;
    FILES.forEach(function (f) { w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')) });
    const D7 = w.MoKa.data;
    ok(D7._cleanFakeSymbols([{ name: '崩铁牌组', cards: [{ name: '开拓', symbol: '✦', symbolImg: 'assets/sym/sowilo.png' }] }]) === 1,
      '清理函数：真的动手改了 1 张');
    ok(D7._cleanFakeSymbols([{ name: '星语牌组', cards: [{ name: '启程', symbol: '✦', symbolImg: 'assets/sym/star4.svg' }] }]) === 0,
      '清理函数：星语这种本来就对的，不动');
    ok(D7._cleanFakeSymbols([{ name: 'Aegis牌组', cards: [{ name: '压抑', symbol: null, symbolImg: null }] }]) === 0,
      '清理函数：不带符号的内置牌组（Aegis）本来就没符号，无事发生');

    // ★★ 两条**导入路径**都必须清干净（用户第二次报的就是"追加到当前牌组"那条 —— 上一版漏了它）
    (function () {
      const man = JSON.parse(fs.readFileSync(path.join(fixDir, '导出-崩铁牌组.json'), 'utf8'));
      const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
      const w = dom.window;
      FILES.forEach(function (f) { w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')) });
      const Dx = w.MoKa.data, Ux = w.MoKa.ui;

      // A：导入为新牌组（importDeck）
      const made = Dx.importDeck(man.deck);
      const da = Dx.findDeck(made.id);
      ok(da.cards.length === man.deck.cards.length, 'A 导入为新牌组：张数对（' + da.cards.length + '）');
      ok(da.cards.every(function (c) { return !/sowilo/.test(String(c.symbolImg || '')); }),
        '★ A 导入为新牌组：卡上一张都不留脏符号');
      ok(da.cards.every(function (c) { return !c.symbolImg && !c.symbol; }),
        '★ A 导入为新牌组：导入进来的卡没有符号');

      // B：追加到当前牌组（appendCardsToDeck）—— 手机里"在牌组页导入"走的就是这条
      const target = Dx.listDecks()[0] || Dx.importDeck(Dx._defaultDeck());
      const before = target.cards.length;
      // ★ 判据用"原样快照对比"，不要写"不许有 sowilo" —— 卢恩那副的「太阳」本来就是 sowilo，
      //   按具体图形判会误伤（这条是搬过来时踩到的）。
      const beforeSnap = JSON.stringify(Dx.findDeck(target.id).cards.map(function (c) {
        return [c.name, c.symbol || null, c.symbolImg || null];
      }));
      Dx.appendCardsToDeck(target.id, man.deck.cards);
      const added = Dx.findDeck(target.id).cards.slice(before);
      ok(added.length === man.deck.cards.length, 'B 追加到当前牌组：追加了 ' + added.length + ' 张');
      ok(added.every(function (c) { return !/sowilo/.test(String(c.symbolImg || '')); }),
        '★★ B 追加到当前牌组：卡上也不许留脏符号（上一版就是漏了这条路径）');
      ok(added.every(function (c) { return !c.symbolImg && !c.symbol; }),
        '★ B 追加进来的卡也没有符号');
      ok(Ux.faceHTML(added[0]).indexOf('8.2 16.5') < 0, '★ B 牌面上不再画索维鲁那个"闪电/S"');
      ok(Dx.findDeck(target.id).cards.length === before + added.length,
        'B 目标牌组张数正确（' + Dx.findDeck(target.id).cards.length + '）');
      const afterSnap = JSON.stringify(Dx.findDeck(target.id).cards.slice(0, before).map(function (c) {
        return [c.name, c.symbol || null, c.symbolImg || null];
      }));
      ok(afterSnap === beforeSnap, '★★ B 目标牌组原有的卡逐张原样（名字/符号/图形一个字都没动）');

      // ★★ 渲染层的最后一道兜底：**没有身份的卡永远不会画出一个符号**
      const dirty = Dx.withCardStyle({ id: 'x1', name: '开拓', symbol: '✦',
        symbolImg: 'assets/sym/sowilo.png', color: '#5b7cfa' });
      const fDirty = Ux.faceHTML(dirty);
      ok(fDirty.indexOf('8.2 16.5') < 0, '★★ 脏数据：非身份卡的牌面上不画那个符文（渲染层兜底）');
      ok(fDirty.indexOf('fc-emblem') < 0 && fDirty.indexOf('fc-symbol') < 0,
        '★★ 牌面上**什么都不画**（既没有符文，也没有那颗凭空来的星）');
      // 星语那 12 张是真身份，照旧画
      const starCard = Dx.withCardStyle({ id: 'x2', name: '启程', symbol: '✦', symbolImg: 'assets/sym/star4.svg' });
      ok(Ux.faceHTML(starCard).indexOf('fc-emblem') > 0, '有身份的内置卡（星语）照常画它的符号（没被这道兜底误伤）');
      ok(Ux.symSVG(Ux.symForCard(dirty)) === '' && Ux.symSVG(Ux.symForCard(starCard)) !== '',
        'symForCard：非身份卡不给图形、身份卡给图形');
    })();
  })();

  group('2. 壳层：WebView 不许吃缓存（换了包必须跑到新 JS）+ 不许碰用户数据');
  (function () {
    // ★ 排查"装了新包还是有老毛病"时排到的第二条路：版本名/URL 都没变，
    //   WebView 完全可能继续用缓存里的旧 JS → 壳里必须显式关掉缓存。
    const java = fs.readFileSync(path.join(__dirname, '..', 'android', 'src', 'com', 'catcard', 'app', 'MainActivity.java'), 'utf8');
    ok(/setCacheMode\(WebSettings\.LOAD_NO_CACHE\)/.test(java), '★ 壳里关掉了 WebView 缓存（LOAD_NO_CACHE）');
    ok(!/web\.clearCache\s*\(/.test(java), '★★ 壳里**不许**调用 web.clearCache —— 用户的图就在 WebView 存储里，宁可不碰');
    ok(/LOAD_NO_CACHE/.test(java), '★ 只靠 LOAD_NO_CACHE：每次都去源头读，但不删任何东西');
    // 界面上要能看出构建号（不然"装的是哪一次"没法对齐）
    const setjs = fs.readFileSync(path.join(ROOT, 'js/scenes/settings.js'), 'utf8');
    // ★ 构建号是「装的是哪一次」的唯一指纹：这里钉死，换包忘了同步就红。
    //   （这条原来在 走查-卢恩牌组.js 里，2026-09-20 那份删掉后搬到这里，跟着构建号走。）
    ok(/const BUILD = '333'/.test(setjs), '设置页显示构建号 BUILD = 333');
    /* ★★ 2026-10-05 修「关键词太长时文字冲出底色 / 块向右偏」的真凶 —— 钉在壳层上：
       Android WebView 的 **Minimum font size 默认 8px**。牌义弹窗里那张牌只有 --card-w:66px，
       关键词字号算下来才 4.89px → 被强制抬到 8px（1.64 倍）→ 文字比盒子宽，nowrap 又不让折
       → 直接从盒子里漏出去。桌面 Chrome 的最小字号默认是 0，所以本地永远复现不出来。
       实测证据（诊断报告）：66px 的「离为火」关键词，行内 font-size 算出来 4.886px，
       getComputedStyle 实算 8px，文字实宽 65 > 内容宽 54。 */
    const mact = fs.readFileSync(path.join(__dirname, '..', 'android/src/com/catcard/app/MainActivity.java'), 'utf8');
    ok(/setMinimumFontSize\(\s*1\s*\)/.test(mact),
      '★★ WebView 最小字号设成 1px（默认 8px 会把小牌面的关键词抬大 → 冲出底色）');
    ok(/setTextZoom\(\s*100\s*\)/.test(mact),
      '★ WebView 不跟随系统字体缩放（版面才稳定）');
    /* ★ 2026-10-25：279 出包时这条正则漏改（settings.js 已是 2.2.7），走查红 1 条。
       它是"同步点"，换版本时**正则和文案都要改**，查构建号.py 只扫文案、扫不到正则。 */
    ok(/const VERSION = '2\.6\.10'/.test(setjs), '版本名 2.6.10（构建号只增不减）');
    ok(/<span>构建<\/span>/.test(setjs), '「关于」里真的有「构建」这一行');
    /* ★★ 2026-10-12（用户：「只写在项目记录里，似乎还不够」）：抽屉底部那处**写死的版本号**
       是典型漏网 —— index.html 里原本躺着「猫卡 2.1.0 · 239」，构建号滚到 241 它也不动
       （app.js 启动后会覆盖，可首帧、或 JS 出问题时，用户看到的就是那串过期数字）。
       两道保险：① index.html 里不许有任何版本号/构建号字面量；② 真值由 app.js 从常量灌。
       机器那份在构建门禁里（tools/门禁.py ②），这里是走查这一份 —— 两边都得咬住。 */
    const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    ok(!/猫卡\s*v?\d+\.\d+\.\d+/.test(idxHtml), '★★ index.html 里没有写死的版本号（显示一律读常量）');
    ok(!/\bv\d+\.\d+\.\d+\b/.test(idxHtml), '★★ index.html 里没有写死的 vX.Y.Z');
    ok(/id="drawer-ver"/.test(idxHtml), '★ 抽屉底部那个版本位还在（#drawer-ver）');
    const appJs = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    ok(/getElementById\('drawer-ver'\)/.test(appJs) && /settings\.VERSION/.test(appJs) && /settings\.BUILD/.test(appJs),
      '★★ #drawer-ver 由 app.js 从 MoKa.settings.VERSION / BUILD 灌（不在 HTML 里写死）');
  })();

  group('3. 丢图那颗雷：图片库读不到时，一个引用都不许动（用户报"经常丢图"）');
  await (async function () {
    // ★ 现场：IndexedDB 这一趟没打开成功（冷启动打开大库超时 / 被旧连接挡住），
    //   原来 hydrateImages 会把每个 idb: 引用当成"图没了"→ 置 null → 下次落盘就写死。
    //   图其实还在库里，引用却没了 —— 这就是"图会莫名消失"的元凶。
    const mkSeed = function () {
      return [{
        id: 'd1', name: '我的牌组', backImage: 'idb:img-back', backColor: '#8a7a3a', backTemplate: null,
        cards: [
          { id: 'c1', name: '卡一', image: 'idb:img-1', color: '#5b7cfa' },
          { id: 'c2', name: '卡二', image: 'idb:img-2', color: '#8a5cf6', imageHi: 'idb:img-hi' }
        ]
      }];
    };
    const boot = function (withFakeIdb) {
      const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
      const w = dom.window;
      if (!withFakeIdb) { try { w.indexedDB = undefined; } catch (e) {} }
      w.localStorage.setItem('moka.decks.v1', JSON.stringify(mkSeed()));
      FILES.forEach(function (f) { w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')) });
      return w;
    };

    // A：库打不开 → 引用必须原样保留，落盘也不能写死
    const wA = boot(false);
    const DA = wA.MoKa.data;
    await DA.initImages();
    const dA = DA.listDecks()[0];
    ok(dA.cards[0].image === 'idb:img-1' && dA.cards[1].image === 'idb:img-2' && dA.backImage === 'idb:img-back',
      '★★ 图片库没打开成功 → 三个 idb: 引用一个都没被动过',
      '实际 ' + JSON.stringify([dA.cards[0].image, dA.cards[1].image, dA.backImage]));
    DA.renameDeck('d1', '改个名触发落盘');
    await DA.flushPersist();
    const saved = JSON.parse(wA.localStorage.getItem('moka.decks.v1'));
    ok(saved[0].cards[0].image === 'idb:img-1',
      '★★ 落盘之后 localStorage 里还是 idb: 标记（没有把图写死成 null）',
      '实际 ' + JSON.stringify(saved[0].cards[0].image));

    // B：库可用、图也在 → 正常取回来
    const wB = boot(true);
    const DB = wB.MoKa.data;
    const mem = { 'img-1': 'data:image/jpeg;base64,AAA', 'img-2': 'data:image/jpeg;base64,BBB',
                  'img-back': 'data:image/jpeg;base64,CCC', 'img-hi': 'data:image/jpeg;base64,DDD' };
    wB.MoKa.images.ensure = function () { return Promise.resolve(true); };
    wB.MoKa.images.all = function () { return Promise.resolve(Object.assign({}, mem)); };
    wB.indexedDB = {};
    await DB.initImages();
    const dB = DB.listDecks()[0];
    ok(dB.cards[0].image === mem['img-1'] && dB.backImage === mem['img-back'],
      '库可用时照旧取回图片（没把正常路径改坏）');

    // C：库可用、但某张真的没了 → 仍按老规矩：从 .bak 逐字段恢复，恢复不了才置空
    const wC = boot(true);
    const DC = wC.MoKa.data;
    const inline = mkSeed();
    inline[0].cards[0].image = 'data:image/jpeg;base64,RRR';
    wC.localStorage.setItem('moka.decks.v1.bak', JSON.stringify(inline));
    wC.MoKa.images.ensure = function () { return Promise.resolve(true); };
    wC.MoKa.images.all = function () { return Promise.resolve({}); };
    await DC.initImages();
    const dC = DC.listDecks()[0];
    ok(dC.cards[0].image === 'data:image/jpeg;base64,RRR', '★ 库读到了但那张缺了 → 从 .bak 内嵌备份恢复');
    ok(dC.cards[1].image === null, '★ 备份里也没有的那张 → 才置空（"确实没了"才认）');

    // D：孤儿清理必须把 imageHi 也算引用（原来每次落盘都会把高清图删掉）
    //   ★ 2026-09-21：引用表的写法换成了统一的 note(c.image)/note(c.imageHi)（一套码管
    //   `idb:` 和 `ls:` 两种标记 —— 见 data.js 里 persist 的"保险3"），所以这里认两种写法。
    const src = fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8');
    ok(/note\(c\.imageHi\)|refs\[c\.imageHi\]/.test(src), '★★ 清孤儿时的引用表里有 imageHi');
  })();

  /* ============================================================
     11. ★ 导入导出：卡片的"外观字段"必须原样往返（2026-09-27）
     ------------------------------------------------------------
     起因：这一版加了内嵌字体（nameFont/kwFont）和「底色→样式」（nameBgStyle/kwBgStyle），
     用户问「卡牌的导入导出功能要不要同步更新」。
     查下来**代码不用改**：导出把整张卡 JSON 原样搬（只把 image 挪进 images/），
     导入走 data.js 的 withCardStyle —— 而它的取值来源就是 cardStyleDefaults() 的键表，
     新字段天然在列。但这种事不能靠读代码下结论：这里把两条导出路径 + 两条导入路径
     都真跑一遍，钉住"换台手机/换个人，外观不会静默回退"。
     ============================================================ */
  group('11. 导入导出：字体 / 样式字段原样往返');
  await (async function () {
    const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
    const w = dom.window;
    FILES.forEach(function (f) { w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n//# sourceURL=' + f); });
    const D = w.MoKa.data, IO = w.MoKa.io;

    const LOOK = { nameFont: 'kai', kwFont: 'song', nameBgStyle: 'deboss', kwBgStyle: 'neon',
                   nameVy: 10, kwVy: 92, nameFs: 78, kwFs: 60, nameWeight: 400, kwWeight: 600 };
    const dk = D.createDeck('往返-样式');
    D.addCard(dk.id, { name: '甲', keyword: '一', meaning: 'm1', color: '#333' });
    D.addCard(dk.id, { name: '乙', keyword: '二', meaning: 'm2', color: '#555' });
    D.applyStyleToDeck(dk.id, Object.assign(D.withCardStyle({}), LOOK));
    const src = D.findDeck(dk.id);
    Object.keys(LOOK).forEach(k =>
      ok(src.cards.every(function (c) { return c[k] === LOOK[k]; }), '起点：整副都带上了 ' + k + '=' + LOOK[k]));

    // ① ZIP 那条：manifest（导出）→ hydrate（解包）→ importDeck（导入）
    const man = IO.buildZipManifest_(src, function () {});
    const kept = Object.keys(LOOK).filter(k => man.deck.cards.every(function (c) { return c[k] === LOOK[k]; }));
    ok(kept.length === Object.keys(LOOK).length,
      '★★ ZIP 导出：manifest 里外观字段一个不少（缺 ' + Object.keys(LOOK).filter(k => kept.indexOf(k) < 0).join(',') + '）');
    const back = await IO.hydrateManifest_(man, async function () { return null; });
    const d2 = D.importDeck(back.decks[0]);
    Object.keys(LOOK).forEach(k =>
      ok(D.findDeck(d2.id).cards.every(function (c) { return c[k] === LOOK[k]; }),
        '★★ ZIP 往返后 ' + k + ' 还是 ' + LOOK[k] + '（换台手机外观不回退）'));

    // ② 追加那条（手机里"在牌组页导入"走的就是 appendCardsToDeck）
    const target = D.listDecks()[0] || D.importDeck(D._defaultDeck());
    const before = D.findDeck(target.id).cards.length;
    D.appendCardsToDeck(target.id, back.decks[0].cards);
    const added = D.findDeck(target.id).cards.slice(before);
    ok(added.length === 2 && Object.keys(LOOK).every(k => added.every(function (c) { return c[k] === LOOK[k]; })),
      '★★ 追加导入：外观字段也跟着来（走的是 appendCardsToDeck）');

    // ③ 老包（没有这些字段）→ 按默认值补齐，不许是 undefined
    const oldMan = { kind: 'moka-deck-v1', deck: { name: '老包', cards: [{ name: '丙', keyword: '三', meaning: 'm' }] } };
    const oldBack = await IO.hydrateManifest_(oldMan, async function () { return null; });
    const oldMade = D.importDeck(oldBack.decks[0]);
    const oc = D.findDeck(oldMade.id).cards[0];
    ok(oc.nameFont === 'sys' && oc.nameBgStyle === 'soft' && oc.kwFont === 'sys' && oc.kwBgStyle === 'soft',
      '★★ 老包（没有外观字段）：按默认值补齐，不是 undefined');
  })();

  /* ============================================================
     12. ★ 牌面圆角：设置页那个新开关（2026-09-27）
     ------------------------------------------------------------
     用户：「在底部栏那个设置界里面再丢个新功能 调牌面圆角-直角」。
     实现是**一个变量管全部**：:root 的 --card-r，牌面外壳 + 两张纸边都读它。
     这里钉住三件事，任何一件断了这个开关就是死的：
       ① v3.css 的牌面圆角真的读 var(--card-r)（没有再写死 9px）
       ② 设置页真有那个区块（stepper / 滑条 / 恢复默认 三个控件都在）
       ③ 冷启动真的应用（app.js 调 settings.init → init 里带上 applyCardR）
     ============================================================ */
  group('12. 牌面圆角：设置页可调、0 = 直角');
  (function () {
    const css = fs.readFileSync(path.join(ROOT, 'css/v3.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const set = fs.readFileSync(path.join(ROOT, 'js/scenes/settings.js'), 'utf8');
    const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');

    const shell = /\.tcard-side\s*\{([^}]*)\}/.exec(css);
    ok(!!shell && /border-radius:\s*var\(--card-r/.test(shell[1]),
      '★★ 牌面外壳的圆角读 var(--card-r)（写死 9px 的话设置页就是个死开关）');
    // 默认值可以是 8/9…，别写死（改默认真空过一次）；关键是"两张纸边都跟着变量减 1px"
    const edges = (css.match(/border-radius:\s*calc\(var\(--card-r,\s*\d+px\)\s*-\s*1px\)/g) || []).length;
    ok(edges === 2, '★★ 牌背 + 牌面两张纸边都跟着走（各减 1px 贴在描边里侧）—— 现在 ' + edges + ' 处');

    ['id="cr-val"', 'id="cr-range"', 'id="cr-reset"', "R_KEY = 'moka.cardRadius'",
     '牌面圆角'].forEach(k =>
      ok(set.indexOf(k) >= 0, '★ 设置页里有 ' + k));
    ok(/init: function \(\) \{ applyCardW\(getCardW\(\)\); applyCardR\(getCardR\(\)\); \}/.test(set),
      '★★ 冷启动就应用（settings.init 里带上 applyCardR）');
    ok(/settings\.init\(\)/.test(app), '★ app.js 启动时确实调 settings.init()');

    // 真跑一遍：clamp / 应用 / 落盘
    const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
    const w = dom.window;
    FILES.forEach(function (f) { w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n//# sourceURL=' + f); });
    const S = w.MoKa.settings;
    ok(S._clampR(-5) === 0 && S._clampR(99) === 20 && S._clampR('abc') === S.R_DEFAULT && S._clampR(3.6) === 4,
      '★★ 圆角取值被夹在 0–20 且取整（-5→0、99→20、abc→默认、3.6→4）');
    ok(S.R_DEFAULT === 8 && /var\(--card-r,\s*8px\)/.test(css),
      '★★ 默认 8px 且和 v3.css 的兜底值一致（用户实机试出来的：8 最好）—— 实际 ' + S.R_DEFAULT);
    ok(S._applyCardR(0) === 0 && w.document.documentElement.style.getPropertyValue('--card-r') === '0px',
      '★★ 设成 0 时 :root 上真的是 0px（直角）');
    S._setCardR(0);
    ok(w.localStorage.getItem('moka.cardRadius') === '0', '★★ 选择落盘（下次进来还是直角）');
    S._applyCardR(9);
    S.init();
    ok(w.document.documentElement.style.getPropertyValue('--card-r') === '0px',
      '★★ init() 会把存下来的 0 应用回去（冷启动不回弹成 9）');
  })();

  /* ★ 2026-10-19（构建 263）：用户报「先渲染上半屏、下半屏等一会才出来」。
     病因是脚本没跑完浏览器就抢画首帧、剩下的光栅 tile 后补（见 渲染首帧-排查思路与修法.md）。
     治法 = html.booting + opacity:0（透明但照常绘制）+ bootReveal 放行。这里把关键点钉住 ——
     这几处任何一个被"优化"掉，毛病就悄悄回来了。 */
  group('13. 首屏守卫（上半先出、下半晚出）');
  (function () {
    const rawHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const appjs = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    const v3 = fs.readFileSync(path.join(ROOT, 'css/v3.css'), 'utf8');
    ok(/<html[^>]*class="booting"/.test(rawHtml), '★★ <html> 带着 class="booting"（守卫的起点，丢了就不生效）');
    ok(/html\.booting\s+body\s*\{[^}]*opacity\s*:\s*0/.test(v3),
      '★★ 守卫用 opacity:0 —— 元素照常绘制/光栅化，放行零重绘');
    ok(!/html\.booting\s+body\s*\{[^}]*visibility\s*:\s*hidden/.test(v3),
      '★★ 不许用 visibility:hidden 冒充守卫（放行时要重新产生绘制指令，等于没治）');
    ok(/function\s+bootReveal\s*\(/.test(appjs), '★ app.js 里有 bootReveal()');
    ok(/gotoScene\('table'\)[\s\S]{0,300}bootReveal\s*\(\s*\)/.test(appjs),
      '★★ bootReveal() 在 init 末尾调用（init 跑完、DOM 是最终形态才放行）');
    ok(/__bootArmed/.test(rawHtml) && /__bootArmed/.test(appjs),
      '★★ 2s 硬兜底与 init 用 __bootArmed 对齐（否则慢设备会被兜底提前放行成半成品）');
    ok(/setTimeout\(\s*unboot\s*,\s*8000\s*\)/.test(rawHtml),
      '★★ 8s 总兜底在（init 挂起时唯一的出口 —— 没有它就永远白屏，2026-10-19 自查发现）');
    ok(/function\s+prewarmStrip/.test(appjs), '★ 牌堆栏背景图预热在（下半屏那几张牌背图）');
  })();

  console.log('\n----------------------------------------');
  if (fail) { console.log('失败 ' + fail + ' 条 / 共 ' + (pass + fail) + ' 条'); fails.forEach(f => console.log('  ✗ ' + f)); process.exitCode = 1; }
  else console.log('全部通过 ✔  ' + pass + ' 条');
})();
