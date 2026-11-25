#!/usr/bin/env node
/* 验证件 · 外置资源型牌面图（存储层迭代 2026-10-08）
   ------------------------------------------------------------------
   跑法：  node app/test/验证-外置资源图.js "" <deckKey>              # 源码 www/
           node app/test/验证-外置资源图.js /tmp/pkg/assets <deckKey>  # 解包后的包内那份

   它验的是**一条数据通路**：牌面图不再是内嵌 data URL，而是
   `assets/deckimg/<key>/<n>.<ext>` 相对资源路径。这条通路上有 4 个环节，
   每一环单独坏掉都不会报错、只会"牌面空白"，所以必须逐环钉住：

     ① 注册表      —— image 是**短路径**、不是 base64（不内嵌才不撑注册表）
     ② 磁盘        —— 路径真实存在，且**逐字节等于源图**（零重编码 = 不掉清晰度）
     ③ 渲染        —— UI.faceHTML 吐出来的就是这条相对路径（背景图 / <img> 两种形态都认）
     ④ 落盘 / 导出 —— 路径原样保留（被写成 null = 重启后白牌；导出丢图 = 备份废掉）

   本件只认"路径 + 文件"，**不认哪副牌**：张数、图名、牌背形态全部跟着注册表走。
   （★ 2026-10-12：雷诺曼那副的专属遗留 —— 写死的「38 张」和「外置牌背 _back.png」
     两条断言 —— 已清掉。牌背是不是外置图不由本件管：矢量牌背走 back.svg，
     外置牌背在 back.svg 里写 <image href>，两条都不影响牌面图这条通路。）
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
/* 和另几套走查同一条兜底路径（这台机器上 jsdom 不在 app/ 下） */
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { ({ JSDOM } = require('/root/dsh-dom/node_modules/jsdom')); }

const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'www');
const APP = path.join(__dirname, '..');
/* 用法：node 验证-外置资源图.js [assets目录] <deckKey>
   不传 deckKey 直接退出 —— 本件验的是通路，没有对象就无从下手。 */
const KEY = process.argv[3];
if (!KEY) {
  console.log('用法：node 验证-外置资源图.js [assets目录] <deckKey>');
  console.log('（每副走外置资源的牌组传自己的 key，例："" hero 或 /tmp/pkg/assets hero）');
  process.exit(2);
}
const PREFIX = 'assets/deckimg/';
const pkgMode = !!process.argv[2];

