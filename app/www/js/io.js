/* ============================================================
 * 猫卡 · 文件导入/导出 (io.js)  v2
 * ------------------------------------------------------------
 * 原生通道：window.LotFile
 *   saveText/shareSavedFile            (文本, 兼容)
 *   saveBinary(name,mime,b64)/shareFile(name,mime)   (真 ZIP, 原生补丁后可用)
 *   pickImport / getImportStatus / getImportResult    (文本读回, 兼容)
 *   getImportBinaryBase64               (二进制读回, 原生补丁后可用)
 * 导出 = 单牌组 → .zip(manifest.json + images/)；无原生二进制能力时自动回退 .json
 * 导入 = 选文件 → 自动识别 .zip / .json → 追加到当前牌组（无当前牌组则新建）
 * ============================================================ */
(function (global) {
  'use strict';
  const D = global.MoKa.data;
  const UI = global.MoKa.ui;

  /* ---------- 导出文件命名规则 ----------
   * 用户可在「设置」里改模板；可用占位符：
   *   {name} 牌组名  {date} 年月日  {time} 时分  {sec} 时分秒  {ts} 时间戳  {n} 张数
   * 默认 {name}_{date}-{time} —— 与改造前的文件名完全一致，老习惯不受影响。
   */
  const TPL_KEY = 'moka.exportTpl';
  const TPL_DEFAULT = '{name}_{date}-{time}';

  function safeName(name) {
    return String(name || '牌组').replace(/[\\/:*?"<>|\s]+/g, '_');
  }
  function exportTpl() {
    try {
      const v = localStorage.getItem(TPL_KEY);
      if (v && String(v).trim()) return String(v);
    } catch (e) {}
    return TPL_DEFAULT;
  }
  function tplTokens(deckName, cardCount) {
    const d = new Date();
    const p2 = function (x) { return ('00' + x).slice(-2); };
    return {
      '{name}': safeName(deckName),
      '{date}': d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()),
      '{time}': p2(d.getHours()) + p2(d.getMinutes()),
      '{sec}': p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()),
      '{ts}': String(d.getTime()),
      '{n}': (cardCount == null ? '' : String(cardCount))
    };
  }
  // 把模板套成真实文件名（含扩展名）；非法字符统一换成下划线
  function buildFileName(deckName, cardCount, ext) {
    const toks = tplTokens(deckName, cardCount);
    let out = exportTpl();
    Object.keys(toks).forEach(function (k) { out = out.split(k).join(toks[k]); });
    out = out.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
    if (!out) out = toks['{name}'] + '_' + toks['{date}'] + '-' + toks['{time}'];
    return out + '.' + String(ext || 'zip').replace(/^\./, '');
  }
  /* ★ 2026-10-08：**外置资源型牌面图**的前缀。
     机制说明与用法在 app/decks/00-必读-内置牌组增删流程.md；生成器同目录（tools/gen_*）里认得出。
     这类图随包走（www/assets/deckimg/…），既不内嵌进注册表、也不落手机存储：
       · 导出 → 不进 zip，manifest 里原样写这条相对路径（几十字节）；
       · 导入 → 原样还原成路径，WebView 直接按路径加载，换台装了猫卡的手机照样看得见。
     ★ 判据**只认前缀、不认牌组名**（这里刻意不点任何一副牌的名字）：它是给所有"整面图 / 插画"
       牌组用的通用通路，谁进谁出都不牵动这段代码；点了名反而会让「删除 <key>」的 dry-run
       把这条通用机制误列成"那副牌的专属补丁"。 */
  const DECK_ASSET_PREFIX = 'assets/deckimg/';
  function dataURLparts(url) {
    if (typeof url !== 'string' || url.indexOf('data:') !== 0) return null;
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
    return m ? { mime: m[1], b64: m[2] } : null;
  }
  function extOf(mime) {
    if (!mime) return '.bin';
    if (mime.indexOf('png') >= 0) return '.png';
    if (mime.indexOf('jpeg') >= 0 || mime.indexOf('jpg') >= 0) return '.jpg';
    if (mime.indexOf('webp') >= 0) return '.webp';
    return '.bin';
  }
  function mimeOfPath(path) {
    if (/\.png$/i.test(path)) return 'image/png';
    if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
    if (/\.webp$/i.test(path)) return 'image/webp';
    return 'application/octet-stream';
  }
  function utf8Decode(bytes) {
    try { if (global.TextDecoder) return new TextDecoder('utf-8').decode(bytes); } catch (e) {}
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }
  function bytesFromB64(b64) {
    const bin = global.atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function getJZ() {
    return (typeof global !== 'undefined' && (global.JSZip || global.jszip)) ||
           (typeof window !== 'undefined' && (window.JSZip || window.jszip)) || null;
  }
  function zipCapable() {
    return !!getJZ() && typeof window.LotFile !== 'undefined' &&
      typeof window.LotFile.saveBinary === 'function' && typeof window.LotFile.shareFile === 'function';
  }
  function binImportCapable() {
    return typeof window.LotFile !== 'undefined' && typeof window.LotFile.getImportBinaryBase64 === 'function';
  }

  /* ============ 导出 ============ */
  function buildSingleJson(deck) {
    return JSON.stringify({
      app: 'moka', kind: 'moka-deck-v1', ver: 1, exportedAt: new Date().toISOString(),
      deck: {
        name: deck.name,
        backImage: deck.backImage || null,
        backTemplate: deck.backTemplate || null,
        backColor: deck.backColor || '#8a7a3a',
        useRev: !!deck.useRev,
        hiRes: !!deck.hiRes,          // 牌组级开关：是否存了高清大图
        // ★ 2026-09-21：纸边两个开关以前整段漏了 —— 关掉纸边再导出/导入，设定静默回退成"开"。
        //   牌组级字段的完整清单见 data.js cloneDeck 上的注释，三处要一起加。
        backEdge: deck.backEdge !== false,
        faceEdge: deck.faceEdge !== false,
        cards: deck.cards.map(function (c) { return JSON.parse(JSON.stringify(c)); })
      }
    });
  }
  // UTF-8 文本 → base64（走二进制通道要用）
  function utf8ToB64(str) {
    try {
      const bytes = new TextEncoder().encode(String(str));
      let bin = '';
      const CH = 0x8000;                        // 分块，别一次 apply 太多参数
      for (let i = 0; i < bytes.length; i += CH) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      }
      return window.btoa(bin);
    } catch (e) {
      try { return window.btoa(unescape(encodeURIComponent(String(str)))); } catch (e2) { return null; }
    }
  }
  const MIME_OF_EXT = { json: 'application/json', txt: 'text/plain', csv: 'text/csv' };

  // 通用：把一段文本存成文件（走文件桥 → Download/猫卡/），存完顺手弹出分享
  // 成功 {name}，失败 {err}
  // 注意：桥的 saveText 一律写 text/plain，安卓/分享面板会把 .json 当文本、显示成 txt；
  //       所以 .json 走 saveBinary + application/json（能带正确 MIME，桥支持）。
  /* ★ 2026-09-23：加第三个参数 opt.share=false → **只写文件、不弹分享面板**。
     为什么要这个：自动备份（签文那份 Download/猫卡/签文-自动备份.json）用的是同一个函数，
     而它默认会弹分享 —— 用户报"初始化进软件弹出来一个分享"，就是首次启动播内置签文包时
     触发了一次自动备份，把分享面板带出来了。导出牌组/签文那种**用户主动**的操作仍旧弹分享。 */
  function saveTextFile(name, text, opt) {
    const wantShare = !(opt && opt.share === false);
    if (typeof window.LotFile === 'undefined') return { err: '文件通道不可用（需在猫卡 App 内运行）' };
    const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    const ext = m ? m[1].toLowerCase() : '';
    const canBin = typeof window.LotFile.saveBinary === 'function';
    let res;
    if (ext === 'json' && canBin) {
      const b64 = utf8ToB64(text);
      if (b64 == null) return { err: '保存失败（内容编码异常）' };
      try { res = String(window.LotFile.saveBinary(name, MIME_OF_EXT.json, b64)); }
      catch (e) { return { err: '保存失败（文件通道异常）' }; }
      if (res.indexOf('OK:') !== 0) return { err: '保存失败 (' + res + ')' };
      const fn = res.substring(3);
      if (wantShare) { try { window.LotFile.shareFile(fn, MIME_OF_EXT.json); } catch (e) {} }
      return { name: fn };
    }
    if (typeof window.LotFile.saveText !== 'function') return { err: '文件通道不可用（需在猫卡 App 内运行）' };
    try { res = String(window.LotFile.saveText(text, name)); }
    catch (e) { return { err: '保存失败（文件通道异常）' }; }
    if (res.indexOf('OK:') !== 0) return { err: '保存失败 (' + res + ')' };
    const fn = res.substring(3);
    if (wantShare) { try { window.LotFile.shareSavedFile(fn); } catch (e) {} }
    return { name: fn };
  }
  /* ★ 2026-10-12：**图片**落地（签文截图 PNG 用）。
     与 saveTextFile 同一套：走原生桥 saveBinary → Download/猫卡/，存完弹分享面板。
     入参是 canvas 给的那种 dataURL（image/png、image/jpeg 都行），不再自己转码。 */
  function saveImageFile(name, dataUrl, opt) {
    const wantShare = !(opt && opt.share === false);
    if (typeof window.LotFile === 'undefined') return { err: '文件通道不可用（需在猫卡 App 内运行）' };
    if (typeof window.LotFile.saveBinary !== 'function') return { err: '文件通道不可用（这个版本不支持存图片）' };
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataUrl || ''));
    if (!m) return { err: '保存失败（图片数据异常）' };
    const mime = m[1] || 'image/png';
    const fn0 = name || ('猫卡-' + Date.now() + '.png');
    let res;
    try { res = String(window.LotFile.saveBinary(fn0, mime, m[2])); }
    catch (e) { return { err: '保存失败（文件通道异常）' }; }
    if (res.indexOf('OK:') !== 0) return { err: '保存失败 (' + res + ')' };
    const fn = res.substring(3);
    if (wantShare) { try { window.LotFile.shareFile(fn, mime); } catch (e) {} }
    return { name: fn };
  }
  function exportJson(deck) {
    return saveTextFile(buildFileName(deck.name, deck.cards.length, 'json'), buildSingleJson(deck));
  }  /* 纯逻辑：把牌组摊成 manifest；图片不进 manifest，交给
     put(dataUrl, holder, key, images) 去处理（真导出时写进 zip，走查时塞个假的）。
     ★ 单独抽出来是为了**能测** —— JSZip 的 generateAsync 在 jsdom 里永远不 resolve，
       这段逻辑原来被压在 exportZip 里面，走查根本够不着。 */
  function buildZipManifest(deck, put) {
    const manifest = {
      app: 'moka', kind: 'moka-deck-v1', ver: 2, exportedAt: new Date().toISOString(),
      images: {},
      deck: {
        name: deck.name,
        backImagePath: null,
        backTemplate: deck.backTemplate || null,
        backColor: deck.backColor || '#8a7a3a',
        useRev: !!deck.useRev,
        hiRes: !!deck.hiRes,
        backEdge: deck.backEdge !== false,      // ★ 同 buildSingleJson：纸边开关别再漏
        faceEdge: deck.faceEdge !== false,
        cards: []
      }
    };
    put(deck.backImage, manifest.deck, 'backImagePath', manifest.images);
    deck.cards.forEach(function (c) {
      const card = JSON.parse(JSON.stringify(c));
      const img = card.image || null;
      const imgHi = card.imageHi || null;
      delete card.image;
      delete card.imageHi;
      card.imagePath = null;
      card.imageHiPath = null;
      if (img) put(img, card, 'imagePath', manifest.images);
      // ★ 高清大图也必须搬进 images/。漏了这一步，它会被 JSON 原样写进 manifest.json ——
      //   一卡几百 KB 的裸 base64，导出包直接废掉。
      if (imgHi) put(imgHi, card, 'imageHiPath', manifest.images);
      manifest.deck.cards.push(card);
    });
    return manifest;
  }

  /* ★ 2026-10-08：真 put 抽出来（原来埋在 exportZip 里，走查 / 验证件够不着）——
     「外置资源型牌面图原样保留路径、不进 zip」这条必须有牙，抽出来才验得了。
     和 buildZipManifest 当年抽出来的理由一样。 */
  function makeZipPut(zip) {
    let imgIdx = 0;
    return function put(dataUrl, holder, key, images) {
      /* ★ 外置资源型牌面图：不进 zip、也不写 null —— 原样把相对路径写进 manifest。
         图片本就随包走，再塞一份进 zip 只是白涨体积（神谕卡 52 张内嵌那次就是这么涨上去的）。 */
      if (typeof dataUrl === 'string' && dataUrl.indexOf(DECK_ASSET_PREFIX) === 0) {
        holder[key] = dataUrl; return;
      }
      const p = dataURLparts(dataUrl);
      if (!p) { holder[key] = null; return; }
      const path = 'images/' + (imgIdx++) + extOf(p.mime);
      zip.file(path, p.b64, { base64: true });
      images[path] = p.mime;
      holder[key] = path;
    };
  }

  function exportZip(deck) {
    const zip = new global.JSZip();
    const put = makeZipPut(zip);
    const manifest = buildZipManifest(deck, put);
    zip.file('manifest.json', JSON.stringify(manifest));
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }
  /* ★ 2026-09-21：导出前先看一眼"图片到底拿得到没有"。
     背景：图片平时存在 IndexedDB 里、内存里只留一个 `idb:xxx` 标记，启动时再补回原图
     （data.js 的 hydrateImages）。如果那次补回失败（历史上真出过：图库读不出来，
     那个会话就一个引用都不动、全留在标记状态），导出流程会把 `idb:` 当成"没有图"：
       · ZIP 路子 → dataURLparts 认不出 → imagePath = null，**静默**少图；
       · JSON 兜底 → 文件里字面写着 "image":"idb:img-1"，换台手机就是死引用。
     两种都不报错，用户以为"导出过就安全了" —— 而导出正是他最后一道保险。
     所以这里给一个明确的判据：**还有标记没补回来就说清楚，别导出一个没有图的空壳。**
     返回 null = 可以导出；返回字符串 = 原因（调用方拿去提示/确认）。 */
  function unhydratedImages(deck) {
    var n = 0;
    if (!deck) return 0;
    if (typeof deck.backImage === 'string' && deck.backImage.indexOf('idb:') === 0) n++;
    (deck.cards || []).forEach(function (c) {
      if (!c) return;
      if (typeof c.image === 'string' && c.image.indexOf('idb:') === 0) n++;
      if (typeof c.imageHi === 'string' && c.imageHi.indexOf('idb:') === 0) n++;
    });
    return n;
  }
  function exportBlockReason(deck) {
    var n = unhydratedImages(deck);
    if (!n) return null;
    return '这副牌有 ' + n + ' 张图片还没从图库里读出来（现在是引用状态），' +
           '直接导出会**丢图**。建议先重启 App 再试；如果你就是要导这份没图的备份，点「继续导出」。';
  }

  function exportDeck(deckId) {
    const deck = deckId ? D.findDeck(deckId) : null;
    if (!deck) { UI.toast('未找到牌组'); return; }
    const warn = exportBlockReason(deck);
    if (warn) {
      // 不硬拦（用户可能就是要把"结构"导走），但**必须先说清楚**再让他决定
      UI.confirmDialog({
        icon: '⚠', title: '这些图现在导不出来',
        sub: warn,
        okText: '继续导出', cancelText: '先不导'
      }).then(function (go) { if (go) doExportDeck(deck); });
      return;
    }
    doExportDeck(deck);
  }
  function doExportDeck(deck) {
    const canZip = zipCapable();
    const fmt = canZip ? 'ZIP（manifest+images，可直接解压）' : 'JSON（当前环境无原生二进制通道，自动回退）';
    UI.confirmDialog({
      icon: '↑',
      title: '导出牌组',
      sub: '将导出「' + deck.name + '」（' + deck.cards.length + ' 张猫卡' + (deck.backImage ? '，含牌背图' : '') + '）为 ' + fmt + '。\n文件名：' + buildFileName(deck.name, deck.cards.length, canZip ? 'zip' : 'json'),
      okText: '保存并分享'
    }).then(function (ok) {
      if (!ok) return;
      if (typeof window.LotFile === 'undefined') { UI.toast('文件通道不可用（需在 mQimen 内运行）'); return; }
      const name = buildFileName(deck.name, deck.cards.length, 'zip');
      if (zipCapable()) {
        exportZip(deck).then(function (blob) {
          const rd = new FileReader();
          rd.onload = function () {
            const ds = String(rd.result);
            const b64 = ds.indexOf(',') >= 0 ? ds.substring(ds.indexOf(',') + 1) : ds;
            const res = String(window.LotFile.saveBinary(name, 'application/zip', b64));
            if (res.indexOf('OK:') !== 0) { UI.toast('保存失败 (' + res + ')'); return; }
            UI.toast('已导出「' + deck.name + '」(.zip)');
            try { window.LotFile.shareFile(name, 'application/zip'); } catch (e) {}
          };
          rd.onerror = function () { UI.toast('读取压缩数据失败'); };
          rd.readAsDataURL(blob);
        }).catch(function (e) { UI.toast('压缩失败: ' + String(e && e.message || e)); });
      } else {
        const out = exportJson(deck);
        if (out.err) { UI.toast(out.err); return; }
        UI.toast('已导出「' + deck.name + '」(.json)');
      }
    });
  }

  /* ============ 文件选择 ============ */
  function pickPayload(onDone) {
    if (typeof window.LotFile === 'undefined') { UI.toast('文件通道不可用（需在 mQimen 内运行）'); return; }
    let ok = false;
    try { ok = !!window.LotFile.pickImport(); } catch (e) { ok = false; }
    if (!ok) {
      let st = 'error:unknown';
      try { st = String(window.LotFile.getImportStatus ? window.LotFile.getImportStatus() : 'error:unknown'); } catch (e2) {}
      UI.toast(st.indexOf('error:') === 0 ? '无法打开文件选择器 (' + st.substring(6) + ')' : '无法打开文件选择器');
      return;
    }
    let waited = 0;
    const timer = setInterval(function () {
      waited += 500;
      let st = '';
      try { st = String(window.LotFile.getImportStatus()); } catch (e) { st = 'error:read'; }
      if (st === 'done') {
        clearInterval(timer);
        let b64 = null, txt = null, binAvail = 0, binEmpty = 0;
        if (binImportCapable()) {
          binAvail = 1;
          try {
            const v = String(window.LotFile.getImportBinaryBase64() || '');
            if (v) b64 = v; else binEmpty = 1;
          } catch (e) { binAvail = 2; /* 调用抛错 */ }
        }
        if (b64 == null) {
          // 读不到二进制时给一次 600ms 重试
          setTimeout(function () {
            let b2 = null;
            if (binImportCapable()) {
              try { const v2 = String(window.LotFile.getImportBinaryBase64() || ''); if (v2) b2 = v2; else binEmpty = 1; } catch (e) {}
            }
            if (b2 != null) { onDone({ b64: b2, txt: null, binAvail: binAvail, binEmpty: 0 }); return; }
            try { txt = String(window.LotFile.getImportResult() || ''); } catch (e) { txt = ''; }
            onDone({ b64: null, txt: txt, binAvail: binAvail, binEmpty: binEmpty });
          }, 600);
          return;
        }
        onDone({ b64: b64, txt: null, binAvail: binAvail, binEmpty: 0 });
        return;
      }
      if (st === 'cancel') { clearInterval(timer); UI.toast('已取消选择'); return; }
      if (st.indexOf('error:') === 0) { clearInterval(timer); UI.toast('读取文件失败 (' + st.substring(6) + ')'); return; }
      if (waited > 180000) { clearInterval(timer); UI.toast('选择文件超时，请重试'); }
    }, 500);
  }

  /* ============ 解析(.json 或 .zip) → 统一对象 {kind, decks?} ============ */
  async function hydrateZip(manifest, zip) {
    // 图片文件补回 dataURL
    const resolvePath = async function (path) {
      if (!path) return null;
      /* ★ 外置资源型：它不在这份 zip 里 —— 它随包走，原样返回即可（对应 exportZip 的 put）。 */
      if (path.indexOf(DECK_ASSET_PREFIX) === 0) return path;
      try {
        const f = zip.file(path);
        if (!f) return null;
        const b = await f.async('base64');
        const mime = manifest.images && manifest.images[path] ? manifest.images[path] : mimeOfPath(path);
        return 'data:' + mime + ';base64,' + b;
      } catch (e) { return null; }
    };
    return hydrateManifest(manifest, resolvePath);
  }

  /* 纯逻辑：manifest → {kind,decks}；图片靠 resolvePath(path) 异步补回 dataURL。
     ★ 抽出来同样是为了能测（JSZip 在 jsdom 里不可用）。 */
  async function hydrateManifest(manifest, resolvePath) {
    const decks = [];
    if (manifest.kind === 'moka-deck-v1' && manifest.deck) {
      const dk = manifest.deck;
      const back = await resolvePath(dk.backImagePath);
      const cards = [];
      for (const c of (dk.cards || [])) {
        const card = JSON.parse(JSON.stringify(c));
        const img = await resolvePath(card.imagePath);
        const imgHi = await resolvePath(card.imageHiPath);
        delete card.imagePath;
        delete card.imageHiPath;
        card.image = img || null;
        card.imageHi = imgHi || null;
        cards.push(card);
      }
      decks.push({
        name: dk.name, backImage: back, backTemplate: dk.backTemplate || null,
        backColor: dk.backColor || '#8a7a3a',
        // ★ 这两个牌组级开关以前整段漏了 useRev —— 单个牌组 ZIP 导出再导入，
        //   「正逆位」设定会静默丢掉。这次一起补齐。
        useRev: !!dk.useRev,
        hiRes: !!dk.hiRes,
        backEdge: dk.backEdge !== false,        // ★ 缺字段的老包 → 按默认"开"
        faceEdge: dk.faceEdge !== false,
        cards: cards
      });
      return { kind: 'decks', decks: decks };
    }
    if (manifest.kind === 'moka-decks-v1' && Array.isArray(manifest.decks)) {
      for (const d0 of manifest.decks) {
        const back = await resolvePath(d0.backImagePath);
        const cards = [];
        for (const c of (d0.cards || [])) {
          const card = JSON.parse(JSON.stringify(c));
          const img = await resolvePath(card.imagePath);
          const imgHi = await resolvePath(card.imageHiPath);
          delete card.imagePath;
          delete card.imageHiPath;
          card.image = img || null;
          card.imageHi = imgHi || null;
          cards.push(card);
        }
        decks.push({ name: d0.name, backImage: back, backTemplate: d0.backTemplate || null, backColor: d0.backColor || '#8a7a3a', useRev: !!d0.useRev, hiRes: !!d0.hiRes, backEdge: d0.backEdge !== false, faceEdge: d0.faceEdge !== false, cards: cards });
      }
      return { kind: 'decks', decks: decks };
    }
    return null;
  }
  async function resolvePayload(payload) {
    const diag = { b64len: payload.b64 ? payload.b64.length : -1, txtlen: payload.txt != null ? payload.txt.length : -1, jszip: !!getJZ(), bin: payload.binAvail != null ? payload.binAvail : (binImportCapable() ? 1 : 0), binEmpty: payload.binEmpty || 0, err: '' };
    try {
      // 1) 文本优先(旧 json)
      if (payload.txt != null) {
        try { const o = JSON.parse(payload.txt); if (o && o.app === 'moka') return { ok: true, obj: o }; } catch (e) { diag.err = 'json:' + String(e && e.message || e); }
      }
      // 2) 二进制: 先试 UTF-8 JSON, 再试 zip
      if (payload.b64) {
        const bytes = bytesFromB64(payload.b64);
        diag.head = bytes.length > 4 ? (bytes[0] + ',' + bytes[1] + ',' + bytes[2] + ',' + bytes[3]) : '';
        const asText = utf8Decode(bytes);
        try {
          const o = JSON.parse(asText);
          if (o && o.app === 'moka') return { ok: true, obj: o };
        } catch (e) {}
        if (getJZ()) {
          try {
            const zip = await getJZ().loadAsync(bytes);
            const mf = zip.file('manifest.json');
            if (mf) {
              const mjson = JSON.parse(await mf.async('string'));
              const r = await hydrateZip(mjson, zip);
              if (r) return { ok: true, obj: r };
            } else { diag.err = 'no-manifest'; }
          } catch (e) { diag.err = 'unzip:' + String(e && e.message || e).slice(0, 80); }
        } else { diag.err = 'no-jszip'; }
      } else { diag.err = diag.err || 'empty-payload'; }
    } catch (e) { diag.err = 'outer:' + String(e && e.message || e).slice(0, 80); }
    return { ok: false, diag: diag };
  }

  /* ============ 导入 ============ */
  async function reportImport(successMessage) {
    let status;
    try { status = await D.flushPersist(); } catch (e) {}
    if (status && status.ok && !status.unresolvedImgs) {
      UI.toast(successMessage);
    } else {
      UI.toast('导入结果未完全保存：重启后可能回退。请先保留原导入文件。', 4000);
    }
  }

  function importTo(targetDeckId) {
    pickPayload(function (payload) {
      resolvePayload(payload).then(function (res) {
        if (!res || !res.ok || !res.obj) {
          const d = (res && res.diag) || {};
          UI.toast('解析失败 诊断:bin=' + d.bin + ' 空=' + d.binEmpty + ' b64=' + d.b64len + ' txt=' + d.txtlen + ' jszip=' + (d.jszip ? 1 : 0) + (d.err ? ' ' + d.err : ''));
          return;
        }
        const obj = res.obj;
        let decks = null;
        if (obj.kind === 'moka-decks-v1' && Array.isArray(obj.decks) && obj.decks.length) decks = obj.decks;
        else if (obj.kind === 'moka-deck-v1' && obj.deck && Array.isArray(obj.deck.cards)) decks = [obj.deck];
        else if (obj.kind === 'decks' && Array.isArray(obj.decks) && obj.decks.length) decks = obj.decks; // hydrateZip 输出
        if (!decks || !decks.length) { UI.toast('文件里没有牌组数据'); return; }

        // 旧版“整库备份/多组” → 逐个加入为新牌组(续写不覆盖)
        if (decks.length > 1 || (decks.length === 1 && obj.kind === 'moka-decks-v1')) {
          return UI.confirmDialog({
            icon: '↓', title: '导入牌组',
            sub: '文件含 ' + decks.length + ' 个牌组，将逐个加入为新牌组（不覆盖现有数据，撞名自动加序号）。',
            okText: '导入'
          }).then(function (ok) {
            if (!ok) return;
            let n = 0;
            decks.forEach(function (dk) { try { if (D.importDeck(dk)) n++; } catch (e) {} });
            if (global.MoKa.library) global.MoKa.library.goHome();
            if (!n) { UI.toast('导入失败：没有可加入的牌组'); return; }
            return reportImport('已加入 ' + n + ' 个牌组' + (n < decks.length ? '，有 ' + (decks.length - n) + ' 个未加入' : ''));
          });
          return;
        }
        // 单牌组 → 追加到当前牌组(无当前则新建)
        const deck = decks[0];
        const cnt = (deck.cards || []).length;
        const cur = targetDeckId ? D.findDeck(targetDeckId) : null;
        if (cur) {
          const hasBack = !!(deck.backImage);
          return UI.confirmDialog({
            icon: '↓', title: '导入到「' + cur.name + '」',
            sub: '把文件中的 ' + cnt + ' 张猫卡追加到当前牌组末尾。' + (hasBack ? '文件自带的牌背也会一并应用到本牌组。' : '当前牌组的牌背保持不变。'),
            okText: '追加'
          }).then(function (ok) {
            if (!ok) return;
            if (!D.appendCardsToDeck(cur.id, deck.cards || [])) { UI.toast('导入失败：找不到目标牌组'); return; }
            let extra = '';
            if (hasBack) {
              const cfg = {
                image: deck.backImage || null,
                template: deck.backTemplate || null,
                color: deck.backColor || '#8a7a3a'
              };
              try { if (D.setDeckBack(cur.id, cfg)) extra = '，已套用文件牌背'; } catch (e) {}
            }
            return reportImport('已追加 ' + cnt + ' 张猫卡到「' + cur.name + '」' + extra);
          });
        } else {
          const made = D.importDeck(deck);
          if (!made) { UI.toast('导入失败：文件里没有有效的牌组'); return; }
          if (global.MoKa.library) global.MoKa.library.goHome();
          return reportImport('已导入为新牌组：' + made.name);
        }
      }).catch(function () { UI.toast('解析文件失败'); });
    });
  }

  global.MoKa = global.MoKa || {};
  global.MoKa.io = {
    buildFileName, exportTpl, TPL_KEY, TPL_DEFAULT, saveTextFile, pickPayload,
    saveImageFile,
    exportDeck: exportDeck, importTo: importTo,
    // 下划线结尾 = 本项目的"走查钩子"约定（走查要直接验 ZIP 往返，不想绕文件桥）
    exportZip_: exportZip, hydrateZip_: hydrateZip,
    // manifest 的构造/还原是纯函数，走查直接喂假 put / 假 resolvePath 就能验
    buildZipManifest_: buildZipManifest, hydrateManifest_: hydrateManifest,
    makeZipPut_: makeZipPut,
    // ★ 走查钩子：导出前的"图片还没补回来"判据（纯函数）
    exportBlockReason_: exportBlockReason, unhydratedImages_: unhydratedImages };
})(window);
