/* ============================================================
 * 猫卡 · 骰子 (scenes/dice.js)
 * ------------------------------------------------------------
 * 排版 = 方案 E「桌上四颗」：**没有类型条** —— 台面上一颗大骰子居中，
 * 底下一排四颗小骰子（d4/d6/d12/d20）当托盘，点哪颗换哪颗；点大骰子或按「掷」就掷。
 * 视角 = 正上方俯视；结果面转到镜头正对（+8° 残留倾斜，不然一颗水晶看成平面图）。
 *
 * 3D 用 three.js（MIT，js/three.min.js 里，离线）：几何取它现成的四/六/十二/二十面体，
 * 自己只做三件管道活：把几何拆成一个个面 → 每面贴一张名字画布 → 掷的时候转到目标朝向。
 *
 * ★ 两条踩过的坑（别改回去）：
 *   1) 目标面法线必须用 crossVectors **接住**结果（原来算完就扔，法线恒为零向量 → 朝向全错且不报错）。
 *   2) 整页重画（innerHTML）会把 canvas 从文档里摘掉 → 看着像"骰子凭空消失"，
 *      所以 paint() 之后必须把 renderer.domElement 挂回 #dice-stage 并重新量尺寸。
 * ============================================================ */
(function (global) {
  'use strict';

  var RND = global.MoKa.random;      // 点数 / 落定朝向：统一走 crypto 随机源

  var K_KEY = 'moka.dice';
  /* sides = 俯视看下去那个正多边形的边数（面数 ≠ 边数：四面体看下去是三角形）；
     rot   = 起始角修正（正方形要转 45° 才是正着放） */
  var TYPES = [
    { k: 'd4',  n: 4,  sides: 3, rot: 0,   name: '正四面'   },
    { k: 'd6',  n: 6,  sides: 4, rot: 45,  name: '正六面'   },
    { k: 'd8',  n: 8,  sides: 6, rot: 0,   name: '正八面'   },
    { k: 'd12', n: 12, sides: 5, rot: 0,   name: '正十二面' },
    { k: 'd20', n: 20, sides: 6, rot: 30,  name: '正二十面' }
  ];
  var PER = { d4: 1, d6: 2, d8: 1, d12: 3, d20: 1 };   // 每个面由几个三角形拼成
  var RADIUS = 0.95;                             // 骰子半径（用户要求小一点）
  var TILT = 8 * Math.PI / 180;                  // 残留倾斜

  /* ★ 每颗骰的外观 —— 可在「编辑面名」页里逐个调（透明度 / 颜色 / 数字在内在外）。
     颜色走"梦幻浪漫"一档：粉、紫、粉紫渐变。默认就是粉紫渐变。 */
  var LOOK_COLORS = [
    /* —— 第一组：淡彩（原来的，做"若有似无"的水晶）—— */
    { k: 'dream',  n: '粉紫渐变', g: ['#ffd9ec', '#c9a7f0'] },
    { k: 'sakura', n: '樱花粉',   c: '#ffd6e7' },
    { k: 'iris',   n: '藕荷紫',   c: '#dcc8f2' },
    { k: 'lilac',  n: '月光紫',   c: '#f0e9ff' },
    { k: 'peach',  n: '蜜桃粉',   c: '#ffdcc9' },
    { k: 'mist',   n: '雾蓝紫',   c: '#d6dcf7' },
    /* —— 第二组：用户点名的颜色（去掉了与上面太接近的：珍珠粉/薰衣草紫/香槟金/极光白/蜜桃橙）—— */
    { k: 'ice',     n: '冰蓝',     c: '#bfefff' },
    { k: 'mint',    n: '薄荷绿',   c: '#bdfcc9' },
    { k: 'viola',   n: '浅紫罗兰', c: '#d8bfd8' },
    { k: 'mermaid', n: '人鱼蓝',   c: '#7fffd4' },
    { k: 'aurora',  n: '紫极光',   c: '#b39ddb' },
    { k: 'berry',   n: '草莓粉',   c: '#ffb6c1' },
    { k: 'lemon',   n: '柠檬黄',   c: '#fffacd' },
    { k: 'sky',     n: '天空蓝',   c: '#87ceeb' },
    { k: 'deep',    n: '深空蓝',   c: '#0b1f3a' },
    { k: 'nebula',  n: '暗紫星云', c: '#2e1a47' },
    { k: 'forest',  n: '墨绿极光', c: '#0b3d2e' },
    { k: 'wine',    n: '酒红透明', c: '#7b1e3a' },
    { k: 'blackgold', n: '黑金',   g: ['#1a1a1a', '#d4af37'] }
  ];
  /* 默认外观：酒红透明（色板倒数第二个）+ 金属质感。
     ★ 骰子现在一律"实心"（用户要求全部 100% 不透明）→ 数字一律贴在面**外侧**。
     ★ 颜色偏深时数字自动改成浅色，否则深色金属面上的深色数字看不见。 */
  var LOOK_DEF = { ck: 'wine', mtl: 'metal' };
  var LOOK_MTL = [{ k: 'metal', n: '金属' }, { k: 'gloss', n: '琉璃' }];
  function lookInk(ck) {                    // 这个底色上该用深字还是浅字
    var col = lookColor(ck), hex = col.g ? col.g[1] : col.c;
    var r = parseInt(hex.substr(1, 2), 16), g2 = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
    return (0.299 * r + 0.587 * g2 + 0.114 * b) / 255 < 0.55 ? 'light' : 'dark';
  }
  function lookColor(ck) {
    return LOOK_COLORS.filter(function (x) { return x.k === ck; })[0] || LOOK_COLORS[0];
  }
  var _gradCache = {};
  function gradTex(colors) {           // 粉紫渐变：一张竖条渐变贴图，按面的 UV 铺上去
    var key = colors.join('|');
    if (_gradCache[key]) return _gradCache[key];
    var T = global.THREE;
    var c = document.createElement('canvas'); c.width = 8; c.height = 128;
    var g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 128);
    colors.forEach(function (col, i) { gr.addColorStop(i / (colors.length - 1), col); });
    g.fillStyle = gr; g.fillRect(0, 0, 8, 128);
    var tex = new T.CanvasTexture(c);
    _gradCache[key] = tex;
    return tex;
  }
  var page = null, view = 'roll', cur = 'd6', rolling = false;
  var st = load(), R = null, glBroken = false, result = null;

  /* ---------- 存档 ---------- */
  function defaults(n) { var a = []; for (var i = 1; i <= n; i++) a.push(String(i)); return a; }
  function load() {
    var o = null;
    try { o = JSON.parse(localStorage.getItem(K_KEY) || 'null'); } catch (e) {}
    var out = { cur: 'd6', faces: {}, look: {} };
    TYPES.forEach(function (t) {
      var f = o && o.faces && o.faces[t.k];
      out.faces[t.k] = (f && f.length === t.n) ? f.slice() : defaults(t.n);
      var L = (o && o.look && o.look[t.k]) || {};
      out.look[t.k] = {
        ck: (L.ck && lookColor(L.ck).k === L.ck) ? L.ck : LOOK_DEF.ck,
        mtl: (L.mtl === 'metal' || L.mtl === 'gloss') ? L.mtl : LOOK_DEF.mtl
      };
    });
    if (o && TYPES.filter(function (t) { return t.k === o.cur; })[0]) out.cur = o.cur;
    return out;
  }
  function save() {
    try { localStorage.setItem(K_KEY, JSON.stringify(st)); return true; }
    catch (e) { global.MoKa.ui && global.MoKa.ui.toast && global.MoKa.ui.toast('存不下：手机存储写入失败'); return false; }
  }
  function typeOf(k) { return TYPES.filter(function (t) { return t.k === k; })[0]; }
  function faces() { return st.faces[cur]; }
  function $(s) { return page ? page.querySelector(s) : null; }
  function esc(t) { return global.MoKa.ui.esc(t == null ? '' : String(t)); }

  /* ---------- three.js 现场 ---------- */
  function envTexture() {
    /* 现场画一张"影棚"环境图（横竖渐变 + 三块高光）—— 玻璃的反射靠它，不引任何外部 HDRI */
    var T = global.THREE;
    var c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    var g = c.getContext('2d');
    var lin = g.createLinearGradient(0, 0, 0, 512);
    lin.addColorStop(0, '#ffffff'); lin.addColorStop(.42, '#eef2fa');
    lin.addColorStop(.62, '#dfe5f0'); lin.addColorStop(1, '#9aa3b4');
    g.fillStyle = lin; g.fillRect(0, 0, 1024, 512);
    function blob(x, y, r, a) {
      var rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, 'rgba(255,255,255,' + a + ')'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    blob(260, 120, 220, .95); blob(760, 170, 180, .8); blob(520, 60, 260, .7);
    g.fillStyle = 'rgba(40,48,64,0.22)'; g.fillRect(0, 400, 1024, 112);
    var tex = new T.CanvasTexture(c); tex.mapping = T.EquirectangularReflectionMapping;
    var pm = new T.PMREMGenerator(R.renderer); var env = pm.fromEquirectangular(tex).texture;
    pm.dispose(); tex.dispose();
    return env;
  }

  function faceGeoms(src, per) {
    var T = global.THREE;
    var g = src.index ? src.toNonIndexed() : src, pos = g.attributes.position, out = [];
    var n = Math.round(pos.count / 3 / per);
    for (var f = 0; f < n; f++) {
      var v = [];
      for (var t = 0; t < per; t++) {
        var b = (f * per + t) * 3;
        for (var i = 0; i < 3; i++) v.push(new T.Vector3(pos.getX(b + i), pos.getY(b + i), pos.getZ(b + i)));
      }
      var geo = new T.BufferGeometry(), arr = new Float32Array(v.length * 3);
      v.forEach(function (p, i) { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; });
      geo.setAttribute('position', new T.BufferAttribute(arr, 3)); geo.computeVertexNormals();
      /* ★★ 面的中心 = 各三角形的**面积加权重心**。
         原来直接平均顶点：正十二面体的五边形是扇形三分的（apex 被重复计 3 次），
         平均出来会偏向 apex；正方形和三角形恰好重合，所以只有 d12 看得出来。 */
      var c = new T.Vector3(), aSum = 0;
      for (var t2 = 0; t2 < per; t2++) {
        var a0 = v[t2 * 3], a1 = v[t2 * 3 + 1], a2 = v[t2 * 3 + 2];
        var ar = new T.Vector3().crossVectors(a1.clone().sub(a0), a2.clone().sub(a0)).length() * 0.5;
        c.addScaledVector(a0.clone().add(a1).add(a2).multiplyScalar(1 / 3), ar);
        aSum += ar;
      }
      if (aSum > 1e-9) c.multiplyScalar(1 / aSum);
      else { c.set(0, 0, 0); v.forEach(function (p) { c.add(p); }); c.multiplyScalar(1 / v.length); }
      /* ★★ 法线必须接住 crossVectors 的结果（历史 bug：n 恒为零向量 → 朝向全错还不报错） */
      var nv = new T.Vector3().crossVectors(v[0].clone().sub(c), v[1].clone().sub(c)).normalize();
      if (nv.dot(c) < 0) nv.negate();
      if (nv.lengthSq() < 0.5) nv.copy(c).normalize();
      /* ★ 面的二维基（(u, w)）：**用这一面自己的第一条边**定，永远有定义 ——
         原来那套"把屏幕上方投影到面平面"的写法，遇到与屏幕上方平行的面（立方体 ±Z 两面）
         投影长度为零、基直接塌掉，UV 全挤成一点 → 名字画不上去，就是用户看到的"灰面"。
         现在面内基与任何外部坐标轴无关；朝向问题交给 roll() 里的"绕镜头轴转正"。 */
      var u = v[1].clone().sub(v[0]).normalize();
      if (u.lengthSq() < 1e-8) u = v[2].clone().sub(v[0]).normalize();   // 只为万一的退化三角形
      var wy = new T.Vector3().crossVectors(nv, u).normalize();          // nv = u × wy，右手系，不会镜像
      if (wy.dot(new T.Vector3(0, 1, 0)) < 0) { u.negate(); wy.negate(); }  // 只定符号：保证左右不翻
      var vx = u, vy = wy;
      var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, uv = [];
      v.forEach(function (p) {
        var d = p.clone().sub(c), x = d.dot(vx), y = d.dot(vy);
        uv.push([x, y]);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      });
      var w = Math.max(maxX - minX, 1e-6), h = Math.max(maxY - minY, 1e-6), s = Math.min(0.80 / w, 0.80 / h);
      /* ★★ 数字是画在贴图正中央的，所以必须把**面的中心 c**（= 局部原点）对到 (0.5,0.5)。
         原来对的是**包围盒中心** ((minX+maxX)/2, (minY+maxY)/2)：正方形两者重合
         （所以 d6 一直正常），正三角形差 1/6 高、正五边形也偏
         → d4/d8/d12/d20 的数字被推到一边，就是这个 bug。 */
      var uvs = new Float32Array(uv.length * 2);
      uv.forEach(function (p, i) {
        uvs[i * 2] = 0.5 + p[0] * s;
        uvs[i * 2 + 1] = 0.5 + p[1] * s;
      });
      geo.setAttribute('uv', new T.BufferAttribute(uvs, 2));
      /* ★ 内切圆半径 = 面中心到**边界边**的最短距离（边界边 = 只出现一次的边；
         扇形三分的对角线会出现两次，必须排除 —— 否则 d12 会取到对角线，字缩成一点）。 */
      var seen = {}, inr = 0;
      for (var ei = 0; ei < v.length; ei += 3) {
        for (var q = 0; q < 3; q++) {
          var A = uv[ei + q], B = uv[ei + (q + 1) % 3];
          var kk = (A[0] < B[0] || (A[0] === B[0] && A[1] <= B[1]))
                 ? A[0] + ',' + A[1] + '|' + B[0] + ',' + B[1]
                 : B[0] + ',' + B[1] + '|' + A[0] + ',' + A[1];
          seen[kk] = (seen[kk] || 0) + 1;
        }
      }
      Object.keys(seen).forEach(function (kk) {
        if (seen[kk] !== 1) return;
        var pr = kk.split('|');
        var ax = +pr[0].split(',')[0], ay = +pr[0].split(',')[1];
        var bx = +pr[1].split(',')[0], by = +pr[1].split(',')[1];
        var ex = bx - ax, ey = by - ay, el = Math.sqrt(ex * ex + ey * ey);
        if (el < 1e-9) return;
        var d0 = Math.abs(ax * by - bx * ay) / el;          // 原点到边所在直线的距离
        if (!inr || d0 < inr) inr = d0;
      });
      if (!(inr > 1e-6)) inr = Math.min(w, h) * 0.5;        // 兜底
      /* 内切圆直径占贴图的比例 —— 数字必须装进这个圆，不然"字比面大" */
      var disk = Math.min(1, 2 * inr * s);
      out.push({ geo: geo, normal: nv, center: c, up: wy.clone(), disk: disk });
    }
    return out;
  }
  function srcGeometry(k) {
    var T = global.THREE;
    if (k === 'd4')  return new T.TetrahedronGeometry(RADIUS, 0);
    if (k === 'd6')  return new T.BoxGeometry(RADIUS * 1.28, RADIUS * 1.28, RADIUS * 1.28);
    if (k === 'd8')  return new T.OctahedronGeometry(RADIUS, 0);
    if (k === 'd12') return new T.DodecahedronGeometry(RADIUS, 0);
    return new T.IcosahedronGeometry(RADIUS, 0);
  }
  var FS_REF = 131;          /* d6 的字号 —— 小字拿它当"该有多黑"的基准 */
  function labelTexture(text, disk, ink) {
    var T = global.THREE;
    var S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    var g = c.getContext('2d'), t = String(text == null ? '' : text);
    /* ★ disk = 这一面的「内切圆直径」占贴图的比例（faceGeoms 按面形算好）。
       数字必须装进内切圆里 —— 原来写死 132px：四边形刚好，三角形/五边形就"字比面还大"。 */
    var light = ink === 'light';                 /* 深底色 → 浅字（深色金属面上才看得见） */
    var avail = S * (disk > 0 && disk <= 1 ? disk : 0.80);
    var fs = Math.max(14, Math.round(avail * 0.64));
    do {
      g.font = '700 ' + fs + 'px -apple-system,"Noto Sans CJK SC",sans-serif';
      if (g.measureText(t).width <= avail * 0.94) break;
      fs -= 4;
    } while (fs > 14);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    var tx = S / 2, ty = S / 2 + fs * 0.04;
    /* ★ 白描边的模糊半径必须**跟着字号走**。
       原来写死 10px：d6（131px、笔画约 13.8px）刚好；d4/d8/d20（76px、笔画约 8px）
       模糊(10) 比笔画(8) 还大 → 字被自己的白边糊淡，这就是"有的骰数字深、有的浅"。
       0.075 这个系数在 d6 上正好等于原来的 10px（所以 d6 观感不变）。 */
    g.shadowColor = light ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.8)';
    g.shadowBlur = Math.max(3, Math.round(fs * 0.075));
    g.fillStyle = light ? '#f4f6fb' : '#2b3040';
    g.fillText(t, tx, ty);
    /* 小字再补一点**等宽描边**：字小的笔画本身就细，光靠白边改不回来（光学尺寸补偿） */
    var extra = (FS_REF - fs) * 0.035;
    if (extra > 0.2) {
      g.shadowColor = 'transparent'; g.shadowBlur = 0;
      g.lineWidth = extra; g.strokeStyle = g.fillStyle;
      g.strokeText(t, tx, ty);
    }
    var tex = new T.CanvasTexture(c); tex.anisotropy = 4;
    return tex;
  }
  function dieMaterial(L) {
    /* 骰面材质。两种质感（都是实心不透明）：
         metal = 金属：metalness 1 —— 底色变成反射的染色，靠影棚环境图出高光/暗带
         gloss = 琉璃：metalness 0 + 强 clearcoat —— 像上釉的瓷/玻璃，通透亮泽
       环境反射不用 transmission：会丢上下文且吃性能。 */
    var T = global.THREE, col = lookColor(L.ck), metal = L.mtl !== 'gloss';
    var m = new T.MeshPhysicalMaterial({
      color: col.g ? 0xffffff : new T.Color(col.c),
      metalness: metal ? 1 : 0,
      roughness: metal ? 0.28 : 0.05,
      transparent: false, opacity: 1, depthWrite: true,
      envMap: R.env, envMapIntensity: metal ? 1.55 : 1.0,
      clearcoat: metal ? 0.18 : 0.85, clearcoatRoughness: 0.03,
      side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2
    });
    if (col.g) m.map = gradTex(col.g);
    return m;
  }
  function shadowMesh() {
    var T = global.THREE;
    var c = document.createElement('canvas'); c.width = c.height = 256;
    var g = c.getContext('2d');
    var rg = g.createRadialGradient(128, 128, 0, 128, 128, 126);
    rg.addColorStop(0, 'rgba(24,30,42,0.42)'); rg.addColorStop(.55, 'rgba(24,30,42,0.16)');
    rg.addColorStop(1, 'rgba(24,30,42,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
    var m = new T.Mesh(new T.PlaneGeometry(2.3, 2.3),
      new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(0.16, -RADIUS * 1.28, 0.2);
    m.renderOrder = 1;
    return m;
  }

  function ensureScene() {
    if (R) {
      var h = $('#dice-stage');
      if (h && R.renderer.domElement.parentNode !== h) h.appendChild(R.renderer.domElement);
      if (h) { R.host = h; resize(); }
      return R;
    }
    var T = global.THREE;
    var host = $('#dice-stage');
    if (!T || !host) return null;
    var renderer;
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); }
    catch (e) { glBroken = true; return null; }
    if (!renderer || !renderer.getContext()) { glBroken = true; return null; }
    renderer.domElement.addEventListener('webglcontextlost', function (ev) {
      ev.preventDefault(); glBroken = true; rolling = false; stopLoop(); paint();
    }, false);
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth || 300, host.clientHeight || 300, false);
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);

    var scene = new T.Scene();
    /* 视角：正上方往下投（屏幕上方 = 世界 -Z） */
    var camera = new T.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 7.2, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);

    R = { THREE: T, renderer: renderer, scene: scene, camera: camera, die: null, faces: [], raf: 0, host: host, env: null, shadow: null };
    R.env = envTexture();
    scene.environment = R.env;
    scene.add(new T.HemisphereLight(0xffffff, 0x9aa3b4, 0.55));
    var d1 = new T.DirectionalLight(0xffffff, 0.9); d1.position.set(2.6, 7, 2.2); scene.add(d1);
    var d2 = new T.DirectionalLight(0xdfe8ff, 0.4); d2.position.set(-3, 3, -3.6); scene.add(d2);
    R.shadow = shadowMesh(); scene.add(R.shadow);
    buildDie();
    resize();
    startLoop();
    return R;
  }

  function buildDie() {
    var T = global.THREE;
    if (R.die) { R.scene.remove(R.die); R.die = null; R.faces = []; }
    var list = faceGeoms(srcGeometry(cur), PER[cur]);
    var g = new T.Group(), names = faces();
    var L = st.look[cur], ink = lookInk(L.ck);
    var gm = dieMaterial(L);
    list.forEach(function (f, i) {
      g.add(new T.Mesh(f.geo, gm));
      /* 名字贴面里侧一点点（1.2%），像刻在水晶里 */
      /* 面是实心的 → 数字必须贴在**外侧**，刻在里侧会被面挡住 */
      var inner = f.geo.clone(), p = inner.attributes.position, k2 = 1 + 0.012;
      for (var k = 0; k < p.count; k++) {
        p.setXYZ(k, f.center.x + (p.getX(k) - f.center.x) * k2,
                    f.center.y + (p.getY(k) - f.center.y) * k2,
                    f.center.z + (p.getZ(k) - f.center.z) * k2);
      }
      inner.computeVertexNormals();
      var lm = new T.MeshBasicMaterial({ map: labelTexture(names[i], f.disk, ink), transparent: true, depthWrite: false, side: T.DoubleSide });
      g.add(new T.Mesh(inner, lm));
      R.faces.push({ normal: f.normal.clone(), up: f.up.clone(), mat: lm });
    });
    /* 棱线：水晶面几乎是白的，原来的线太淡（0x9db6d2 @ 0.45）→ 一片白看不出立体。
       用户要求"棱角明显一些"：颜色压深到石板蓝、不透明度提到 0.85。 */
    list.forEach(function (f) {
      g.add(new T.LineSegments(new T.EdgesGeometry(f.geo, 1),
        new T.LineBasicMaterial({ color: 0x3d5c7d, transparent: true, opacity: 0.85 })));
    });
    R.die = g;
    R.scene.add(g);
    g.quaternion.setFromAxisAngle(new T.Vector3(0.4, 1, 0.25).normalize(), 0.6);
  }

  function resize() {
    if (!R) return;
    var h = R.host, w = h.clientWidth || 300, hh = h.clientHeight || 300;
    R.renderer.setSize(w, hh, false);
    R.camera.aspect = w / hh;
    R.camera.updateProjectionMatrix();
  }
  function loop() {
    if (!R) return;
    R.raf = global.requestAnimationFrame(loop);
    var camDir = R.camera.position.clone().normalize();
    R.faces.forEach(function (f) {
      if (!f.mat) return;
      var n = f.normal.clone().applyQuaternion(R.die.quaternion);
      f.mat.opacity = n.dot(camDir) > 0 ? 1 : 0.22;      // 背面名字压暗，透过去不糊
    });
    if (R.shadow && R.die) {
      var k = R.die.scale.x;
      R.shadow.scale.set(k, k, 1);
      R.shadow.material.opacity = 0.5 + 0.5 / Math.max(1, k);
    }
    R.renderer.render(R.scene, R.camera);
  }
  function startLoop() { ensureScene(); if (R && !R.raf) loop(); }
  function stopLoop() { if (R && R.raf) { global.cancelAnimationFrame(R.raf); R.raf = 0; } }

  /* ---------- 掷 ---------- */
  function ease(t) { return 1 - Math.pow(1 - t, 3); }
  function badQ(q) { return !isFinite(q.x) || !isFinite(q.y) || !isFinite(q.z) || !isFinite(q.w); }
  function roll() {
    if (rolling || view !== 'roll') return;
    if (glBroken || !ensureScene()) {
      glBroken = true;
      var i0 = RND.int(faces().length);
      result = { name: faces()[i0], idx: i0 };
      paint();
      return;
    }
    rolling = true;
    var T = R.THREE, n = R.faces.length;
    var idx = RND.int(n);
    var up = new T.Vector3(0, 1, 0);
    /* 俯视：把要报的那一面转到镜头正对 */
    var target = new T.Quaternion().setFromUnitVectors(R.faces[idx].normal, up);
    /* 随机自转：真骰子落定本来就是任意朝向，不替它"摆正"（用户明确不要转正） */
    target.premultiply(new T.Quaternion().setFromAxisAngle(up, RND.float() * Math.PI * 2));
    target.premultiply(new T.Quaternion().setFromAxisAngle(
      new T.Vector3(Math.cos(RND.float() * 6.28), 0, Math.sin(RND.float() * 6.28)), TILT));
    if (badQ(target)) target.setFromAxisAngle(new T.Vector3(0.3, 1, 0.2).normalize(), RND.float() * 3);
    var q0 = R.die.quaternion.clone();
    var axis = new T.Vector3(RND.float() - .5, RND.float() - .5, RND.float() - .5).normalize();
    var t0 = performance.now(), DUR = 1150;
    setResult('', '');
    (function step(now) {
      try {
        var t = Math.min(1, (now - t0) / DUR), e = ease(t);
        var qs = new T.Quaternion().setFromAxisAngle(axis, (1 - e) * Math.PI * 2 * 2.7);
        var qm = T.Quaternion.slerpQuaternions
          ? new T.Quaternion().slerpQuaternions(q0, target, e)
          : q0.clone().slerp(target, e);
        R.die.quaternion.copy(qs).multiply(qm);
        R.die.scale.setScalar(1 + 0.06 * Math.sin(Math.PI * Math.min(1, t * 1.12)) * (1 - e));
        if (t < 1) { global.requestAnimationFrame(step); return; }
        R.die.quaternion.copy(target); R.die.scale.setScalar(1);
        rolling = false;
        result = { name: faces()[idx], idx: idx };
        /* ★ 如果这期间 3D 上下文丢了（界面已经换成 2D 骰面），必须整页重画一次，
           否则那颗 2D 骰面还停在上一次的文字上（只改文字是改不到 svg 里的） */
        if (glBroken) paint();
        else setResult(result.name, typeOf(cur).name + ' · 第 ' + (idx + 1) + ' 面');
      } catch (err) {
        rolling = false;                                   // 绝不把骰子弄没：出错了就把原因写出来
        setResult('', '动画出错：' + (err && err.message ? err.message : err));
      }
    })(t0);
  }

  /* ---------- 页面（方案 E：托盘 = 类型选择） ---------- */
  /* 正多边形路径：中心 (50,50)、外接圆半径 R0、起始角 rot —— 托盘与 2D 兜底共用 */
  function polyPath(sides, rot, R0) {
    R0 = R0 || 44;
    var pts = [];
    for (var i = 0; i < sides; i++) {
      var a = (-90 + rot + i * 360 / sides) * Math.PI / 180;
      pts.push((50 + R0 * Math.cos(a)).toFixed(1) + ' ' + (50 + R0 * Math.sin(a)).toFixed(1));
    }
    return 'M' + pts.join('L') + 'Z';
  }
  /* 托盘：直接就是面数（4 / 6 / 12 / 20）四个数字，选中那颗把数字反白放进墨色圆里。
     数字本身就是最小的说明，不用再写 d4/d6。 */
  function trayNum(t) {
    return '<span class="num">' + t.n + '</span>';
  }
  function head() {
    return '<div class="lib-head">' +
      '<button class="btn-mini" type="button" data-act="back">‹ 返回</button>' +
      '<div class="lib-title">骰子</div>' +
      '<button class="btn-mini" type="button" data-act="' + (view === 'edit' ? 'done' : 'edit') + '">' +
        (view === 'edit' ? '完成' : '编辑面名') + '</button></div>';
  }
  function tray() {
    return '<div class="dz-tray">' + TYPES.map(function (t) {
      return '<div class="td' + (t.k === cur ? ' on' : '') + '" data-die="' + t.k + '">' +
        trayNum(t) + '</div>';
    }).join('') + '</div>';
  }
  function flat2D() {
    var t = typeOf(cur), d = polyPath(t.sides, t.rot, 46);
    return '<div class="dz-2d"><svg viewBox="0 0 100 100" aria-hidden="true">' +
      '<path d="' + d + '" fill="rgba(214,234,255,.55)" stroke="rgba(96,128,168,.85)" ' +
      'stroke-width="2.4" stroke-linejoin="round"/>' +
      '<text x="50" y="52" text-anchor="middle" dominant-baseline="central" ' +
      'font-size="' + (String(result ? result.name : '').length > 3 ? 22 : 30) + '" font-weight="700" ' +
      'fill="#2b3040">' + (result ? esc(result.name) : '—') + '</text></svg></div>';
  }
  function rollView() {
    return head() + '<div class="dz-wrap">' +
      (glBroken ? flat2D() : '<div class="dz-stage" id="dice-stage"></div>') +
      '<div class="dz-res"><div class="rn" id="dz-name">' + (result ? esc(result.name) : '') + '</div>' +
        '<div class="rs" id="dz-sub">' +
          (result && result.idx >= 0 ? (typeOf(cur).name + ' · 第 ' + (result.idx + 1) + ' 面') : '') + '</div></div>' +
      tray() +
      '<div class="dz-bar"><button class="btn btn-primary dz-roll" type="button" data-act="roll">掷</button></div></div>';
  }
  function editView() {
    var t = typeOf(cur), names = faces(), L = st.look[cur], cells = '';
    for (var i = 0; i < t.n; i++) {
      cells += '<label class="dz-cell"><span>第 ' + (i + 1) + ' 面</span>' +
        '<input class="dz-in" type="text" maxlength="12" data-i="' + i + '" value="' + esc(names[i]) + '"></label>';
    }
    var sws = LOOK_COLORS.map(function (x) {
      var stl = x.g ? ('linear-gradient(160deg,' + x.g[0] + ',' + x.g[1] + ')') : x.c;
      return '<button type="button" class="dz-swd' + (x.k === L.ck ? ' on' : '') + '" data-ck="' + x.k +
             '" aria-label="' + x.n + '" title="' + x.n + '" style="background:' + stl + '"></button>';
    }).join('');
    return head() + '<div class="lib-scroll dz-edit">' + tray() +
      /* ★ 小预览：改外观时立刻能看到效果（复用同一个 renderer 画布，paint 会挂到这儿）。
         WebGL 挂了就别留一个空框 —— 那种情况掷骰页本来就走 2D 兜底。 */
      (glBroken ? '' : '<div class="dz-prev"><div class="dz-stage" id="dice-stage"></div></div>') +
      '<div class="dz-sec">外观 · ' + t.name + '</div>' +
      '<div class="dz-card">' +
        '<div class="dz-row"><span class="dz-lb">颜色</span>' +
          '<span class="dz-sws">' + sws + '</span></div>' +
        '<div class="dz-row"><span class="dz-lb">质感</span>' +
          '<span class="dz-mtls">' + LOOK_MTL.map(function (x) {
            return '<button type="button" class="dz-mtl' + (x.k === L.mtl ? ' on' : '') +
                   '" data-mtl="' + x.k + '">' + x.n + '</button>';
          }).join('') + '</span></div>' +
      '</div>' +
      '<div class="dz-sec">面名 · ' + t.n + ' 面</div>' +
      '<div class="dz-tip">抽到哪面就报哪个名字（最多 12 字）。</div>' +
      '<div class="dz-grid' + (t.n >= 6 ? ' two' : '') + '">' + cells + '</div>' +
      '<div class="dz-edit-bar"><button class="btn btn-soft" type="button" data-act="reset">' +
        '恢复默认（' + t.n + ' 个数字）</button></div></div>';
  }
  function setResult(name, sub) {
    var a = $('#dz-name'), b = $('#dz-sub');
    if (a) a.textContent = name || '';
    if (b) b.textContent = sub || '';
  }
  function paint() {
    if (!page) return;
    page.innerHTML = (view === 'edit') ? editView() : rollView();
    /* ★ 掷骰页和编辑页都有 #dice-stage（编辑页那个是小预览）：画布两处都要挂回去 ——
       整页重画会把 canvas 从文档里摘掉，不挂回去就是"骰子凭空消失" */
    var stg = $('#dice-stage');
    if (glBroken) { stopLoop(); }
    else if (stg) {
      /* ★ 没有场景就先建一颗 —— 以前只有"掷过"才有 R，
         结果是"没掷过就进编辑页 → 预览一块空白、点颜色也没反应"（用户报的那两个 bug）。 */
      if (!R) ensureScene();
      if (glBroken) {
        /* 建的时候才发现 WebGL 挂了 → 重画一次，预览框会自己藏起来 */
        page.innerHTML = (view === 'edit') ? editView() : rollView();
        stg = $('#dice-stage');
      }
      if (R && stg) {
        if (R.renderer.domElement.parentNode !== stg) stg.appendChild(R.renderer.domElement);
        R.host = stg; resize(); startLoop();
      }
    }
    if (view === 'roll') {
      setResult(result ? result.name : '',
        (result && result.idx >= 0) ? (typeOf(cur).name + ' · 第 ' + (result.idx + 1) + ' 面') : '');
    }
  }

  /* ---------- 交互 ---------- */
  function onClick(e) {
    /* 颜色色板（编辑页）—— 先于 data-act 处理，色板按钮没有 data-act */
    var sw = e.target.closest ? e.target.closest('[data-ck]') : null;
    if (sw) {
      st.look[cur].ck = sw.dataset.ck;
      save();
      [].forEach.call(page.querySelectorAll('[data-ck]'), function (b) {
        b.classList.toggle('on', b === sw);
      });
      if (R) buildDie();
      return;
    }
    /* 质感（金属 / 琉璃） */
    var mt = e.target.closest ? e.target.closest('[data-mtl]') : null;
    if (mt) {
      st.look[cur].mtl = mt.dataset.mtl;
      save();
      [].forEach.call(page.querySelectorAll('[data-mtl]'), function (b) {
        b.classList.toggle('on', b === mt);
      });
      if (R) buildDie();
      return;
    }
    var el = e.target.closest ? e.target.closest('[data-act],[data-die]') : null;
    if (!el) return;
    if (el.dataset.die) {
      var k = el.dataset.die;
      if (k === cur) return;
      cur = k; st.cur = k; save();
      result = null;
      /* 两个视图都要重建 —— 编辑页那个预览也得跟着换形状。
         只判 R：重建几何/材质本来就不依赖 WebGL 上下文（上下文丢了也照样该换形状）。 */
      if (R) { ensureScene(); buildDie(); }
      paint();
      return;
    }
    var a = el.dataset.act;
    if (a === 'roll') { roll(); return; }
    if (a === 'edit') { view = 'edit'; stopLoop(); paint(); return; }
    if (a === 'done') { view = 'roll'; paint(); return; }
    if (a === 'back') {
      /* 编辑页里「‹ 返回」= 回掷骰页（原来直接跳回占卜桌，是 bug）；掷骰页里才回占卜桌 */
      if (view === 'edit') { view = 'roll'; paint(); } else { global.MoKa.app.gotoScene('table'); }
      return;
    }
    if (a === 'reset') { st.faces[cur] = defaults(typeOf(cur).n); save(); paint(); return; }
  }
  function onInput(e) {
    var el = e.target;
    if (!el.dataset || el.dataset.i === undefined) return;
    st.faces[cur][parseInt(el.dataset.i, 10)] = el.value;
    save();
    if (R && view === 'roll') buildDie();          // 名字改了：重贴一遍贴图
  }
  function onStageTap(e) {
    if (view !== 'roll') return;                 /* 编辑页那次是小预览，点它不该掷 */
    if (e.target.closest && e.target.closest('#dice-stage')) roll();
  }

  /* ---------- 对外 ---------- */
  function init() {
    page = document.getElementById('dice-page');
    if (!page) return;
    cur = st.cur;
    page.addEventListener('click', onClick);
    page.addEventListener('input', onInput);
    page.addEventListener('click', onStageTap);
    global.addEventListener('resize', function () { if (view === 'roll') resize(); });
  }
  function render() {
    if (!page) page = document.getElementById('dice-page');
    if (!page) return;
    cur = st.cur;
    paint();
  }
  function back() {
    if (view === 'edit') { view = 'roll'; paint(); return true; }
    return false;
  }
  function stop() { stopLoop(); }

  global.MoKa = global.MoKa || {};
  global.MoKa.dice = { init: init, render: render, back: back, stop: stop, roll: roll, _dbg: function () { return R; } };
})(window);
