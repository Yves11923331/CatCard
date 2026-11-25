/* ============================================================
 * 猫卡 · 神签 (lots.js)
 * ------------------------------------------------------------
 * 这个模块是 mQimen「神签」的移植：
 *   · 文案   —— 照抄 mqimen_src/js/script.min.js 里的 $lbl_*（下面那张表是脚本抽出来的）
 *   · 排版   —— 照抄 mqimen_src/index.html 的 #tGod / #tDraw / #tWrite（含 id 与 class 名）
 *               对应的 CSS 也照抄进 css/v3.css（.god-tut-example / .ex-badge / .tut-divider /
 *               .lot-item / .lot-del / .lot-index / .lot-text / #draw_box 那几条），
 *               只把颜色换猫卡的黑白灰（主题跟着猫卡走）
 *   · 交互   —— 照抄 script.min.js：求签 / 抽签 / 写签 三页，必须填所问、随机一条、
 *               随写随存、「储存」= 保存并回求签页、进写签页清零删除计数（前 2 次删要确认）、
 *               抽签页与写签页隐藏底栏、写签页右下角悬浮「滚到底部」
 * 猫卡这边的差异（就这几条，记录 §6c 有写）：
 *   1. 外壳用猫卡自己的：顶栏「‹ …」返回 + 底部 tabbar（原版是 mQimen 的 header/footer）
 *   2. 「找回」不在这页 —— 挪到「设置 → 神签」（对外 openRestore）
 *   3. 导出多一条「保存为文件」（走 LotFile 桥，落 Download/猫卡/，文件名走设置页的命名模板）；
 *      导入多一条「从文件导入」
 *   4. 没有 icon font：原版用 fontawesome 图标的位置，这里改内联 SVG 或字符
 * 存储键：moka.lots.packs / moka.lots.active / moka.lots.hist / moka.lots.delCount
 * ============================================================ */
