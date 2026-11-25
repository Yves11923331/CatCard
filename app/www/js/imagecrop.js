/* ============================================================
 * 猫卡 · 图片裁剪 (imagecrop.js) —— 基于 Cropper.js
 * ------------------------------------------------------------
 * 用法:
 *   MoKa.imagecrop.open({ onDone(dataURL|null) })   // 比例固定 1:1.5（CARD_RATIO），别再传
 *     → 弹系统选图 → 全屏裁剪(可拖拽/双指缩放, 固定比例)
 * ------------------------------------------------------------
 * 依赖: js/cropper.min.js + css/cropper.min.css (本地)
 * ============================================================ */
(function (global) {
  'use strict';
  const UI = global.MoKa.ui;

  /* 裁剪输出：2:3（清晰优先）。
     ★ 这里是"图片体积/内存"的总闸门：牌面在占卜桌上最宽也就 ~200px（用户可调），
       再乘上放大镜头的 3×，480 宽已经够用；原来固定 540×810 + 质量 0.88，
       一张解码后约 1.7MB 内存，牌桌上翻开 20 张就是 30MB+。
     现在：宽度按设置(省空间360/标准480/高清640)、质量 0.82、并先铺白底
       （否则源图有透明区时，JPEG 会把透明处变成黑色）。 */
  const QUALITY_KEY = 'moka.imgQuality';
  /* 清晰度档位（宽度）：越大越清晰，内存也越大。
     一张 720×1080 解码后约 3MB；桌面上翻开 12 张 ≈ 36MB —— 所以默认给"高清"，
     "超清"留给牌少、或者只在牌库看图的场景。 */
  const LEVELS = { std: 540, hd: 720, uhd: 1080 };

  /* ★ 2026-10-11：**「高清牌面」开关已下架**（用户指出它是冗余的）——
     既然裁剪输出统一 1080 宽，查看器（约 774 设备像素）本来就够清晰，
     再额外存一张 1440 大图纯属重复劳动（还多占一份内存与一个字段）。
     老数据里已经存在的 imageHi 仍然会被查看器优先使用（读逻辑没动，向后兼容）。 */

  /* ★ 2026-10-11：**取消清晰度档位** —— 统一输出 1080 宽。
     用户原话：「运存完全能承受」「尽量不要降低图片的清晰度」。
     档位（540/720/1080）本来就是为省内存设的，现在没必要让用户做这个技术选择；
     设置页那一整块也一并删掉，界面少一处要理解的参数。 */
  /* ★ 2026-11-19：全工程统一到严格 2:3（1:1.5），裁剪器同步改（原来 1.52）。
     ★ 2026-10-13：**统一到卡片的真实比例 1:1.52**（用户：「统一。改裁剪」）。
     卡片的高度一直是 `--card-w × 1.52`（main.css / v3.css 两处），而裁剪输出原来是 2:3
     （1080×1620）—— 差 1.33%，图片进卡片会被 `object-fit:cover` 左右各裁掉一点。
     现在**裁剪框与输出都按 1:1.5**（1078×1617 → 1620），零裁切。
     ⚠ 实际产出是 **1080×1641**（不是 1642）：Cropper 的 getCroppedCanvas 在给了 aspectRatio 时
       会用 `width / aspectRatio` 重算高度（1620 整）。与卡片的 1.5 零误差。
     ⚠ 比例只此一处口径：调用方 **不要**再传 ratio（传了就覆盖它，又变两套）。
     ⚠ 已存的旧牌面图（1620 高）不重裁 —— 那 0.7% 肉眼看不出来，重裁要用户重选图。 */
  const CARD_RATIO = 1 / 1.5;                  // 宽/高，与 --card-h: calc(--card-w * 1.5) 同口径
  function outWidth() { return LEVELS.uhd; }   // 1080×1641（见上面的取整说明）

  function intermediateCanvasCap(cropper, outputWidth, outputHeight) {
    const canvas = cropper.getCanvasData();
    const cropBox = cropper.getCropBoxData();
    if (!canvas || !cropBox || !(canvas.width > 0) || !(canvas.height > 0) ||
        !(canvas.naturalWidth > 0) || !(canvas.naturalHeight > 0) ||
        !(cropBox.width > 0) || !(cropBox.height > 0)) return null;

    return {
      maxWidth: Math.max(outputWidth, Math.min(canvas.naturalWidth,
        Math.ceil(outputWidth * canvas.width / cropBox.width))),
      maxHeight: Math.max(outputHeight, Math.min(canvas.naturalHeight,
        Math.ceil(outputHeight * canvas.height / cropBox.height)))
    };
  }

  function getCroppedCanvas(cropper, outputWidth, outputHeight) {
    const cap = intermediateCanvasCap(cropper, outputWidth, outputHeight);
    return cropper.getCroppedCanvas(Object.assign({
      width: outputWidth,
      height: outputHeight,
      imageSmoothingQuality: 'high',
      fillColor: '#ffffff'
    }, cap || {}));
  }

  function open(opts) {
    opts = opts || {};
    const ratio = opts.ratio || CARD_RATIO;    // 调用方没传就用卡片口径（正常都不传）
    const onDone = opts.onDone || function () {};
    const hi = false;                // ★ 2026-10-11：高清大图下架，恒为 false（参数保留仅为兼容旧调用）

    // 1. 选图
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', function () {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (!f) { onDone(null); return; }
      const rd = new FileReader();
      rd.onload = function () { startCrop(rd.result, ratio, onDone, hi); };
      rd.onerror = function () { UI.toast('读取图片失败'); onDone(null); };
      rd.readAsDataURL(f);
    });
    inp.click();
  }

  /* 当前正在开着的裁剪器（同一时刻只有一个）。系统返回键通过它"取消"这次裁剪。 */
  var activeCancel = null;

  function startCrop(src, ratio, onDone, hi) {
    const root = document.getElementById('overlay-root');

    // 遮罩 + 裁剪框(iframe 无需; 全屏)
    const mask = document.createElement('div');
    mask.className = 'crop-mask';
    mask.innerHTML =
      '<div class="crop-stage">' +
        '<div class="crop-bar">' +
          '<button type="button" class="btn btn-ghost crop-cancel">取消</button>' +
          '<span class="crop-hint">拖动调整位置 · 双指缩放</span>' +
          '<button type="button" class="btn btn-primary crop-done">完成</button>' +
        '</div>' +
        '<div class="crop-holder">' +
          '<img id="crop-image" alt="选图">' +
        '</div>' +
      '</div>';
    root.appendChild(mask);

    const img = mask.querySelector('#crop-image');
    const holder = mask.querySelector('.crop-holder');
    const bar = mask.querySelector('.crop-bar');

    let cropper = null;
    let doneCalled = false;

    let detachFit = function () {};      // 摘 resize 监听用的钩子（mount 里赋值）
    function closeAnd(doneResult, hiResult) {
      if (doneCalled) return; // 只处理一次
      doneCalled = true;
      /* ⚠ 2026-09-21：这里原来只 destroy + remove，**那条 window resize 监听从没摘过**。
         每次"选图→完成/取消"都往 window 上挂一个 fit，闭包一直攥着 mask / cropper / img
         （img.src 是整张原图的 dataURL）—— 选十几张图就是十几份，内存一路涨。 */
      try { detachFit(); } catch (e) {}
      if (cropper) { try { cropper.destroy(); } catch (e) {} }
      mask.remove();
      if (activeCancel === selfCancel) activeCancel = null;
      // 第二个参数只有"开了高清牌面"时才有值；其余调用点不传 → null
      if (onDone) onDone(doneResult, hiResult || null);
    }
    /* 系统返回键要用：index.html 的 closeTopmost 会先问有没有正在裁剪的图。
       返回 true = "我吃掉这次返回"（等价于点「取消」），别把下面的页面一层层退掉。 */
    function selfCancel() { if (doneCalled) return false; closeAnd(null); return true; }
    activeCancel = selfCancel;

    // 把 mount 逻辑提成函数, 确保 onload/缓存图都走这里
    function mount() {
      if (!window.Cropper) { UI.toast('裁剪组件未加载'); closeAnd(null); return; }
      if (cropper) return; // 已初始化(缓存图再次触发)
      try {
        cropper = new Cropper(img, {
          viewMode: 1,
          dragMode: 'move',
          aspectRatio: ratio,
          autoCropArea: 0.9,
          background: true,
          center: true,
          responsive: true,
          checkOrientation: true,
          modal: true,
          guides: true,
          highlight: false,
          movable: true,
          rotatable: true,
          scalable: false,
          zoomable: true,
          toggleDragModeOnDblclick: false
        });
      } catch (e) {
        console.error('Cropper init error', e);
        UI.toast('初始化裁剪失败: ' + (e && e.message || ''));
        closeAnd(null);
        return;
      }

      function fit() {
        const vw = window.innerWidth, vh = window.innerHeight;
        const topH = bar.offsetHeight || 56;
        holder.style.width = vw + 'px';
        holder.style.height = Math.max(200, vh - topH) + 'px';
        try { cropper.resize(); } catch (e) {}
      }
      fit();
      window.addEventListener('resize', fit);
      detachFit = function () { window.removeEventListener('resize', fit); };

      mask.querySelector('.crop-cancel').addEventListener('click', function () { closeAnd(null); });
      mask.addEventListener('click', function (e) { if (e.target === mask) closeAnd(null); });

      mask.querySelector('.crop-done').addEventListener('click', function () {
        if (!cropper) { UI.toast('裁剪器尚未就绪，请稍候'); return; }
        let out = null, hiOut = null;
        try {
          const ow = outWidth();
          const oh = Math.round(ow / ratio);
          const canvas = getCroppedCanvas(cropper, ow, oh);
          if (!canvas) { UI.toast('生成失败：裁剪结果为空'); return; }
          out = canvas.toDataURL('image/jpeg', 0.90);
          if (!out) { UI.toast('生成失败：输出为空'); return; }
          /* 高清大图已取消（见上面 HI_W 的说明）：output 就是最终牌面，查看器够用。 */
        } catch (e) {
          console.error('[裁剪导出失败]', e);
          UI.toast('生成失败: ' + (e && e.message ? e.message : String(e)));
          return; // 失败不关闭, 让用户可重试
        }
        closeAnd(out, hiOut);
      });
    }

    img.addEventListener('load', mount);
    img.addEventListener('error', function () {
      UI.toast('图片无法显示');
      closeAnd(null);
    });
    img.src = src;
    // 若图片已缓存且已 complete, load 不会再触发 → 手动 mount
    if (img.complete) mount();
  }

  global.MoKa = global.MoKa || {};
  /* 有没有正在裁剪的图；有就取消它（系统返回键用）。返回 true = 这次返回被吃掉了。 */
  function cancelActiveCrop() { return !!(activeCancel && activeCancel()); }
  global.MoKa.imagecrop = {
    open: open,
    cancel: cancelActiveCrop,
    _intermediateCanvasCap: intermediateCanvasCap,
    _getCroppedCanvas: getCroppedCanvas
  };
})(window);
