/* ============================================================
 * 猫卡 · 设置 (settings.js)
 * ------------------------------------------------------------
 * 这一页管四件事：
 *   1. 牌面默认大小（占卜桌）—— 精准到 1px，改完立刻生效，桌面已发的牌也一起变
 *   1b. 牌面圆角 —— 0 = 直角，调大 = 圆角（2026-09-27 用户要的：「调牌面圆角-直角」）
 *   2. 图片清晰度 —— 决定"翻开牌"的图有多清晰（同时说明内存代价）
 *   3. 导出文件命名规则 —— 模板 + 占位符，实时预览
 *   4. 神签 —— 签文包/签文统计 + 「找回」（快照恢复；原版在侧栏，这里挪进设置）
 *   5. 关于（版本 / 牌组数 / 数据占用）
 *
 * 存储键：moka.cardW / moka.cardRadius / moka.imgQuality / moka.exportTpl
 * （命名规则的实际套用逻辑在 io.js 的 buildFileName 里，本页只做编辑与预览）
 * ============================================================ */
(function (global) {
  'use strict';
  const UI = global.MoKa.ui;
  const D = global.MoKa.data;

  const CARD_W_KEY = 'moka.cardW';
  const W_MIN = 40, W_MAX = 200, W_DEFAULT = 100, H_RATIO = 1.5;   // 2026-11-19 用户定：默认 100（原 90）
  const VERSION = '2.6.10';
  /* 构建号 = AndroidManifest 里的 versionCode。
     ★ 为什么要摆在界面上：版本名一直是 1.0.5（用户要求不改），光看"版本"分不出装的是哪一次构建 ——
       排查"装了新版还是老毛病"时，这一行就是**唯一能对齐的指纹**。改一次壳就 +1。 */
  const BUILD = '333';

  /* ---------------- 牌面默认大小 ---------------- */
  function clampW(v) {
    v = Math.round(parseFloat(v));
    if (!isFinite(v)) v = W_DEFAULT;
    return Math.max(W_MIN, Math.min(W_MAX, v));
  }
  function getCardW() {
    try { const v = localStorage.getItem(CARD_W_KEY); return v ? clampW(v) : W_DEFAULT; }
    catch (e) { return W_DEFAULT; }
  }
  function applyCardW(v) {
    v = clampW(v);
    const r = document.documentElement;
    r.style.setProperty('--card-w', v + 'px');
    r.style.setProperty('--card-h', Math.round(v * H_RATIO) + 'px');
    return v;
  }
  function setCardW(v) {
    v = applyCardW(v);
    try { localStorage.setItem(CARD_W_KEY, String(v)); } catch (e) {}
    let n = 0;
    try { n = (global.MoKa.table && global.MoKa.table.refreshCardSize) ? global.MoKa.table.refreshCardSize() : 0; } catch (e) {}
    return { w: v, n: n };
  }

  /* ---------------- 牌面圆角（2026-09-27） ----------------
     用户：「在底部栏那个设置界里面再丢个新功能 调牌面圆角-直角」。
     做法上**一个变量管全部**：:root 上的 `--card-r`，v3.css 里牌面外壳和两张纸边都读它
     （纸边 = 外壳 − 1px，正好贴在 1px 描边里侧）。
     牌面出现在占卜桌 / 牌库 / 选牌台 / 编辑页预览四处，改变量一次全变，不用逐个重画。
     为什么不做成"几档 class"：0 到 20 之间总有人想要 3px、6px —— 滑条给得干脆。 */
  const R_KEY = 'moka.cardRadius';
  const R_MIN = 0, R_MAX = 20, R_DEFAULT = 8;      // ★ 用户实机试出来的：8 最好（原来是 9）
  /* ⚠ 改这个数要三处一起：这里、v3.css 里 `var(--card-r, 8px)` 的兜底值、
     以及设置页「恢复默认（N）」的文案（它是拼出来的，跟着这个常量走）。 */
  function clampR(v) {
    v = Math.round(parseFloat(v));
    if (!isFinite(v)) v = R_DEFAULT;
    return Math.max(R_MIN, Math.min(R_MAX, v));
  }
  function getCardR() {
    try { const v = localStorage.getItem(R_KEY); return v === null ? R_DEFAULT : clampR(v); }
    catch (e) { return R_DEFAULT; }
  }
  function applyCardR(v) {
    v = clampR(v);
    document.documentElement.style.setProperty('--card-r', v + 'px');
    return v;
  }
  function setCardR(v) {
    v = applyCardR(v);
    try { localStorage.setItem(R_KEY, String(v)); } catch (e) {}
    return v;
  }

  /* ---------------- 缩略牌背（选牌台 / 占卜桌 / 牌库） ----------------
     ★ 2026-09-20 用户要的开关：这三处的**小牌背**显示「默认」还是「个性图片」。
       只影响缩略背；翻开的那张牌永远用这副牌组自己的牌背。 */
  /* ★ 2026-10-11：「缩略牌背」整块搬到**牌背设定页**（library.js）——
     设置页不再出现第二处"牌背"，用户不会再把两个"牌背"搞混。 */
  // 改完立刻把三处缩略背重画一遍（桌面那摞 + 选牌台 + 牌库列表）
  function refreshThumbs() {
    try { if (global.MoKa.table && global.MoKa.table.renderPileStrip) global.MoKa.table.renderPileStrip(); } catch (e) {}
    try { if (global.MoKa.table && global.MoKa.table.refreshTray) global.MoKa.table.refreshTray(); } catch (e) {}
    try { if (global.MoKa.library && global.MoKa.library.renderHome) global.MoKa.library.renderHome(); } catch (e) {}
  }

  /* ★ 2026-10-11：「图片清晰度」档位**整块下架**（用户：「运存完全能承受」「不降清晰度」）——
     裁剪输出统一 1080 宽（imagecrop.js 的 outWidth），不再让用户做这个技术选择。
     老的 localStorage 键 moka.imgQuality 留着不读也不写（无害）。 */

  /* ---------------- 工具 ---------------- */
  function esc(v) { return UI.esc(v); }
  function fmtKB(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function dataBytes() {
    /* ★ 2026-09-23：改成**全量**统计 —— 以前只看 4 个键，图片兜底库（moka.img.ls.*，一张可到 1.5MB）
       完全没算进去，于是"数据占用"看着很小、实际已经贴着 5MB 上限，签文就可能写不进去。 */
    if (D.lsBytes) { try { return D.lsBytes(); } catch (e) {} }
    let n = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i); n += ((localStorage.getItem(k) || '').length);
      }
    } catch (e) {}
    return n;
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    const page = document.getElementById('set-page');
    if (!page) return;
    const w = getCardW();
    const io = global.MoKa.io || {};
    const tpl = io.exportTpl ? io.exportTpl() : '{name}_{date}-{time}';
    const decks = D.listDecks();
    const cards = decks.reduce(function (a, d) { return a + ((d.cards && d.cards.length) || 0); }, 0);
    const imgMode = (D.imageStoreMode ? D.imageStoreMode() : 'idb');
    const imgTxt = (imgMode === 'idb') ? 'IndexedDB' : '内嵌（受限）';
    /* ★ 2026-10-15：占用只算**一次** —— dataBytes() 要全量遍历 localStorage 并累加字符串长度，
       原来第 208 行（显示）和第 212 行（判断要不要报警）各算了一遍，等于渲染一次设置页
       白走两遍全库（图片兜底库那个键单张就能到 1.5MB）。 */
    const bytes = dataBytes();
    const LG = global.MoKa.lots || null;
    const lotSt = (LG && LG.stats) ? LG.stats() : { packs: 0, lots: 0, snaps: 0 };

    const cr = getCardR();
    const toks = [
      ['{name}', '牌组名'], ['{date}', '年月日'], ['{time}', '时分'],
      ['{sec}', '时分秒'], ['{ts}', '时间戳'], ['{n}', '张数']
    ].map(function (t) {
      return '<button type="button" class="chip-tok" data-tok="' + t[0] + '">' + t[0] + '<i>' + t[1] + '</i></button>';
    }).join('');

    page.innerHTML =
      '<div class="lib-head"><div class="lib-title">设置</div></div>' +
      '<div class="lib-scroll">' +

        '<div class="sec">' +
          '<div class="sec-h">占卜桌</div>' +
          '<div class="set-lb">牌面默认大小<span class="dim">宽 × 1.5 = 高</span></div>' +
          '<div class="stepper">' +
            '<button type="button" class="st-btn" id="cw-minus" aria-label="减小">−</button>' +
            '<input class="st-in" id="cw-val" type="number" inputmode="numeric" min="' + W_MIN + '" max="' + W_MAX + '" step="1" value="' + w + '">' +
            '<span class="st-unit">px</span>' +
            '<button type="button" class="st-btn" id="cw-plus" aria-label="增大">＋</button>' +
          '</div>' +
          '<input class="rng" id="cw-range" type="range" min="' + W_MIN + '" max="' + W_MAX + '" step="1" value="' + w + '">' +
          '<div class="cw-preview"><div class="cw-card" id="cw-card"><span>牌面</span></div></div>' +
          '<div class="set-hint" id="cw-size"></div>' +
          '<div class="set-hint">范围 ' + W_MIN + '–' + W_MAX + ' px，可拖动也可直接输入整数。<b>改完立刻生效</b>，桌面上已经发出的牌会一起变。</div>' +
          '<button type="button" class="btn btn-text" id="cw-reset">恢复默认（' + W_DEFAULT + '）</button>' +
        '</div>' +

        '<div class="sec">' +
          '<div class="sec-h">牌面圆角</div>' +
          '<div class="stepper">' +
            '<button type="button" class="st-btn" id="cr-minus" aria-label="减小">−</button>' +
            '<input class="st-in" id="cr-val" type="number" inputmode="numeric" min="' + R_MIN + '" max="' + R_MAX + '" step="1" value="' + cr + '">' +
            '<span class="st-unit">px</span>' +
            '<button type="button" class="st-btn" id="cr-plus" aria-label="增大">＋</button>' +
          '</div>' +
          '<input class="rng" id="cr-range" type="range" min="' + R_MIN + '" max="' + R_MAX + '" step="1" value="' + cr + '">' +
          '<div class="set-hint" id="cr-hint"></div>' +
          '<div class="set-hint"><b>0 = 直角</b>（方方正正那种），越大越圆。改完立刻生效：' +
            '占卜桌已发出的牌、牌库、选牌台、编辑页的预览一起变。</div>' +
          '<button type="button" class="btn btn-text" id="cr-reset">恢复默认（' + R_DEFAULT + '）</button>' +
        '</div>' +

        /* ★ 2026-10-11 下架两块：「缩略牌背」搬去牌背设定页、「图片清晰度」整块取消
           （图片统一 1080 高清输出）。设置页只剩「占卜桌显示」+「导出命名」+ 关于。 */

        '<div class="sec">' +
          '<div class="sec-h">导出文件命名</div>' +
          '<input class="input" id="tpl-in" spellcheck="false" maxlength="80" value="' + esc(tpl) + '" placeholder="' + esc('{name}_{date}-{time}') + '">' +
          '<div class="tok-row">' + toks + '</div>' +
          '<div class="set-hint">示例：<b id="tpl-prev"></b></div>' +
          '<div class="set-hint">点上面的标签会插到光标处。文件名里的 <code>\\ / : * ? " &lt; &gt; |</code> 与空格会自动换成下划线。</div>' +
          '<button type="button" class="btn btn-text" id="tpl-reset">恢复默认（{name}_{date}-{time}）</button>' +
        '</div>' +

        (LG ?
        '<div class="sec">' +
          '<div class="sec-h">神签</div>' +
          '<div class="kv"><span>签文包 / 签文</span><b>' + lotSt.packs + ' / ' + lotSt.lots + '</b></div>' +
          '<div class="kv"><span>可找回的快照</span><b>' + lotSt.snaps + ' 份</b></div>' +
          '<div class="kv"><span>内置签文包</span><b>' + (LG.builtinInfo ? LG.builtinInfo().text : '—') + '</b></div>' +
          '<div style="height:12px"></div>' +
          '<button type="button" class="btn btn-ghost btn-block" id="lg-restore">找回签文</button>' +
          '<div style="height:8px"></div>' +
          '<button type="button" class="btn btn-ghost btn-block" id="lg-restore-builtin">恢复内置签文包</button>' +
          '<div class="set-hint">每次改动签文（删签、删包、导入）之前，系统会自动留一份底，最多 10 份。' +
            '点「找回签文」挑一份恢复 —— <b>恢复会覆盖当前签文</b>，覆盖前又会再留一份，所以不会越找越少。</div>' +
        '</div>' : '') +

        '<div class="sec">' +
          '<div class="sec-h">关于</div>' +
          '<div class="kv"><span>版本</span><b>' + VERSION + '</b></div>' +
          '<div class="kv"><span>构建</span><b>' + BUILD + '</b></div>' +
          '<div class="kv"><span>牌组 / 猫卡</span><b>' + decks.length + ' / ' + cards + '</b></div>' +
          '<div class="kv"><span>签文包 / 签文</span><b>' + lotSt.packs + ' / ' + lotSt.lots + '</b></div>' +
          '<div class="kv"><span>数据占用</span><b id="usage">' + fmtKB(bytes) + '</b></div>' +
          '<div class="kv"><span>图片存储</span><b>' + imgTxt + '</b></div>' +
          /* ★ 2026-11-13 授权核对：Tabler 只在署名里出现过，代码里没有任何 Tabler 图标
             （grep 全文只有这一行）—— 假署名，删掉。Lucide 确实在用（编辑器顶栏那套线条图标）。 */
          '<div class="kv"><span>符号素材</span><b>Lucide（ISC）</b></div>' +
          '<div class="kv"><span>3D 引擎</span><b>three.js（MIT）</b></div>' +
          /* ★ 2026-11-13 授权核对补：这两款也是真在用，之前漏了署名 ——
             JSZip（v3.10.1，MIT/GPLv3 双许可，这里按 MIT）→ io.js 的导出/导入 zip；
             Cropper.js（v1.6.2，MIT）→ imagecrop.js 的图片裁剪。 */
          '<div class="kv"><span>导出压缩</span><b>JSZip（MIT）</b></div>' +
          '<div class="kv"><span>图片裁剪</span><b>Cropper.js（MIT）</b></div>' +
          /* ★ 2026-10-15 两处修：
             ① 颜色写的是浅色主题那个 #c0392b —— 深色主题下面板是 #1b1f24，
                对比度只有 3.05:1（小字要 4.5:1），这条"存储快满了、签文会存不下"的
                救命告警几乎糊进背景。v3.css 早就把 --danger 按主题换过色
                （浅 #c0392b / 深 #e2685f），跟着它走即可。
             ② 正文里的 `**内嵌**` 是 Markdown 写法，HTML 里不会渲染 ——
                用户看到的是带星号的原样文字。改 <b>。 */
          (bytes > 4 * 1024 * 1024
            ? '<div class="set-hint" style="color:var(--danger)">⚠ 存储快满了（localStorage 上限约 5MB）：签文/牌组可能保存失败。' +
              '先导出备份，再删掉不用的牌组或图片。</div>'
            : '') +
          (imgMode === 'idb' ? '' :
            '<div class="set-hint">当前图片是<b>内嵌</b>在 localStorage 里的（清晰度优先、原图直存）：容量只有约 5MB，' +
            '图片特别多时可能存不下（会提示"保存失败：存储异常"）。' +
            '图片库正常时都会进 IndexedDB 的大容量存储，这里只在图片库不可用时的兜底。' +
            '建议定期导出牌组备份。</div>') +
        '</div>' +

        '<div style="height:28px"></div>' +
      '</div>';

    bind(page, w);
  }

  /* ---------------- 交互 ---------------- */
  function bind(page, w) {
    const $ = function (id) { return page.querySelector('#' + id); };
    const valEl = $('cw-val'), rangeEl = $('cw-range');
    const LG = global.MoKa.lots || null;      // 神签：可能还没加载（老版本缓存），要兜底


    function syncCardSize(size, toast) {
      const r = setCardW(size);
      valEl.value = r.w;
      rangeEl.value = r.w;
      $('cw-card').style.width = r.w + 'px';
      $('cw-card').style.height = Math.round(r.w * H_RATIO) + 'px';
      $('cw-size').textContent = '实际尺寸：' + r.w + ' × ' + Math.round(r.w * H_RATIO) + ' px'
        + (r.n ? '　（桌面已发出 ' + r.n + ' 张，已同步）' : '');
      if (toast) UI.toast('牌面大小：' + r.w + ' px');
    }

    ['cw-minus', 'cw-plus'].forEach(function (id) {
      $(id).addEventListener('click', function () {
        syncCardSize(clampW(parseFloat(valEl.value) + (id === 'cw-minus' ? -1 : 1)), true);
      });
    });
    // 输入框：输入过程中就跟着变（但要等有值且合法）
    valEl.addEventListener('input', function () {
      const v = parseFloat(valEl.value);
      if (isFinite(v) && v >= W_MIN && v <= W_MAX) syncCardSize(v, false);
    });
    valEl.addEventListener('change', function () { syncCardSize(valEl.value, true); });
    valEl.addEventListener('blur', function () { syncCardSize(valEl.value, false); });
    rangeEl.addEventListener('input', function () { syncCardSize(rangeEl.value, false); });
    rangeEl.addEventListener('change', function () { syncCardSize(rangeEl.value, true); });
    $('cw-reset').addEventListener('click', function () { syncCardSize(W_DEFAULT, true); });

    // 牌面圆角（0 = 直角）
    const crVal = $('cr-val'), crRange = $('cr-range');
    function crHint(v) {
      $('cr-hint').textContent = v === 0 ? '现在是直角'
        : (v <= 4 ? '微微一点圆（' + v + 'px）' : (v <= 12 ? '常规圆角（' + v + 'px）' : '圆得很明显（' + v + 'px）'));
    }
    function syncCardR(v, toast) {
      const r = setCardR(v);
      crVal.value = r; crRange.value = r; crHint(r);
      if (toast) UI.toast('牌面圆角：' + (r === 0 ? '直角' : r + ' px'));
      return r;
    }
    ['cr-minus', 'cr-plus'].forEach(function (id) {
      $(id).addEventListener('click', function () {
        syncCardR(clampR(parseFloat(crVal.value) + (id === 'cr-minus' ? -1 : 1)), true);
      });
    });
    crVal.addEventListener('input', function () {
      const v = parseFloat(crVal.value);
      if (isFinite(v) && v >= R_MIN && v <= R_MAX) syncCardR(v, false);
    });
    crVal.addEventListener('change', function () { syncCardR(crVal.value, true); });
    crVal.addEventListener('blur', function () { syncCardR(crVal.value, false); });
    crRange.addEventListener('input', function () { syncCardR(crRange.value, false); });
    crRange.addEventListener('change', function () { syncCardR(crRange.value, true); });
    $('cr-reset').addEventListener('click', function () { syncCardR(R_DEFAULT, true); });
    crHint(getCardR());

    /* ★ 2026-10-11：缩略牌背 / 图片清晰度两块的事件随它们一起下架
       （缩略牌背的事件搬去了 library.js 的牌背设定页）。 */
    // 命名模板
    const tplIn = $('tpl-in');
    function syncPreview() {
      // ★ 必须先存模板、再算预览：buildFileName 是从 localStorage 读模板的，
      //   反过来写会导致预览永远慢一拍（显示上一次的模板结果）。
      try { localStorage.setItem('moka.exportTpl', tplIn.value); } catch (e) {}
      const f = (global.MoKa.io && global.MoKa.io.buildFileName)
        ? global.MoKa.io.buildFileName('星语 · 示例牌组', 12, 'zip')
        : '（预览不可用）';
      $('tpl-prev').textContent = f;
    }
    tplIn.addEventListener('input', syncPreview);
    tplIn.addEventListener('change', syncPreview);
    syncPreview();
    Array.prototype.forEach.call(page.querySelectorAll('.chip-tok'), function (b) {
      b.addEventListener('click', function () {
        const tok = b.dataset.tok;
        const s = tplIn.selectionStart == null ? tplIn.value.length : tplIn.selectionStart;
        const e = tplIn.selectionEnd == null ? s : tplIn.selectionEnd;
        tplIn.value = tplIn.value.slice(0, s) + tok + tplIn.value.slice(e);
        const pos = s + tok.length;
        try { tplIn.setSelectionRange(pos, pos); } catch (err) {}
        tplIn.focus();
        syncPreview();
      });
    });
    $('tpl-reset').addEventListener('click', function () {
      tplIn.value = '{name}_{date}-{time}';
      syncPreview();
      UI.toast('已恢复默认命名');
    });

    // 神签：找回（列表与恢复逻辑都在 lots.js，设置页只给入口）
    if (LG) {
      $('lg-restore').addEventListener('click', function () {
        LG.openRestore(function () { render(); });    // 恢复成功后刷新本页统计
      });
      const rb = $('lg-restore-builtin');
      if (rb) rb.addEventListener('click', function () {
        LG.restoreBuiltin();
        render();
      });
    }

    // 初始化预览里的牌面尺寸
    syncCardSize(w, false);
  }

  /* ---------------- 对外 ---------------- */
  global.MoKa = global.MoKa || {};
  global.MoKa.settings = {
    init: function () { applyCardW(getCardW()); applyCardR(getCardR()); },
    render: render,
    getCardW: getCardW,
    setCardW: setCardW,
    // 走查钩子（_ 结尾 = 本项目的约定）：圆角是纯函数，直接喂值验
    _clampR: clampR, _getCardR: getCardR, _applyCardR: applyCardR, _setCardR: setCardR,
    R_MIN: R_MIN, R_MAX: R_MAX, R_DEFAULT: R_DEFAULT,
    BUILD: BUILD, VERSION: VERSION
  };
})(window);
