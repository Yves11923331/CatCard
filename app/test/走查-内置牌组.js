/* 猫卡 · 内置牌组走查：钉住"内容写在 app/decks/*.json、代码只读注册表"这条流程
 *
 * 用法：
 *   node 走查-内置牌组.js                 # 源码 + decks/*.json（全套）
 *   node 走查-内置牌组.js /tmp/pkg/assets # 只验包内那份（没有 decks/，跳过对照那两组）
 *
 * 这一套不测界面：它测的是**工作流程本身**。
 * 最容易被绕过的一环：改了 app/decks/*.json 却忘了跑
 *   python3 app/tools/内置牌组.py 生成
 * → 盘上的注册表还是旧的，App 里看到的内容和 JSON 对不上。第 2 组就是防这个。
 */
const fs = require('fs'), path = require('path'), cp = require('child_process');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { ({ JSDOM } = require('/root/dsh-dom/node_modules/jsdom')); }

const ROOT = process.argv[2] || path.join(__dirname, '..', 'www');
const APP = path.join(__dirname, '..');
const DECKS = path.join(APP, 'decks');
const TOOL = path.join(APP, 'tools', '内置牌组.py');
const pkgMode = !!process.argv[2];          // 给了目录 = 在验解包后的 assets

let pass = 0, fail = 0, skip = 0; const fails = [];
function ok(cond, msg) { if (cond) { pass++; } else { fail++; fails.push(msg); } }
function group(name) { console.log('\n== ' + name); }
function note(msg) { skip++; console.log('  ↳ 跳过：' + msg); }

/* 起一个装了 www/ 的 jsdom（和另两套走查同一套路：手动 eval，文件列表写死） */
const FILES = ['js/idb.js', 'js/builtin-decks.js', 'js/random.js', 'js/data.js', 'js/ui.js', 'js/jszip.min.js', 'js/io.js',
  'js/cropper.min.js', 'js/imagecrop.js', 'js/scenes/table.js', 'js/scenes/library.js', 'js/scenes/editor.js',
  'js/scenes/settings.js', 'js/scenes/lots.js'];