(function (global) {
  'use strict';
  const UI = global.MoKa.ui;
  const RND = global.MoKa.random;   // 抽签 / 挑问题：统一走 crypto 随机源

  /* ============================================================
   * 文案表：脚本从 mQimen 的 script.min.js 抽出来的 $lbl_*（中文那一列）
   * —— 别手改这里，要改就去改原版再重抽
   * ============================================================ */
  const T = {
   "lbl_btn_copy": "复制",
   "lbl_btn_draw": "抽签",
   "lbl_btn_draw_again": "再抽一次",
   "lbl_btn_export_file": "保存为文件",
   "lbl_btn_import": "导入",
   "lbl_btn_import_file": "从文件导入",
   "lbl_btn_write": "写签",
   "lbl_exp_fmt_json": "JSON（精确）",
   "lbl_exp_fmt_text": "文本（可读）",
   "lbl_exp_from": "从",
   "lbl_exp_rng_all": "全部",
   "lbl_exp_rng_part": "自定义",
   "lbl_exp_to": "到",
   "lbl_export_fmt": "格式",
   "lbl_export_range": "范围",
   "lbl_export_title": "导出签文",
   "lbl_god_empty": "还没有签文，请先到「写签」添加",
   "lbl_god_tut_title": "求签教程",
   "lbl_import_title": "导入签文",
   "lbl_lot_add": "新建",
   "lbl_lot_del_confirm": "确定删除这条签文？前 2 次删除需确认。",
   "lbl_lot_del_hint": "前 2 次删除签文需确认（已确认 {n} 次，之后免确认）",
   "lbl_lot_export": "导出",
   "lbl_lot_hint": "签文内容…",
   "lbl_lot_import": "导入",
   "lbl_lot_save": "储存",
   "lbl_pack_active": "当前签文包",
   "lbl_pack_add_confirm": "新建一个空签文包并切换到它？",
   "lbl_pack_del_confirm": "确定删除当前签文包？",
   "lbl_pack_min": "至少保留一个签文包",
   "lbl_pack_new": "签文包",
   "lbl_pack_title": "签文包",
   "lbl_question_empty": "请先输入你的问题",
   "lbl_question_ph": "输入你的问题，建议用「是/否」式提问…",
   "lbl_question_prefix": "问题",
   "lbl_restore_close": "关闭",
   "lbl_restore_confirm": "恢复后将覆盖当前签文，确定恢复？",
   "lbl_restore_done": "已恢复",
   "lbl_restore_empty": "暂无可用快照\n修改签文后系统会自动留底",
   "lbl_restore_lots": " 条签文",
   "lbl_restore_lots_title": "签文快照",
   "lbl_restore_packs": " 个签文包 · ",
   "lbl_restore_title": "找回",
   "lbl_title_draw": "抽签",
   "lbl_title_god": "神签",
   "lbl_title_write": "写签",
   "lbl_tut_done": "自己使用，看到这里就够了",
   "lbl_tut_share": "分享给他人（可选）",
   "lbl_tut_title": "使用教程"
  };

  // $lbl_god_tut（求签教程）
  const GOD_TUT = [
   [
    "① 怎么求",
    "在输入框输入你的问题，点「抽签」，随机得到一签。"
   ],
   "② 两种问法，各有适合的签文",
   [
    "是否式",
    "「能不能成？」",
    "适合断语型签文，签文直接回答成or不成"
   ],
   "✅ 是否式",
   [
    "开放式",
    "「他对我是什么感情？」",
    "适合描述型签文，让签文自己描绘"
   ],
   "💬 开放式"
  ];

  // $lbl_tut_main（③④⑤ 的正文在 TUT_SHARE_STEPS）
  const TUT_MAIN = [
   [
    "① 写签",
    "点击「新建」创建签文框，每个框写一条签文，随写随存。"
   ],
   [
    "② 抽签",
    "进入「抽签」随机抽取一条，范围为当前选中的签文包，可在顶部切换。"
   ]
  ];
  const TUT_SHARE_STEPS = [
   [
    "③ 导出",
    "在「写签」页点「导出」→「保存为文件」，全部签文存成 JSON 文件，签文再多也不怕。"
   ],
   [
    "④ 分享",
    "保存后自动弹出分享面板，把文件发给好友，对方即获得同一套签文。"
   ],
   [
    "⑤ 导入",
    "好友点「导入」→「从文件导入」，选择收到的文件，即可开始使用。"
   ]
  ];

  const K_PACKS = 'moka.lots.packs';
  const K_ACTIVE = 'moka.lots.active';
  const K_HIST = 'moka.lots.hist';
  const K_DELCNT = 'moka.lots.delCount';
  /* ★★ 2026-09-23：同一个存储里再留**第二份**（另一个键）。
     用户报的正是「只有签文这一个键没了、牌组图片都在」—— 整个存储被清那类事故不会只丢它一个，
     所以先按「单键丢失/损坏」兜住：主键读不出来时自动从这份恢复，并把主键回写。 */
  const K_BAK = 'moka.lots.packs.bak';
  /* ★ 2026-09-23：**内置签文包**（内容在 app/lots/*.txt → 生成 www/js/builtin-lots.js）。
     规矩照内置牌组那套来（踩过的坑都在这儿）：
       · 新装机：直接把内置包当当前包，打开就有签可抽；
       · 老装机：**缺了才补**（追加成新包，不动你现有的包、也不抢你当前选的那个）；
       · 用户删过 → 再不塞回来（localStorage 的 moka.lots.seed 标记，删了就是不要了）；
       · 同名包已存在（哪怕内容不一样）→ 一个字都不动。
     想再要回来：设置 → 神签 →「恢复内置签文包」。 */
  const K_SEED = 'moka.lots.seed';
  /* ★ 内置包改过名：本机那条旧名就地改成新名、并换成新版内容（一次性，跑过就打标记）。
     只认"本机确实有旧名那条"—— 用户自己删过的包不会因此被塞回来。 */
  function migrateRenamed() {
    const K = 'moka.lots.renamed.v1';
    try { if (localStorage.getItem(K)) return 0; } catch (e) { return 0; }
    const B = builtinPacks();
    const p = packs();
    let n = 0;
    B.forEach(function (b) {
      (b.renamedFrom || []).forEach(function (old) {
        const i = p.findIndex(function (x) { return x && x.name === old; });
        if (i < 0) return;
        if (p.some(function (x) { return x && x.name === b.name; })) { p.splice(i, 1); }
        else { p[i] = { name: b.name, lots: b.lots.slice() }; }
        n++;
      });
    });
    try { localStorage.setItem(K, '1'); } catch (e) {}
    if (n) putPacks(p);
    return n;
  }

  function builtinPacks() {
    const B = (global.MoKaBuiltinLots || []);
    return Array.isArray(B) ? B.filter(function (x) { return x && x.name && Array.isArray(x.lots) && x.lots.length; }) : [];
  }
  function seedBuiltin() {
    const B = builtinPacks();
    if (!B.length) return 0;
    let marked = null;
    try { marked = localStorage.getItem(K_SEED); } catch (e) { return 0; }
    if (marked) return 0;
    const p = packs();
    let n = 0;
    B.forEach(function (b) {
      if (p.some(function (x) { return x && x.name === b.name; })) return;   // 同名：不碰
      const onlyEmptyDefault = p.length === 1 && !(p[0].lots || []).length && p[0].name === T.lbl_pack_new;
      if (onlyEmptyDefault) p[0] = { name: b.name, lots: b.lots.slice() };    // 全新装机：直接当当前包
      else p.push({ name: b.name, lots: b.lots.slice() });                   // 老装机：追加，不抢当前包
      n++;
    });
    if (n) putPacks(p);
    try { localStorage.setItem(K_SEED, '1'); } catch (e) {}
    return n;
  }
  /* 设置页那一行：「内置签文包」现在是什么状态（有几条 / 本机有没有） */
  function builtinInfo() {
    const B = builtinPacks();
    if (!B.length) return { packs: 0, here: 0, text: '（这个版本没有）' };
    const p = packs();
    const here = B.filter(function (b) { return p.some(function (x) { return x && x.name === b.name; }); });
    const text = B.map(function (b) {
      return b.name + ' ' + b.lots.length + (p.some(function (x) { return x && x.name === b.name; }) ? '✓' : '✗');
    }).join(' · ');
    return { packs: B.length, here: here.length, text: text };
  }
  /* 设置页那个「恢复内置签文包」按钮：用户自己删过之后还能要回来 */
  function restoreBuiltin() {
    const B = builtinPacks();
    if (!B.length) { UI.toast('这个版本没有内置签文包'); return 0; }
    const p = packs();
    let n = 0, renamed = 0;
    B.forEach(function (b) {
      /* ★ 改过名的内置包：旧名那条就地清掉（否则同内容会留两份）—— 名字见 tools/内置签文.py 的 RENAME */
      (b.renamedFrom || []).forEach(function (old) {
        for (let i = p.length - 1; i >= 0; i--) {
          if (p[i] && p[i].name === old) { snapshot(); p.splice(i, 1); renamed++; }
        }
      });
      if (p.some(function (x) { return x && x.name === b.name; })) return;
      snapshot();
      p.push({ name: b.name, lots: b.lots.slice() });
      n++;
    });
    if (n || renamed) {
      /* ★ 2026-10-15 两处修：
         ① 这是**显式恢复**（用户自己点了按钮）→ 必须带 force。数据读坏时 `_broken` 非空，
            不带 force 会被 putPacks 直接拒写 —— 而这个按钮恰恰是那种状态下**唯一的自救入口**，
            原来是"点了没反应、还照样报已恢复"。
         ② 写盘失败就别报成功（putPacks 已经弹了失败原因），否则用户以为救回来了。 */
      const wrote = putPacks(p, { force: true });
      render();
      if (!wrote) return n;
      UI.toast(renamed ? ('已更新内置签文包（' + renamed + ' 个旧名清理掉）') : ('已恢复内置签文包（' + B[0].lots.length + ' 条）'));
    } else UI.toast('内置签文包已经在里面了');
    return n;
  }
  const HIST_MAX = 10;                 // 快照最多留 10 份（原版同）
  // 签文排版：短签居中（原版就是 text-center），长签顶格
  //   判定 = 行数 ≤ LOT_CENTER_LINES 且 去空白字数 ≤ LOT_CENTER_CHARS 才算"短"
  //   超过任一条就走顶格（多行签、长签居中会很散）
  const LOT_CENTER_LINES = 2;
  const LOT_CENTER_CHARS = 24;

  let page = null;
  let view = 'god';                    // god | draw | write
  let question = '';                   // 原版 $god_question
  let drawn = null;
  let drawnAlign = 'center';           // 这一签在屏幕上是居中还是顶格（截图按同一档画）
  let shooting = false;                // 截图进行中：连点不重复出图

  /* ---------------- 数据（键名沿用猫卡，结构与原版 mqm_packs 相同） ---------------- */
  function readJSON(key, fb) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fb : v; }
    catch (e) { return fb; }
  }
  function writeJSON(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; }
  }
  /* ★ 内存权威副本（只做缓存，不动"随写随存"的语义）。
     原来 packs() 每次都 JSON.parse 整个签文包，而 saveLots() = packs() 解析一次
     + JSON.stringify + localStorage 写一次，**input 事件是每敲一个字都调** ——
     用户那个包 676 条签文 ≈ 105KB，实测每敲一个字要 4 次 JSON.parse(105KB)。
     现在内存里留一份权威副本，packs() 直接返回它，解析次数 4 → 0（实测 40 个字
     136ms → 90ms；真机上 setItem 还要同步落盘，省得更多）。
     ★ 刻意**不**把写盘也改成去抖：那会破坏"随写随存"这个既有契约
       （localStorage 里必须立刻就是最新），而且会留一个"没落盘就崩"的丢字窗口。 */
  let _packsCache = null;
  let _packsRaw = null;      // 上次读/写时的原始字符串：用来发现"有人绕过 putPacks 直接写了 localStorage"
  /* ★★ 2026-09-23：**"读不出来"绝不许被当成"没有"** —— 用户报"更新之后签文会丢"。
     老写法里 readJSON 一旦解析失败就返回 null → packs() 静默换成一个**空包** →
     用户只要在写签/抽签页碰一下（随写随存），这个空包就把真数据盖掉了，
     表现就是"签文全没了"，而且**一声不响**。
     现在：raw 明明有值却解析不出来 → 记下 _broken，packs() 照旧给一个空包让界面能用，
     但 putPacks() **拒绝写入**（除非走 import/restore 那种显式覆盖），并提示用户去导入备份。 */
  let _broken = null;        // 非 null = 源数据在但读不出来（存着那串原文的前 80 字，够定位）
  function isBroken() { return _broken !== null; }

  function packs() {
    // 比对"上次那串原文"：一样就用缓存，不一样说明外部直接写过 localStorage，重新解析。
    // 这样既有缓存（省掉每敲一个字 4 次 JSON.parse(105KB)），又不破坏"localStorage 是唯一真相"的契约。
    let raw = null;
    try { raw = localStorage.getItem(K_PACKS); } catch (e) { raw = null; }
    if (_packsCache && raw === _packsRaw) return _packsCache;
    let p = null, failed = false;
    if (typeof raw === 'string' && raw !== '') {
      try { p = JSON.parse(raw); } catch (e) { failed = true; }
    } else if (raw === null || raw === '') {
      p = readJSON(K_PACKS, null);            // 真没有（首次用）
    }
    // 主键没有 / 读不出来 / 不是数组 → **先试第二份**（能救就自动救回来）
    if (failed || p === null || !Array.isArray(p) || !p.length) {
      const salv = tryMirror();
      if (salv) {
        p = salv; failed = false; _broken = null;
        try { global.MoKa.ui.toast('签文已从本机备份自动恢复（共 ' + packCount(salv) + ' 条）'); } catch (e) {}
      }
    }
    if (failed || (p !== null && !Array.isArray(p))) {
      _broken = String(raw).slice(0, 80);
      try {
        if (!packs._warned) { packs._warned = 1; global.MoKa.ui.toast('签文读取出错：已停止写入，别在这里改；去「设置 → 神签」导入你的备份'); }
      } catch (e) {}
      p = null;
    }
    if (!Array.isArray(p) || !p.length) p = [{ name: T.lbl_pack_new, lots: [] }];
    p.forEach(function (x, i) {
      if (!x || typeof x !== 'object') p[i] = { name: T.lbl_pack_new + ' ' + (i + 1), lots: [] };
      if (!Array.isArray(p[i].lots)) p[i].lots = [];
      if (!p[i].name) p[i].name = T.lbl_pack_new + ' ' + (i + 1);
    });
    _packsCache = p;
    _packsRaw = raw;
    return p;
  }
  // 同步落盘（保持"随写随存"）：内存副本和 localStorage 一起更新。
  // 只 stringify 一次，并把那串原文记下来给 packs() 比对用。
  function putPacks(p, opt) {
    if (_broken !== null && !(opt && opt.force)) {
      try { global.MoKa.ui.toast('签文读取异常，已暂停写入。请到「设置 → 神签」导入备份'); } catch (e) {}
      return false;
    }
    /* ★★ 2026-10-15 修（静默分叉）：**写盘成功之前，绝不动内存缓存**。
       原来 `_packsCache = p` 写在 setItem 前面，于是配额一满就是三重假象：
         · putPacks 返回 false，但调用方没人看，紧接着照报「已导入 N 条」；
         · 更糟的是 packs() 拿 _packsRaw（还是**旧**串）一比对，认定"盘上没变"，
           直接把这份**没落盘**的数据当权威返回 —— 界面、列表、后续编辑全当真；
         · 直到重启才整体回退，中间用户做的每一件事都白做。
       现在：先 stringify、再 setItem；**成功才换缓存**。失败 = 返回 false + 保持旧值。 */
    let str;
    try { str = JSON.stringify(p); }
    catch (e) {
      try { global.MoKa.ui.toast('签文保存失败：数据无法序列化'); } catch (e2) {}
      return false;
    }
    try {
      localStorage.setItem(K_PACKS, str);
    } catch (e) {
      /* ★★ 失败时必须**把内存副本作废**，光"不赋值"是不够的 ——
         调用方拿到的是 packs() 返回的那个**对象引用**（packs():305 把 _packsCache 指向它），
         它在调 putPacks 之前就已经 push/splice 改过了；盘上没变（setItem 抛错），
         下次 packs() 一看 raw === _packsRaw 就把这份**没落盘**的副本当权威返回，
         界面、后续编辑全当真，重启才回退。
         作废之后下次 packs() 会重新解析盘上的（旧）数据 —— 正好回到
         "localStorage 是唯一真相"那个契约（packs() 开头注释自己写的）。 */
      _packsCache = null;
      _packsRaw = null;
      try { global.MoKa.ui.toast('签文保存失败：存储空间可能已满（建议先导出备份）'); } catch (e2) {}
      return false;
    }
    _packsCache = p;
    _packsRaw = str;
    _broken = null;
    mirror(str);
    return true;
  }
  function packCount(ps) { let n = 0; (ps || []).forEach(function (x) { n += ((x && x.lots) || []).length; }); return n; }
  /* 第二份（同存储、另一个键）：主键丢了/坏了就拿它救，救回来顺手回写主键。 */
  function tryMirror() {
    try {
      const b = localStorage.getItem(K_BAK);
      if (!b) return null;
      const v = JSON.parse(b);
      if (!Array.isArray(v) || !v.length || !packCount(v)) return null;
      try { localStorage.setItem(K_PACKS, b); _packsRaw = b; } catch (e) {}
      return v;
    } catch (e) { return null; }
  }
  let _bkAt = 0;                 // 「第二份」的节流
  let _fAt = 0, _fLast = '';      // 「文件备份」的节流（独立计时，别互相压）
  /* 主键写成功后才调：同一串内容另存一份到 K_BAK（节流 20 秒），再走文件备份。 */
  function mirror(str) {
    try {
      if (!str) return;
      const now = Date.now();
      if (now - _bkAt >= 20000) { localStorage.setItem(K_BAK, str); _bkAt = now; }
    } catch (e) { /* 第二份写不下不能影响主流程 */ }
    autoBackup(str);
  }

  /* ★★ 自动文件备份（2026-09-23）：localStorage 只有一份，一旦被清/损坏就真没了。
     每次成功落盘后，最多每 30 秒、且内容变了才往 Download/猫卡/ 写一份
     「签文-自动备份.json」（走现成的文件桥 io.saveTextFile，不用新权限）。
     恢复：设置 → 神签 → 导入签文 → 从文件导入，选这份文件即可。 */
  const BK_NAME = '签文-自动备份.json';
  function autoBackup(str) {
    try {
      if (!str || str === _fLast) return;
      const now = Date.now();
      if (now - _fAt < 30000) return;
      const io = global.MoKa && global.MoKa.io;
      if (!io || !io.saveTextFile) return;
      const r = io.saveTextFile(BK_NAME, str, { share: false });   // ★ 自动备份只写文件，不弹分享面板（用户报过）
      if (r && r.err) return;                 // 写不成就静默放过，别打扰用户
      _fAt = now; _fLast = str;
    } catch (e) {}
  }
  function activeIdx() {                       // 原版 get_active_idx()
    const i = parseInt(localStorage.getItem(K_ACTIVE), 10);
    const p = packs();
    return (isNaN(i) || i < 0 || i >= p.length) ? 0 : i;
  }
  function setActiveIdx(i) { try { localStorage.setItem(K_ACTIVE, String(i)); } catch (e) {} }
  function lots() { return packs()[activeIdx()].lots; }
  function saveLots(l) { const p = packs(); p[activeIdx()].lots = l; return putPacks(p); }
  function activePackName() { return packs()[activeIdx()].name; }
  function nonEmpty(l) { return l.filter(function (t) { return t && String(t).trim() !== ''; }); }

  /* 改动前留底 —— 照抄原版 $snap_lots() */
  function snapshot() {
    const cur = localStorage.getItem(K_PACKS);
    if (!cur) return;
    let hist = readJSON(K_HIST, []);
    if (!Array.isArray(hist)) hist = [];
    try {
      const snap = { ts: Date.now(), packs: JSON.parse(cur) };
      if (!hist.length || JSON.stringify(hist[hist.length - 1].packs) !== JSON.stringify(snap.packs)) {
        hist.push(snap);
        if (hist.length > HIST_MAX) hist = hist.slice(-HIST_MAX);
        /* ★ 2026-09-23 回退记录：这里一度按总字节封顶到 200KB（怕快照吃满 localStorage）——
           用户不接受"找回点变少"，已退回原样：只按**份数**留最近 10 份。 */
        writeJSON(K_HIST, hist);
      }
    } catch (e) {}
  }
  function hist() { const h = readJSON(K_HIST, []); return Array.isArray(h) ? h : []; }

  /* 删除确认计数（原版 mqm_lot_del_count，每次进写签页清零） */
  function delCount() { return parseInt(localStorage.getItem(K_DELCNT), 10) || 0; }
  function setDelCount(n) { try { localStorage.setItem(K_DELCNT, String(n)); } catch (e) {} }

  /* ---------------- 小工具 ---------------- */
  function pad(n) { return ('00' + n).slice(-2); }
  function esc(s) { return UI.esc(s); }
  // 照抄原版 $fmt_ts()
  function fmtTs(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '（时间不详）';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  // 签文框随内容长高（原版是 rows=2 的 form-control，猫卡这边给它自动长高）
  function autoGrow(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight ? (ta.scrollHeight + 'px') : '';
  }
  // 原版进写签页/抽签页会 $("#footer").hide()，求签页 show —— 这里对应底部 tabbar
  function showTabbar(on) {
    const tb = document.getElementById('tabbar');
    if (tb) tb.style.display = on ? '' : 'none';
  }

  // 一键到底/到顶：要"飞快但有过程"（rAF 缓动），别瞬时跳过去
  function animateScroll(toBottom) {
    const sc = page && page.querySelector('.lib-scroll');
    const targets = [page, sc].filter(Boolean);
    let reduce = false;
    try { reduce = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
    targets.forEach(function (el) {
      const from = el.scrollTop || 0;
      const to = toBottom ? (el.scrollHeight || 0) : 0;
      if (reduce || Math.abs(to - from) < 2) { el.scrollTop = to; return; }
      const DUR = 260;                                   // 快，但看得见过程
      const t0 = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
      const step = function (now) {
        const t = (typeof now === 'number' ? now : Date.now()) - t0;
        const p = Math.min(1, t / DUR);
        const e = 1 - Math.pow(1 - p, 3);                // easeOutCubic：起步快、收尾稳
        el.scrollTop = from + (to - from) * e;
        updateFab();
        if (p < 1) global.requestAnimationFrame(step);
        else { el.scrollTop = to; updateFab(); }
      };
      global.requestAnimationFrame(step);
    });
  }

  // 右下角圆钮：滑动时才露出来；已经到底了就地变成"回到顶部"
  function updateFab() {
    const fab = page && page.querySelector('#btn_lot_bottom');
    if (!fab) return;
    const sc = page.querySelector('.lib-scroll') || page;
    const top = Math.max(page.scrollTop || 0, sc.scrollTop || 0);
    const ch = Math.max(page.clientHeight || 0, sc.clientHeight || 0);
    const sh = Math.max(page.scrollHeight || 0, sc.scrollHeight || 0);
    const canScroll = sh > ch + 8;
    const atBottom = canScroll && (top + ch >= sh - 48);
    fab.classList.toggle('is-show', canScroll && top > 40);
    fab.classList.toggle('is-top', atBottom);
    const tip = atBottom ? '回到顶部' : '滚到底部';
    fab.setAttribute('title', tip);
    fab.setAttribute('aria-label', tip);
  }

  /* ---------------- 顶栏（外壳是猫卡的） ---------------- */
  function head(title) {
    return '<div class="lib-head">' +
      '<button class="btn-mini" type="button" id="lots-back">‹ 返回</button>' +
      '<div class="lib-title">' + esc(title) + '</div>' +
      '</div>';
  }
  // 照抄 toggle_god_tut() / toggle_god_share 那套：点标题条开合 + 箭头翻转
  function bindTut(headId, bodyId, arrowId) {
    const h = page.querySelector('#' + headId), b = page.querySelector('#' + bodyId), a = page.querySelector('#' + arrowId);
    if (!h || !b) return;
    h.addEventListener('click', function () {
      const open = b.hasAttribute('hidden');
      if (open) { b.removeAttribute('hidden'); if (a) a.classList.add('is-open'); }
      else { b.setAttribute('hidden', ''); if (a) a.classList.remove('is-open'); }
    });
  }

  /* ---------------- 教程两块（照抄 ini_god_tut() / ini_tutorial()） ---------------- */
  function godTutHTML() {
    const t = GOD_TUT;
    let h = '';
    h += '<div class="god-tut-step-title">' + t[0][0] + '</div>';
    h += '<div>' + t[0][1] + '</div>';
    h += '<div class="god-tut-step-title" style="padding-top:.6rem;">' + t[1] + '</div>';
    h += '<div class="god-tut-example god-tut-rec"><span class="ex-text"><b>' +
      t[2][0] + '</b><br/><span class="ex-quote">' + t[2][1] + '</span><br/>' + t[2][2] +
      '</span><span class="ex-badge">' + t[3] + '</span></div>';
    h += '<div class="god-tut-example god-tut-open"><span class="ex-text"><b>' +
      t[4][0] + '</b><br/><span class="ex-quote">' + t[4][1] + '</span><br/>' + t[4][2] +
      '</span><span class="ex-badge">' + t[5] + '</span></div>';
    return h;
  }
  function writeTutHTML() {
    const m = TUT_MAIN, s = TUT_SHARE_STEPS;
    let h = '<div class="tut-main">';
    for (let i = 0; i < m.length; i++) h += '<div class="tut-step"><b>' + m[i][0] + '</b>　' + m[i][1] + '</div>';
    h += '</div>';
    h += '<div class="tut-divider"><span>' + T.lbl_tut_done + '</span></div>';
    h += '<div class="tut-share-head" id="tut_share_head"><b>' + T.lbl_tut_share + '</b>' +
      '<span class="tut-arrow" id="tut_share_arrow"></span></div>';
    h += '<div class="tut-share-body" id="tut_share_body" hidden>';
    for (let j = 0; j < s.length; j++) h += '<div class="tut-step"><b>' + s[j][0] + '</b>　' + s[j][1] + '</div>';
    h += '</div>';
    return h;
  }

  /* ---------------- 页面骨架 ---------------- */
  function init() {
    migrateRenamed();                   // ★ 内置包改过名的：本机那条就地改名（一次性）
    seedBuiltin();                      // ★ 内置签文包：新装机铺上、老装机缺了才补（见上面注释）
    page = document.getElementById('lots-page');
    // #lots-page 是常驻元素（只换 innerHTML），监听器只能在这里挂一次，
    // 否则每次渲染都会再挂一个（切几次页面就叠几个）
    if (page) page.addEventListener('scroll', updateFab);
  }
  function render() {
    if (!page) page = document.getElementById('lots-page');
    if (!page) return;
    if (view === 'draw') return renderDraw();
    if (view === 'write') return renderWrite();
    return renderGod();
  }

  /* ============================================================
   * ① 求签页 —— 照抄 #tGod
   *    折叠「求签教程」（贴顶）→ 问题输入框 → 「抽签 / 写签」两个通栏按钮
   *    方案 E：结构一个字不动，只调间距节奏 + 收掉给底栏留的 120px 死白（见 v3.css §29d）
   * ============================================================ */
  /* ---------- 常问词库（★ 2026-10-13 构建 251；刷新时机同日改为「进主页一次」）----------
     内容在 app/asks/常问.txt → 生成 www/js/builtin-asks.js（20 类 / 120 句）。
     界面**一次只随机端出 6 句** —— 用户原话：
       「你不要把所有词库列出来啊，它是轮流随机显示的」。
     ★ 刷新时机（用户原话：「常问的刷新逻辑…改为 点进神签页（区分抽签页）自动刷新一次」）：
       · **只在进求签页时刷新一次** —— renderGod 每次重建页面，asksHTML() 重新随机一批；
       · **不要定时轮换**（原先是每 4 秒自动换一批，页面自己动，用户不要了）；
       · 抽签页 / 写签页没有常问块，进去不刷新（用户特意点名要区分开）。
     点一句 = 填进所问输入框（**不**直接抽签，用户 2026-10-13 明确过）。 */
  const ASK_N = 6;              // 一批几句（两栏 × 3 行）

  function askPool() {
    const G = (global.MoKaBuiltinAsks || []);
    const out = [];
    for (let i = 0; i < G.length; i++) {
      const a = (G[i] && G[i].asks) || [];
      for (let k = 0; k < a.length; k++) if (a[k]) out.push(a[k]);
    }
    return out;
  }
  /* 抽 n 句、**同一批内不重复**（词库在生成时已做过全局去重，这里只管这一批别撞） */
  function pickAsks(n) {
    const pool = askPool();
    if (pool.length <= n) return pool.slice(0);
    const idx = [];
    while (idx.length < n) {
      const r = RND.int(pool.length);
      if (idx.indexOf(r) < 0) idx.push(r);
    }
    return idx.map(function (i) { return pool[i]; });
  }
  function askBtnsHTML(list) {
    return list.map(function (q) {
      return '<button type="button" class="lk" data-q="' + esc(q) + '">' + esc(q) + '</button>';
    }).join('');
  }
  function asksHTML() {
    const list = pickAsks(ASK_N);
    if (!list.length) return '';            // 词库缺失（老包）→ 这块整个不出现，页面照旧
    return '<div class="lot-asks">' +
      '<div class="lot-asks-lbl">常 问</div>' +
      '<div class="lot-asks-g" id="god_asks">' + askBtnsHTML(list) + '</div>' +
    '</div>';
  }

  function renderGod() {
    page.innerHTML =
      head(T.lbl_title_god) +
      '<div class="lib-scroll lot-god">' +
        '<div class="pb-2">' +
          '<div id="god_tut_head" class="tut-head">' +
            '<div class="tut-t" id="lbl_god_tut_title"><span>' + esc(T.lbl_god_tut_title) + '</span></div>' +
            '<span class="tut-arrow" id="god_tut_arrow"></span>' +
          '</div>' +
          '<div id="god_tut_body" class="tut-body" hidden>' + godTutHTML() + '</div>' +
        '</div>' +
        // 输入框 + 抽签/写签 仍是一组，但不做垂直居中（方案 E）—— 只把和教程条的间距拉开。
        // .lot-god-fill 负责吃掉剩余高度，把下面那行小字压到底。
        asksHTML() +
        '<div class="lot-god-q">' +
          '<input id="god_question" type="text" class="input lot-q-in" maxlength="60"' +
            ' placeholder="' + esc(T.lbl_question_ph) + '" value="' + esc(question) + '">' +
          '<div class="lot-acts">' +
            '<button id="btn_god_draw" type="button" class="btn btn-primary btn-tall">' + esc(T.lbl_btn_draw) + '</button>' +
            '<button id="btn_god_write" type="button" class="btn btn-ghost btn-tall">' + esc(T.lbl_btn_write) + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="lot-god-fill"></div>' +
        '<div class="lot-god-note">签文由你导入</div>' +
      '</div>';

    showTabbar(false);                 // 神签整个场景都不显示底栏
    bindTut('god_tut_head', 'god_tut_body', 'god_tut_arrow');
    bindGod();
    // 常问：不挂定时器 —— 上面 asksHTML() 这次重建就已经随机了一批，
    // 也就是「进这一页刷新一次」；停在本页不动它就一直是这一批（用户要的就是这样）。
  }

  function bindGod() {
    const $ = function (id) { return page.querySelector('#' + id); };
    $('lots-back').addEventListener('click', function () { global.MoKa.app.gotoScene('table'); });
    $('god_question').addEventListener('input', function () { question = this.value; });
    // 照抄 god_draw_go()：空所问只提示，不抽
    $('btn_god_draw').addEventListener('click', function () {
      question = ($('god_question').value || '').trim();
      if (!question) { UI.toast(T.lbl_question_empty); $('god_question').focus(); return; }
      view = 'draw';
      render();
    });
    // 照抄 show_write()：进写签页先把删除确认计数清零
    /* 常问：点一句 → **只填进输入框**，留在求签页。
       ★ 2026-10-13 用户明确：「点了之后输入问题框，但是不要直接抽签」——
         抽不抽由用户自己按「抽签」决定（他可能还要改两个字）。 */
    const ga = $('god_asks');
    if (ga) ga.addEventListener('click', function (e) {
      const b = e.target && e.target.closest ? e.target.closest('.lk') : null;
      if (!b) return;
      const q = b.getAttribute('data-q') || '';
      if (!q) return;
      question = q;
      const inp = $('god_question');
      if (inp) inp.value = q;
      // 就停在这儿：不跳抽签页、不调 render()
    });
    $('btn_god_write').addEventListener('click', function () {
      setDelCount(0);
      view = 'write';
      render();
    });
  }

  /* ============================================================
   * ② 抽签页 —— 照抄 #tDraw + draw_lot()
   *    签盒里：问题（居中加粗）+ 虚线 + 签文（居中，pre-wrap）
   *    下面「当前签文包：X」，再下面并排两颗键：⌷ 截图（相机图标）+ 再抽一次
   *    ★ 2026-10-12：用户要求加截图键，并把这两颗键做美观（排法见下面 renderDraw）。
   * ============================================================ */
  /* 折行复测用：高度 / 行高 = 视觉行数（走查直接喂假值；拿不到行高返回 0 = 不改原判据） */
  function visualLines(height, lineHeight) {
    return lineHeight > 0 ? Math.round(height / lineHeight) : 0;
  }

  function renderDraw() {
    // 抽签页：没有常问块，也不刷新常问 —— 只认「进求签页刷新一次」那条规矩。
    // （原先这里要 stopAskLoop() 停定时器；2026-10-13 定时轮换取消后就没有可停的了）
    const p = packs();
    const a = activeIdx();
    const pool = nonEmpty(p[a].lots);
    let box, align = 'center';
    if (!pool.length) {
      // 照抄 draw_lot() 的空态
      box = '<div class="text-center text-muted" style="font-size:90%;">' + esc(T.lbl_god_empty) + '</div>';
      drawn = null;
    } else {
      drawn = RND.pick(pool);
      // 短签居中、长签顶格（#draw_box 是 pre-wrap，原文直接放，别替换换行）
      const lotLines = String(drawn).split('\n').length;
      const lotChars = String(drawn).replace(/\s/g, '').length;
      // ★ 这个判据只决定**屏幕**上居中/顶格；截图（lot-shot.js）从 2026-10-12 起
      //   一律按设计稿左对齐 —— 它是拿去分享的一张图，排版不跟屏幕走。
      align = (lotLines <= LOT_CENTER_LINES && lotChars <= LOT_CENTER_CHARS) ? 'center' : 'left';
      box = '<div class="text-center fw-bold pb-2" style="color:var(--ink);">' +
              esc(T.lbl_question_prefix) + '：' + esc(question) + '</div>' +
            '<hr class="my-2" style="border-top:1px dashed var(--line-hard);">' +
            '<div id="draw_lot" class="' + (align === 'center' ? 'text-center' : 'lot-flush') + '">' + esc(drawn) + '</div>';
    }
    drawnAlign = align;

    page.innerHTML =
      head(T.lbl_title_draw) +
      '<div class="lib-scroll">' +
        '<div id="draw_box" class="p-4">' + box + '</div>' +
        '<div id="lbl_active_pack" class="text-center pt-2 text-muted" style="font-size:84%;">' +
          esc(T.lbl_pack_active) + '： ' + esc(p[a].name) + '</div>' +
        /* ★ 2026-10-12：签文页的两颗键，用户点的排法 ——
             「并排 · 截图次、再来一次主」：
             ｜⌷｜  窄的墨线描边图标键（相机，纯符号无汉字）
             ｜  再抽一次  ｜  宽的实心墨黑主键
           图标键的 SVG 与写签页那颗垃圾桶同一套（1.8 描边 / currentColor / 内联不引外部文件）。 */
        '<div class="draw-acts">' +
          '<button id="btn_draw_shot" type="button" class="btn btn-shot" title="截图" aria-label="截图 · 存成一张图">' +
            '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M22 18.4a1.9 1.9 0 0 1-1.9 1.9H3.9A1.9 1.9 0 0 1 2 18.4V8.7a1.9 1.9 0 0 1 1.9-1.9h3.4l1.7-2.6h6l1.7 2.6h3.4A1.9 1.9 0 0 1 22 8.7z"/>' +
              '<circle cx="12" cy="13.2" r="3.6"/>' +
            '</svg>' +
          '</button>' +
          '<button id="btn_draw_again" type="button" class="btn btn-primary btn-draw-again">' + esc(T.lbl_btn_draw_again) + '</button>' +
        '</div>' +
      '</div>';

    showTabbar(false);

    /* ★ 2026-10-19 用户报「第二段字体/对齐不对」（附抽签页截图）：
       签文数据本身是**一行**（21 字），但窄屏上被浏览器自动折成两行，
       第二行单独居中 —— 看着就像第二段缩进、字距也变了。
       短签居中的判据（LOT_CENTER_*）只看原文段数/字数，不知道会折行；
       这里按**真实渲染高度**复测：折行（视觉行数 > 原文段数）就改顶格。
       截图渲染（lot-shot.js）自己按宽度断行、本来就左对齐，不受影响。 */
    const lotEl = page.querySelector('#draw_lot');
    if (lotEl && lotEl.classList.contains('text-center')) {
      const want = String(drawn || '').split('\n').length;
      let lh = 0;
      try { lh = parseFloat(getComputedStyle(lotEl).lineHeight) || 0; } catch (e) {}
      if (visualLines(lotEl.offsetHeight, lh) > want) {
        lotEl.classList.remove('text-center');
        lotEl.classList.add('lot-flush');
        drawnAlign = 'left';              // 记录"屏幕上实际怎么排的"（截图仍固定左对齐）
      }
    }

    page.querySelector('#lots-back').addEventListener('click', function () { view = 'god'; render(); });
    // 原版 onclick="show_god()"：回求签页，让人重新写问题（不是就地重抽）
    page.querySelector('#btn_draw_again').addEventListener('click', function () { view = 'god'; render(); });
    page.querySelector('#btn_draw_shot').addEventListener('click', drawShot);
  }

  /* 截图：把屏幕上这一签画成一张 1080 宽的 PNG。
     渲染在 lot-shot.js（Canvas 2D 重画，不截 WebView），落地走 io.saveImageFile
     （原生桥 → Download/猫卡/ + 分享面板）。
     ★ 用当前屏幕这一签（drawn），**绝不重新随机** —— 截出来的必须是看到的那一条。 */
  function drawShot() {
    if (shooting) return;
    if (!drawn) { UI.toast(T.lbl_god_empty); return; }
    const S = global.MoKa.lotShot;
    if (!S) { UI.toast('截图模块没加载，这个版本不完整'); return; }
    shooting = true;
    UI.toast('正在生成图片…');
    S.shot({
      question: question,
      qPrefix: T.lbl_question_prefix,
      lot: drawn,
      pack: activePackName(),
      align: drawnAlign
    }).then(function (r) {
      shooting = false;
      UI.toast(r && r.name ? ('已保存到 Download/猫卡/' + r.name) : ((r && r.err) || '截图失败'));
    }, function (e) {
      shooting = false;
      UI.toast('截图失败：' + ((e && e.message) || e));
    });
  }

  /* ============================================================
   * ③ 写签页 —— 照抄 #tWrite + render_lots() / add_lot() / del_lot() / save_lots_back()
   * ============================================================ */
  function renderWrite() {
    const p = packs();
    const a = activeIdx();
    const l = p[a].lots;
    const cnt = delCount();

    page.innerHTML =
      head(T.lbl_title_write) +
      '<div class="lib-scroll">' +

        '<div class="d-flex flex-row align-items-center pb-2">' +
          '<button id="lbl_pack_title" type="button" class="w-pack-lb" title="点这里改当前签文包的名字">' +
            esc(T.lbl_pack_title) + '<span class="w-pack-edit">✎</span></button>' +
          '<select id="pack_sel" class="input w-pack-sel"></select>' +
          '<button id="btn_pack_add" type="button" class="btn btn-tool btn-icon" title="' + esc(T.lbl_pack_add_confirm) + '">＋</button>' +
          '<button id="btn_pack_del" type="button" class="btn btn-tool btn-icon" title="' + esc(T.lbl_pack_del_confirm) + '">' +
            '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg></button>' +
        '</div>' +

        '<div class="d-flex flex-row pb-2 w-tools">' +
          '<button id="btn_lot_export" type="button" class="btn btn-tool">' + esc(T.lbl_lot_export) + '</button>' +
          '<button id="btn_lot_import" type="button" class="btn btn-tool">' + esc(T.lbl_lot_import) + '</button>' +
        '</div>' +

        '<div id="lot_del_hint" class="text-muted lot-del-hint"></div>' +
        '<div id="lot_list"></div>' +

        '<div class="d-flex flex-row pt-2 pb-1 w-acts">' +
          '<button id="btn_lot_add" type="button" class="btn btn-primary">' + esc(T.lbl_lot_add) + '</button>' +
          '<button id="btn_lot_save" type="button" class="btn btn-primary">' + esc(T.lbl_lot_save) + '</button>' +
        '</div>' +

        '<div class="pt-3">' +
          '<div id="tut_head" class="tut-head">' +
            '<div class="tut-t" id="lbl_tut_title"><span>' + esc(T.lbl_tut_title) + '</span></div>' +
            '<span class="tut-arrow" id="tut_arrow"></span>' +
          '</div>' +
          '<div id="tut_body" class="tut-body" hidden>' + writeTutHTML() + '</div>' +
        '</div>' +

        '<div style="height:22px"></div>' +
      '</div>' +
      // 照抄 #btn_lot_bottom（原版右下角悬浮圆钮）
      '<button id="btn_lot_bottom" type="button" class="btn btn-primary fab-bottom" title="滚到底部" aria-label="滚到底部">' +
        '<svg class="fab-down" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 6l5 5 5-5"/><path d="M7 13l5 5 5-5"/></svg>' +
        '<svg class="fab-up" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18l5-5 5 5"/><path d="M7 11l5-5 5 5"/></svg>' +
      '</button>';

    showTabbar(false);
    renderPackSel();
    renderLots();
    updateLotDelHint();
    bindTut('tut_head', 'tut_body', 'tut_arrow');
    bindTut('tut_share_head', 'tut_share_body', 'tut_share_arrow');
    bindWrite();
  }

  // 照抄 render_pack_sel()
  function renderPackSel() {
    const p = packs(), a = activeIdx();
    const sel = page.querySelector('#pack_sel');
    if (!sel) return;
    sel.innerHTML = p.map(function (x, i) {
      return '<option value="' + i + '">' + esc(x.name || (T.lbl_pack_new + ' ' + (i + 1))) + '</option>';
    }).join('');
    sel.value = String(a);
  }

  // 照抄 render_lots()（class 名沿用原版的 lot-item / lot-del / lot-index / lot-text）
  function renderLots() {
    const l = lots();
    const list = page.querySelector('#lot_list');
    if (!list) return;
    let html = '';
    for (let i = 0; i < l.length; i++) {
      html += '<div class="lot-item bg-light rounded p-2 mb-2 position-relative">' +
        '<button type="button" class="lot-del" data-idx="' + i + '" aria-label="删除">✕</button>' +
        '<div class="lot-index fw-bold pb-1">' + (i + 1) + '</div>' +
        '<textarea class="lot-text form-control textarea" rows="2" data-idx="' + i + '" placeholder="' + esc(T.lbl_lot_hint) + '"></textarea>' +
        '</div>';
    }
    list.innerHTML = html;
    /* 填值 + 长高。
       ★ 这里原来是逐条 `ta.value = ...; autoGrow(ta)`，而 autoGrow 是
         "先写 style.height 再读 scrollHeight" —— **每一条都强制一次同步布局**，
         N 条签文就是 N 次强制回流（布局抖动）。用户的签文包有 676 条，
         点「写签」要建 676 个 textarea + 676 次强制布局，这就是入口卡顿的主因。
       改成三段批处理：
         ① 先全部写值、把高度清成 auto（只写，不读）
         ② 再全部连续读 scrollHeight —— 连续读之间没有写，只会触发**一次**布局
         ③ 最后全部连续写高度（写不会触发布局，因为后面不再读）
       同样的结果，强制布局从 N 次降到 1 次。 */
    const tas = list.querySelectorAll('.lot-text');
    for (let k = 0; k < tas.length; k++) {
      tas[k].value = l[k] || '';
      tas[k].style.height = 'auto';
    }
    const hs = new Array(tas.length);
    for (let k = 0; k < tas.length; k++) hs[k] = tas[k].scrollHeight || 0;   // 连续读 = 一次布局
    for (let k = 0; k < tas.length; k++) tas[k].style.height = hs[k] ? (hs[k] + 'px') : '';  // 连续写
  }

  // 照抄 update_lot_del_hint()
  function updateLotDelHint() {
    const el = page.querySelector('#lot_del_hint');
    if (!el) return;
    const cnt = delCount();
    el.textContent = cnt < 2 ? T.lbl_lot_del_hint.replace('{n}', String(cnt)) : '';
  }

  function bindWrite() {
    const $ = function (id) { return page.querySelector('#' + id); };

    $('lots-back').addEventListener('click', function () { view = 'god'; render(); });

    // 照抄 render_pack_sel() 里的 change 行为（原版是 onchange="set_active_idx(...)"）
    $('pack_sel').addEventListener('change', function () {
      setActiveIdx(parseInt(this.value, 10) || 0);
      renderPackSel();
      renderLots();
      updateLotDelHint();
    });

    // 照抄 add_pack()
    $('btn_pack_add').addEventListener('click', function () {
      // 原版就是一句 confirm(T.lbl_pack_add_confirm)，这里保留"标题+正文"的等效形态
      UI.confirmDialog({ sub: T.lbl_pack_add_confirm, okText: '新建', cancelText: '取消' })
        .then(function (ok) {
          if (!ok) return;
          const p = packs();
          const names = p.map(function (x) { return x.name; });
          let n = 1;
          while (names.indexOf(T.lbl_pack_new + ' ' + n) >= 0) n++;
          snapshot();
          p.push({ name: T.lbl_pack_new + ' ' + n, lots: [] });
          // ★ 2026-10-15：没写进去就别装作新建成功（缓存不再被污染，render 出来的还是原样）
          if (!putPacks(p)) { render(); return; }
          setActiveIdx(p.length - 1);
          renderPackSel();
          renderLots();
          updateLotDelHint();
        });
    });

    // 照抄 del_pack()
    $('btn_pack_del').addEventListener('click', function () {
      const p = packs();
      if (p.length <= 1) { UI.toast(T.lbl_pack_min); return; }
      UI.confirmDialog({ sub: T.lbl_pack_del_confirm, okText: '删除', cancelText: '取消' })
        .then(function (ok) {
          if (!ok) return;
          snapshot();
          const i = activeIdx();
          p.splice(i, 1);
          // ★ 2026-10-15：删包没落盘就别跟着切索引/重画成"删掉了"的样子
          if (!putPacks(p)) { render(); return; }
          setActiveIdx(Math.max(0, i - 1));
          renderPackSel();
          renderLots();
          updateLotDelHint();
        });
    });

    // 点「签文包」三个字 = 改当前包名（下拉只负责切换，互不干扰）
    $('lbl_pack_title').addEventListener('click', function () {
      UI.promptDialog({ title: '修改签文包名称', value: activePackName(), placeholder: '签文包名称', okText: '保存' })
        .then(function (name) {
          if (name == null) return;
          const nm = String(name).trim();
          if (!nm) { UI.toast('名字不能为空'); return; }
          if (nm === activePackName()) return;
          snapshot();
          const p = packs();
          p[activeIdx()].name = nm;
          // ★ 2026-10-15：改名没落盘就退回去（否则界面显示新名、重启变回旧名）
          if (!putPacks(p)) { render(); return; }
          renderPackSel();
          UI.toast('已改名为「' + nm + '」');
        });
    });

    $('btn_lot_export').addEventListener('click', openExport);
    $('btn_lot_import').addEventListener('click', openImport);

    // 照抄 $("#lot_list").on("input", ".lot-text", ...) 随写随存
    $('lot_list').addEventListener('input', function (e) {
      const ta = e.target;
      if (!ta || !ta.classList || !ta.classList.contains('lot-text')) return;
      const i = parseInt(ta.getAttribute('data-idx'), 10);
      const l = lots();
      if (i >= 0 && i < l.length) { l[i] = ta.value; saveLots(l); autoGrow(ta); updateFab(); }
    });

    // 照抄 del_lot()：前 2 次确认（计数进页面时清零）
    $('lot_list').addEventListener('click', function (e) {
      const b = e.target && e.target.closest ? e.target.closest('.lot-del') : null;
      if (!b) return;
      const i = parseInt(b.getAttribute('data-idx'), 10);
      if (!(i >= 0)) return;
      const doIt = function () {
        const l = lots();
        snapshot();
        l.splice(i, 1);
        saveLots(l);
        renderLots();
        updateLotDelHint();
      };
      const cnt = delCount();
      if (cnt >= 2) { doIt(); return; }
      UI.confirmDialog({ sub: T.lbl_lot_del_confirm, okText: '删除', cancelText: '取消' })
        .then(function (ok) {
          if (!ok) return;
          setDelCount(cnt + 1);
          doIt();
        });
    });

    // 照抄 add_lot()
    $('btn_lot_add').addEventListener('click', function () {
      const l = lots();
      l.push('');
      saveLots(l);
      renderLots();
      const tas = page.querySelectorAll('.lot-text');
      const last = tas[tas.length - 1];
      if (last) { last.focus(); try { last.scrollIntoView({ block: 'center' }); } catch (e) {} }
    });

    // 照抄 save_lots_back()：存了回求签页
    $('btn_lot_save').addEventListener('click', function () {
      saveLots(lots());
      view = 'god';
      render();
    });

    // 一键到底 / 到底后变一键到顶（滑动时才露出来）
    $('btn_lot_bottom').addEventListener('click', function () {
      animateScroll(!this.classList.contains('is-top'));   // 有过程地滚，别瞬移
    });
    const scroller = page.querySelector('.lib-scroll');   // 这层每次渲染都是新的，随渲染绑
    if (scroller) scroller.addEventListener('scroll', updateFab);
    updateFab();
  }

  /* ============================================================
   * 导出弹层 —— 照抄 #dia_lot_export / build_lot_export()
   *   格式：文本（可读）| JSON（精确）   范围：全部 | 自定义（从…到…）
   *   按钮：保存为文件（猫卡新增：走文件桥）| 复制
   * ============================================================ */
  function buildExport(fmt, from, to) {                 // 照抄 build_lot_export()
    const l = lots();
    const n = l.length;
    if (!n) return { text: '', count: 0 };
    from = Math.max(1, from);
    to = Math.min(n, to);
    if (from > to) { const t = from; from = to; to = t; }
    const sel = l.slice(from - 1, to);
    if (fmt === 'json') return { text: JSON.stringify(sel, null, 2), count: sel.length };
    const parts = [];
    for (let i = 0; i < sel.length; i++) {
      if (!sel[i] || !String(sel[i]).trim()) continue;
      parts.push('===== ' + (parts.length + 1) + ' =====\n' + sel[i]);
    }
    return { text: parts.join('\n\n'), count: parts.length };
  }

  function openExport() {
    const n = lots().length;
    const body =
      '<div class="dialog-title">' + esc(T.lbl_export_title) + '</div>' +
      '<div class="fw-bold pb-1" style="font-size:90%;">' + esc(T.lbl_export_fmt) + '</div>' +
      '<span class="seg" id="ex-fmt">' +
        '<button type="button" data-v="text" class="seg-btn is-sel">' + esc(T.lbl_exp_fmt_text) + '</button>' +
        '<button type="button" data-v="json" class="seg-btn">' + esc(T.lbl_exp_fmt_json) + '</button>' +
      '</span>' +
      '<div class="fw-bold pb-1 pt-3" style="font-size:90%;">' + esc(T.lbl_export_range) + '</div>' +
      '<span class="seg" id="ex-rng">' +
        '<button type="button" data-v="all" class="seg-btn is-sel">' + esc(T.lbl_exp_rng_all) + '</button>' +
        '<button type="button" data-v="part" class="seg-btn">' + esc(T.lbl_exp_rng_part) + '</button>' +
      '</span>' +
      '<div id="exp_range_row" class="w-range" hidden>' +
        '<span class="w-range-lb">' + esc(T.lbl_exp_from) + '</span>' +
        '<input id="exp_from" type="number" class="input w-range-in" min="1" value="1">' +
        '<span class="w-range-lb">' + esc(T.lbl_exp_to) + '</span>' +
        '<input id="exp_to" type="number" class="input w-range-in" min="1" value="' + (n || 1) + '">' +
      '</div>' +
      '<div style="height:16px"></div>' +
      '<button class="btn btn-primary btn-block" id="ex-file">' + esc(T.lbl_btn_export_file) + '</button>' +
      '<div style="height:8px"></div>' +
      '<button class="btn btn-ghost btn-block" id="ex-copy">' + esc(T.lbl_btn_copy) + '</button>' +
      '<div style="height:8px"></div>' +
      '<button class="btn btn-text btn-block" id="ex-cancel">关闭</button>';

    showSheet(body, function (sheet) {
      segPick(sheet, '#ex-fmt');
      segPick(sheet, '#ex-rng', function (v) {
        const row = sheet.querySelector('#exp_range_row');
        if (v === 'part') row.removeAttribute('hidden'); else row.setAttribute('hidden', '');
      });
      const arg = function () {                       // 照抄 do_lot_export() 的取参
        const fmt = pickOf(sheet, '#ex-fmt') || 'text';
        const rng = pickOf(sheet, '#ex-rng') || 'all';
        let from = 1, to = lots().length;
        if (rng === 'part') {
          from = parseInt(sheet.querySelector('#exp_from').value, 10);
          to = parseInt(sheet.querySelector('#exp_to').value, 10);
          if (isNaN(from) || isNaN(to) || from < 1 || to < 1) { UI.toast('范围无效'); return null; }
        }
        const r = buildExport(fmt, from, to);
        if (!r.count) { UI.toast('没有可导出的签文'); return null; }
        return { fmt: fmt, r: r };
      };
      const ext = function (fmt) { return fmt === 'json' ? 'json' : 'txt'; };
      sheet.querySelector('#ex-file').addEventListener('click', function () {
        const a = arg(); if (!a) return;
        const io = global.MoKa.io;
        if (!io || !io.saveTextFile) { UI.toast('文件通道不可用'); return; }
        const name = io.buildFileName
          ? io.buildFileName(activePackName(), a.r.count, ext(a.fmt))
          : ('签文.' + ext(a.fmt));
        const r = io.saveTextFile(name, a.r.text);
        if (r && r.err) { UI.toast(r.err); return; }
        UI.toast('已保存 ' + a.r.count + ' 条 → ' + name);
        closeSheet();
      });
      sheet.querySelector('#ex-copy').addEventListener('click', function () {
        const a = arg(); if (!a) return;
        copyText(a.r.text, function (ok) { UI.toast(ok ? ('已复制 ' + a.r.count + ' 条') : '复制失败'); });
      });
      sheet.querySelector('#ex-cancel').addEventListener('click', closeSheet);
    });
  }

  /* ============================================================
   * 导入弹层 —— 照抄 #dia_lot_import / do_lot_import()
   *   导入方式：新建签文包 | 追加到末尾   包名称 + 粘贴框
   *   按钮：从文件导入 | 导入
   * ============================================================ */
  function parseImport(txt) {
    const t = String(txt || '').trim();
    if (!t) return [];
    if (t.charAt(0) === '[') {
      /* ★★ 2026-10-15 修（"备份救不了它唯一要救的那个场景"）：
         自动备份 `签文-自动备份.json` 写的是 **JSON.stringify(packs)** ——
         也就是**对象数组** `[{name,lots:[...]}, …]`（见 autoBackup），
         而这里原来一律 `j.map(String)` → 每个元素变成字符串 `"[object Object]"`：
         解析"成功"、条数也对，内容全是垃圾，真签文一条都回不来，
         还把这堆垃圾追加进当前签包（用户按注释指引恢复，得到的是这个）。
         现在按形状分三路：字符串数组（「导出→JSON」那种）/ 签文包数组（自动备份那种）/ 其它。 */
      let j = null, parsed = false;
      try { j = JSON.parse(t); parsed = true; } catch (e) { parsed = false; }
      if (parsed && Array.isArray(j)) {
        if (j.every(function (x) { return typeof x === 'string'; })) return j;
        const out = [];
        let looksLikePacks = false;
        j.forEach(function (x) {
          if (x && typeof x === 'object' && Array.isArray(x.lots)) {
            looksLikePacks = true;
            x.lots.forEach(function (s) { if (s != null) out.push(String(s)); });
          } else if (typeof x === 'string') out.push(x);
        });
        if (looksLikePacks) return out;          // 空包也算"解析成功"，只是 0 条
        return null;                             // 数组里是别的形状 → 老实地报"无法解析"
      }
      /* 解析失败/不是数组：**别急着报错** —— `[上上签] 大吉` 这种手写文本签文
         开头也是 `[`，它本该走下面的按行分支。带 JSON 结构特征的才判为坏包。 */
      if (/[{}]|"\s*:/.test(t)) return null;
    }
    if (t.indexOf('=====') >= 0) {
      const blocks = t.split(/^=====\s*\d*\s*=====$/gm)
        .map(function (b) { return b.trim(); })
        .filter(function (b) { return b !== ''; });
      /* ★ 2026-10-15：**切出多块才算切块成功**。
         原来写 `if (blocks.length)` —— 分隔符只要格式不完全匹配那个正则
         （`===== 第一签 =====` 这种文字编号、`====` 四个等号、正文和分隔符同行…），
         split 出来就是"整段一块"，长度 1 也被判成切块成功 →
         **整个文件变成一条巨型签文**（抽签永远抽到同一坨）。
         现在切不出多块就继续往下走按行。 */
      if (blocks.length > 1) return blocks;
    }
    return t.split('\n').map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
  }

  function b64ToText(b64) {
    try {
      const bin = global.atob(b64);
      if (global.TextDecoder) {
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new global.TextDecoder('utf-8').decode(bytes);
      }
      return decodeURIComponent(escape(bin));
    } catch (e) { return null; }
  }

  function openImport() {
    // 不分模式：给谁就加到谁后面（名字没用过就现建一个）
    const body =
      '<div class="dialog-title">' + esc(T.lbl_import_title) + '</div>' +
      '<div class="text-muted" style="font-size:88%;">' + esc(T.lbl_pack_active) + '： ' + esc(activePackName()) + '</div>' +
      '<div style="height:6px"></div>' +
      '<textarea id="lot_import_text" class="textarea" rows="8" placeholder="在此粘贴签文文本…"></textarea>' +
      '<div style="height:12px"></div>' +
      '<button class="btn btn-ghost btn-block" id="im-file">' + esc(T.lbl_btn_import_file) + '</button>' +
      '<div style="height:8px"></div>' +
      '<button class="btn btn-primary btn-block" id="im-do">' + esc(T.lbl_btn_import) + '</button>' +
      '<div style="height:8px"></div>' +
      '<button class="btn btn-text btn-block" id="im-cancel">关闭</button>';

    showSheet(body, function (sheet) {
      const doImport = function (parsed) {
        if (parsed === null) { UI.toast('无法解析导入内容'); return; }
        if (!parsed.length) { UI.toast('没有可导入的内容'); return; }
        // ★ 导入是显式恢复动作：即使当前数据"读不出"也要放行（force），否则永远救不回来
        if (isBroken()) {
          const fresh = [{ name: activePackName(), lots: [] }];
          if (!putPacks(fresh, { force: true })) { render(); return; }   // 起步就没写进去，别硬往下走
        }
        snapshot();                                     // 改动前留底
        const p = packs();
        const idx = activeIdx();
        /* ★ 2026-10-15：**导入去重**。原来一律 concat —— 同一份文件误导入两次，
           每条签文就在抽签池里各躺两份（抽中概率直接翻倍，占卜结果失真），
           还把 5MB 配额推得更快（撑爆就触发上面那条静默失败）。
           重复的跳过并如实报数，别让用户以为"导了两遍 = 内容多了一倍"。 */
        const have = new Set(p[idx].lots);
        const add = [];
        let dup = 0;
        parsed.forEach(function (s) {
          if (have.has(s)) { dup++; return; }
          have.add(s); add.push(s);
        });
        if (!add.length) {
          UI.toast('这 ' + dup + ' 条都已经在「' + p[idx].name + '」里了，没有新增');
          closeSheet();
          return;
        }
        p[idx].lots = p[idx].lots.concat(add);            // 追加到当前签包末尾
        const wrote = putPacks(p, { force: true });
        closeSheet();
        render();
        /* ★ 2026-10-15：**写盘失败就不能报"已导入 N 条"**。
           原来这句无条件执行，而且会把 putPacks 刚弹出的失败原因**盖掉**
           （toast 是单例，后一条无条件覆盖前一条）—— 用户看到的是"导入成功"，
           重启才发现一条都没落盘（§5 明写「写失败必须看得见，不许静默分叉」）。 */
        if (wrote) {
          UI.toast('已导入 ' + add.length + ' 条到「' + p[idx].name + '」'
            + (dup ? '（跳过 ' + dup + ' 条重复）' : ''));
        }
      };
      sheet.querySelector('#im-do').addEventListener('click', function () {
        doImport(parseImport(sheet.querySelector('#lot_import_text').value));
      });
      sheet.querySelector('#im-file').addEventListener('click', function () {
        const io = global.MoKa.io;
        if (!io || !io.pickPayload) { UI.toast('文件通道不可用'); return; }
        io.pickPayload(function (pay) {
          let txt = (pay && pay.txt) ? pay.txt : '';
          if (!txt && pay && pay.b64) txt = b64ToText(pay.b64) || '';
          if (!txt) { UI.toast('读不到文件内容'); return; }
          doImport(parseImport(txt));
        });
      });
      sheet.querySelector('#im-cancel').addEventListener('click', closeSheet);
    });
  }

  /* ============================================================
   * 找回（快照）—— 入口在「设置 → 神签」，界面照抄 #dia_restore
   *   open_restore() 的排版：小节标题「签文快照」+ 一行一个快照
   *   （时间 + "N 个签文包 · M 条签文"），空态「暂无 / 暂无可用快照…」
   * ============================================================ */
  function openRestore(after) {
    const h = hist();
    const rows = [];
    for (let i = h.length - 1; i >= 0; i--) {          // 原版就是从最新往回列
      const s = h[i] || {};
      const ps = s.packs || [];
      let n = 0;
      ps.forEach(function (x) { n += ((x && x.lots) || []).length; });
      rows.push('<button type="button" class="restore-item" data-restore="' + i + '">' +
        '<span class="ri-t">' + esc(fmtTs(s.ts)) + '</span>' +
        '<span class="ri-m">' + ps.length + T.lbl_restore_packs + n + T.lbl_restore_lots + '</span>' +
        '</button>');
    }

    let body = '<div class="dialog-title">' + esc(T.lbl_restore_title) + '</div>' +
      '<div class="fw-bold pb-1 pt-2" style="font-size:92%;">' + esc(T.lbl_restore_lots_title) + '</div>';
    if (!rows.length) {
      body += '<div class="text-muted py-1 pb-2" style="font-size:88%;">' +
        esc(T.lbl_restore_empty).replace(/\n/g, '<br>') + '</div>';
    } else {
      body += '<div class="restore-list">' + rows.join('') + '</div>';
    }
    body += '<div style="height:12px"></div><button class="btn btn-text btn-block" id="rs-close">' +
      esc(T.lbl_restore_close) + '</button>';

    showSheet(body, function (sheet) {
      sheet.querySelector('#rs-close').addEventListener('click', closeSheet);
      Array.prototype.forEach.call(sheet.querySelectorAll('.restore-item'), function (b) {
        b.addEventListener('click', function () {
          const s = hist()[parseInt(b.dataset.restore, 10)];
          if (!s || !s.packs) return;
          // 照抄 do_restore_lots()：先问再覆盖，成功后提示「已恢复」
          UI.confirmDialog({ sub: T.lbl_restore_confirm, okText: '恢复', cancelText: '取消' })
            .then(function (ok) {
              if (!ok) return;
              snapshot();                      // 猫卡多留一手：覆盖前也存一份
              putPacks(s.packs, { force: true });   // 找回是显式覆盖：坏数据也要能救回来
              if (activeIdx() >= s.packs.length) setActiveIdx(0);
              closeSheet();
              UI.toast(T.lbl_restore_done);
              render();
              if (after) after();
            });
        });
      });
    });
  }

  /* ---------------- 底部弹层（猫卡的观感：贴底 .lot-sheet） ---------------- */
  let sheetEl = null;
  function showSheet(innerHTML, after) {
    closeSheet();
    sheetEl = document.createElement('div');
    sheetEl.className = 'modal-mask sheet-mask';
    sheetEl.innerHTML = '<div class="lot-sheet">' + innerHTML + '</div>';
    document.getElementById('overlay-root').appendChild(sheetEl);
    sheetEl.addEventListener('click', function (e) { if (e.target === sheetEl) closeSheet(); });
    if (after) after(sheetEl);
  }
  function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; } }

  function segPick(root, sel, cb) {
    const box = root.querySelector(sel);
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(box.querySelectorAll('button'), function (x) { x.classList.toggle('is-sel', x === b); });
        if (cb) cb(b.dataset.v);
      });
    });
  }
  function pickOf(root, sel) {
    const b = root.querySelector(sel + ' button.is-sel');
    return b ? b.dataset.v : null;
  }
  function copyText(txt, cb) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { cb(true); }, function () { cb(execCopy(txt)); });
        return;
      }
    } catch (e) {}
    cb(execCopy(txt));
  }
  function execCopy(txt) {
    try {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, txt.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok === true;
    } catch (e) { return false; }
  }

  /* ---------------- 系统返回键：抽签/写签 → 求签页 ---------------- */
  function back() {
    if (view === 'god') return false;
    view = 'god';
    render();
    return true;
  }

  /* ---------------- 给设置页/抽屉用 ---------------- */
  function stats() {
    const p = packs();
    let n = 0;
    p.forEach(function (x) { n += (x.lots || []).length; });
    return { packs: p.length, lots: n, active: activeIdx(), activeName: activePackName(), snaps: hist().length };
  }

  global.MoKa = global.MoKa || {};
  global.MoKa.lots = {
    init: init,
    render: render,
    go: function (v) { view = v || 'god'; render(); },
    back: back,
    stats: stats,
    packs: packs,
    restoreBuiltin: restoreBuiltin,
    builtinInfo: builtinInfo,
    hist: hist,
    openRestore: openRestore,
    _visualLines_: visualLines
  };
})(window);