let pass = 0, fail = 0; const fails = [];
function ok(c, m) { if (c) { pass++; } else { fail++; fails.push(m); } }
function sha256(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

const FILES = ['js/idb.js', 'js/builtin-decks.js', 'js/random.js', 'js/data.js', 'js/ui.js', 'js/jszip.min.js', 'js/io.js',
  'js/cropper.min.js', 'js/imagecrop.js', 'js/scenes/table.js', 'js/scenes/library.js',
  'js/scenes/settings.js', 'js/scenes/lots.js'];
function boot(storage) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  if (storage) Object.keys(storage).forEach(k => w.localStorage.setItem(k, storage[k]));
  FILES.forEach(f => { w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n//# sourceURL=' + f); });
  return w;
}

(async function () {
  console.log('验证对象：' + ROOT + (pkgMode ? '  （包内 assets）' : '  （源码 www/）'));
  const w = boot();
  const D = w.MoKa.data, UI = w.MoKa.ui, IO = w.MoKa.io, B = w.MoKaBuiltinDecks;

  /* ---- ① 注册表：路径而非 base64 ---- */
  const reg = B.filter(e => e.key === KEY)[0];
  /* ★ 牌组不在注册表里（已删除 / 已下架）→ 跳过，而不是变红灯。
     判据只看注册表、不猜原因 —— 和工具 dry-run 里「删完走查会红」那一段是同一件事的两面。 */
  if (!reg) {
    console.log('\n↳ 跳过：「' + KEY + '」不在注册表里（牌组已删除或已下架）—— 本件针对它，没有对象可验。');
    console.log('  要恢复：把备份放回 decks/' + KEY + '/ 与 www/assets/deckimg/' + KEY + '/ →');
    console.log('         python3 tools/内置牌组.py 生成 → 再跑本件。');
    process.exit(0);
  }
  const N = reg.cards.length;
  ok(N > 0, '① 注册表里有「' + KEY + '」，张数 = ' + N + '（跟着注册表走，不写死）');
  ok(reg.cards.every(c => typeof c.image === 'string' && c.image.indexOf(PREFIX) === 0),
    '① 每张卡的 image 都是 `' + PREFIX + '…` 相对路径');
  ok(reg.cards.every(c => String(c.image).indexOf('data:') !== 0),
    '★★ 注册表里**一个 data URL 都没有**（有 = 又开始内嵌 base64）');
  const regChars = reg.cards.reduce((n, c) => n + String(c.image).length, 0);
  ok(regChars < 3000, '★★ ' + N + ' 条路径合计 ' + regChars + ' 字符（内嵌 base64 的话是百万级）');

  /* ---- ② 磁盘：存在 + 逐字节等于源图 ---- */
  const files = reg.cards.map(c => path.join(ROOT, c.image));
  const miss = files.filter(p => !fs.existsSync(p));
  ok(miss.length === 0, '② 路径全部真实存在（缺 ' + miss.length + ' 张）');
  /* 体积按**去重后的文件**算：几卡共用一张图时只落一份，
     按 16 条卡路径累加会把体积报成 16 倍（Overflow 那张就这么虚报过）。 */
  const uniqFiles = [...new Set(files)];
  let bytes = 0, same = 0, checked = 0;
  uniqFiles.forEach(p => {
    if (!fs.existsSync(p)) return;
    bytes += fs.statSync(p).size;
    /* ★ 包内模式没有 decks/<key>/faces/（源图不进包）→ 只验"文件在"，
       逐字节那条留给源码模式 —— 拿不到源图就报红是假红。 */
    if (pkgMode) return;
    const src = path.join(APP, 'decks', KEY, 'faces', path.basename(p));
    checked++;
    if (fs.existsSync(src) && sha256(p) === sha256(src)) same++;
  });
  if (pkgMode) {
    console.log('   · 包内模式：跳过"逐字节等于源图"（源图不在包里）—— 那一条在源码模式跑');
  } else {
    ok(same === checked,
      '★★ ' + N + ' 张卡的图**逐字节等于源图**（' + checked + ' 个文件全中 —— '
      + (checked < N ? '有共用，' : '') + '零重编码 = 清晰度零损失）');
  }
  console.log('   图片实体 ' + (bytes / 1048576).toFixed(2) + ' MB（' + uniqFiles.length + ' 个文件 / '
    + N + ' 张卡）／ 注册表占 ' + regChars + ' 字符  →  体积比 ' + Math.round(bytes / regChars) + ':1');

  /* ---- ③ 渲染：吐出来的就是这条相对路径 ---- */
  const d0 = (D.listDecks() || []).filter(d => d.name === reg.name)[0];
  ok(!!d0, '③ 新装机 seed 了「' + reg.name + '」');
  if (d0) {
    ok(d0.cards.length === N, '③ 牌组 ' + N + ' 张（实际 ' + d0.cards.length + '）');
    /* 牌面图有两种渲染形态：`<img src>`（牌面底图，英雄之旅/Overflow 这种）
       和 `background-image:url(...)`（整面插画）。两种都只认"路径出现在 HTML 里"。 */
    const imgPath = d0.cards[0].image;
    const html = String(UI.faceHTML(d0.cards[0]));
    ok(html.indexOf(imgPath) > 0,
      '★★ faceHTML 里就是这条相对路径（' + (html.indexOf("background-image:url('") > 0 ? '背景图' : 'img 标签') + '）');
    const last = String(UI.faceHTML(d0.cards[d0.cards.length - 1]));
    ok(html.indexOf('data:image') < 0 && last.indexOf('data:image') < 0,
      '★★ 渲染出来的牌面 HTML 里没有内联 base64');
  }

  /* ---- ④ 落盘：路径原样保留、零占用 ---- */
  const built = await D._buildMeta();
  const md = (built && built.meta || []).filter(d => d.name === reg.name)[0];
  ok(!!md && md.cards.length === N, '④ 落盘副本里有这副牌（' + N + ' 张）');
  ok(!!md && md.cards.every(c => typeof c.image === 'string' && c.image.indexOf(PREFIX) === 0),
    '★★ 落盘后 image **原样是路径**（被写成 null = 下次开机白牌）');
  ok(built && built.unresolvedImgs === 0, '④ 没有"存不下"的图（unresolvedImgs=' + (built && built.unresolvedImgs) + '）');
  ok(md.cards.every(c => String(c.image).indexOf('data:') !== 0),
    '④ 外置图不进 BUNDLED_IMGS 那条链（它不是 data:，本来就不该走"落盘写 null"）');
  /* 判据要落在"图有没有进来"，不是"整库多大" —— 整库那几百 KB 是**牌组文案**
     （aegis 那副 85 KB 的牌义 JSON 之类），跟图无关。真正会顶配额的只有内联 base64，直接找它。 */
  let lsUse = 0, inline = 0;
  for (let i = 0; i < w.localStorage.length; i++) {
    const k = w.localStorage.key(i) || '', v = w.localStorage.getItem(k) || '';
    lsUse += k.length + v.length;
    if (/data:image\/[a-z]+;base64,[A-Za-z0-9+/]{5000,}/.test(v)) inline++;
  }
  ok(inline === 0, '★★ localStorage 里没有任何内联图片 base64（有 = 内置图又开始落盘顶配额）');
  ok(lsUse < 500000, '· localStorage 整库 ' + Math.round(lsUse / 1024) + ' KB —— 这是牌组文案，不是图');
  ok((D._imgLsKeys ? D._imgLsKeys() : []).length === 0,
    '★★ 图片兜底库一条都不许有（外置图根本不进这条链）');

  /* ---- ⑤ 导出 / 导入往返：路径原样过去、原样回来 ---- */
  const zip = new w.JSZip();
  const put = IO.makeZipPut_(zip);
  const man = IO.buildZipManifest_(d0, put);
  ok(man.deck.cards.length === N, '⑤ manifest 里 ' + N + ' 张卡');
  ok(man.deck.cards.every(c => c.imagePath && c.imagePath.indexOf(PREFIX) === 0),
    '★★ 导出：' + N + ' 张的 imagePath 原样是相对路径（不是 null = 没丢图）');
  ok(man.images && Object.keys(man.images).length === 0,
    '★★ 导出：images/ 里 0 个文件（随包的图不塞第二份进 zip）');
  const backDeck = await IO.hydrateManifest_(man, async function (p) {
    return (p && p.indexOf(PREFIX) === 0) ? p : null;    // 复刻 hydrateZip 里那条外置分支
  });
  const c0 = backDeck.decks[0].cards[0];
  ok(c0.image === d0.cards[0].image, '★★ 导入：原样还原成 ' + c0.image);

  report();

  function report() {
    console.log('\n' + '-'.repeat(56));
    if (fail === 0) console.log('全部通过 ✔  ' + pass + ' 条');
    else {
      console.log('失败 ' + fail + ' 条 / 共 ' + (pass + fail) + ' 条');
      fails.forEach(m => console.log('  ✗ ' + m));
    }
    process.exit(fail ? 1 : 0);
  }
})();