function boot(storage) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  if (storage) Object.keys(storage).forEach(k => w.localStorage.setItem(k, storage[k]));
  FILES.forEach(f => { w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n//# sourceURL=' + f); });
  return w;
}

/* decks/*.json → 和注册表同构的那份（生成器就是这么投影的） */
function project(d) {
  const out = {
    key: d.key, name: d.name, oldNames: d.oldNames || [], order: d.order,
    onTable: !!d.onTable, addIfMissing: !!d.addIfMissing, symbols: d.symbols,
    back: { template: (d.back || {}).template === undefined ? null : (d.back || {}).template,
            color: (d.back || {}).color || '' },
    cards: (d.cards || []).map(c => ({
      name: c.name, keyword: c.keyword,
      symbol: c.symbol === undefined ? null : c.symbol,
      sym: c.sym === undefined ? null : c.sym,
      faceText: c.faceText, meaning: c.meaning, color: c.color,
      // ★ 牌面图（英雄之旅那副）：漏了这一行 → "改了 decks/*.json 里的图却忘了跑生成"
      //   第 2 组那条守卫就抓不到（注册表和 JSON 的图会静默分叉）
      image: c.image === undefined ? null : c.image
    }))
  };
  // ★ 2026-11-17：牌组级纸边（backEdge / faceEdge）。生成器**只在 deck.json 写了才生成**
  //   → 这里也只在那时才带这个键（否则 JSON.stringify 两边分叉，明明一致却红）。
  ['backEdge', 'faceEdge'].forEach(function (k) {
    if (typeof d[k] === 'boolean') out[k] = d[k];
  });
  return out;
}

(async function () {
  /* ============================================================
     1. 注册表自身的形状
     ============================================================ */
  group('1. 注册表（js/builtin-decks.js）的形状');
  const w = boot();
  const D = w.MoKa.data, UI = w.MoKa.ui;
  const B = w.MoKaBuiltinDecks;
  ok(Array.isArray(B) && B.length > 0, 'window.MoKaBuiltinDecks 是数组且非空');
  ok(!!D && !!UI, '数据层/界面层已装载');

  const keys = B.map(e => e.key), names = B.map(e => e.name);
  ok(new Set(keys).size === keys.length, 'key 不重复：' + keys.join(','));
  ok(new Set(names).size === names.length, 'name 不重复：' + names.join(','));
  ok(B.every(e => typeof e.key === 'string' && e.key && typeof e.name === 'string' && e.name), '每副都有 key 与 name');
  ok(B.every(e => Number.isInteger(e.order)), '每副都有整数 order');
  const orders = B.map(e => e.order);
  ok(orders.every((v, i) => i === 0 || orders[i - 1] < v), '注册表顺序 = order 升序（' + orders.join(' < ') + '）');
  ok(B.every(e => typeof e.onTable === 'boolean' && typeof e.addIfMissing === 'boolean'
      && typeof e.seed === 'boolean'),
    '每副都写明 onTable / addIfMissing / seed（布尔）');
  const starE = B.find(e => e.key === 'star');
  ok(starE.seed === false, '★ 星语牌组 seed=false：新装机不再建它（用户 2026-09-20 说它是试用的）');
  ok(B.filter(e => e.key !== 'star').every(e => e.seed === true), '其余内置牌组新装机都建');
  ok(B.every(e => Array.isArray(e.cards) && e.cards.length > 0), '每副都有卡');
  ok(B.filter(e => e.symbols === 'none').every(e => e.cards.every(c => !c.sym)),
    'symbols=none 的牌组不带 sym');

  // 每张卡：字段齐全 + 白名单 + symbolImg 画得出来
  const palette = D.pickPalette();
  let badField = [], badColor = [], badSym = [], badPath = [], badSvg = [], badDup = [];
  const allNames = {};
  B.forEach(e => {
   const sameDeck = {};                       // 同一副牌内的重名（任何牌组都要查）
   return e.cards.forEach(c => {
    // faceText 允许为空（牌面句跟正文重复 = 阻碍认知 → 删掉，见 3c3 组）
    /* ★ 2026-09-28：keyword 允许**整副为空**（用户："我没有加关键词，就是我觉得不要了"）——
       但"一半有一半没有"仍然算漏填（生成器那边也是同一条规矩，两边要对齐）。 */
    ['name', 'meaning'].forEach(f => { if (!c[f]) badField.push(e.key + '/' + (c.name || '?') + '.' + f); });
    if (typeof c.keyword !== 'string') badField.push(e.key + '/' + (c.name || '?') + '.keyword');
    if (!Number.isInteger(c.color) || c.color < 0 || c.color >= palette.length) badColor.push(e.name + '/' + c.name);
    if (c.sym) {
      const path1 = 'assets/sym/' + c.sym + '.svg';
      if (!/^assets\/sym\/[a-z0-9_\-]+\.svg$/.test(path1)) badPath.push(path1);
      if (!String(UI.symSVG(path1) || '').trim()) badSvg.push(e.name + '/' + c.name + ' → ' + path1);
    }
    /* ★ 2026-10-05 用户：「卡名**可以**跨牌组重复，只要技术方面不会有问题」——
       技术上真正怕撞车的只有 data.js 里那两张"按名字认符号"的表：
         BUILTIN_BY_NAME（symbols:star 且有 sym）。
       symbols:'none' 的牌组（现在只剩 Aegis）根本不进那两张表 → 它们的卡名可以随便撞。
       所以这里只管两件事：① 同一副牌内不许重名（任何牌组都要）；② 进符号表的卡跨牌组不许撞。 */
    const inSymTable = e.symbols === 'star' && !!c.sym;
    if (sameDeck[c.name]) badDup.push(e.name + '/' + c.name);
    sameDeck[c.name] = 1;
    if (inSymTable) {
      if (allNames[c.name]) badSym.push('卡名「' + c.name + '」在 ' + allNames[c.name] + ' 与 ' + e.name + ' 都出现');
      allNames[c.name] = e.name;
    }
   });
  });
  ok(badField.length === 0, '每张卡的 name/meaning 都不空、keyword 都是字符串（2026-10-05 起允许只有一部分卡有关键词：长牌名切一半当关键词）' + (badField.length ? '：' + badField.slice(0, 3) : ''));
  ok(badColor.length === 0, '每张卡的 color 都落在调色板里' + (badColor.length ? '：' + badColor.slice(0, 3) : ''));
  ok(badPath.length === 0, 'symbolImg 路径一律是 assets/sym/<id>.svg（不带图、不落文件）');
  ok(badSvg.length === 0, '每个符号 UI.symSVG 都画得出来（' + (badSvg[0] || '全过') + '）');
  ok(badDup.length === 0, '同一副牌里没有重名' + (badDup.length ? '：' + badDup.slice(0, 3) : ''));
  ok(badSym.length === 0, '★ 进"符号表"的卡跨牌组不重名（其余牌组的卡名可以重复 —— 2026-10-05 放宽）' + (badSym.length ? '：' + badSym.slice(0, 2) : ''));
  ok(!fs.existsSync(path.join(ROOT, 'assets', 'sym')), '包里没有 assets/sym 目录（符号是代码里的矢量，不是文件）');

  // 具体的期望（2026-09-20：卢恩符文已连代码一起下架，只剩星语 / Aegis）
  const star = B.find(e => e.key === 'star');
  ok(!!star, '内置有 star（星语牌组）');
  const psy2 = (list, k) => list.find(e => e.key === k);
  const armor = B.find(e => e.key === 'aegis');
  /* ★ 2026-10-24：Aegis 已下架（合并进 Love & Armour）。下面凡是验「出厂样式」的段落，改看合并副 lovearmour 的注册表条目。 */
  const LAE = B.find(e => e.key === 'lovearmour');
  /* ---- Aegis牌组：内置进包（decks/不打包.txt 里没有它）----
     兜底：万一它不在注册表里（被下架），就跳过这一组，不报红。 */
  if (!armor) {
    note('Aegis牌组不在注册表里（被下架？）→ 它那一组断言跳过');
  } else {
  ok(armor.cards.length === 35, '★ Aegis牌组（防御机制母类 19 + 社会赞许性 2 + 荣格原型 8 + 艾森克 6）35 张');
  ok(armor.symbols === 'none' && armor.cards.every(c => !c.sym && !c.symbol), '★ Aegis不带符号');
    ok(armor.back.template === 'aegis' && armor.back.color === '#4f5d6b', 'Aegis牌背：内置「盾环」+ 铁青 #4f5d6b');
  ok(armor.onTable === true && armor.addIfMissing === true && armor.seed === true,
    'Aegis：新装机建、老装机缺了补、默认上桌');
  // 颜色＝来源分组：弗洛伊德十一张（色 8 深蓝）＋ 安娜·弗洛伊德五张（色 9 浅蓝）＋ 克莱因三张（色 10 绿）
  //   ★ 2026-10-06：第四组＝「社会赞许性」两张（色 19 黑，PALETTE 末尾新增）
  //   ★ 2026-10-06（构建 219）：第五组＝「荣格原型」八张（色 3 橙，阿尼玛四 + 阿尼姆斯四，用户指定统一橙）
  const lv = {}; armor.cards.forEach(c => { lv[c.color] = (lv[c.color] || 0) + 1; });
  ok(lv[8] === 11 && lv[9] === 5 && lv[10] === 3 && lv[19] === 2 && lv[3] === 8 && lv[4] === 6,
    '★ Aegis按来源分组：弗洛伊德十一（色8）、安娜五（色9）、克莱因三（色10）、社会赞许性二（色19黑）、荣格原型八（色3橙）、艾森克六（色4青）——' + JSON.stringify(lv));
  ok(armor.cards.every(c => /〔.+〕$/.test(c.meaning)), '★ Aegis每张牌义末尾都标了出处（可逐条复查）');
  /* ★ 2026-10-06：后补的十张分两档钉 ——
     ① 社会赞许性二：用户给的两段原文、"不要扩写"，所以是短牌义；
     ② 荣格原型八（构建 220 重写）：用户嫌原来"太简单、太抽象"，指定要写出「**从投射到逐渐撤回**」这条主线
        ⇒ 变成中等体例（200~700 字），而且**四段体例必须齐**（投射长什么样／撤回这一步／最容易卡住的坑／自检一句）。
     500~800 字那套仍然只钉前面 19 张母类。 */
  const SOC = ['自我欺骗增强', '印象管理'];
  const JUNG8 = ['夏娃', '海伦', '玛利亚', '索菲亚', '赫拉克勒斯', '亚历山大', '阿波罗', '赫尔墨斯'];
  /* ★ 2026-10-07（构建 222）：艾森克 PEN 六张 —— 外倾／内倾、高／低神经质四张**照抄被删的 Psyche+牌组**
     （用户自己的文字，原文一字未改），高／低精神质两张按同样写法新写（先生理基础、后具体表征）。 */
  const EY = ['外倾型', '内倾型', '高神经质', '低神经质', '高精神质', '低精神质'];
  const isSoc = c => SOC.indexOf(c.name) >= 0;
  const isJ8 = c => JUNG8.indexOf(c.name) >= 0;
  const isEY = c => EY.indexOf(c.name) >= 0;
  const old19 = armor.cards.filter(c => !isSoc(c) && !isJ8(c) && !isEY(c));
  ok(old19.every(c => c.meaning.length >= 500 && c.meaning.length <= 800 && c.faceText.length <= 30),
    'Aegis 19 张母类牌义 500~800 字、牌面句 ≤30（牌义最长 ' + Math.max.apply(null, old19.map(c => c.meaning.length)) + ' 字）');
  const soc = armor.cards.filter(isSoc);
  ok(soc.length === 2 && soc.every(c => c.meaning.length >= 40 && c.meaning.length <= 400 && !c.faceText),
    '★ 社会赞许性两张：短牌义（用户原文＋出处）、牌面句留空（实为 ' +
    soc.map(c => c.name + ':' + c.meaning.length).join('／') + '）');
  const ey = armor.cards.filter(isEY);
  ok(ey.length === 6 && ey.every(c => c.meaning.length >= 40 && c.meaning.length <= 400 && !c.faceText),
    '★ 艾森克六张：短牌义（生理基础＋具体表征）、牌面句留空（实为 ' + ey.map(c => c.name + ':' + c.meaning.length).join('／') + '）');
  const j8 = armor.cards.filter(isJ8);
  ok(j8.length === 8 && j8.every(c => c.meaning.length >= 200 && c.meaning.length <= 700 && !c.faceText),
    '★ 荣格原型八张：中等体例（200~700 字）、牌面句留空（实为 ' +
    j8.map(c => c.name + ':' + c.meaning.length).join('／') + '）');
  {
    // ★★ 主线不许省：八张必须写全「撤回」（怎么退出来）与「固着」（这一层卡住的样子）。
    //    ★ 语体沿革：构建 220「短牌义」→ 221「释义体（讲义腔）」（撤出指的是／这一层最常见的僵局是）
    //      → 222「论文质感」（学术用语、术语首次出现当场解释）；标签不再固定，改为**钉内容词**。
    //    ★ 构建 224：八张的正文整体换成用户重写的版本（象征与心理内涵 ＋ 亲密关系中的矛盾／课题），
    //      钉的内容词跟着换：每张必须写到「亲密关系」与「课题」。
    const SEG = ['亲密关系', '课题'];
    const badSeg = j8.filter(c => !SEG.every(x => c.meaning.indexOf(x) > 0));
    ok(badSeg.length === 0, '★★ 荣格原型八张都写了「亲密关系」与「课题」两段内容——' +
      (badSeg.length ? '缺：' + badSeg.map(c => c.name).join('／') : '主线完整'));
    const aiTaste = j8.filter(c => c.meaning.indexOf('自检一句') >= 0);
    ok(aiTaste.length === 0, '★★ 八张里没有"自检一句"那类自检卡口吻（220 去 AI 味起立的规矩）——' +
      (aiTaste.length ? '仍有：' + aiTaste.map(c => c.name).join('／') : '已清干净'));
    // ★ 222 起：整副（19 母类 ＋ 8 荣格）统一「论文质感」——不许出现 markdown 加粗（App 牌义是纯文本渲染）
    const md = armor.cards.filter(c => c.meaning.indexOf('**') >= 0);
    ok(md.length === 0, '★ 牌义里没有 markdown 加粗标记（** 会原样显示）——' +
      (md.length ? '仍有：' + md.map(c => c.name).join('／') : '干净'));
  }
  // ★ 2026-10-06（构建 219）：荣格原型八张 —— 阿尼玛四层标荣格本人（CW 16 §361）、阿尼姆斯四层标学派整理，
  //   两张单一手一二手**不许混**（别把后人补的账算到荣格头上）。
  const JUNG_A = ['夏娃', '海伦', '玛利亚', '索菲亚'];
  const JUNG_M = ['赫拉克勒斯', '亚历山大', '阿波罗', '赫尔墨斯'];
  const pick = n => armor.cards.filter(c => c.name === n)[0];
  ok(JUNG_A.every(n => pick(n) && pick(n).meaning.indexOf('荣格《移情心理学》CW 16 §361') > 0),
    '★ 阿尼玛四层都标了荣格本人的出处（《移情心理学》CW 16 §361）');
  ok(JUNG_M.every(n => pick(n) && pick(n).meaning.indexOf('荣格学派整理') > 0
                       && pick(n).meaning.indexOf('CW 16') < 0),
    '★ 阿尼姆斯四层都标「荣格学派整理」、且**不**冒充荣格原文（出处不许混）');
  ok(armor.cards.some(c => c.name === '压抑') && armor.cards.some(c => c.name === '否认'),
    '★ 公认的地基两张（压抑 / 否认）都在');
  // ★ 2026-10-02：这是整副**重做**（78 张具体机制 → 19 张母类），上一版 65 个旧卡名必须进 retiredNames
  //   （老装机开机同步时下线旧卡，否则重做就变成"新旧并存"——用户当场抓住的）。
  const aegisCur = {}; armor.cards.forEach(c => { aegisCur[c.name] = 1; });
  const aegisRetired = armor.retiredNames || [];
  ok(aegisRetired.length === 65 && aegisRetired.every(n => !aegisCur[n]),
    '★ Aegis 重做：上一版 65 个旧卡名都进了 retiredNames、且没混进现役名字（实为 ' + aegisRetired.length + ' 个）');
  ok(['理智化', '躯体化', '合理化', '内摄', '反向作用', '反转成对立面', '情感隔离', '利他性让渡', '抑制'].every(
       n => aegisRetired.indexOf(n) >= 0 && !aegisCur[n]),
    '★ 被下线的旧机制（理智化／躯体化／合理化／内摄／反向作用／反转成对立面／情感隔离／利他性让渡／抑制）都在退役名单里');
  // ★ 2026-09-23：改成**相对顺序**判定 —— 原来是"倒数第二"，加了试验牌组「三国人物卡」（order 60）就红了。
  //   以后再加副牌组也不该再改这条。
  const guaAfter = B.find(e => e.key === 'gua64');
  ok(!!guaAfter && orders.indexOf(armor.order) < orders.indexOf(guaAfter.order),
    'Aegis 排在易经牌组前面（order ' + armor.order + ' < ' + (guaAfter ? guaAfter.order : '?') + '）');
  }
  ok(star.back.template === null, '牌背：星语无模板');
  ok(star.addIfMissing === false, 'addIfMissing：星语 false（用户删了不塞回来）');

  /* ============================================================
     2. ★ 核心守卫：decks/*.json ↔ 注册表（防"改了 JSON 忘了生成"）
     ============================================================ */
  group('2. decks/*.json 与注册表一致（忘了跑「生成」就会红在这里）');
  if (pkgMode || !fs.existsSync(DECKS)) {
    note('包内模式 / 找不到 decks 目录 —— 这一组只在源码里跑（工具「校验」在构建前会兜住）');
  } else {
    // ★ app/decks/不打包.txt 里列出的（别的会话在做的牌组）不进注册表、不进包
    const skipTxt = path.join(DECKS, '不打包.txt');
    const skipKeys = new Set(fs.existsSync(skipTxt)
      ? fs.readFileSync(skipTxt, 'utf8').split('\n').map(l => l.split('#')[0].trim()).filter(Boolean)
      : []);
    const files = fs.readdirSync(DECKS).filter(f => fs.existsSync(path.join(DECKS, f, 'deck.json'))).sort()
      .filter(f => !skipKeys.has(JSON.parse(fs.readFileSync(path.join(DECKS, f, 'deck.json'), 'utf8')).key));
    ok(files.length === B.length, 'decks/*.json 里「进包」的份数（' + files.length + '）= 注册表份数（' + B.length + '）');
    // ★ 按文件的 order 配对（不能按文件名排 —— 中文文件名一排序就跟 order 错位，
    //   报错会指到另一副牌组头上，白查半天）
    const fromJson = files.map(f => [f, project(JSON.parse(fs.readFileSync(path.join(DECKS, f, 'deck.json'), 'utf8')))])
      .sort((a, b) => a[1].order - b[1].order);
    fromJson.forEach(([f, pj], i) => {
      const a = JSON.stringify(pj), b = JSON.stringify(project(B[i]));
      if (a !== b) {
        // 指出第一处不同，方便定位
        let at = 0; while (at < a.length && a[at] === b[at]) at++;
        ok(false, f + ' 与注册表不一致（第 ' + at + ' 字符起：盘上 ' + a.slice(at, at + 40) + ' / 注册表 ' + b.slice(at, at + 40) + '）');
      } else ok(true, f + ' ↔ 注册表一致');
    });
    // 工作流程脚本本身能跑通（含"生成物最新"和"index/走查都接了线"）
    try {
      const out = cp.execFileSync('python3', [TOOL, '校验'], { encoding: 'utf8' });
      ok(/校验通过/.test(out), 'app/tools/内置牌组.py 校验 退出 0：' + (out.trim().split('\n')[0] || ''));
    } catch (e) {
      ok(false, 'app/tools/内置牌组.py 校验 没过：' + String((e.stdout || e.message) || '').trim().split('\n').slice(0, 3).join(' / '));
    }
    const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const tags = (index.match(/<script src="([^"]+)"/g) || []).map(s => s.replace(/.*src="/, '').replace('"', ''));
    ok(tags.indexOf('js/builtin-decks.js') >= 0 && tags.indexOf('js/builtin-decks.js') < tags.indexOf('js/data.js'),
      'index.html 引了 builtin-decks.js 且排在 data.js 前面');
    ['走查-占卜桌选牌台.js', '走查-壳层与丢图.js', '走查-内置牌组.js'].forEach(f => {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
      ok(/'js\/builtin-decks\.js'/.test(src), f + ' 的加载列表里有 js/builtin-decks.js');
    });
  }

  /* ============================================================
     3. data.js 真的从注册表派生（不是又抄了一份内容）
     ============================================================ */
  group('3. data.js 从注册表派生');
  ok(D.STAR_DECK_NAME === star.name, 'STAR_DECK_NAME 来自注册表');
  const d1 = D._defaultDeck();
  ok(d1.name === star.name && d1.cards.length === 12, '默认那副 = 注册表的 star');
  ok(JSON.stringify(d1.cards.map(c => c.name)) === JSON.stringify(star.cards.map(c => c.name)),
    '星语卡序与注册表逐张一致');
  ok(d1.cards.every(c => palette.indexOf(c.color) === star.cards[d1.cards.indexOf(c)].color),
    '卡色按注册表的 color 序号取调色板');
  ok(d1.cards.every(c => c.image === null && c.imageHi === undefined), '内置卡的图片字段一律为空（不塞用户图）');
  ok(D.isStarName('启程') && !D.isStarName('财富'), '按卡名认身份：只有星语那 12 个名字算身份');

  // ★ 有牙：把注册表里的名字/内容换掉，再 eval 一遍 data.js —— 内容必须跟着变。
  //   要是 data.js 里还藏着一份手写内容，这里就会红。
  group('3b. ★ 改了注册表，data.js 的行为必须跟着变（证明内容没有第二份）');
  {
    const w2 = boot();
    w2.MoKaBuiltinDecks = JSON.parse(JSON.stringify(w2.MoKaBuiltinDecks));
    w2.MoKaBuiltinDecks.find(e => e.key === 'star').name = '测试·星语改名';
    w2.MoKaBuiltinDecks.find(e => e.key === 'star').cards[0].name = '测试·第一张';
    w2.MoKaBuiltinDecks.find(e => e.key === 'star').cards[0].sym = 'beacon';
    w2.MoKaBuiltinDecks.find(e => e.key === 'star').back.color = '#123456';
    ['js/data.js'].forEach(f => w2.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')));
    const D2 = w2.MoKa.data;
    ok(D2.STAR_DECK_NAME === '测试·星语改名', '改名注册表 → STAR_DECK_NAME 跟着变');
    ok(D2._defaultDeck().name === '测试·星语改名' && D2._defaultDeck().cards[0].name === '测试·第一张',
      '改卡名 → 默认那副的卡跟着变');
    ok(D2._defaultDeck().cards[0].symbolImg === 'assets/sym/beacon.svg', '改 sym → symbolImg 跟着变');
  }

  /* ============================================================
     3c. ★ 不带符号的内置牌组，不许进「有身份的卡名」表
     ------------------------------------------------------------
     为什么单列一组：这份表决定 cleanFakeSymbols 保留谁的符号。
     一副 symbols:none 的内置牌组如果把自己的卡名塞进去，
     用户那些**同名**的卡（焦虑/抑郁/移情·父…）就会跟着被豁免，
     §54 好不容易清掉的假符号（他自己那副 58 张的精分牌组，58 张全是 sowilo）就清不掉了。
     ============================================================ */
  group('3c. ★ 不带符号的内置牌组不参与"认身份"（假符号清理的护栏）');
  {
    const w4 = boot();
    // 塞一副"symbols: none"的假内置牌组进来，再 eval data.js
    w4.MoKaBuiltinDecks = JSON.parse(JSON.stringify(w4.MoKaBuiltinDecks));
    w4.MoKaBuiltinDecks.push({
      key: 'nosym', name: '无符号测试牌组', oldNames: [], order: 99, onTable: false, addIfMissing: false,
      symbols: 'none', back: { template: null, color: '#8a7a3a' },
      cards: [{ name: '焦虑', keyword: '预期', symbol: null, sym: null, faceText: 'x', meaning: 'y', color: 0 },
              { name: '抑郁', keyword: '事后', symbol: null, sym: null, faceText: 'x', meaning: 'y', color: 1 }]
    });
    w4.eval(fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8'));
    const D4 = w4.MoKa.data;
    const identity = D4._builtinIdentityNames();
    ok(identity.indexOf('否认') < 0 && identity.indexOf('压抑') < 0 && identity.indexOf('置换') < 0,
      '★ Aegis那 29 张（symbols:none）同样不进表 —— 否则用户自己叫「否认」「压抑」「置换」的卡会被豁免');
    ok(identity.indexOf('焦虑') < 0 && identity.indexOf('抑郁') < 0,
      'symbols:none 的牌组，卡名不进"有身份"表（现在表里有 ' + identity.length + ' 个名字）');
    ok(identity.indexOf('启程') >= 0, '带符号的星语卡名照旧在表里');
    // 表里的每个名字，都必须对应注册表里一张**带 sym** 的卡（结构不变式）
    const symNames = {};
    w4.MoKaBuiltinDecks.forEach(e => e.cards.forEach(c => { if (c.sym) symNames[c.name] = 1; }));
    ok(identity.every(n => symNames[n]), '表里每个名字都对应一张带符号的内置卡');
    // 行为面：用户一张叫「焦虑」的卡（被早期版本盖了 sowilo）必须被清掉
    const cleaned = D4._cleanFakeSymbols([{ id: 'd1', name: '用户自己的牌组', cards: [
      { id: 'c1', name: '焦虑', symbol: '✦', symbolImg: 'assets/sym/sowilo.png' },
      { id: 'c2', name: '启程', symbol: '✦', symbolImg: 'assets/sym/star4.svg' }
    ] }]);
    ok(cleaned === 1, '同名但内置那副不带符号 → 照样清掉（清了 ' + cleaned + ' 张）');
  }

  /* ============================================================
     3c2. 内置牌背归属：谁声明的模板，只有那副（及其克隆）看得见
     ============================================================ */
  group('3c2. 内置牌背归属判定（一盾两色／三爻／里程线）');
  {
    const mk = (name, names) => ({ id: 'd-' + name, name: name, cards: names.map((n, i) => ({ id: 'c' + i, name: n })) });
    const mine = mk('我的牌组', ['随便', '两张']);
    ok(!D.deckOwnsBack(mine, 'guax') && !D.deckOwnsBack(mine, 'hero') && !D.deckOwnsBack(mine, 'aegis'),
      '★ 用户自己的牌组：内置模板（三爻／里程线／一盾两色）都不拥有，不跨界显示');
    const lib = fs.readFileSync(path.join(ROOT, 'js/scenes/library.js'), 'utf8');
    const la = B.find(e => e.key === 'lovearmour');
    ok(!!la && la.back.template === 'lovearmour' && la.back.color === '#2e5447',
       '★ Love & Armour 的牌背指向「深墨绿玫瑰心结盘」+ #2e5447');
    /* ★★ 2026-10-24（构建 274）：Aegis 已下架 —— 35 张防御牌合并进 Love & Armour 那副 60 张里。
       那面「一盾两色」的盾印（aegisBackSVG）不再被任何注册表牌组引用，断言改成"确实没人用了"。 */
    ok(!B.some(e => e.key === 'aegis'), '★ Aegis 已下架（合并进 Love & Armour），注册表里没有 key=aegis');
    ok(!B.some(e => e.key === 'stories'), '★ Amour Codex（stories）已下架，它的 25 张并进了 Love & Armour');
    {
      const bd = D.listDecks().filter(d => d.name === la.name)[0];
      ok(bd.backTemplate === 'lovearmour', '★ 真建出来的那副也带上了玫瑰心结盘牌背');
      const bh = UI.backHTML(bd.name, { template: bd.backTemplate, color: bd.backColor });
      ok(bh.indexOf('deckimg/lovearmour/_back.jpg') > 0, '★ 牌背渲染走外置图分支（back.svg 里的 _back.jpg）');
    }
    ok(/deckOwnsBack\(deck, t\.id\)/.test(lib), '★ 模板列表用的是 deckOwnsBack 泛化判定');
  }

  /* ============================================================
     3c3. 牌面排版：超过 4 个字一律缩字号（不折行、不拆字）
     ============================================================ */
  group('3c3. 牌面排版：超过 4 个字一律缩字号（不折行、不拆字）');
  {
    const ratioOf = (html) => {
      const m = /font-size:calc\(var\(--card-w, 90px\) \* ([\d.]+)\)/.exec(html);
      return m ? parseFloat(m[1]) : null;
    };
    const R = 13 / 90;
    const f = (n, k) => UI.faceHTML({ name: n, keyword: k || '词', color: '#333' });
    ok(Math.abs(ratioOf(f('抱持')) - R) < 1e-4, '4 字以内不缩字（比例仍是 13/90）');
    ok(/fc-name/.test(f('抱持')) && !/is-two/.test(f('力比多·投注')), '★ 复名不再拆两行（用户定的：缩小就行）');
    ok(Math.abs(ratioOf(f('力比多·投注')) - R * (0.57 / (6 * 13 / 90 * 1.10))) < 1e-3,
      '★ 6 字名 → 缩到刚好放得下（含字距，' + ratioOf(f('力比多·投注')).toFixed(4) + '）');
    ok(Math.abs(ratioOf(f('俄狄浦斯期')) - R * (0.57 / (5 * 13 / 90 * 1.10))) < 1e-3,
      '★ 5 字名 → 缩到 71.7%（含字距，' + ratioOf(f('俄狄浦斯期')).toFixed(4) + '）');
    // ★★ 回归：用户报"占卜桌上 强迫性重复 / 俄狄浦斯期 显示不了"
    //     根因＝旧公式把 5 个字缩到占宽 62.1%（可用只有 62.2%）→ 折行 → 顶出牌面被裁
    ['强迫性重复', '俄狄浦斯期', '自我同一性', '被欲望位置'].forEach(n => {
      const h = f(n);
      const wide = Array.from(n).length * ratioOf(h) * 1.10;    // 含字距
      ok(/white-space:nowrap/.test(h) && wide <= 0.605,
        '★「' + n + '」一行放得下（占宽 ' + wide.toFixed(3) + ' ≤ 0.605，且不折行）');
    });
    const wrapped = UI.faceHTML({ name: '一个特别特别特别特别特别特别特别特别特别特别特别长的牌名字啊哈哈', color: '#333' });
    ok(/top:4%;[^"]*transform:none/.test(wrapped), '★ 万不得已折行时贴住上边（不再顶出牌面被裁）');
    ok(ratioOf(f('能指先于所指')) < ratioOf(f('俄狄浦斯期')) && ratioOf(f('俄狄浦斯期')) <= ratioOf(f('抱持')) + 1e-9,
      '6 字比 5 字缩得多；5 字及以内不缩（内边距收窄就够了）');
    ok(Math.abs(ratioOf(f('抱持')) - R) < 1e-4 && Math.abs(ratioOf(f('潮汐')) - R) < 1e-4, '3 字以内不缩（还是 100%）');
    ok(Math.abs(ratioOf(f('移情·父')) - R * (0.57 / (4 * 13 / 90 * 1.10))) < 1e-3,
      '4 字名缩到 89.7%（含字距，几乎看不出来）');
    // 一行放得下：字数 × 缩后的字宽 ≤ 可用宽度（牌宽的 62.2%）
    // 短名字用默认内边距（可用 62.2%）；长名字会收窄内边距（可用 82%）
    const fits = (n) => { const r = ratioOf(f(n)); return Array.from(n).length * r * 1.10 <= 0.6225 + 1e-6; };
    ['力比多·投注', '攻击力·受阻', '关系·稳定', '自恋·健康', '俄狄浦斯期', '自我同一性',
     '能指先于所指', '被欲望位置', '欲望的主体', '强迫性重复'].forEach(n =>
      ok(fits(n), '★「' + n + '」缩完一行放得下'));
    // ---- 2026-09-20 晚：字号下限 20 / 按字数自动适配（可关）/ 字重三档 ----
    const R2 = 13 / 90;
    ok(Math.abs(ratioOf(UI.faceHTML({ name: '抱持', nameFs: 20, color: '#333' })) - R2 * 0.2) < 1e-4,
      '★ 字号下限放宽到 20%（以前 50% 会被夹住）');
    ok(Math.abs(ratioOf(f('俄狄浦斯期')) - R2 * (0.57 / (5 * 13 / 90 * 1.10))) < 1e-3, '★ 自动适配：5 字名缩到 71.7%');
    /* ★★ 2026-09-28 用户改主意：「拆行是什么意思？折成两行吗？其实我还是想要一行排下的」
       —— 所以**一行永远是第一目标**：手动模式也照样缩到一行放得下（只是不再享受
       kwWrap2 那种"宁可折两行也别缩成蚂蚁"的待遇）。折行只剩"缩到 25% 地板还不够"这一种兜底。 */
    ok(/white-space:nowrap/.test(f('俄狄浦斯期')), '自动适配时不许换行（保证一行）');
    ok(/white-space:nowrap/.test(UI.faceHTML({ name: '俄狄浦斯期', autoFit: false, color: '#333' })),
      '★ 关掉自动适配：仍然保证一行（放不下就缩，不许溢出、也不折行）');
    {   // 手动模式 + 超长名字：必须缩到一行放得下
      const longName = '一个特别特别特别长的牌名字';   // 12 字：缩完在 25% 地板之上，仍是一行
      const h = UI.faceHTML({ name: longName, autoFit: false, nameFs: 100, color: '#333' });
      const r = parseFloat(/fc-name[^>]*font-size:calc\(var\(--card-w, 90px\) \* ([\d.]+)\)/.exec(h)[1]);
      ok(/white-space:nowrap/.test(h) && Array.from(longName).length * r * 1.10 <= 0.6225 + 1e-6,
        '★★ 手动模式 + 字号拉满 + 超长名字：自动缩到一行放得下（占宽 '
        + (Array.from(longName).length * r).toFixed(3) + ' ≤ 0.6225）');
    }
    // ★ 用户手动调小的字号不许再被乘一遍（免得"我明明设了 80%，怎么更小"）
    ok(Math.abs(UI.fitFs('name', '强迫性重复', 70, true).fs - 70) < 1e-6
       && Math.abs(UI.fitFs('name', '抱持', 60, true).fs - 60) < 1e-6
       && Math.abs(UI.fitFs('name', '强迫性重复', 90, true).fs - 71.75) < 0.1,
      '★ 手动字号本身就放得下 → 原样不动；放不下 → 才收到上限（90% → 71.7%）');
    const veryLong = UI.faceHTML({ name: '一个特别特别长的牌名字', color: '#333' });
    ok(Array.from('一个特别特别长的牌名字').length * ratioOf(veryLong) * 1.10 <= 0.6225 + 1e-6,
      '★ 12 字长名字缩完一行放得下（占宽 ' + (Array.from('一个特别特别长的牌名字').length * ratioOf(veryLong)).toFixed(3) + '）');
    const extreme = UI.faceHTML({ name: '一个特别特别特别特别特别特别长的牌名字啊哈', color: '#333' });
    ok(ratioOf(extreme) >= R2 * 0.25 - 1e-3 && /top:4%;[^"]*transform:none/.test(extreme),
      '★ 极端长名字缩到底（≥25%）且仍放得下（' + ratioOf(extreme).toFixed(5) + '）');
    ok(/font-weight:400/.test(UI.faceHTML({ name: '抱持', nameWeight: 400, color: '#333' })),
      '★ 字重可改（常规 400）');
    ok(/font-weight:700/.test(UI.faceHTML({ name: '抱持', color: '#333' })), '默认字重还是 700');
    const longKw = UI.faceHTML({ name: '抱持', keyword: '一个很长的关键词', color: '#333' });
    const kwRatio = parseFloat(/fc-keyword[^>]*font-size:calc\(var\(--card-w, 90px\) \* ([\d.]+)\)/.exec(longKw)[1]);
    ok(kwRatio < 10 / 90, '★ 关键词也走自动适配（' + kwRatio.toFixed(5) + ' < ' + (10 / 90).toFixed(5) + '）');
    // ★★ 2026-09-21 根因：main.css 给 .fc-chip 定了 white-space:nowrap + overflow:hidden + text-overflow:ellipsis
    //    → 长名字被**省略号截断**（用户截图里的「能指先于…」）；v3.css 必须把它压掉
    const mainCss = fs.readFileSync(path.join(ROOT, 'css/main.css'), 'utf8');
    const v3css = fs.readFileSync(path.join(ROOT, 'css/v3.css'), 'utf8');
    ok(/text-overflow:\s*ellipsis/.test(mainCss), 'main.css 里确实有那条省略号截断（记录在案）；v3.css 必须压掉它');
    const chipBlocks = (v3css.match(/\.fc-chip[^{]*\{[^}]*\}/g) || []);
    ok(chipBlocks.length > 0 && chipBlocks.every(b => !/overflow:\s*hidden/.test(b)
       && !/text-overflow:\s*ellipsis/.test(b) && !/letter-spacing:\s*[\d.]+px/.test(b)),
      '★ v3.css 的 .fc-chip 块：不 hidden、不 ellipsis、字距不再用绝对 px（' + chipBlocks.length + ' 块）');

    ok(!/left:4%/.test(f('强迫性重复')) && !/padding-left:calc/.test(f('强迫性重复')),
      'chip 内外边距保持统一（只靠字号不一样，不动形状）');
    // 牌义弹层：牌面句当第一段索引
    const tbl = fs.readFileSync(path.join(ROOT, 'js/scenes/table.js'), 'utf8');
    ok(/card\.faceText \? '<div class="meaning-index">'/.test(tbl), '★ 牌义弹层把牌面句当第一段（索引）');
  }

  /* ============================================================
     3c4. 编辑页布局（Tab 版）+ 复制样式到整副（2026-09-20）
     ============================================================ */
  group('3c4. 鲸造编辑器保存白名单 + 复制样式到整副');
  {
    const lib = fs.readFileSync(path.join(ROOT, 'js/scenes/editor.js'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'css/v3.css'), 'utf8');
    ['autoFit: draft.autoFit', 'nameWeight: draft.nameWeight', 'kwWeight: draft.kwWeight',
     'faceBg: draft.faceBg', 'imgScale: draft.imgScale'].forEach(k =>
      ok(lib.indexOf(k) >= 0, '保存白名单里有 ' + k.split(':')[0]));
    // 行为：复制样式到整副（真调数据层，不碰内容）
    const dk = D.createDeck('走查-复制样式');
    const c1 = D.addCard(dk.id, { name: '第一张', keyword: '甲', meaning: 'm1', nameFs: 100, nameWeight: 700, autoFit: true });
    const c2 = D.addCard(dk.id, { name: '第二张', keyword: '乙', meaning: 'm2', nameFs: 60, kwWeight: 400, autoFit: false });
    const n = D.applyCardStyleToDeck(dk.id, c1.id);
    const again = D.findDeck(dk.id);
    const a = again.cards.find(c => c.id === c1.id), b = again.cards.find(c => c.id === c2.id);
    ok(n === 1, '复制样式影响 1 张（实为 ' + n + ' 张）');
    ok(b.nameFs === a.nameFs && b.autoFit === a.autoFit && b.kwWeight === a.kwWeight,
      '★ 第二张的样式跟着第一张了（字号/适配/字重）');
    ok(b.name === '第二张' && b.keyword === '乙' && b.meaning === 'm2',
      '★ 内容一个字没被覆盖（名字/关键词/牌义）');
    // 新建卡（还没保存，没有 id）也能复制：用草稿样式直接写进整副
    const dk2 = D.createDeck('走查-草稿复制');
    D.addCard(dk2.id, { name: 'A', meaning: 'a' });
    D.addCard(dk2.id, { name: 'B', meaning: 'b' });
    const n2 = D.applyStyleToDeck(dk2.id, D.withCardStyle({ nameFs: 88, kwWeight: 600, autoFit: false }));
    const cards2 = D.findDeck(dk2.id).cards;
    ok(n2 === 2 && cards2.every(c => c.nameFs === 88 && c.kwWeight === 600 && c.autoFit === false),
      '★ 新建卡时用草稿样式复制到整副（' + n2 + ' 张）');
    D.deleteDeck(dk2.id);
    D.deleteDeck(dk.id);
  }

  /* ============================================================
     3c4b. 牌面「字体 / 底色样式」—— 新设置不许是死按钮（2026-09-27）
     ------------------------------------------------------------
     用户报「字体背景默认是胶囊，丑死了」→ 加了 3 款字体 + 9 个底色样式预设
     （第 9 个 plain「素字」是 2026-09-27 加的：白卡牌面要不画底、又要深色字）。
     "死按钮" = 按下去什么都不变。这里逐项验四层，任何一层断了都红：
       ① 数据层认得这两个字段（默认值 + 复制样式到整副）
       ② 渲染层真的输出对应类名（且"不画底"的那三种不写行内底色）
       ③ CSS 里真有那条规则，而且 **8 个样式两两不同**（两条规则一模一样 = 必有一个是死的）
       ④ 编辑页真接上了（按钮 / 保存白名单 / 草稿字段）+ 内嵌字体文件真的在
     ============================================================ */
  group('3c4b. 牌面字体 / 底色样式：逐项验"不是死按钮"');
  {
    /* ★ 2026-10-11 字体库升级：2 → 10 款内嵌字体（GB2312 子集，各 1~4.3MB） */
    const FONTS = { sys: '', kai: 'is-ft-kai', song: 'is-ft-song', hei: 'is-ft-hei', ming: 'is-ft-ming',
      mao: 'is-ft-mao', xing: 'is-ft-xing', shou: 'is-ft-shou', you: 'is-ft-you',
      deyi: 'is-ft-deyi', wei: 'is-ft-wei' };
    const STYLES = ['soft', 'pill', 'tag', 'plate', 'ribbon', 'outline', 'underline', 'none', 'plain',
      'scroll', 'bamboo', 'rice', 'carve', 'ledger', 'label', 'neon', 'halo', 'spot', 'glass',
      'hex', 'notch', 'stripe', 'dotgrid', 'gridpaper', 'sidebar', 'double', 'stitch', 'ribbon2',
      'sqring', 'twinline', 'emboss', 'deboss', 'gold', 'copper', 'velvet', 'papercut', 'holo',
      'leather', 'mist'];
    /* 不画底/不写行内底色的：描边三兄弟 + 素字 + 第二批 30 款（自带配色，ui.js 一个行内样式都不写） */
    const NOBG = { outline: 1, underline: 1, none: 1, plain: 1 };
    ['scroll','bamboo','rice','carve','ledger','label','neon','halo','spot','glass','hex','notch',
     'stripe','dotgrid','gridpaper','sidebar','double','stitch','ribbon2','sqring','twinline',
     'emboss','deboss','gold','copper','velvet','papercut','holo','leather','mist']
      .forEach(k => { NOBG[k] = 1; });
    const lib = fs.readFileSync(path.join(ROOT, 'js/scenes/editor.js'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'css/v3.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

    // ① 数据层
    ['nameFont', 'kwFont', 'nameBgStyle', 'kwBgStyle'].forEach(k =>
      ok(D.withCardStyle({})[k] != null, '★ 默认值里有 ' + k));
    ok(D.withCardStyle({ nameFont: 'kai', nameBgStyle: 'ribbon' }).nameFont === 'kai' &&
       D.withCardStyle({ nameFont: 'kai', nameBgStyle: 'ribbon' }).nameBgStyle === 'ribbon',
      '★ 数据层认得 nameFont / nameBgStyle');
    const dkS = D.createDeck('走查-样式字段');
    D.addCard(dkS.id, { name: 'A', meaning: 'a' });
    D.addCard(dkS.id, { name: 'B', meaning: 'b' });
    D.applyStyleToDeck(dkS.id, D.withCardStyle({ nameFont: 'song', kwBgStyle: 'tag' }));
    ok(D.findDeck(dkS.id).cards.every(c => c.nameFont === 'song' && c.kwBgStyle === 'tag'),
      '★★ 「复制样式到整副」把 字体/底色样式 一起带过去（漏在 STYLE_KEYS 外就漏）');
    D.deleteDeck(dkS.id);

    // ② 渲染层
    Object.keys(FONTS).forEach(f => {
      const h = UI.faceHTML({ name: '测试', keyword: '甲', nameFont: f, kwFont: f });
      ok(FONTS[f] === '' ? (h.indexOf('is-ft-') < 0) : (h.indexOf(FONTS[f]) > 0),
        '字体「' + f + '」渲染出对应类名' + (FONTS[f] ? '（' + FONTS[f] + '）' : '（系统＝不加类）'));
    });
    STYLES.forEach(st => {
      const h = UI.faceHTML({ name: '测试', keyword: '甲', nameBgStyle: st, kwBgStyle: st });
      ok(h.indexOf('is-bg-' + st) > 0, '底色样式「' + st + '」渲染出 is-bg-' + st);
      const inlineBg = /fc-chip[^>]*style="[^"]*background:/.test(h);
      ok(NOBG[st] ? !inlineBg : inlineBg,
        NOBG[st] ? ('「' + st + '」不写行内底色（写了会压过 CSS 的"不画底"）')
                 : ('「' + st + '」写了行内底色（颜色/深浅才对它有用）'));
    });

    // ③ CSS：规则都在，且 8 个样式两两不同
    const bodies = {};
    STYLES.forEach(st => {
      const re = new RegExp('\\.fc-chip\\.is-bg-' + st + '\\s*\\{([^}]*)\\}', 'g');
      const acc = []; let m;
      while ((m = re.exec(css))) acc.push(m[1].replace(/\s+/g, ' ').trim());
      bodies[st] = acc.join(' ').trim();
      ok(bodies[st].length > 0, '★★ v3.css 里有 .fc-chip.is-bg-' + st + ' 的规则（没规则＝死按钮）');
    });
    const uniq = {};
    Object.keys(bodies).forEach(st => { (uniq[bodies[st]] = uniq[bodies[st]] || []).push(st); });
    const dup = Object.keys(uniq).filter(k => uniq[k].length > 1);
    ok(dup.length === 0,
      '★★ 39 个底色样式两两不同' + (dup.length ? '（撞了：' + dup.map(k => uniq[k].join('=')).join('；') + '）' : ''));
    /* ★★ 圆角不许是死声明（2026-09-27）：基础 .fc-chip 的 border-radius 一旦带 !important，
       每个样式自己写的圆角就永远不生效 —— 44 款全长同一个圆角，用户当场就看出来了
       （「咱就非要做圆角的吗？不能把圆角给去掉吗」）。 */
    const baseRule = /\.fc-chip\s*\{([^}]*)\}/.exec(css);
    ok(!!baseRule && !/border-radius[^;]*!important/.test(baseRule[1]),
      '★★ 基础 .fc-chip 的圆角不带 !important（带了的话，各款样式自己的圆角全是死声明）');
    ok(/is-bg-plate\s*\{[^}]*border-radius:\s*0/.test(css),
      '★ 「压暗条」自己写着 border-radius:0（全宽无圆角）—— 现在真的生效了');

    /* 只有"真不画底"的才该是 transparent —— 第二批里自带底色的（米黄/深底/渐变）不要混进来 */
    ['outline', 'underline', 'none', 'plain', 'scroll', 'twinline', 'sqring'].forEach(st =>
      ok(/background:\s*transparent/.test(bodies[st]), '★ is-bg-' + st + ' 确实把底色设成透明'));
    Object.keys(FONTS).forEach(f => {
      if (!FONTS[f]) return;
      const re = new RegExp('\\.fc-chip\\.' + FONTS[f] + '[^{]*\\{([^}]*)\\}', 'g');   // 允许选择器列表（.fc-chip.x, .ed-font.x）
      const acc = []; let m;
      while ((m = re.exec(css))) acc.push(m[1]);
      ok(acc.length > 0 && acc.join(' ').indexOf('MK-') >= 0,
        '★ .fc-chip.' + FONTS[f] + ' 真的挂了内嵌字体族');
    });

    // ④ 编辑页接线 + 字体文件真的在
    // ★ 2026-10-02：39 款样式从硬编码横排改成了 JS 按 6 大类生成（BGSTYLE_GROUPS），
    //   源码里不再有 data-bgstyle="mist" 这种字面量 → 改成验「id 进了分组表」+「分组结构在」。
    STYLES.forEach(st => ok(lib.indexOf("'" + st + "'") >= 0, '编辑页有「' + st + '」样式（大类分组）'));
    ok(lib.indexOf('BGSTYLE_GROUPS') >= 0 && lib.indexOf('#ed-bgcat') >= 0, '★ 样式按 6 大类分组（BGSTYLE_GROUPS + #ed-bgcat）');
    /* ★ 2026-10-11：字体选择器改成 FONT_LIST 动态生成（11 款横滑）——
       不再有 data-font="xxx" 字面量，改成验「字体表里有这些 id」+「选择器结构在」。 */
    ['sys', 'kai', 'song', 'ming', 'mao', 'xing', 'shou', 'you', 'deyi', 'hei', 'wei'].forEach(f =>
      ok(lib.indexOf("'" + f + "'") >= 0, '字体表里有「' + f + '」'));
    ok(/FONT_LIST/.test(lib) && /ed-fonts/.test(lib), '★ 字体选择器由 FONT_LIST 生成（11 款横滑）');
    ['nameFont: draft.nameFont', 'kwFont: draft.kwFont',
     'nameBgStyle: draft.nameBgStyle', 'kwBgStyle: draft.kwBgStyle'].forEach(k =>
      ok(lib.indexOf(k) >= 0, '保存白名单里有 ' + k.split(':')[0]));
    ok(/UI\.fitFs/.test(lib) && /UI\.effNameVy/.test(lib) && /UI\.wrapPosStyle/.test(lib),
      '★ 编辑页 paintBlock 与台面共用同一套字号/位置算法（编辑页 = 台面的构造保证）');
    [['kai', 'MK-Kai'], ['song', 'MK-Song'], ['hei', 'MK-Hei'], ['ming', 'MK-Ming'], ['mao', 'MK-Mao'],
     ['xing', 'MK-Xing'], ['shou', 'MK-Shou'], ['you', 'MK-You'], ['deyi', 'MK-Deyi'], ['wei', 'MK-Wei']].forEach(x => {
      const fp = path.join(ROOT, 'assets', 'fonts', x[0] + '.woff2');
      const has = fs.existsSync(fp);
      ok(has && fs.statSync(fp).size > 100 * 1024,
        '★★ 内嵌字体文件在：assets/fonts/' + x[0] + '.woff2（' + (has ? Math.round(fs.statSync(fp).size / 1024) + ' KB' : '缺失') + '）');
      ok(css.indexOf("'" + x[1] + "'") >= 0, '@font-face 里声明了 ' + x[1]);
    });
  }

  /* ============================================================
     3c4c. ★ 牌面版式走**数据**，不许再被 CSS 焊死（2026-09-27）
     ------------------------------------------------------------
     用户报：「内置的这几副牌里面，就我们的p字头牌组，名词和关键词定死了，
             不要搞那么突兀的」。
     根因：版式曾经写死在 v3.css 里、条条 !important ——
           别的副牌在「调整牌面」里能拖能改，就它一动不动。
     规矩：出厂版式 = 注册表的 deck.cardStyle（只当**默认值**落到每张卡上），
           CSS 里一条专属版式规则都不许留。
     ============================================================ */
  group('3c4c. 版式：走数据、用户改得动，CSS 里不许焊死');
  {
    const rawCss = fs.readFileSync(path.join(ROOT, 'css/v3.css'), 'utf8');
    const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
    /* ⚠ 出厂样式是用户随时会调的东西（这两天就改了五六轮）——所以这里**认形状不认具体值**：
       只要求"注册表里写了、每张卡真的拿到了、值都是合法样式 id"，
       具体是凹刻还是账簿不钉死，免得每调一次就红一片。 */
    const want = { nameBgStyle: LAE.cardStyle && LAE.cardStyle.nameBgStyle,
                   kwBgStyle: LAE.cardStyle && LAE.cardStyle.kwBgStyle,
                   nameFont: LAE.cardStyle && LAE.cardStyle.nameFont };
    ok(!!LAE.cardStyle, '★ 注册表里 Love & Armour 带出厂牌面样式 cardStyle');
    Object.keys(want).forEach(k =>
      ok(LAE.cardStyle && LAE.cardStyle[k] === want[k],
        '★ cardStyle.' + k + ' = ' + want[k] + '（实际 ' + (LAE.cardStyle && LAE.cardStyle[k]) + '）'));
    // 落到每一张卡上（不是躺在注册表里好看）
    const w = boot(null);
    const dk = w.MoKa.data.listDecks().filter(d => d.name === LAE.name)[0];
    /* ⚠ 张数**别写死**：用户随时会往里加卡。
       只要求"注册表里几张、牌组就几张，并且每张都拿到了出厂值"。 */
    const regCount = (LAE.cards || []).length;
    ok(!!dk && dk.cards.length === regCount &&
       dk.cards.every(c => Object.keys(want).every(k => c[k] === want[k])),
      '★★ ' + regCount + ' 张卡都拿到了这套出厂值（不是躺在注册表里没人用）');
    // ★★ 关键：出厂值只是**默认值** —— 卡上自己写的说了算（用户改一次就覆盖）
    const mine = w.MoKa.data.withCardStyle({ nameBgStyle: 'pill', nameFont: 'kai' }, LAE.cardStyle);
    ok(mine.nameBgStyle === 'pill' && mine.nameFont === 'kai' && mine.kwBgStyle === want.kwBgStyle,
      '★★ 卡自己的样式字段压过出厂值（用户改得动 —— 这就是"没定死"）');
    // plain「素字」：白卡上必须是深色字 —— 白字＋光晕在白底上等于隐形
    const h = UI.faceHTML({ name: '王', keyword: '想象', nameBgStyle: 'plain', kwBgStyle: 'plain' });
    ok(h.indexOf('is-bg-plain') > 0, '★ 渲染出 is-bg-plain');
    ok(!/fc-chip[^>]*style="[^"]*background:/.test(h), '★ 素字不写行内底色');
    ok(!/fc-chip[^>]*style="[^"]*color:\s*#fff/.test(h) &&
       /* ★ 2026-11-17（t23 测试债）：这条原来只认字面 `color: #1c2536`。
          产品侧为了修「深色卦牌诗句不可见」，把素字的字色改成
          `color: var(--fc-plain-ink, #1c2536)`（浅色仍落回 #1c2536，深色由主题给浅墨），
          语义没变、只是多包了一层 var 兜底 —— 断言却因此恒红。
          现在两种写法都认：`#1c2536` 直写，或 `var(..., #1c2536)`（兜底值必须是深墨色）。
          仍然咬得住：字色写成白/别的浅色 → 不匹配，红（见本行下面的负例自检）。 */
       /\.fc-chip\.is-bg-plain\s*\{[^}]*color:\s*(?:var\([^)]*,\s*)?#1c2536/.test(css),
      '★★ 素字的字是深墨色、而且写在 CSS 里（行内不写 —— 白卡上不能用白字＋光晕）');
    /* ★ 2026-11-17（t23）：证明上面那条不是"只为当前代码量身定做"的假断言 ——
       同一段规则文本，换成白字/浅字必须判红（负例），新旧两种写法都必须判绿（正例）。 */
    const PLAIN_RULE_RE = /\.fc-chip\.is-bg-plain\s*\{[^}]*color:\s*(?:var\([^)]*,\s*)?#1c2536/;
    ok(PLAIN_RULE_RE.test('.fc-chip.is-bg-plain { background: transparent; color: #1c2536; }') &&
       PLAIN_RULE_RE.test('.fc-chip.is-bg-plain { background: transparent; color: var(--fc-plain-ink, #1c2536); }'),
      '★★（自检）新旧两种写法都认：直写 #1c2536 / var(..., #1c2536)');
    ok(!PLAIN_RULE_RE.test('.fc-chip.is-bg-plain { color: #ffffff; }') &&
       !PLAIN_RULE_RE.test('.fc-chip.is-bg-plain { color: var(--fc-plain-ink, #fff); }'),
      '★★（自检）素字被写成白字/var 兜底成 #fff → 仍然判红（断言有牙）');
    /* ★★ 老装机迁移：CSS 撤掉之后，用户那些卡必须被补上出厂样式
       （它们的样式字段一直是全局默认值；不补 = 升级后那副牌立刻变样）。
       反过来，用户自己调过样式的卡一个字都不许碰。 */
    const worn = { id: 'deck-old', name: LAE.name, builtinKey: LAE.key, createdAt: 1,
      backImage: null, backTemplate: 'lovearmour', backColor: '#2e5447', useRev: false, cards: [
        Object.assign(w.MoKa.data.withCardStyle({}), { id: 'o1', name: '压抑', keyword: '' }),
        Object.assign(w.MoKa.data.withCardStyle({}), { id: 'o2', name: '否认', keyword: '', nameFs: 123 })
      ] };
    const nFix = w.MoKa.data._applyBuiltinCardStyle([worn], LAE);
    ok(nFix === 1 && worn.cards[0].nameBgStyle === want.nameBgStyle && worn.cards[0].nameFont === want.nameFont,
      '★★ 老装机迁移：没人调过的卡补上出厂样式（补了 ' + nFix + ' 张）');
    ok(worn.cards[1].nameFs === 123, '★★ 用户自己调过样式的卡一个字都不碰（还是 123）');
    ok(w.MoKa.data._applyBuiltinCardStyle([worn], LAE) === 0, '★ 迁移是幂等的（再跑一次一张都不补）');

    /* ★★ 第二批 30 款（用户挑的）：两条硬规矩 ——
       ① 全是**通条**（is-bar 类 + v3.css 里有 .fc-chip.is-bar 的加宽规则）
       ② **自带配色**：ui.js 一个行内 background/color 都不许写（写了就把设计盖掉） */
    const BAR = ['scroll','bamboo','rice','carve','ledger','label','neon','halo','spot','glass','hex',
      'notch','stripe','dotgrid','gridpaper','sidebar','double','stitch','ribbon2','sqring','twinline',
      'emboss','deboss','gold','copper','velvet','papercut','holo','leather','mist'];
    ok(/\.fc-chip\.is-bar\s*\{[^}]*width:\s*calc\(100% \+ var\(--card-w/.test(css),
      '★★ v3.css 里有 .fc-chip.is-bar 的加宽规则（通条：通到牌面两边）');
    const badBar = BAR.filter(st => UI.faceHTML({ name: '王', keyword: '想象', nameBgStyle: st }).indexOf('is-bar') < 0);
    ok(badBar.length === 0, '★★ 30 款全带 is-bar（漏了就变成"跟着字数走"）' + (badBar.length ? '：' + badBar.join(',') : ''));
    const dirty = BAR.filter(st => {
      const hh = UI.faceHTML({ name: '王', keyword: '想象', nameBgStyle: st, kwBgStyle: st });
      return /fc-chip[^>]*style="[^"]*(background|color):/.test(hh);
    });
    ok(dirty.length === 0, '★★ 30 款自带配色：ui.js 不写行内 background/color' + (dirty.length ? '（脏了：' + dirty.join(',') + '）' : ''));
    // 出厂样式：Aegis 现在是素字
    ok(!!LAE.cardStyle && !!LAE.cardStyle.nameBgStyle && !!LAE.cardStyle.kwBgStyle,
      '★ Love & Armour 出厂样式写了：' + (LAE.cardStyle ? LAE.cardStyle.nameBgStyle + ' / ' + LAE.cardStyle.kwBgStyle : '没写'));
    /* ★★ 条高必须统一（用户提醒的"位置会抖动"）：
       字多的牌名会被自动缩字号（实测 A字牌组：2 字 0.144 ／ 7 字 0.078，差近一倍），
       块高跟着变 —— 药丸看不出来，**条**一眼就露（每张牌的条粗细都不一样）。
       v3.css 给条（.is-bar / 压暗条）加了跟牌宽成比例的最小高度 + 上下 padding 归零。 */
    ok(/\.fc-chip\.is-bar,\s*\.fc-chip\.is-bg-plate\s*\{[^}]*min-height:\s*calc\(var\(--u\)/.test(css),
      '★★ 条（通条／压暗条）有统一的最小高度 —— 不然同一副牌里每张的条粗细都不同');
    ok(/\.fc-chip\.is-bar\.fc-keyword,\s*\.fc-chip\.is-bg-plate\.fc-keyword\s*\{[^}]*min-height/.test(css),
      '★ 关键词那条矮一点（字号本来就小），单独给了高度');
    ok(/is-bg-plate\s*\{[^}]*padding-top:\s*0/.test(css) || /is-bar,\s*\.fc-chip\.is-bg-plate\s*\{[^}]*padding-top:\s*0/.test(css),
      '★ 条的上下 padding 归零（高度只由 min-height 说了算，不被 padding 干扰）');
    // 另外两副的出厂样式（2026-09-27 用户定的）
    const gua = psy2(B, 'gua64');
    /* 这两副有出厂样式；值随用户调，这里只验"写了 + 是合法样式 id"。
       （合法 id 清单 = 编辑页那 39 个按钮，两边必须对得上 —— 比钉死某个值有用得多。） */
    const KNOWN = {};
    ['soft','pill','tag','plate','ribbon','outline','underline','none','plain',
     'scroll','bamboo','rice','carve','ledger','label','neon','halo','spot','glass','hex','notch',
     'stripe','dotgrid','gridpaper','sidebar','double','stitch','ribbon2','sqring','twinline',
     'emboss','deboss','gold','copper','velvet','papercut','holo','leather','mist'].forEach(k => { KNOWN[k] = 1; });
    [['Love & Armour', LAE], ['64卦', gua]].forEach(function (it) {
      const nm = it[0], e = it[1];
      ok(!!e && !!e.cardStyle && KNOWN[e.cardStyle.nameBgStyle] && KNOWN[e.cardStyle.kwBgStyle],
        '★ ' + nm + ' 出厂样式写了、而且是合法样式 id（'
        + (e && e.cardStyle ? e.cardStyle.nameBgStyle + ' / ' + e.cardStyle.kwBgStyle : '没写') + '）');
    });

    const rePlain = new RegExp('\\.fc-chip\\.is-bg-plain\\s*\\{([^}]*)\\}', 'g');
    let mp, body = '';
    while ((mp = rePlain.exec(css))) body += ' ' + mp[1];
    ok(/background:\s*transparent/.test(body) && /box-shadow:\s*none/.test(body) &&
       /text-shadow:\s*none/.test(body),
      '★ v3.css 的 is-bg-plain 真的不画底、不留影和光晕');
  }

  /* ============================================================
     3c5. 内置牌组的"内容同步"（老装机：下线旧卡 + 补齐新卡）
     —— 用户报"拆出来的三张没有呀"，根因就是老装机只补牌组、不刷内容
     ============================================================ */
  group('3c5. 老装机的内容同步（整副重做：下线旧卡 + 补齐新牌单）');
  {
    // 造一副"老装机上的 Aegis"：名字还是**改名前**的「心甲牌组」（重做前那 78 张的缩影）：
    //   焦虑信号／预期 = 新牌单里已经没有的旧机制名（下线）
    //   压抑 = 留用，且被用户改过（牌义 + 字号）→ 一个字都不许覆盖
    //     ★ 2026-09-21：带上一个"对不上"的指纹 —— 那正是"用户改过"的判据（见 3c5b 组）
    //   否认 = 留用、没改过（无指纹）→ 文案会被刷新成新牌单那一版（3c5b 钉这条）
    //   ★ 牌组名本身也要就地改名：心甲牌组 → Aegis牌组（oldNames 那条路）
    const old = { id: 'deck-old-aegis', name: 'Love & Armour', createdAt: 1, backImage: null, backTemplate: 'lovearmour',
      backColor: '#2e5447', useRev: false, cards: [
        { id: 'c1', name: '压抑', keyword: '', meaning: '用户自己改过的一句话', color: 0, nameFs: 123,
          builtinHash: 'deadbeef' },
        { id: 'c2', name: '隔离', keyword: '', meaning: '旧的隔离（会被刷新）', color: 6 },
        { id: 'c3', name: '退行', keyword: '', meaning: '旧的退行（会被刷新）', color: 2 },
        { id: 'c4', name: '否认', keyword: '', meaning: '旧的否认', color: 7 }
      ] };
    const mine = { id: 'deck-mine', name: '我自己的牌组', createdAt: 1, cards: [
        { id: 'm1', name: '焦虑信号', keyword: '我自己也有一张', meaning: '别动我', color: 1 },
        { id: 'm2', name: '预期', keyword: '我自己的老卡', meaning: '也别动我', color: 1 } ] };
    const w9 = boot({ 'moka.decks.v1': JSON.stringify([old, mine]) });
    const D9 = w9.MoKa.data;
    const list = D9.listDecks();
    const fix = list.find(d => d.name === LAE.name) || { id: '(没找到)', cards: [] };
    const userDeck = list.find(d => d.name === '我自己的牌组') || { cards: [] };
    ok(!!fix && fix.id === 'deck-old-aegis',
      '★ 老装机上那副（已叫 Love & Armour）被认出并就地同步，id 不变');
    ok(fix.cards.length === LAE.cards.length,
      '★ 同步后张数 = 注册表全量（旧 4 张里下线 2 张、其余命中，补进 ' + (LAE.cards.length - 2) + ' 张）→ ' + fix.cards.length + ' 张');
    ok(fix.cards.every(c => LAE.cards.some(x => x.name === c.name)),
      '★ 同步后不留注册表里没有的旧卡名');
    ok(LAE.cards.every(c => fix.cards.some(x => x.name === c.name)), '★ 注册表里的卡一张不缺（' + LAE.cards.length + ' 张全在）');
    const kept = fix.cards.find(c => c.name === '压抑');
    ok(!!kept && kept.meaning === '用户自己改过的一句话' && kept.nameFs === 123,
      '★ 用户改过的卡**一个字都没被覆盖**（牌义 + 字号都还在）');
    const fresh = fix.cards.find(c => c.name === '隔离');
    ok(!!fresh && fresh.meaning === LAE.cards.find(c => c.name === '隔离').meaning,
      '补齐进来的新卡内容 = 注册表那份');
    ok(userDeck.cards.length === 2 && userDeck.cards.some(c => c.name === '焦虑信号') && userDeck.cards.some(c => c.name === '预期')
       && userDeck.cards.every(c => c.meaning === '别动我' || c.meaning === '也别动我'),
      '★ 用户自己的牌组（同样有「焦虑信号」「预期」两张）完全没被碰 —— 重做只动内置那副');
    // 反复跑不会重复追加
    const before = fix.cards.length;
    D9._syncBuiltinCards(list, armor);
    ok(D9.findDeck(fix.id).cards.length === before, '再跑一次同步不会重复追加（幂等）');
  }

  /* ============================================================
     3c5b. ★ 同名卡也要跟着刷新文案（2026-09-21）
     —— 用户报「一些牌义显示的还是之前的，你是看着牌名相同就没有改吗」
        根因：syncBuiltinCards 只"补缺的卡"，同名的卡一根手指都不碰 →
        整副重做时那些名字没变的卡，永远停在旧文案上。
     规矩：每张内置卡记一个内容指纹（builtinHash）
        · 没指纹（这机制之前建的）→ 当我们发的原版，刷新一次并补指纹
        · 指纹 == 当前内容（没人动过）→ 注册表变了就刷新
        · 指纹 != 当前内容（用户改过文案）→ 永远不碰
     文案之外**牌面图也走同一套**（图有独立的 builtinImgHash，2026-09-27 加的）：
        · 图指纹对不上 → 用户自己换的图 → 不碰
        · 图指纹对得上 / 老卡没图指纹 → 是我们发的 → 注册表换了新图就跟着换
          （用户报「牌面没有更正成功」：原来写死 `if (card.image) return`，
            图一旦生成就永远冻结，新画的画根本上不了机）
     卡 id／字号／底色等全部样式字段始终留着。
     ============================================================ */
  group('3c5b. ★ 同名卡跟着刷新文案（用户改过的不碰）');
  {
    const srcBig = LAE.cards.find(c => c.name === '压抑');
    const srcDial = LAE.cards.find(c => c.name === '否认');
    const JPG = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    const OLDART = 'data:image/jpeg;base64,OLDARTAAAAAAAAAAAAA';   // "我们上一次发给他的那张图"
    const hashOf = boot(null).MoKa.data._imgHash;                  // 拿真身算指纹，不在测试里抄一份算法
    const stale = { id: 'deck-aeg2', name: LAE.name, builtinKey: LAE.key, createdAt: 1,
      backImage: null, backTemplate: 'lovearmour', backColor: '#2e5447', useRev: false, cards: [
        // ① 没文案指纹 + 旧文案 + 用户调过字号、**自己换过图**（图指纹对不上）→ 文案刷新，图和样式全留
        { id: 'k1', name: '压抑', keyword: '旧词', meaning: '旧版的压抑文案', faceText: null,
          color: '#5b7cfa', nameFs: 88, image: JPG, builtinImgHash: '0:deadbeef' },
        // ② 指纹对不上 = 用户自己改过文案 → 一个字都不许动
        { id: 'k2', name: '隔离', keyword: '我改的词', meaning: '我自己写的牌义', builtinHash: 'deadbeef' },
        // ③ 我们发出去的旧牌面图（图指纹对得上）→ 注册表换了新画，必须跟着换
        { id: 'k3', name: '否认', keyword: '', meaning: '旧文案', image: OLDART,
          builtinImgHash: hashOf(OLDART) }
      ] };
    const w10 = boot({ 'moka.decks.v1': JSON.stringify([stale]) });
    const D10 = w10.MoKa.data;
    const fix10 = D10.listDecks().find(d => d.name === LAE.name);
    const big = fix10.cards.find(c => c.name === '压抑');
    ok(!!big && big.meaning === srcBig.meaning && big.keyword === srcBig.keyword,
      '★★ 名字没变的卡（压抑）文案被刷新成注册表那一版');
    ok(!!big && big.id === 'k1' && big.nameFs === 88 && big.image === JPG,
      '★ 刷新只换文案：卡 id、用户调的字号、他自己换的图都留着（图指纹对不上就永远不碰）');
    /* ★★ 这条是用户报的那个 bug 的回归测试（2026-09-27）：
       「有一张牌的图正常替换了、另一张没替换」——
       我们发出去的旧画，注册表换了新画之后必须跟着换。 */
    const dial = fix10.cards.find(c => c.name === '否认');
    ok(!!dial && !!srcDial.image && dial.image === srcDial.image,
      '★★ 我们发的旧牌面图跟着新版更新（图指纹对得上 → 换成注册表那张）');
    ok(!!dial && dial.builtinImgHash === hashOf(dial.image),
      '★ 换完把图指纹更新成新的（不然下一次又会被当成"用户换的"）');
    ok(!!big && big.builtinHash === D10._cardContentHash(big),
      '★ 刷新后补上指纹（下次进来不会被重复改）');
    const mine = fix10.cards.find(c => c.name === '隔离');
    ok(!!mine && mine.meaning === '我自己写的牌义' && mine.keyword === '我改的词',
      '★★ 用户自己改过文案的卡：一个字都没被覆盖（指纹对不上就永远不碰）');
    // 幂等：再跑一次，一张都不该变
    const snap = JSON.stringify(fix10.cards);
    D10._syncBuiltinContent(D10.listDecks(), armor);
    ok(JSON.stringify(D10.listDecks().find(d => d.name === LAE.name).cards) === snap,
      '再跑一次同步不会重复改动（幂等）');
  }

  /* ============================================================
     3c5c. ★ 卡级 oldNames：老装机「内投」原地改名「内摄」（2026-11-06）
     —— 与「牌组级 oldNames」同名不同层：这里只改一张卡的名字，
        卡 id、位置、抽牌进度都不动；旧名靠 syncBuiltinContent 在验过指纹之后原地改。
     ============================================================ */
  group('3c5c. ★ 卡级 oldNames：老装机「内投」原地改名「内摄」');
  {
    const oldDeck = { id: 'deck-ren', name: LAE.name, builtinKey: LAE.key, createdAt: 1,
      backImage: null, backTemplate: 'lovearmour', backColor: '#2e5447', useRev: false,
      cards: LAE.cards.map(function (c) {
        const oldName = (c.name === '内摄') ? '内投' : c.name;
        return { id: 'x-' + oldName, name: oldName, keyword: '', meaning: '旧文案', color: 0 };
      }) };
    const w = boot({ 'moka.decks.v1': JSON.stringify([oldDeck]) });
    const Dx = w.MoKa.data;
    const fix = Dx.listDecks().find(function (d) { return d.name === LAE.name; });
    const got = fix.cards.filter(function (c) { return c.name === '内摄'; });
    ok(got.length === 1 && got[0].id === 'x-内投',
      '★ 老装机「内投」原地改名「内摄」：id 不变、只一张');
    ok(!fix.cards.some(function (c) { return c.name === '内投'; }), '★ 旧名「内投」不残留');
  }

  /* ============================================================
     3c6. Aegis的「符号语言」（2026-09-20 晚）：每张卡自带一段内联 SVG
     ------------------------------------------------------------
     语言的规则在 设计-界面/38-Aegis符号语言-v2.md：
       外框说层级（8 种）／骨架说族（15 副）／变量说具体是哪一种。
     这里钉住四件事：都有、都不一样、画得出来、不许引外部文件。
     ============================================================ */
  group('3c6. Love & Armour 的牌面：61 张全是外置 jpg、名字走文字层');
  {
    const A = B.find(e => e.key === 'lovearmour');
    ok(!!A && A.cards.length === 61, '★ Love & Armour 61 张（爱情 26 + 防御 35）');
    ok(A.cards.every(c => typeof c.image === 'string' && c.image.indexOf('assets/deckimg/lovearmour/') === 0),
      '★ 61 张都带 image（外置 jpg 路径；2026-10-24 起不再内嵌 data:image/svg+xml）');
    ok(A.cards.every(c => c.styleKey === 'lovearmour' && (c.art == null) && !c.band),
      '★ 每张 styleKey=lovearmour、art/band 都清空');
    ok(A.cards.slice(26).every(c => !c.keyword), '★ 防御那 35 张关键词清空（爱情 26 张保留原关键词）');
    const imgs = A.cards.map(c => c.image);
    ok(new Set(imgs).size === imgs.length, '★ 61 张 image 互不相同（每张一个图案）');
    const dA = D.withCardStyle(A.cards[0]);
    const face = UI.faceHTML(dA);
    ok(face.indexOf('fc-img') > 0 && face.indexOf('deckimg/lovearmour/') > 0, '★ 牌面渲染出 .fc-img（外置图）');
    ok(face.indexOf('is-fc-lovearmour') > 0, '★ 牌面带 is-fc-lovearmour 类（素字光晕那条 CSS 用得上）');
    const real = D.listDecks().filter(d => d.name === A.name)[0];
    ok(!!real && real.cards.length === 61, '★ 新装机真的建出了这副牌（61 张）');
    ok(real.cards.every(c => typeof c.image === 'string' && c.image.length > 20),
      '★★ 真牌组里每一张也带 image（走 builtinCard 这条路 —— art 当年就是在这漏过）');
    ok(D.withCardStyle(real.cards[0]).image === real.cards[0].image,
      '★★ withCardStyle 也认 image（编辑/落盘一趟不许丢）');
    const css = fs.readFileSync(path.join(ROOT, 'css/v3.css'), 'utf8');
    ok(/\.tcard-face\.is-fc-lovearmour\s+\.fc-name/.test(css),
      '★ v3.css 有 .is-fc-lovearmour .fc-name 那条（素字光晕 + 字距）');
    ok(D._builtinIdentityNames().indexOf('压抑') < 0, '★ 防御那 35 张的卡名不进「有身份」表（symbols:none）');
  }

  /* ============================================================
     3d. 拿用户真实导出当回归：58 张「精分牌组」的假符号必须全清、且不被认成内置牌组
     ============================================================ */
  group('3d. 回归：用户那副 58 张的精分牌组（真实导出）');
  if (!fs.existsSync(path.join(__dirname, 'fixtures', '导出-精分牌组.json'))) {
    note('找不到 fixtures/导出-精分牌组.json');
  } else {
    const u = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', '导出-精分牌组.json'), 'utf8'));
    const udk = u.deck || (u.decks || [])[0];
    const copy = JSON.parse(JSON.stringify(udk));
    const n = D._cleanFakeSymbols([copy]);
    ok(n === copy.cards.length, '58 张（' + copy.cards.length + '）被 sowilo 盖住的卡全部清掉（清了 ' + n + ' 张）');
    ok(copy.cards.every(c => !c.symbolImg && !c.symbol), '清完 symbolImg 为 null、symbol 为空');
    ok(!D.deckOwnsBack(copy, 'aegis'),
      '★ 用户那副 58 张不拥有任何内置牌背（不跨界、不被当成内置那副）');
    const hit = udk.cards.filter(c => B.some(e => e.cards.some(x => x.name === c.name))).length;
    ok(hit / udk.cards.length < 0.8,
      '命中率 ' + hit + '/' + udk.cards.length + '（= ' + Math.round(100 * hit / udk.cards.length) + '%）离 80% 的误判线还有余量');
  }

  /* ============================================================
     4. 老装机：addIfMissing 的语义（用户删过的别塞回来）
     ============================================================ */
  group('4. 老装机迁移：只补该补的，绝不碰用户的牌组');
  {
    const mine = { id: 'deck-mine', name: '我的牌组', createdAt: 1, backImage: null, backTemplate: null,
      backColor: '#8a7a3a', useRev: false, cards: [{ id: 'card-1', name: '我的卡', keyword: '随便', meaning: '', symbol: 'ᛊ', symbolImg: 'assets/sym/sowilo.svg' }] };
    const w3 = boot({ 'moka.decks.v1': JSON.stringify([mine]) });
    const D3 = w3.MoKa.data;
    const list = D3.listDecks();
    const wantAdd = B.filter(e => e.addIfMissing !== false && !e.hidden).map(e => e.name);
    ok(list.length === 1 + wantAdd.length,
      '我的牌组 + 补上的 ' + wantAdd.join(' + ') + ' = ' + list.length + ' 副（星语不给塞回来）');
    ok(list[0].name === '我的牌组' && list[0].id === 'deck-mine', '用户牌组还在原位、id 没变');
    ok(wantAdd.every(n => list.some(d => d.name === n)), '每副该补的内置牌组都在（' + wantAdd.join('、') + '）');
    ok(list.find(d => d.name === LAE.name).cards.length === (LAE.cards || []).length,
      '缺的 Aegis牌组 ' + (LAE.cards || []).length + ' 张（张数跟着注册表走，别写死）');
    ok(!list.some(d => d.name === star.name), '★ seed=false 且 addIfMissing=false 的星语：不塞回来');
    /* ★ 2026-11-19：新增 onTable 默认值。补上的牌组里，只有 onTable !== false 的才自动上桌；
       易经牌组（onTable=false）补上后必须留给用户在牌库自己勾。 */
    const wantOnTable = B.filter(e => e.addIfMissing !== false && !e.hidden && e.onTable !== false).map(e => e.name);
    const wantOffTable = B.filter(e => e.addIfMissing !== false && !e.hidden && e.onTable === false).map(e => e.name);
    ok(wantOnTable.every(n => {
        const d = list.find(x => x.name === n);
        return d && D3.tableDeckIds().indexOf(d.id) >= 0;
      }), '补上且 onTable !== false 的牌组自动上占卜桌');
    ok(wantOffTable.every(n => {
        const d = list.find(x => x.name === n);
        return d && D3.tableDeckIds().indexOf(d.id) < 0;
      }), '★ 默认不上桌的牌组（' + wantOffTable.join('、') + '）补上后不自动进占卜桌');
    // ★ hidden 牌组（周易专用 zy64）：建了，但不进牌库列表、不上桌
    const hiddenNames = B.filter(e => e.hidden).map(e => e.name);
    if (hiddenNames.length) {
      ok(D3.listDecks(true).some(d => hiddenNames.indexOf(d.name) >= 0),
        '★ hidden 牌组建了（listDecks(true) 能看到：' + hiddenNames.join('、') + '）');
      ok(!D3.listDecks().some(d => hiddenNames.indexOf(d.name) >= 0),
        '★ hidden 牌组不在牌库列表（listDecks 默认不含）');
    }
    // ★ 2026-09-20 晚：这副牌从「心甲牌组」改名叫「Aegis牌组」——
    //   老装机上那副（如果装过构建 28 那一版）必须**就地改名**，id 不变、19 张卡和 art 都不许动。
    {
      const oldNameDeck = { id: 'deck-old-armor', name: '心甲牌组', createdAt: 1, backImage: null,
        backTemplate: null, backColor: '#4f5d6b', useRev: false,
        cards: [{ id: 'a1', name: '压抑', keyword: '忘掉', meaning: 'x', faceText: 'y', color: '#5b7cfa',
                  symbol: null, symbolImg: null, art: '<path d="M4.5 12 H19.5" stroke="currentColor" stroke-width="1.3"/>' }] };
      const w5 = boot({ 'moka.decks.v1': JSON.stringify([oldNameDeck]) });
      const D5 = w5.MoKa.data;
      const renamed = D5.findDeck('deck-old-armor');
      /* ★★ 2026-10-24：Aegis 已下架并合并进 Love & Armour ——
         老装机上那副「心甲牌组」不再被任何注册表条目认领：不改名、不同步、不补卡，原样留着（用户自己删）。 */
      ok(!!renamed && renamed.name === '心甲牌组', '★ Aegis 下架后，老装的「心甲牌组」原样保留（不被改名、不并进新副）');
      ok(renamed.id === 'deck-old-armor', '名字没动，id 也没动');
      ok(renamed.cards.length === 1, '★ 也不再被同步补卡（注册表里没有 key=aegis 了）');
    }

    const mine2 = D3.findDeck('deck-mine');
    ok(mine2.cards[0].symbolImg === null && mine2.cards[0].symbol === '',
      '用户自己那张被早期版本盖了 sowilo 的卡，符号被清干净（不是内置的身份）');
  }

  /* ============================================================
     4b. 牌组级纸边（backEdge / faceEdge）：新装默认 / 老装迁移 / 幂等 / 用户改过不动
     ------------------------------------------------------------
     2026-11-17：用户导出包把「易经牌组」「周易牌组」两副的纸边都关了
     （manifest.deck.backEdge / faceEdge = false）。新装机由 builtinDeck() 直接带上，
     老装机靠 applyBuiltinDeckFlags（edgeStamp 指纹）迁移。
     这一组把四条路径全钉住 —— 少一条，"老用户升级后纸边还开着"就没人发现。
     ============================================================ */
  group('4b. 牌组级纸边：新装默认 / 老装迁移 / 幂等 / 用户改过不动');
  {
    const E = {};
    B.forEach(e => { E[e.key] = e; });
    ok(!!E.gua64 && E.gua64.backEdge === false && E.gua64.faceEdge === false,
      '★ 注册表：gua64 backEdge=false / faceEdge=false');
    ok(!!E.zy64 && E.zy64.backEdge === false && E.zy64.faceEdge === false,
      '★ 注册表：zy64 backEdge=false / faceEdge=false');
    ok(!!E.star && E.star.backEdge === undefined && E.star.faceEdge === undefined,
      '★ 没声明纸边的牌组（星语）注册表里一个字段都不多 —— 其余牌组零影响');

    /* ① 新装机：seed 出来的那两副直接 false/false，并且带指纹（迁移不会再白写一次盘） */
    const seeded = D.listDecks(true).filter(d => d.builtinKey === 'gua64' || d.builtinKey === 'zy64');
    ok(seeded.length === 2, '新装机按注册表建出两副（实为 ' + seeded.length + '）');
    ok(seeded.every(d => d.backEdge === false && d.faceEdge === false),
      '★ 新装机：纸边直接 false/false（不靠迁移这一步）');
    ok(seeded.every(d => typeof d.edgeStamp === 'string' && d.edgeStamp.indexOf('backEdge') > 0),
      '★ 新装机：带 edgeStamp 指纹（' + String(seeded[0] && seeded[0].edgeStamp) + '）');
    ok(D._applyBuiltinDeckFlags(D.listDecks(true), E.gua64) === 0,
      '★ 幂等：新装机上再跑一遍迁移 = 0 处改动');

    /* ② 老装机（这两个字段从来没有过 = 默认开）：迁移成 false/false */
    const legacyDeck = (name, extra) => Object.assign({
      id: 'deck-legacy-1', name: name, createdAt: 1, backImage: null,
      backTemplate: 'guax', backColor: '#46543f', useRev: false,
      cards: [{ id: 'c1', name: '乾为天', keyword: '长风破浪会有时', meaning: 'x', color: '#8a7cff' },
              { id: 'c2', name: '坤为地', keyword: '润物细无声', meaning: 'y', color: '#ffd93d' }]
    }, extra || {});
    {
      const w4b = boot({ 'moka.decks.v1': JSON.stringify([legacyDeck('易经牌组')]) });
      const D4 = w4b.MoKa.data;
      const dk = D4.listDecks(true).filter(d => d.builtinKey === 'gua64')[0];
      ok(!!dk && dk.backEdge === false && dk.faceEdge === false,
        '★★ 老装机：原来没有这两个字段（= 默认开）→ 迁成 false/false');
      ok(!!dk && typeof dk.edgeStamp === 'string' && dk.edgeStamp.indexOf('"backEdge":false') > 0,
        '★ 迁移后记了 edgeStamp（' + String(dk && dk.edgeStamp) + '）');
      ok(!!dk && dk.cards.length === 64, '★ 迁移不影响内容同步（老装的 2 张照样补成 64 张）');
    }
    /* ③ 已经是目标值（上一次迁移写过的）：保持，且再跑一遍 = 0 处 */
    {
      const w4c = boot({ 'moka.decks.v1': JSON.stringify([legacyDeck('易经牌组', { backEdge: false, faceEdge: false })]) });
      const D4c = w4c.MoKa.data;
      const dk = D4c.listDecks(true).filter(d => d.builtinKey === 'gua64')[0];
      ok(!!dk && dk.backEdge === false && dk.faceEdge === false, '★ 已经等于目标值：保持 false/false');
      ok(D4c._applyBuiltinDeckFlags(D4c.listDecks(true), E.gua64) === 0, '★ 再跑一次 = 0 处（不白写盘）');
    }
    /* ④ 用户自己动过（关牌背、留牌面）：一个都不碰，也不盖指纹 */
    {
      const w4d = boot({ 'moka.decks.v1': JSON.stringify([legacyDeck('易经牌组', { backEdge: false, faceEdge: true })]) });
      const D4d = w4d.MoKa.data;
      const dk = D4d.listDecks(true).filter(d => d.builtinKey === 'gua64')[0];
      ok(!!dk && dk.backEdge === false && dk.faceEdge === true, '★★ 用户改过的（关牌背、开牌面）原样不动');
      ok(!!dk && dk.edgeStamp === undefined, '★ 没被我们盖指纹（下次也不会顺手改）');
    }
    /* ⑤ 用户自己的牌组：连"认领"都不该发生 */
    {
      const own = { id: 'deck-own', name: '我的牌组', createdAt: 1, backImage: null, backTemplate: null,
        backColor: '#8a7a3a', useRev: false,
        cards: [{ id: 'o1', name: '我的卡', keyword: 'x', meaning: 'y' }] };
      const w4e = boot({ 'moka.decks.v1': JSON.stringify([own]) });
      const D4e = w4e.MoKa.data;
      const dk = D4e.findDeck('deck-own');
      ok(!!dk && dk.backEdge === undefined && dk.faceEdge === undefined && dk.edgeStamp === undefined,
        '★ 用户自己的牌组：纸边字段一个都不写（不是内置那副）');
    }
  }

  /* ============================================================
     5. 易经牌组（2026-09-23 写的第五副；构建 49 起**进包**）
     ------------------------------------------------------------
     内容这一组**直接读 JSON**（不信注册表那份投影），
     源码和包内两种模式都跑（decks/ 在 app 下，与包内 assets 无关）。
     钉住四件事：牌名规则（3~4 字，重卦写「乾为天」）、牌义两段、六爻图（每张 6~12 条线、
     64 张各不相同、没引外部文件）、色号按上卦分 8 组。
     ============================================================ */
  group('5. 易经牌组（gua64，进包）：牌名 / 牌义 / 六爻图 / 色号');
  {
    const guaPath = path.join(DECKS, 'gua64', 'deck.json');
    if (!fs.existsSync(guaPath)) {
      note('找不到 decks/gua64/deck.json');
    } else {
      const G = JSON.parse(fs.readFileSync(guaPath, 'utf8'));
      // ① 进包（2026-09-23 构建 49 起）：注册表里必须有它。（「不在不打包.txt」那条死行检查
      //    由第 7 组统一管，这里不重复钉。）
      ok(B.some(e => e.key === G.key), '注册表里有它（已进包，且生成物是最新的）');
      ok(orders.indexOf(G.order) > orders.indexOf(LAE.order),
        '易经牌组排在 Aegis 之后（order ' + G.order + ' > ' + LAE.order + '）');
      // ② 形状
      ok(G.cards.length === 64, '64 张（现在 ' + G.cards.length + '）');
      ok(G.symbols === 'none' && G.cards.every(c => !c.sym && !c.symbol),
        '★ symbols 留 none：不带符号身份（用户自己的同名卡不会被认成内置身份）');
      // ③ 牌名：3~4 字；8 重卦「X为Y」；两字卦名写全称
      const lens = G.cards.map(c => Array.from(c.name).length);
      ok(lens.every(n => n >= 3 && n <= 4),
        '★ 牌名都在 3~4 字（实测 ' + Math.min.apply(null, lens) + '~' + Math.max.apply(null, lens) + ' 字，牌面一行放得下）');
      const wantNames = ['乾为天', '坤为地', '坎为水', '离为火', '震为雷', '艮为山', '巽为风', '兑为泽',
        '水雷屯', '火水未济', '水火既济', '风天小畜', '天水讼', '地天泰'];
      ok(wantNames.every(n => G.cards.some(c => c.name === n)),
        '★ 全称写法对（8 个重卦「乾为天」＋ 56 个「火水未济 / 水雷屯」）');
      // ④ 次序 = 通行本：头两张乾为天/坤为地，末两张水火既济/火水未济
      ok(G.cards[0].name === '乾为天' && G.cards[1].name === '坤为地' &&
         G.cards[62].name === '水火既济' && G.cards[63].name === '火水未济',
        '★ 按通行本卦序排（首 乾坤、末 既济/未济）');
      // ⑤ 牌义 = 两段（卦名含义 / 核心义理），都非空
      const badMeaning = G.cards.filter(c => !/^卦名含义：[\s\S]+\n核心义理：[\s\S]+$/.test(c.meaning));
      ok(badMeaning.length === 0,
        '★ 每张牌义都是「卦名含义：…」+「核心义理：…」两段' + (badMeaning.length ? '：' + badMeaning[0].name : ''));
      const kwLens = G.cards.map(c => Array.from(c.keyword || '').length);
      // ★ 2026-09-23 用户要求：64 卦的关键词从"白话短语"换成**一句诗/词**（如「长风破浪会有时」），
      //   上限跟着编辑器走（输入框 maxlength=8）→ 断言从 1~5 放宽到 1~8。
      ok(kwLens.every(n => n >= 1 && n <= 8),
        '★ 每张都有关键词、1~8 字（实测 ' + Math.min.apply(null, kwLens) + '~' + Math.max.apply(null, kwLens) +
        ' 字；8 字那几张（如「如临深渊如履薄冰」）fitFs 会自动缩到约 61%，一行仍放得下）');
      // ⑥ 六爻图：art 是 6~12 条 <line>、64 张各不相同、不引外部文件、画得出来
      const lines = G.cards.map(c => (String(c.art || '').match(/<line /g) || []).length);
      ok(lines.every(n => n >= 6 && n <= 12),
        '★ 每张的 art 是 6~12 条线（一幅卦画：6 爻，阴爻拆两段 → 最多 12 条；实测 ' +
        Math.min.apply(null, lines) + '~' + Math.max.apply(null, lines) + '）');
      const artsG = G.cards.map(c => c.art);
      ok(new Set(artsG).size === 64, '★ 64 段 art 互不相同（没有两张牌一个卦画）');
      ok(artsG.every(a => typeof a === 'string' && a.indexOf('<img') < 0 && a.indexOf('url(') < 0 &&
        a.indexOf('<script') < 0 && a.indexOf('http') < 0),
        '★ art 里没有 <img> / url( / <script / 外链（内联矢量，不落图片文件）');
      ok(G.cards.every(c => String(UI.artSVG(c)).indexOf('<svg') === 0 && UI.artSVG(c).length > 100),
        '★★ 64 张 art 都真的画得出来（UI.artSVG 出 <svg>，不是空的）');
      /* ⑦ 色号＝「京房八宫」（2026-10-02 用户指定），PALETTE 下标 11~18：
            乾黄金 / 兑银灰 / 离红 / 坎蓝 / 艮深黄 / 坤淡黄 / 巽绿 / 震青。
         ★★ 这里**逐卦核对宫属**，不是只数数量 —— 只数数量的话，"把两宫的卦对调"照样绿。
            （同一个宫里的 8 卦，上卦各不相同：火天大有属乾宫但上卦是离、泽雷随属震宫但上卦是兑、
              山水蒙属离宫但上卦是艮 —— 所以"按宫"和"按上卦"是两套分组，不能混。） */
      const PALACE_OF = {
        11: ['乾为天', '天风姤', '天山遁', '天地否', '风地观', '山地剥', '火地晋', '火天大有'],
        12: ['兑为泽', '泽水困', '泽地萃', '泽山咸', '水山蹇', '地山谦', '雷山小过', '雷泽归妹'],
        13: ['离为火', '火山旅', '火风鼎', '火水未济', '山水蒙', '风水涣', '天水讼', '天火同人'],
        14: ['坎为水', '水泽节', '水雷屯', '水火既济', '泽火革', '雷火丰', '地火明夷', '地水师'],
        15: ['艮为山', '山火贲', '山天大畜', '山泽损', '火泽睽', '天泽履', '风泽中孚', '风山渐'],
        16: ['坤为地', '地雷复', '地泽临', '地天泰', '雷天大壮', '泽天夬', '水天需', '水地比'],
        17: ['巽为风', '风天小畜', '风火家人', '风雷益', '天雷无妄', '火雷噬嗑', '山雷颐', '山风蛊'],
        18: ['震为雷', '雷地豫', '雷水解', '雷风恒', '地风升', '水风井', '泽风大过', '泽雷随'],
      };
      const nameColor = {};
      G.cards.forEach(c => { nameColor[c.name] = c.color; });
      const wrongPalace = [];
      let palaceCount = 0;
      Object.keys(PALACE_OF).forEach(function (idx) {
        PALACE_OF[idx].forEach(function (n) {
          palaceCount++;
          if (nameColor[n] !== +idx) wrongPalace.push(n + ' 应为' + idx + '，实为 ' + nameColor[n]);
        });
      });
      ok(palaceCount === 64, '★ 八宫表覆盖 64 卦（不重不漏，实际 ' + palaceCount + '）');
      ok(wrongPalace.length === 0, '★★ 64 卦逐个核对：色号＝所属宫（11 乾/12 兑/13 离/14 坎/15 艮/16 坤/17 巽/18 震）'
        + (wrongPalace.length ? '　→ ' + wrongPalace.slice(0, 6).join('；') : ''));
      /* 调色板直接从 data.js 源码读（和 tools/内置牌组.py 的 palette() 同一口径，
         不依赖 jsdom 里的 MoKa）。 */
      const dataSrc5 = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8');
      const palM = dataSrc5.match(/const PALETTE = \[(.*?)\];/s);
      const pal19 = palM ? palM[1].split(',').map(x => x.trim().replace(/^'|'$/g, '')) : [];
      ok(pal19.slice(11, 19).join(',') === '#8a7cff,#ff5fa2,#ff5252,#4a9eff,#26d0ce,#ffd93d,#4cd964,#ff9f1a',
        '★★ PALETTE 11~18 ＝ 八宫色（乾薰衣草/兑粉/离珊瑚/坎天蓝/艮青/坤亮黄/巽嫩绿/震橙）实为 ' + pal19.slice(11, 19).join(','));
      // ⑧ 牌背：自有模板 guax，且它已经在 BACK_TPL 里（不打包时要进包的第一道）
      ok(G.back.template === 'guax' && G.back.color === '#46543f', '牌背＝内置「三爻」＋ 松绿 #46543f');
      const libSrc = fs.readFileSync(path.join(ROOT, 'js', 'scenes', 'library.js'), 'utf8');
      ok(typeof D.builtinBackSvg === 'function' && (D.builtinBackSvg('guax').match(/<path /g) || []).length === 5,
        '★ 三爻画得出来（三阳爻 + 上下两道细线，5 条 path，颜色已内联进 back.svg）');
      ok(D.builtinBackSvg('guax').indexOf('<img') < 0 && D.builtinBackSvg('guax').indexOf('url(') < 0,
        '三爻全是内联矢量，没有外部文件');
      // ⑨ 用户自己的同名卡不受它影响：它没有符号身份表
      ok(!D.isStarName('火水未济'),
        '★ 卦名不在任何"符号身份"表里（用户自己建的同名卡不会被清符号/被画图）');
    }
  }

  /* ============================================================
     5b. 周易牌组（zy64）：与易经牌组 gua64 **同一套内容**（同名同序 / 画法 / 色号 / 文案）
     ------------------------------------------------------------
     这副牌**不进牌库列表**（hidden=true），是周易功能专用（scenes/zhouyi*）。
     两者必须严丝合缝：周易桌按位取卦（第 i 卦 = 第 i 张），画法或色号一差，就是"另一幅卦"。
     2026-11-17 方案一：两副一起同步到用户导出包口径（关键词素字、牌背/牌面纸边关）。
     ★ 方案二（zy64 换古卦画 ＋ 复古八宫色）**不在本轮**：别在这里提前钉 polyline / 20~27，
       真落地时这一组的 art / color 断言要跟着改（设计稿在 临时/易经Plus-方案/）。
     ============================================================ */
  group('5b. 周易牌组（zy64）：与 gua64 同名同序、画法/色号/文案 64/64 一致');
  {
    const zyPath = path.join(DECKS, 'zy64', 'deck.json');
    const guaPath5b = path.join(DECKS, 'gua64', 'deck.json');
    if (!fs.existsSync(zyPath) || !fs.existsSync(guaPath5b)) {
      note('找不到 decks/zy64/deck.json 或 decks/gua64/deck.json');
    } else {
      const Z = JSON.parse(fs.readFileSync(zyPath, 'utf8'));
      const G5 = JSON.parse(fs.readFileSync(guaPath5b, 'utf8'));
      /* ① 牌组级：仍是功能专用的 hidden 副；样式与纸边跟用户导出包（2026-11-17） */
      ok(B.some(e => e.key === Z.key) && Z.key === 'zy64', '注册表里有它（key=zy64）');
      ok(Z.hidden === true, '★ 仍是 hidden（不进牌库列表，只给周易功能用）');
      ok(Z.backEdge === false && Z.faceEdge === false,
        '★ 牌组级纸边：backEdge=false / faceEdge=false（用户导出包口径）');
      ok(!!Z.cardStyle && Z.cardStyle.kwBgStyle === 'plain' && Z.cardStyle.nameBgStyle === 'plate',
        '★ 出厂样式：关键词素字（kwBgStyle=plain）＋ 牌名胶囊（nameBgStyle=plate）');
      /* ② 64 张、与易经牌组同名同序 */
      ok(Z.cards.length === 64, '64 张（现在 ' + Z.cards.length + '）');
      ok(Z.cards.map(c => c.name).join('|') === G5.cards.map(c => c.name).join('|'),
        '★ 与 gua64 同序同名（周易桌按位取卦：第 i 卦 = 第 i 张）');
      ok(Z.symbols === 'none' && Z.cards.every(c => !c.sym && !c.symbol), '★ symbols 仍是 none（不带符号身份）');
      /* ③ 画法 / 色号 / 文案 64/64 逐张一致（这一副就是 gua64 的内容副本） */
      const diff = [];
      Z.cards.forEach((c, i) => {
        const g = G5.cards[i] || {};
        ['art', 'color', 'keyword', 'meaning', 'faceText'].forEach(k => {
          if (c[k] !== g[k]) diff.push(c.name + ' 的 ' + k);
        });
      });
      ok(diff.length === 0, '★★ art / color / keyword / meaning 与 gua64 逐张一致（64/64）'
        + (diff.length ? '：' + diff.slice(0, 6).join('、') : ''));
      /* ④ 卦画本身仍然画得出来（内容与 gua64 同一套，这里只钉"渲染不断"） */
      ok(Z.cards.every(c => String(UI.artSVG(c)).indexOf('<svg') === 0 &&
        UI.artSVG(c).indexOf(String(c.art)) > 0),
        '★ 64 张 art 都真的画得出来（UI.artSVG 出 <svg>，且把 art 原样嵌进去）');
      const zLines = Z.cards.map(c => (String(c.art || '').match(/<line /g) || []).length);
      ok(zLines.every(n => n >= 6 && n <= 12),
        '★ 每张 art 仍是 6~12 条线（6 爻，阴爻拆两段；实测 ' +
        Math.min.apply(null, zLines) + '~' + Math.max.apply(null, zLines) + '）');
      ok(new Set(Z.cards.map(c => c.art)).size === 64, '★ 64 段 art 互不相同（没有两张牌一个卦画）');
      ok(Z.cards.every(c => String(c.art || '').indexOf('<img') < 0 && String(c.art || '').indexOf('http') < 0),
        '★ art 里没有 <img> / 外链（内联矢量，不落图片文件、不加新资源）');
      /* ⑤ 色号仍是「京房八宫」11~18（与 gua64 同一套；方案二的复古色 20~27 未落地） */
      ok(Z.cards.every(c => c.color >= 11 && c.color <= 18),
        '★ 色号都在 11~18（京房八宫色，与 gua64 同一套）');
    }
  }

  /* ============================================================
     6. 英雄之旅 / O 字头：内置牌组
        ★ 2026-11-13 曾下架成"可导入牌组"，同日用户改主意又内置回来。
          这一组钉"两副都在、牌面图/牌背都在"；详细的图同步链由别组覆盖。
     ============================================================ */
  group('6. 英雄之旅 / O 字头：内置牌组');
  {
    const w = boot(null);
    const D = w.MoKa.data;
    const hero = D.listDecks().filter(d => d.name === '英雄之旅')[0];
    const ov = D.listDecks().filter(d => d.name === 'Overflow牌组')[0];
    /* ★ 2026-11-19：用户要求「把英雄之旅下掉」—— 下架≠删除：注册表不再带它（新装机不建、包不装），
       但 decks/hero 的源文件与 19 张图必须原地留着，随时能「上架」搬回来。
       原来这 4 条钉的是"两副都在"，现在改成钉"下架后该在的还在、该不在的不在"。 */
    ok(!hero, '★ 英雄之旅 已下架（2026-11-19）：新装机不建、不进包');
    ok(fs.existsSync(path.join(__dirname, '..', 'decks', 'hero', 'deck.json')) &&
       fs.readdirSync(path.join(__dirname, '..', 'decks', 'hero', 'faces')).length === 19,
      '★ 下架只是不进包：decks/hero 的 deck.json 与 19 张图都还在（能上架搬回来）');
    ok(!!ov, '★ 新装机有「Overflow牌组」');
    ok(!!ov && ov.cards.length === 16, '★ Overflow 16 张（' + (ov && ov.cards.length) + '）');
    ok(!!ov && new Set(ov.cards.map(c => c.image)).size === 4 &&
      ov.cards.every(c => fs.existsSync(path.join(ROOT, c.image))), '★★ 16 张共用 4 张图、文件都在');
    ok(!!D.builtinBackSvg('overflow2') && !D.builtinBackSvg('hero'),
      '★ 只有进包的 overflow2 注册了牌背模板（英雄之旅下架后不再注册，不是 ✦ 兜底）');
    ok(fs.existsSync(path.join(ROOT, 'assets/deckimg/hero/_back-import.svg')) &&
       fs.existsSync(path.join(ROOT, 'assets/deckimg/overflow2/_back-import.svg')),
      '★ 下架那版留下的 _back-import.svg 还随包 —— 装过 2.4.2/2.4.3 的机器牌背不至于断');
  }


  /* ============================================================
     7. ★ 删除 / 下架 / 上架 这条流程本身（2026-10-06 加）
        「新增」一直是六步走；删除以前全靠手改（构建 194/196 那次），这一组钉住新加的那条路：
          · 命令在、key 打错要报错（不模糊匹配 —— 删错不可逆）
          · dry-run 一个文件都不许动（删除必须两步走）
          · 下架 / 上架 互逆，事后一切回原样
          · 删了牌组不许在别处留悬空引用（专属牌背模板 / 代码硬引用 / 不打包.txt 死行）
     ============================================================ */
  group('7. ★ 删除 / 下架 / 上架（工具流程 + 不许留悬空引用）');
  if (pkgMode || !fs.existsSync(DECKS) || !fs.existsSync(TOOL)) {
    note('包内模式 / 找不到 decks 或 tools —— 这一组只在源码里跑（工具「校验」在构建前会兜住）');
  } else {
    const crypto = require('crypto');
    const deckFiles = () => fs.readdirSync(DECKS).filter(f => fs.existsSync(path.join(DECKS, f, 'deck.json'))).sort();
    const deckObjs = () => deckFiles().map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(DECKS, f, 'deck.json'), 'utf8')); } catch (e) { return null; }
    }).filter(Boolean);
    const deckKeys = new Set(deckObjs().map(d => d.key));
    const skipPath = path.join(DECKS, '不打包.txt');
    const snapshot = () => {
      const h = crypto.createHash('md5');
      deckFiles().forEach(f => { h.update(f); h.update(fs.readFileSync(path.join(DECKS, f, 'deck.json'))); });
      h.update(fs.readFileSync(path.join(ROOT, 'js', 'builtin-decks.js')));
      h.update(fs.existsSync(skipPath) ? fs.readFileSync(skipPath) : '');
      return h.digest('hex');
    };
    const run = (args) => {
      try { return { code: 0, out: cp.execFileSync('python3', [TOOL].concat(args), { encoding: 'utf8' }) }; }
      catch (e) { return { code: e.status == null ? -1 : e.status, out: String(e.stdout || '') + String(e.stderr || '') }; }
    };

    const toolSrc = fs.readFileSync(TOOL, 'utf8');
    ok(/cmd_delete/.test(toolSrc) && /cmd_offline/.test(toolSrc) && /cmd_online/.test(toolSrc),
      '★ 工具里有 删除 / 下架 / 上架 三条命令（删除这条路不许再靠手改）');
    const patchBlock = (toolSrc.match(/DECK_PATCHES = \{([\s\S]*?)\n\}/) || [])[1] || '';
    const patchedKeys = [...patchBlock.matchAll(/^\s*'([a-z0-9_\-]+)':\s*\[[ \t]*$/gm)].map(m => m[1]);
    /* ★ 2026-10-08：**下架的牌组**（不打包.txt）不进注册表，但它在 DECK_PATCHES 里的登记要留着
       —— 上架时不用再补一遍。所以"多登记"判定得把下架的排除掉。
       （以前没遇到过：那几副被排除的牌组当时还没有自己的 DECK_PATCHES 条目。） */
    const skipTxt3 = path.join(DECKS, '不打包.txt');
    const skip3 = new Set(fs.existsSync(skipTxt3)
      ? fs.readFileSync(skipTxt3, 'utf8').split('\n').map(l => l.split('#')[0].trim()).filter(Boolean) : []);
    const missingPatch = B.map(e => e.key).filter(k => patchedKeys.indexOf(k) < 0);
    const extraPatch = patchedKeys.filter(k => B.every(e => e.key !== k) && !skip3.has(k));
    ok(missingPatch.length === 0 && extraPatch.length === 0,
      '★ 每副内置牌组都在工具的 DECK_PATCHES 登记了专属补丁（' + patchedKeys.join('/') + '）' +
      (missingPatch.length ? '；漏登记：' + missingPatch.join('/') : '') +
      (extraPatch.length ? '；多登记：' + extraPatch.join('/') : ''));

    const bad = run(['删除', 'zz_no_such_key']);
    ok(bad.code !== 0 && /没有 key/.test(bad.out),
      '★ 删除一个不存在的 key：退出非 0 且明说"没有 key"（绝不模糊匹配）');

    const target = B[B.length - 1];
    const before = snapshot();
    const dry = run(['删除', target.key]);
    ok(dry.code === 0, '删除 <key> 不带 --确认 = dry-run，退出 0（拿 ' + target.key + ' 做探针）');
    ok(snapshot() === before, '★★ dry-run 一个文件都没动（删除必须"先看清单、再 --确认"两步走）');
    ok(/会自动删掉的文件/.test(dry.out) && /人工/.test(dry.out) && /--确认/.test(dry.out),
      'dry-run 清单分了"自动删 / 人工清"，并提示加 --确认 才真删');
    ok(/老装机/.test(dry.out) && /原样保留/.test(dry.out),
      '★ dry-run 明说：老装机上那副原样保留（删除只影响包，不动用户数据）');
    ok(/专属补丁/.test(dry.out), 'dry-run 里有「专属补丁」一节（把 DECK_PATCHES 自动列出来）');

    /* 下架 → 上架 必须互逆。真跑，finally 里无论如何恢复原样 */
    const skipOrigin = fs.existsSync(skipPath) ? fs.readFileSync(skipPath, 'utf8') : null;
    const targetFile = deckFiles().find(f => {
      try { return JSON.parse(fs.readFileSync(path.join(DECKS, f, 'deck.json'), 'utf8')).key === target.key; } catch (e) { return false; }
    });
    const targetPath = path.join(DECKS, targetFile || '');
    try {
      const off = run(['下架', target.key]);
      const lineOn = fs.existsSync(skipPath) &&
        fs.readFileSync(skipPath, 'utf8').split('\n').map(l => l.split('#')[0].trim()).indexOf(target.key) >= 0;
      ok(off.code === 0 && lineOn, '下架 = 只在不打包.txt 写一行（' + target.key + '）');
      ok(!!targetFile && fs.existsSync(targetPath), '★ 下架不动源文件：decks/' + targetFile + ' 还在');
      const reg = fs.readFileSync(path.join(ROOT, 'js', 'builtin-decks.js'), 'utf8');
      ok(reg.indexOf('key: "' + target.key + '"') < 0, '下架后注册表里没有它了（这个包不带它）');
      const on = run(['上架', target.key]);
      const lineOff = !fs.existsSync(skipPath) ||
        fs.readFileSync(skipPath, 'utf8').split('\n').map(l => l.split('#')[0].trim()).indexOf(target.key) < 0;
      ok(on.code === 0 && lineOff, '上架 = 删掉那一行');
    } finally {
      if (skipOrigin === null) { if (fs.existsSync(skipPath)) fs.unlinkSync(skipPath); }
      else fs.writeFileSync(skipPath, skipOrigin);
      run(['生成']);
    }
    ok(snapshot() === before, '★ 下架 → 上架 → 生成 之后，一切回到原样（含注册表字节）');

    /* 删了牌组，别处不许留悬空引用（工具「校验」里那三条守卫的走查版） */
    // ★ 牌背数据化后：每个带 backSvg 的内置牌组，其 back.template 必须非空（数据完整）
    const backOk = B.filter(e => e.backSvg).every(e => e.back && e.back.template);
    ok(B.some(e => e.backSvg) && backOk, '★ 内置牌背都带 backSvg 且 back.template 非空（数据化，不再写死在代码里）');

    const hardKeys = new Set();
    ['js', 'js/scenes'].forEach(sub => fs.readdirSync(path.join(ROOT, sub)).forEach(f => {
      if (!f.endsWith('.js') || f === 'builtin-decks.js') return;
      [...fs.readFileSync(path.join(ROOT, sub, f), 'utf8')
        .matchAll(/builtinKey\s*===\s*'([a-z0-9_\-]+)'/g)].forEach(m => hardKeys.add(m[1]));
    }));
    const lostKeys = [...hardKeys].filter(k => !deckKeys.has(k));
    ok(hardKeys.size > 0 && lostKeys.length === 0,
      '★ 代码里按 builtinKey 找的牌组都还在 decks/（' + [...hardKeys].join('/') + '）—— 删了要一起改' +
      (lostKeys.length ? '；找不到：' + lostKeys.join('/') : ''));

    const skipNow = fs.existsSync(skipPath)
      ? fs.readFileSync(skipPath, 'utf8').split('\n').map(l => l.split('#')[0].trim()).filter(Boolean) : [];
    const deadSkip = skipNow.filter(k => !deckKeys.has(k));
    ok(deadSkip.length === 0, '★ 不打包.txt 里没有已不存在的 key（删牌组要一起清那一行）' +
      (deadSkip.length ? '；死行：' + deadSkip.join('/') : ''));
  }

  /* ============================================================
     8. ★ 每副牌组的 checks.json（专属内容期望）与注册表一致
     ============================================================ */
  group('8. checks.json（牌组专属内容期望）与注册表一致');
  if (pkgMode || !fs.existsSync(DECKS)) {
    note('包内模式 / 找不到 decks —— 这一组只在源码里跑');
  } else {
    // ★ 2026-10-08：下架的牌组（不打包.txt）不在注册表里，它的 checks.json 自然对不上 —— 跳过。
    const skipTxt8 = path.join(DECKS, '不打包.txt');
    const skip8 = new Set(fs.existsSync(skipTxt8)
      ? fs.readFileSync(skipTxt8, 'utf8').split('\n').map(l => l.split('#')[0].trim()).filter(Boolean) : []);
    const dirs = fs.readdirSync(DECKS).filter(f => fs.existsSync(path.join(DECKS, f, 'deck.json'))).sort()
      .filter(f => !skip8.has(JSON.parse(fs.readFileSync(path.join(DECKS, f, 'deck.json'), 'utf8')).key));
    dirs.forEach(function (dn) {
      const cp = path.join(DECKS, dn, 'checks.json');
      if (!fs.existsSync(cp)) { note(dn + ' 没有 checks.json（允许）'); return; }
      let ch;
      try { ch = JSON.parse(fs.readFileSync(cp, 'utf8')); } catch (e) { ok(false, dn + ' 的 checks.json 读不了：' + e.message); return; }
      const e = B.find(function (x) { return x.key === dn; });
      ok(!!e, 'checks.json 对应注册表里有 ' + dn);
      if (!e) return;
      if (ch.name) ok(e.name === ch.name, dn + ' name = ' + ch.name + '（实际 ' + e.name + '）');
      if (ch.cards != null) ok(e.cards.length === ch.cards, dn + ' 张数 = ' + ch.cards + '（实际 ' + e.cards.length + '）');
      if (ch.symbols) ok(e.symbols === ch.symbols, dn + ' symbols = ' + ch.symbols + '（实际 ' + e.symbols + '）');
      if (ch.backTemplate !== undefined) {
        const bt = (e.back || {}).template || null;
        ok(bt === ch.backTemplate, dn + ' backTemplate = ' + ch.backTemplate + '（实际 ' + bt + '）');
      }
      if (ch.retiredNames != null) ok((e.retiredNames || []).length === ch.retiredNames, dn + ' retiredNames = ' + ch.retiredNames + '（实际 ' + (e.retiredNames || []).length + '）');
      if (ch.hidden !== undefined) ok(!!e.hidden === !!ch.hidden, dn + ' hidden = ' + !!ch.hidden + '（实际 ' + !!e.hidden + '）');
    });
  }

  /* ============================================================
     9. ★ 牌组「使用说明」弹层：谁有 manual 显示谁（通用机制，不写死牌组）
     ============================================================ */
  group('9. 牌组「使用说明」（manual 数据化 + 通用弹层）');
  {
    const withManual = B.filter(function (e) { return e.manual && (e.manual.sections || []).length; });
    ok(withManual.length >= 1, '注册表里有牌组带 manual（' + withManual.length + ' 副）');

    // ★★ 铁律：说明书是通用机制 —— library.js 里不许出现任何牌组的 key
    const libSrc = fs.readFileSync(path.join(ROOT, 'js', 'scenes', 'library.js'), 'utf8');
    const hardCoded = B.map(function (e) { return e.key; }).filter(function (k) {
      return k && new RegExp("['\"]" + k + "['\"]").test(libSrc);
    });
    ok(hardCoded.length === 0, '★★ library.js 里没有写死任何牌组 key' +
       (hardCoded.length ? '（发现：' + hardCoded.join('/') + '）' : '（说明书完全靠 deck.manual 驱动）'));

    // 有 manual 的牌组：弹层能开、内容确实来自 manual、牌阵两种排法都在
    withManual.forEach(function (e) {
      const deck = w.MoKa.data.listDecks(true).filter(function (d) { return d.builtinKey === e.key; })[0];
      ok(!!deck, '（注册表里的 ' + e.key + ' 在装机牌组里找得到）');
      if (!deck) return;
      const opened = w.MoKa.library.showManual(deck);
      ok(opened === true, e.key + '：showManual() 打开成功');
      const layer = w.document.getElementById('manual-layer');
      const txt = layer ? layer.querySelector('.manual-scroll').textContent : '';
      (e.manual.sections || []).forEach(function (sec) {
        if (sec.title) ok(txt.indexOf(sec.title) >= 0, e.key + '：说明里有「' + sec.title + '」');
      });
      const layouts = [];
      (e.manual.sections || []).forEach(function (sec) { (sec.layouts || []).forEach(function (L) { layouts.push(L); }); });
      layouts.forEach(function (L) {
        const cls = L.shape === 'diamond' ? '.spread.is-diamond' : '.spread.is-row';
        const got = layer.querySelectorAll(cls + ' .spread-slot').length;
        ok(got === (L.slots || []).length,
           e.key + '：牌阵「' + (L.name || '') + '」示意图 ' + got + ' / ' + (L.slots || []).length + ' 个位');
      });
      // ★ 返回键必须能关掉说明弹层（否则按返回会直接退出牌库，用户 2026-10-07 报的）
      w.MoKa.library.showManual(deck);
      ok(w.MoKa.library.back() === true && !layer.classList.contains('is-on'),
         e.key + '：返回键能关掉说明弹层（不是关整个牌库）');
      w.MoKa.library.hideManual();
      ok(!layer.classList.contains('is-on'), e.key + '：hideManual() 收起来了');
      ok(w.MoKa.library.hideManual() === false, e.key + '：没开着时 hideManual() 返回 false（不吃返回键）');
    });
  }

  console.log('\n----------------------------------------');
  if (fail) { console.log('失败 ' + fail + ' 条 / 共 ' + (pass + fail) + ' 条' + (skip ? '（跳过 ' + skip + ' 条）' : '')); fails.forEach(f => console.log('  ✗ ' + f)); process.exitCode = 1; }
  else console.log('全部通过 ✔  ' + pass + ' 条' + (skip ? '（跳过 ' + skip + ' 条）' : ''));
})();
