/* ============================================================
 * 猫卡 · 网页版文件通道（web-bridge.js）
 * ------------------------------------------------------------
 * 这个文件**只给网页版用**：GitHub Pages 发布时由 Actions 拷进
 * js/ 目录，再往 index.html 末尾塞一行 <script>。
 * APK 里 WebView 通过 addJavascriptInterface 注入了 window.LotFile，
 * 所以下面第一行判断到就会直接让路 —— 装进 App 也不会顶掉原生通道。
 *
 * 补的是 io.js 一直在检查的那几个方法：
 *   saveText / saveBinary    → 浏览器下载（牌组 .json、牌组 .zip、签文截图 .png）
 *   shareFile / shareSavedFile → 有 Web Share 就分享，没有就静默（io.js 本来就 try/catch）
 *   pickImport + getImportStatus + getImportBinaryBase64 + getImportResult
 *                            → <input type=file>，状态机照 Java 端那套
 *                              pending → done / cancel / error:xxx
 *
 * **没有**实现 window.CatCard.capturePNG（牌面截图）：那是拿 Android 的
 * 视图截图通道，网页版不给假实现 —— 编辑器会继续提示「导出需在猫卡 App 内使用」。
 * 神签截图（lot-shot.js 自己用 Canvas 重画）不受影响，网页版能存。
 * ============================================================ */
(function (global) {
  'use strict';
  if (typeof global.LotFile !== 'undefined') return;      /* App 内：原生桥优先 */
  if (typeof global.document === 'undefined') return;     /* 走查/服务端：不装 */

  var state = { status: 'idle', b64: null, name: '' };
  var blobs = Object.create(null);                        /* name -> Blob，给 Web Share 用 */

  function b64ToBlob(b64, mime) {
    var bin = global.atob(String(b64 || ''));
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    try { a.click(); } catch (e) {}
    blobs[name] = blob;
    setTimeout(function () {
      try { document.body.removeChild(a); } catch (e) {}
      try { URL.revokeObjectURL(url); } catch (e) {}
    }, 1500);
  }

  /* 分享：能分享文件就分享，不能就算了（io.js 的调用都包在 try/catch 里） */
  function share(name) {
    var b = blobs[name];
    if (!b || !global.navigator || typeof navigator.share !== 'function') return;
    try {
      var f = new File([b], name, { type: b.type || 'application/octet-stream' });
      if (navigator.canShare && !navigator.canShare({ files: [f] })) return;
      var p = navigator.share({ files: [f] });
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  function saveText(text, name) {
    var fn = String(name || ('猫卡-' + Date.now() + '.txt'));
    download(new Blob([String(text)], { type: 'text/plain;charset=utf-8' }), fn);
    return 'OK:' + fn;
  }

  function saveBinary(name, mime, b64) {
    var fn = String(name || ('猫卡-' + Date.now()));
    download(b64ToBlob(b64, mime), fn);
    return 'OK:' + fn;
  }

  /* 选文件：状态机与 Java 端一致，io.js 每 500ms 轮询一次 */
  function pickImport() {
    if (!global.document || !document.body) return false;
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.zip,.json,application/zip,application/json';
    inp.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0';
    state = { status: 'pending', b64: null, name: '' };
    document.body.appendChild(inp);

    var settled = false;
    function finish(st) {
      if (settled) return;
      settled = true;
      state.status = st;
      setTimeout(function () { try { inp.remove(); } catch (e) {} }, 0);
    }

    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (!f) { finish('cancel'); return; }
      state.name = f.name;
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || '');
        var i = s.indexOf('base64,');
        state.b64 = i >= 0 ? s.substring(i + 7) : '';
        finish(state.b64 ? 'done' : 'error:empty');
      };
      fr.onerror = function () { finish('error:read'); };
      fr.readAsDataURL(f);
    });
    inp.addEventListener('cancel', function () { finish('cancel'); });

    /* 取消兜底：文件框关掉后窗口会重新拿到焦点，800ms 内没选到文件就当取消 */
    global.addEventListener('focus', function onFocus() {
      global.removeEventListener('focus', onFocus);
      setTimeout(function () { if (!settled) finish('cancel'); }, 800);
    }, { once: true });

    try { inp.click(); } catch (e) { finish('error:open'); return false; }
    return true;
  }

  global.LotFile = {
    saveText: saveText,
    saveBinary: saveBinary,
    shareFile: function (name) { share(name); },
    shareSavedFile: function (name) { share(name); },
    pickImport: pickImport,
    getImportStatus: function () { return state.status; },
    getImportBinaryBase64: function () { return state.b64 || ''; },
    getImportResult: function () { return state.name ? ('浏览器下载/' + state.name) : ''; }
  };
  global.__mokaWebBridge = true;   /* 调试用：一眼看出这是网页版 */
})(typeof window !== 'undefined' ? window : this);
