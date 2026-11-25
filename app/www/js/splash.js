/* ============================================================
 * catcard · 启动页收尾（splash.js）
 * ------------------------------------------------------------
 * 干两件事：
 *   1. 把法阵里那一百多个小元素现场生成出来（刻度 / 地支 / 罗马数字 / 弧段 / 几何）；
 *   2. 决定这一层什么时候淡出。
 *
 * 谁触发：app.js 的 bootReveal() 在「页面真的准备好了」的那一刻调
 *         window.MoKaSplash.hide()（见那边 done() 里的三行）。
 * 什么时候允许淡：
 *   · 至少展示 MIN_MS —— 动画播到字标落定（约 1.5s），别一上来就闪走；
 *   · init 慢就一直等，等 bootReveal 来喊；
 *   · 但无论如何不超过 MAX_MS，init 挂死也不能永远挡着（8s 白屏兜底之外再加一道）。
 *
 * ★ 不监听 DOMContentLoaded 自己判断"好了没"：启动完成的唯一真源在 app.js，
 *   这里只负责"到点了就退场"，两边不要各判各的。
 * ============================================================ */
(function () {
  'use strict';

  var el = document.getElementById('splash');
  if (!el) return;

  var MIN_MS = 2250;      // 动画播完（星盘 1.38 → 长牌 1.30+0.72 → 翻面 1.52+0.70 → 字标 2.12+0.44 ≈ 2.6s）
  /* 硬兜底：init 挂起时也不能永远挡着。★ 必须比 index.html 那个「8s 无条件放行」
     更晚一点 —— 早了的话启动页先淡出、而 .booting 还没摘，底下是全透明的白屏。 */
  var MAX_MS = 8500;
  var FADE_MS = 520;      // 与 splash.css 的 .46s 过渡对齐，多留一点余量


  /* ============================================================
     法阵：现场生成。一百多个节点手写太蠢，这里按角度算。
     C 是 SVG 里的中心（viewBox 0 0 400 400）。
     ============================================================ */
  (function () {
    var NS = 'http://www.w3.org/2000/svg';
    var C = 200;
    function mk(tag, attrs) {
      var el = document.createElementNS(NS, tag);
      for (var k in attrs) if (attrs.hasOwnProperty(k)) el.setAttribute(k, attrs[k]);
      return el;
    }
    function line(deg, r1, r2, extra) {
      var a = { x1: C, y1: C - r1, x2: C, y2: C - r2,
                transform: 'rotate(' + deg + ' ' + C + ' ' + C + ')',
                pathLength: '100' };
      for (var k in extra) if (extra.hasOwnProperty(k)) a[k] = extra[k];
      return mk('line', a);
    }

    /* ---- 外圈 60 根刻度（每 5 根加长） ---- */
    var g = document.getElementById('spTickOuter');
    if (g) for (var i = 0; i < 60; i++) {
      var lg = (i % 5 === 0);
      var l = line(i * 6, 180, lg ? 165 : 174);
      l.style.animationDelay = (0.10 + i * 0.010).toFixed(3) + 's';
      g.appendChild(l);
    }

    /* ---- 内圈 60 根极细刻度 ---- */
    g = document.getElementById('spTickFine');
    if (g) for (var j = 0; j < 60; j++) {
      var l2 = line(j * 6, 122, 118);
      l2.style.animationDelay = (0.58 + j * 0.007).toFixed(3) + 's';
      g.appendChild(l2);
    }

    /* ---- 内环 24 段刻度 ---- */
    g = document.getElementById('spTickInner');
    if (g) for (var k = 0; k < 24; k++) {
      var lg2 = (k % 3 === 0);
      var l3 = line(k * 15, 128, lg2 ? 121 : 124.5);
      l3.style.animationDelay = (0.50 + k * 0.018).toFixed(3) + 's';
      g.appendChild(l3);
    }

    /* ---- 12 条放射线 ---- */
    g = document.getElementById('spRays');
    if (g) for (var m = 0; m < 12; m++) {
      var l4 = line(m * 30, 92, 148);
      l4.style.animationDelay = (0.38 + m * 0.032).toFixed(3) + 's';
      g.appendChild(l4);
    }

    /* ---- 4 条穿过内环的对角虚线 ---- */
    g = document.getElementById('spDiag');
    if (g) for (var n = 0; n < 4; n++) {
      var l5 = line(45 + n * 90, 54, 128, { 'stroke-dasharray': '.8 3.4' });
      l5.style.animationDelay = (0.66 + n * 0.04).toFixed(3) + 's';
      g.appendChild(l5);
    }

    /* ---- 十二地支 ---- */
    g = document.getElementById('spZodiac');
    if (g) {
      var z = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
      for (var p = 0; p < 12; p++) {
        var t = mk('text', {
          x: C, y: C - 162,
          transform: 'rotate(' + (p * 30) + ' ' + C + ' ' + C + ')'
        });
        t.textContent = z[p];
        t.style.animationDelay = (0.52 + p * 0.042).toFixed(3) + 's';
        g.appendChild(t);
      }
    }

    /* ---- 最外：十二个罗马数字 ---- */
    g = document.getElementById('spRomans');
    if (g) {
      var R = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
      for (var q2 = 0; q2 < 12; q2++) {
        var t2 = mk('text', {
          x: C, y: C - 197,
          transform: 'rotate(' + (q2 * 30) + ' ' + C + ' ' + C + ')'
        });
        t2.textContent = R[q2];
        t2.style.animationDelay = (0.02 + q2 * 0.018).toFixed(3) + 's';
        g.appendChild(t2);
      }
    }

    /* ---- 12 段黄道弧（每段 26°，留 4° 缝） ---- */
    g = document.getElementById('spArcs');
    if (g) for (var r2 = 0; r2 < 12; r2++) {
      var a0 = r2 * 30 - 90, Rr = 172;
      var a1 = a0, a2 = a0 + 26;
      var d = 'M ' + (C + Rr * Math.cos(a1 * Math.PI / 180)).toFixed(2) + ' ' +
                    (C + Rr * Math.sin(a1 * Math.PI / 180)).toFixed(2) +
              ' A ' + Rr + ' ' + Rr + ' 0 0 1 ' +
                    (C + Rr * Math.cos(a2 * Math.PI / 180)).toFixed(2) + ' ' +
                    (C + Rr * Math.sin(a2 * Math.PI / 180)).toFixed(2);
      var pa = mk('path', { d: d, 'class': 'sp-arc', pathLength: '100' });
      pa.style.animationDelay = (0.32 + r2 * 0.028).toFixed(3) + 's';
      g.appendChild(pa);
    }

    /* ---- 几何：十二边形 + 两个三角叠成六角星 ---- */
    function poly(n, r, rot) {
      var pts = [];
      for (var i2 = 0; i2 < n; i2++) {
        var ang = (Math.PI * 2 / n) * i2 + (rot || 0);
        pts.push((C + r * Math.cos(ang)).toFixed(2) + ',' + (C + r * Math.sin(ang)).toFixed(2));
      }
      return pts.join(' ');
    }
    var dd = document.getElementById('spDodeca');
    if (dd) dd.setAttribute('points', poly(12, 108, Math.PI / 12));
    var h1 = document.getElementById('spHex1');
    if (h1) h1.setAttribute('points', poly(3, 92, -Math.PI / 2));
    var h2 = document.getElementById('spHex2');
    if (h2) h2.setAttribute('points', poly(3, 92, Math.PI / 2));
  })();

  var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
  var wanted = false, gone = false;

  function now() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function fade() {
    if (gone) return;
    gone = true;
    el.classList.add('is-out');
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, FADE_MS);
  }

  /* app.js 在 bootReveal 的 done() 里调这个 */
  function hide() {
    if (wanted || gone) return;
    wanted = true;
    var left = MIN_MS - (now() - t0);
    if (left > 0) setTimeout(fade, left);
    else fade();
  }

  window.MoKaSplash = {
    hide: hide,
    /* 调试用：在控制台敲 MoKaSplash.drop() 可以立刻收掉 */
    drop: fade,
    shownMs: function () { return now() - t0; }
  };

  setTimeout(function () { if (!wanted) hide(); }, MAX_MS);
})();
