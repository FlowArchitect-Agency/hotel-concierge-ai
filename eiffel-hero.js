/*!
 * eiffel-hero.js — the Champ de Mars, in three dimensions.
 *
 * A self-contained background layer: the Eiffel Tower assembles itself,
 * member by member, as the page is scrolled, standing over the Seine with
 * Trocadero behind it and the gardens in front. Geometry is generated from
 * the monument's real dimensions (330 m to the tip, 125 m square base,
 * platforms at 57.6, 115.7 and 276.1 m) rather than loaded from a model.
 *
 * An ES module: imports three from the page's existing import map, so the
 * site ships ONE copy of three.js rather than two.
 * Degrades to nothing if WebGL is unavailable — call onUnavailable to show
 * whatever static artwork the page already has.
 *
 * Usage (index.html already has the importmap monument.js uses):
 *   <script type="module">
 *     import { mount } from './eiffel-hero.js?v=1';
 *     mount(document.getElementById('hero'), { ... });
 *   </script>
 *
 *   mount(document.getElementById('hero'), {
 *     colors: { iron: 0x4A3A2B },
 *     onProgress: function (p) {},
 *     onUnavailable: function () {}
 *   });
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const DEFAULTS = {
    /* Never let the camera inside the 125 m base: below this the opening
       frame is a close-up of footings and reads as an empty sky. */
    minFrame: 150,
    /* 'hero' thins the scenery for a front page's first paint; 'full' is the
       populated version for a dedicated section. */
    quality: "hero",
    skyTop: "#0A1430", skyUpper: "#1E3566", skyMid: "#4C5C93",
    skyWarm: "#8E6E93", skyGlow: "#C97F66", skyHorizon: "#E9A961",
    skyBand: "#F0C57E",
    haze: 0x1B2C52,
    iron: 0x4A3A2B
};


export function mount(root, options) {

    var opts = options || {};
    var C = {}, k;
    for (k in DEFAULTS) C[k] = DEFAULTS[k];
    if (opts.colors) for (k in opts.colors) C[k] = opts.colors[k];

    if (!root) return;

  var section = root;
  var canvas  = document.createElement("canvas");
  canvas.className = "eiffel-hero-canvas";
  var pin = root.querySelector("[data-eiffel-pin]") || root.querySelector(".hero-scene-pin") || root;
  pin.insertBefore(canvas, pin.firstChild);
  var roFill  = root.querySelector("[data-eiffel-fill]");
  var roPct   = root.querySelector("[data-eiffel-pct]");
  var roLabel = root.querySelector("[data-eiffel-label]");
  var roStage = root.querySelector("[data-eiffel-stage]");

  function bail() { root.classList.add("eiffel-hero--fallback");
                    if (typeof opts.onUnavailable === "function") opts.onUnavailable(); }
  

  /* ── the profile, as a monotone cubic through the real anchors ── */
  var HS = [0, 8, 18, 30, 42, 57.6, 72, 90, 115.7, 145, 180, 215, 250, 276.1, 292, 300],
      WS = [62.5, 53.5, 45.6, 39.6, 35.4, 32.2, 27.4, 21.4, 15.4, 12.4, 10.4, 9.1, 8.1, 7.4, 6.4, 5.6],
      MS = (function () {
    var n = HS.length, d = [], m = [], i;
    for (i = 0; i < n - 1; i++) d.push((WS[i + 1] - WS[i]) / (HS[i + 1] - HS[i]));
    m.push(d[0]);
    for (i = 1; i < n - 1; i++) m.push((d[i - 1] + d[i]) / 2);
    m.push(d[n - 2]);
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { var t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return m;
  })();
  function halfw(h) {
    if (h <= HS[0]) return WS[0];
    if (h >= HS[HS.length - 1]) return WS[WS.length - 1];
    for (var i = 0; i < HS.length - 1; i++) {
      if (h >= HS[i] && h <= HS[i + 1]) {
        var x0 = HS[i], x1 = HS[i + 1], hh = x1 - x0, t = (h - x0) / hh,
            t2 = t * t, t3 = t2 * t;
        return (2*t3 - 3*t2 + 1) * WS[i] + (t3 - 2*t2 + t) * hh * MS[i] +
               (-2*t3 + 3*t2) * WS[i + 1] + (t3 - t2) * hh * MS[i + 1];
      }
    }
    return WS[WS.length - 1];
  }
  function corner(h, i) {                       /* the four columns, in plan */
    var w = halfw(h), sx = (i === 0 || i === 3) ? 1 : -1, sz = (i === 0 || i === 1) ? 1 : -1;
    return new THREE.Vector3(sx * w, h, sz * w);
  }
  function gauge(h) { return 1.66 - 0.26 * Math.min(h / 300, 1); }

  /* ── every iron member ── */
  var members = [], PLATFORMS = [57.6, 115.7, 276.1];
  var levels = [], h;
  for (h = 0;     h < 57.6;  h += 6.4)  levels.push(h);
  for (h = 57.6;  h < 115.7; h += 11.6) levels.push(h);
  for (h = 115.7; h < 276.1; h += 17.8) levels.push(h);
  for (h = 276.1; h < 300;   h += 7.9)  levels.push(h);
  levels.push(300);
  PLATFORMS.forEach(function (p) { if (levels.indexOf(p) < 0) levels.push(p); });
  levels.sort(function (a, b) { return a - b; });

  /* Below the first platform the tower is FOUR SEPARATE LEGS with open sky
     between them — each leg its own square box-truss. Only above the platform
     do they merge into a single shaft. Bracing straight across the base would
     fill in the arch void that defines the whole silhouette. */
  var PLAT1 = 57.6, PLAT2 = 115.7;
  function legSide(h) {
    if (h <= PLAT1) return 26.0 - 6.5 * (h / PLAT1);
    return 19.5 - 9.0 * Math.min((h - PLAT1) / (PLAT2 - PLAT1), 1);
  }
  function legNode(h, quad, k) {
    var w = halfw(h), sd = legSide(h),
        sx = (quad === 0 || quad === 3) ? 1 : -1,
        sz = (quad === 0 || quad === 1) ? 1 : -1,
        xs = [w, w - sd, w - sd, w],
        zs = [w, w, w - sd, w - sd];
    return new THREE.Vector3(sx * xs[k], h, sz * zs[k]);
  }

  for (var L = 0; L < levels.length - 1; L++) {
    var h0 = levels[L], h1 = levels[L + 1], t = gauge(h0), i, qd, k2;

    if (h1 <= PLAT2 + 0.01) {
      for (qd = 0; qd < 4; qd++) {
        for (k2 = 0; k2 < 4; k2++)                                   /* the leg's own posts */
          members.push([legNode(h0, qd, k2), legNode(h1, qd, k2), t * 1.0]);
        for (k2 = 0; k2 < 4; k2++)                                   /* its belts */
          members.push([legNode(h1, qd, k2), legNode(h1, qd, (k2 + 1) % 4), t * 0.82]);
        for (k2 = 0; k2 < 4; k2++) {                                 /* its own X bracing */
          members.push([legNode(h0, qd, k2), legNode(h1, qd, (k2 + 1) % 4), t * 0.62]);
          members.push([legNode(h0, qd, (k2 + 1) % 4), legNode(h1, qd, k2), t * 0.62]);
        }
      }
      /* Above the first platform the legs are tied to each other across each
         face — but nothing crosses the interior, so the core stays open. */
      if (h0 >= PLAT1 - 0.01) {
        for (i = 0; i < 4; i++) {
          members.push([corner(h1, i), corner(h1, (i + 1) % 4), t * 0.5]);
          members.push([corner(h0, i), corner(h1, (i + 1) % 4), t * 0.42]);
          members.push([corner(h0, (i + 1) % 4), corner(h1, i), t * 0.42]);
        }
      }
      continue;
    }

    for (i = 0; i < 4; i++) members.push([corner(h0, i), corner(h1, i), t * 1.3]);
    for (i = 0; i < 4; i++) members.push([corner(h1, i), corner(h1, (i + 1) % 4), t * 1.02]);
    for (i = 0; i < 4; i++) {
      members.push([corner(h0, i), corner(h1, (i + 1) % 4), t * 0.88]);
      members.push([corner(h0, (i + 1) % 4), corner(h1, i), t * 0.88]);
    }
  }

  /* the four great arches */
  function facePoint(face, u, y) {
    var w = halfw(y);
    if (face === 0) return new THREE.Vector3(u * w, y, w);
    if (face === 1) return new THREE.Vector3(-w, y, u * w);
    if (face === 2) return new THREE.Vector3(u * w, y, -w);
    return new THREE.Vector3(w, y, u * w);
  }
  function archPoint(face, u, y, zAt) {
    var w = halfw(zAt);                       /* the face plane stays put as the arch rises */
    if (face === 0) return new THREE.Vector3(u * w, y, w);
    if (face === 1) return new THREE.Vector3(-w, y, u * w);
    if (face === 2) return new THREE.Vector3(u * w, y, -w);
    return new THREE.Vector3(w, y, u * w);
  }
  for (var f = 0; f < 4; f++) {
    var prev = null, prevIn = null;
    for (var k = 0; k <= 26; k++) {
      var sK = k / 26, u = -1 + 2 * sK,
          y  = 20 + 32 * Math.sqrt(Math.max(0, 1 - u * u)),   /* a wide, shallow sweep */
          pt = archPoint(f, u * 0.93, y, 26),
          pi = archPoint(f, u * 0.80, y - 7.5, 26);
      if (prev)   members.push([prev, pt, 3.0]);
      if (prevIn) members.push([prevIn, pi, 1.8]);
      if (k % 4 === 0) members.push([pt, pi, 1.4]);            /* the spandrel ribs */
      prev = pt; prevIn = pi;
    }
  }

  members.sort(function (a, b) { return (a[0].y + a[1].y) - (b[0].y + b[1].y); });

  /* ── scene ── */
  var scene = new THREE.Scene();

  /* Paris at dusk, painted into a canvas and used two ways: as the sky
     behind the tower, and as the environment the ironwork reflects.
     Metal without something to reflect reads as plastic — this is what
     makes it look like iron. */
  var sky = document.createElement("canvas");
  var SW = 1024, SH = 512;
  sky.width = SW; sky.height = SH;
  (function () {
    var c = sky.getContext("2d");
    var g = c.createLinearGradient(0, 0, 0, SH);
    g.addColorStop(0.00, C.skyTop);
    g.addColorStop(0.26, C.skyUpper);
    g.addColorStop(0.46, C.skyMid);
    g.addColorStop(0.60, C.skyWarm);
    g.addColorStop(0.71, C.skyGlow);
    g.addColorStop(0.80, C.skyHorizon);
    g.addColorStop(0.87, C.skyBand);
    g.addColorStop(0.93, "#5A4A44");
    g.addColorStop(1.00, "#221C1B");
    c.fillStyle = g; c.fillRect(0, 0, SW, SH);

    /* Stars in the upper band, fading out before the colour turns warm. */
    c.fillStyle = "#FFFFFF";
    for (var st = 0; st < 260; st++) {
      var sy = Math.pow(Math.random(), 1.7) * SH * 0.42;
      c.globalAlpha = 0.5 * (1 - sy / (SH * 0.42)) * (0.3 + Math.random() * 0.7);
      c.fillRect(Math.random() * SW, sy, 1.4, 1.4);
    }
    c.globalAlpha = 1;

    /* Cloud bars, lit warm underneath and cool on top, the way dusk stacks
       them. Nothing here is meant to be looked at directly -- it exists so
       the ironwork has varied highlights to catch instead of a flat wash. */
    var hasBlur = false;
    try { c.filter = "blur(7px)"; hasBlur = c.filter === "blur(7px)"; } catch (e) {}
    for (var cl = 0; cl < 46; cl++) {
      var cy = SH * (0.34 + Math.random() * 0.50),
          cx = Math.random() * SW,
          cw = 70 + Math.random() * 300,
          ch = 4 + Math.random() * 11,
          warm = Math.min(1, Math.max(0, (cy / SH - 0.34) / 0.50));
      /* Each bar is drawn as a handful of overlapping lobes so the edge is
         ragged rather than a clean ellipse -- a single ellipse at this size
         reads as a lozenge painted on the sky, which is exactly what it is. */
      for (var lo = 0; lo < 5; lo++) {
        var lw = cw * (0.34 + Math.random() * 0.4),
            lx = cx + (lo / 4 - 0.5) * cw * 1.3,
            ly = cy + (Math.random() - 0.5) * ch * 1.4,
            lh = ch * (0.6 + Math.random() * 0.7);
        var cg = c.createLinearGradient(0, ly - lh, 0, ly + lh);
        cg.addColorStop(0, "rgba(48,40,66," + (0.42 * (1 - warm * 0.45)).toFixed(3) + ")");
        cg.addColorStop(0.45, "rgba(" + Math.round(110 + warm * 90) + "," +
                            Math.round(92 + warm * 60) + ",118," +
                            (0.26 + warm * 0.2).toFixed(3) + ")");
        cg.addColorStop(1, "rgba(255," + Math.round(148 + warm * 76) + ",118," +
                            (0.16 + warm * 0.42).toFixed(3) + ")");
        c.fillStyle = cg;
        c.beginPath();
        if (c.ellipse) c.ellipse(lx, ly, lw, lh, 0, 0, Math.PI * 2);
        else c.rect(lx - lw, ly - lh, lw * 2, lh * 2);
        c.fill();
      }
    }
    if (hasBlur) c.filter = "none";

    /* The sun, sitting on the haze just above the horizon, roughly where the
       key light comes from. This is the highlight the metal reflects, and
       with the scene composited in half float it is also the one thing in
       the sky bright enough to bleed. */
    var sux = SW * 0.62, suy = SH * 0.788;
    var glow = c.createRadialGradient(sux, suy, 0, sux, suy, SH * 0.36);
    glow.addColorStop(0.00, "rgba(255,248,226,1)");
    glow.addColorStop(0.05, "rgba(255,222,164,0.86)");
    glow.addColorStop(0.18, "rgba(248,166,102,0.45)");
    glow.addColorStop(0.48, "rgba(226,124,84,0.16)");
    glow.addColorStop(1.00, "rgba(226,124,84,0)");
    c.fillStyle = glow; c.fillRect(0, 0, SW, SH);
    c.fillStyle = "#FFFDF4";
    c.beginPath(); c.arc(sux, suy, SH * 0.026, 0, Math.PI * 2); c.fill();

    /* Crepuscular streaks fanning off it. Faint, and the reason a flat
       gradient reads as a backdrop and this reads as an evening. */
    c.save();
    c.translate(sux, suy);
    for (var ry2 = 0; ry2 < 9; ry2++) {
      var a2 = -1.35 + ry2 * 0.32 + Math.random() * 0.1;
      c.rotate(0);
      var rg = c.createLinearGradient(0, 0, Math.cos(a2) * SW * 0.5, Math.sin(a2) * SW * 0.5);
      rg.addColorStop(0, "rgba(255,214,158,.16)");
      rg.addColorStop(1, "rgba(255,214,158,0)");
      c.fillStyle = rg;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(Math.cos(a2 - 0.045) * SW, Math.sin(a2 - 0.045) * SW);
      c.lineTo(Math.cos(a2 + 0.045) * SW, Math.sin(a2 + 0.045) * SW);
      c.closePath(); c.fill();
    }
    c.restore();

    /* The city's own glow, banded along the horizon. */
    var hz = c.createLinearGradient(0, SH * 0.86, 0, SH);
    hz.addColorStop(0, "rgba(255,186,110,0.34)");
    hz.addColorStop(1, "rgba(24,18,20,0)");
    c.fillStyle = hz; c.fillRect(0, SH * 0.86, SW, SH * 0.14);
  })();
  var skyTex = new THREE.CanvasTexture(sky);
  skyTex.mapping = THREE.EquirectangularReflectionMapping;
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.FogExp2(C.haze, 0.00021);

  var camera = new THREE.PerspectiveCamera(40, 1, 1, 4000);
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  } catch (e) { bail(); return; }
  renderer.setClearColor(0x16201A, 1);

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.96;
  try {
    var pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    scene.environment = pmrem.fromEquirectangular(skyTex).texture;
  } catch (e) { scene.environment = skyTex; }

  var group = new THREE.Group();
  scene.add(group);

  var iron = new THREE.MeshStandardMaterial({
    color: C.iron, metalness: 0.95, roughness: 0.33, envMapIntensity: 0.85
  });
  /* Eiffel's members are not solid bars: each is a built-up girder, four
     angle-iron rails riveted around an open web. A single box reads as a
     matchstick as soon as the camera comes close. This keeps the same unit
     footprint -- so every instance matrix below is untouched -- but gives
     the profile four corner rails around a slimmer core, which is what
     catches the light along an edge and stops the tower looking sawn from
     plank. Five boxes an instance, ~78k triangles for the whole tower. */
  var beam = (function () {
    var core = new THREE.BoxGeometry(0.42, 1, 0.42), parts = [core], o = 0.34, ci;
    var corners = [[-o, -o], [-o, o], [o, -o], [o, o]];
    for (ci = 0; ci < 4; ci++) {
      var rail = new THREE.BoxGeometry(0.32, 1, 0.32);
      rail.translate(corners[ci][0], 0, corners[ci][1]);
      parts.push(rail);
    }
    try {
      var merged = mergeGeometries(parts, false);
      if (merged) return merged;
    } catch (e) { /* fall through to the plain bar */ }
    return new THREE.BoxGeometry(1, 1, 1);
  })();
  var lattice = new THREE.InstancedMesh(beam, iron, members.length);
  lattice.frustumCulled = false;

  var mtx = new THREE.Matrix4(), q = new THREE.Quaternion(),
      up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), mid = new THREE.Vector3();
  for (var i = 0; i < members.length; i++) {
    var a = members[i][0], b = members[i][1], th = members[i][2];
    dir.subVectors(b, a); var len = dir.length() || 0.001;
    mid.addVectors(a, b).multiplyScalar(0.5);
    q.setFromUnitVectors(up, dir.clone().normalize());
    mtx.compose(mid, q, new THREE.Vector3(th, len, th));
    lattice.setMatrixAt(i, mtx);
  }
  lattice.instanceMatrix.needsUpdate = true;
  lattice.count = 0;
  group.add(lattice);

  /* platforms, cupola, mast */
  var deckMat = new THREE.MeshStandardMaterial({ color: 0x3F3225, metalness: 0.9, roughness: 0.42, envMapIntensity: 0.7 });
  var decks = PLATFORMS.map(function (ph) {
    var w = halfw(ph) * 2.3;
    var d = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, w), deckMat);
    d.position.y = ph; d.visible = false; group.add(d);
    return { mesh: d, h: ph };
  });
  var cupola = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 6.4, 11, 14), deckMat);
  cupola.position.y = 305; cupola.visible = false; group.add(cupola);
  var lantern = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.4, 8, 12), deckMat);
  lantern.position.y = 314; lantern.visible = false; group.add(lantern);
  var antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 2.0, 26, 8), iron);
  antenna.position.y = 331; antenna.visible = false; group.add(antenna);
  var tip = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 8),
            new THREE.MeshBasicMaterial({ color: 0xFFE9BE }));
  tip.position.y = 345; tip.visible = false; group.add(tip);
  var SUMMIT = [[cupola,0.955],[lantern,0.972],[antenna,0.984],[tip,0.992]];

  /* the tower's own lamps */
  /* Above white on purpose: in half float these stay brighter than the
     tone curve can hold, which is what makes them bleed like real lamps
     rather than sitting there as pale dots. */
  var lampMat = new THREE.MeshBasicMaterial({ color: 0xF2D9A6 });
  lampMat.color.multiplyScalar(2.6);
  var lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(1.5, 8, 6), lampMat, 16);
  lamps.frustumCulled = false;
  var li = 0, lampH = [];
  PLATFORMS.concat([300]).forEach(function (ph) {
    for (var c = 0; c < 4; c++) {
      var pt = corner(ph, c).multiplyScalar(1.04); pt.y = ph + 3;
      mtx.compose(pt, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      lamps.setMatrixAt(li++, mtx); lampH.push(ph);
    }
  });
  lamps.instanceMatrix.needsUpdate = true;
  lamps.count = 0;
  group.add(lamps);

  var lighthouse = new THREE.Group();
  lighthouse.position.y = 322;
  (function () {
    var beamMat = new THREE.MeshBasicMaterial({
      color: 0xFFEBC0, transparent: true, opacity: 0.075,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (var bm = 0; bm < 2; bm++) {
      var cone = new THREE.Mesh(new THREE.ConeGeometry(20, 1500, 20, 1, true), beamMat);
      cone.rotation.z = Math.PI / 2;                    /* lay the beam on its side */
      cone.rotation.x = 0.06;
      cone.position.x = (bm ? -1 : 1) * 750;
      if (bm) cone.rotation.z = -Math.PI / 2;
      lighthouse.add(cone);
    }
    /* the beams are drawn geometry; a lamp at the hub is enough light */
    var hub = new THREE.PointLight(0xFFE7BA, 80000, 700, 2);
    lighthouse.add(hub);
  })();
  lighthouse.visible = false;
  group.add(lighthouse);

  var beacon = new THREE.PointLight(0xFFE3AE, 0, 260, 2);
  beacon.position.set(0, 345, 0); group.add(beacon);


  /* == the texture foundry ================================================
     Everything below the tower was a single flat colour on a primitive: a
     box of one grey, a lawn of one green, a sphere of one dark green. That
     is the whole difference between this and the cathedral -- the cathedral
     is a scanned building carrying photographed stone, and a solid painted
     an average colour reads as a solid painted an average colour no matter
     how well it is lit.

     Nothing is downloaded: every map here is drawn into a canvas at load,
     which keeps the scene one file and lets each surface carry albedo,
     roughness and a real normal instead of a constant. ==================== */

  var ANISO = 1;
  try { ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 1); } catch (e) {}

  function cv2d(w, h) {
    var c = document.createElement("canvas"); c.width = w; c.height = h; return c;
  }
  function tex(cvs, srgb, rx, ry) {
    var t = new THREE.CanvasTexture(cvs);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx || 1, ry || 1);
    t.anisotropy = ANISO;
    return t;
  }

  /* Value noise, built by drawing a few random low-resolution grids scaled
     up -- the canvas does the interpolation, so this is octaves of smooth
     noise for the cost of a handful of drawImage calls. */
  function noiseCv(size, octaves, amp, base) {
    var out = cv2d(size, size), o = out.getContext("2d");
    o.fillStyle = "#808080"; o.fillRect(0, 0, size, size);
    for (var k = 0; k < octaves; k++) {
      /* The base frequency matters more than the octave count. Starting at
         four, the coarsest layer is a 4x4 grid of blobs that shows up as an
         obvious repeat the moment the texture is tiled across a lawn. */
      var n = (base || 4) << k, small = cv2d(n, n), sc = small.getContext("2d");
      var id = sc.createImageData(n, n), i;
      for (i = 0; i < n * n; i++) {
        var v = 128 + (Math.random() - 0.5) * 250;
        id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
        id.data[i * 4 + 3] = 255;
      }
      sc.putImageData(id, 0, 0);
      o.globalAlpha = (amp || 0.5) / (k + 1);
      o.drawImage(small, 0, 0, size, size);
    }
    o.globalAlpha = 1;
    return out;
  }

  /* Sobel over a height field. Cheap, and the difference between a surface
     that has a direction under a low sun and one that has none. */
  function normalCv(heightCv, strength) {
    var w = heightCv.width, h = heightCv.height;
    var src = heightCv.getContext("2d").getImageData(0, 0, w, h).data;
    var out = cv2d(w, h), oc = out.getContext("2d"), id = oc.createImageData(w, h);
    function H(x, y) {
      x = (x + w) % w; y = (y + h) % h;
      return src[(y * w + x) * 4] / 255;
    }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var dx = (H(x + 1, y) - H(x - 1, y)) * strength,
            dy = (H(x, y + 1) - H(x, y - 1)) * strength,
            l  = Math.sqrt(dx * dx + dy * dy + 1), i = (y * w + x) * 4;
        id.data[i]     = (-dx / l * 0.5 + 0.5) * 255;
        id.data[i + 1] = ( dy / l * 0.5 + 0.5) * 255;
        id.data[i + 2] = (  1 / l * 0.5 + 0.5) * 255;
        id.data[i + 3] = 255;
      }
    }
    oc.putImageData(id, 0, 0);
    return out;
  }

  /* Ground surfaces: gravel, lawn, paving. Tinted noise for the albedo and
     the same noise as a height field for the normal, so the bumps and the
     colour agree with each other. */
  function groundMaps(hex, spread, size, bump, base) {
    var n = noiseCv(size || 256, 4, 0.62, base || 16);
    var alb = cv2d(n.width, n.height), a = alb.getContext("2d");
    var col = new THREE.Color(hex);
    a.fillStyle = "#" + col.getHexString(); a.fillRect(0, 0, alb.width, alb.height);
    a.globalAlpha = spread; a.globalCompositeOperation = "overlay";
    a.drawImage(n, 0, 0);
    a.globalAlpha = 1; a.globalCompositeOperation = "source-over";
    return { map: alb, normal: normalCv(n, bump === undefined ? 2.4 : bump), noise: n };
  }

  /* A Haussmann elevation, or a curtain wall depending on the floor count:
     courses, window reveals, continuous balconies, a cornice, and grime
     washing down from every sill. Returns the maps a lit facade needs --
     what colour it is, which parts are glass, and which windows are on. */
  function facadeMaps(floors, bays, litRatio, modern) {
    var W = 256, H = 256, i, j;
    var alb = cv2d(W, H), a = alb.getContext("2d");
    var emi = cv2d(W, H), e = emi.getContext("2d");
    var hgt = cv2d(W, H), g = hgt.getContext("2d");
    var rgh = cv2d(W, H), r = rgh.getContext("2d");

    a.fillStyle = modern ? "#3B4048" : "#B9AE97"; a.fillRect(0, 0, W, H);
    e.fillStyle = "#000000"; e.fillRect(0, 0, W, H);
    g.fillStyle = "#9A9A9A"; g.fillRect(0, 0, W, H);
    r.fillStyle = "#D8D8D8"; r.fillRect(0, 0, W, H);          /* stone: rough */

    /* Soot gathers at the foot of a wall and rain cleans the top of it. */
    var wash = a.createLinearGradient(0, 0, 0, H);
    wash.addColorStop(0, "rgba(255,248,230,.10)");
    wash.addColorStop(0.55, "rgba(0,0,0,0)");
    wash.addColorStop(1, "rgba(24,20,16,.26)");
    a.fillStyle = wash; a.fillRect(0, 0, W, H);

    var fh = H / floors, bw = W / bays;

    if (!modern) {
      a.fillStyle = "rgba(80,70,54,.09)";
      for (i = 0; i < H; i += 6) a.fillRect(0, i, W, 1);
      g.fillStyle = "rgba(0,0,0,.16)";
      for (i = 0; i < H; i += 6) g.fillRect(0, i, W, 1);
      a.fillStyle = "rgba(236,228,206,.5)";  a.fillRect(0, 0, W, 7);
      g.fillStyle = "#E8E8E8";               g.fillRect(0, 0, W, 7);
      a.fillStyle = "rgba(226,218,196,.35)"; a.fillRect(0, H - fh - 3, W, 3);
      g.fillStyle = "#D2D2D2";               g.fillRect(0, H - fh - 3, W, 3);
    }

    for (j = 0; j < floors; j++) {
      var fy = j * fh;
      var isGround = j === floors - 1;
      /* Haussmann hangs a continuous balcony on the second and fifth floors;
         a curtain wall gets a spandrel band on every one instead. */
      var balcony = modern ? true : (j === 1 || j === floors - 2);

      if (balcony && fh > 9) {
        var by = fy + fh * (modern ? 0.86 : 0.9), bh = Math.max(2, fh * 0.1);
        a.fillStyle = modern ? "rgba(22,26,32,.85)" : "rgba(38,34,28,.72)";
        a.fillRect(0, by, W, bh);
        g.fillStyle = "#F0F0F0"; g.fillRect(0, by, W, bh);
      }

      for (i = 0; i < bays; i++) {
        var bx = i * bw;
        var ww = bw * (modern ? 0.74 : 0.44),
            wh = fh * (isGround && !modern ? 0.62 : 0.5),
            wx = bx + (bw - ww) / 2,
            wy = fy + fh * 0.24;

        g.fillStyle = "#2A2A2A"; g.fillRect(wx, wy, ww, wh);   /* reveal */
        r.fillStyle = "#2E2E2E"; r.fillRect(wx, wy, ww, wh);   /* glass: glossy */
        a.fillStyle = modern ? "#1B2028" : "#252A31";
        a.fillRect(wx, wy, ww, wh);

        if (!modern) {
          a.fillStyle = "rgba(238,230,208,.42)";
          a.fillRect(wx - 1.5, wy - 2, ww + 3, 2);
          a.fillRect(wx - 2.5, wy + wh, ww + 5, 2);
          g.fillStyle = "#EDEDED";
          g.fillRect(wx - 2.5, wy + wh, ww + 5, 2);
          var st = a.createLinearGradient(0, wy + wh, 0, wy + wh + fh * 0.4);
          st.addColorStop(0, "rgba(40,34,26,.22)");
          st.addColorStop(1, "rgba(40,34,26,0)");
          a.fillStyle = st; a.fillRect(wx - 2, wy + wh, ww + 4, fh * 0.4);
        }

        if (Math.random() < litRatio) {
          var warm = Math.random();
          e.fillStyle = warm < 0.14 ? "#7FA8D6" : (warm < 0.6 ? "#FFC067" : "#FFDCA4");
          e.globalAlpha = 0.55 + Math.random() * 0.45;
          e.fillRect(wx, wy, ww, wh);
          e.globalAlpha = 1;
        }
      }
    }

    return {
      map:      tex(alb, true),
      emissive: tex(emi, true),
      rough:    tex(rgh, false),
      normal:   tex(normalCv(hgt, 3.2), false)
    };
  }

  /* Paris roofs are zinc: bluish grey, laid in sheets with standing seams. */
  function zincMaps() {
    var W = 128, H = 128, cvv = cv2d(W, H), z = cvv.getContext("2d"),
        hh = cv2d(W, H), g = hh.getContext("2d");
    z.fillStyle = "#4E555F"; z.fillRect(0, 0, W, H);
    g.fillStyle = "#808080"; g.fillRect(0, 0, W, H);
    z.globalAlpha = 0.34; z.globalCompositeOperation = "overlay";
    z.drawImage(noiseCv(W, 3, 0.5), 0, 0);
    z.globalAlpha = 1; z.globalCompositeOperation = "source-over";
    for (var x = 0; x < W; x += 16) {
      z.fillStyle = "rgba(214,222,232,.22)"; z.fillRect(x, 0, 2, H);
      z.fillStyle = "rgba(22,26,32,.3)";     z.fillRect(x + 2, 0, 1, H);
      g.fillStyle = "#EFEFEF";               g.fillRect(x, 0, 2, H);
    }
    return { map: tex(cvv, true, 3, 3), normal: tex(normalCv(hh, 2.6), false, 3, 3) };
  }

  /* ground, so the uplight has something to pool on */
  var groundG = groundMaps(0x141B28, 0.4, 256, 1.6);
  var ground = new THREE.Mesh(
    new THREE.CircleGeometry(2600, 64),
    new THREE.MeshStandardMaterial({
      map: tex(groundG.map, true, 26, 26),
      normalMap: tex(groundG.normal, false, 26, 26),
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.95, metalness: 0.04, envMapIntensity: 0.14
    })
  );
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.5; scene.add(ground);

  /* ═══ the site: Champ de Mars to the south, the Seine and
         Trocadéro to the north — the tower stands at the join ═══ */
  var lawnG   = groundMaps(0x33482B, 0.42, 256, 1.1, 20);
  var gravelG = groundMaps(0x6E6759, 0.46, 256, 1.3, 24);
  var zinc    = zincMaps();
  /* The Palais de Chaillot and the Ecole Militaire are close enough to read
     as buildings rather than as blocks, so they get a real elevation. */
  var palace  = facadeMaps(4, 9, 0.2, false);

  var MAT = {
    lawn: new THREE.MeshStandardMaterial({
      color: 0x9FB48C,
      map: tex(lawnG.map, true, 13, 13),
      normalMap: tex(lawnG.normal, false, 13, 13),
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughness: .97, metalness: 0, envMapIntensity: .18 }),
    gravel: new THREE.MeshStandardMaterial({
      color: 0xB9AE97,
      map: tex(gravelG.map, true, 22, 22),
      normalMap: tex(gravelG.normal, false, 22, 22),
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughness: .96, metalness: 0, envMapIntensity: .2 }),
    stone: new THREE.MeshStandardMaterial({
      map: palace.map, normalMap: palace.normal, roughnessMap: palace.rough,
      normalScale: new THREE.Vector2(0.9, 0.9),
      emissive: 0xFFFFFF, emissiveIntensity: 0.85, emissiveMap: palace.emissive,
      roughness: .9, metalness: .04, envMapIntensity: .3 }),
    roof: new THREE.MeshStandardMaterial({
      map: zinc.map, normalMap: zinc.normal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: .52, metalness: .55, envMapIntensity: .9 }),
    hedge: new THREE.MeshStandardMaterial({
      map: tex(lawnG.map, true, 2, 2), roughness: .95, metalness: 0 })
  };
  function slab(w, d, mat, x, y, z, ry) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, d), mat);
    m.position.set(x, y, z); if (ry) m.rotation.y = ry;
    m.receiveShadow = true; m.castShadow = true;
    scene.add(m); return m;
  }

  /* ── the Champ de Mars: formal lawns running away from the tower ── */
  slab(420, 1020, MAT.gravel, 0, 0.3, 560);
  for (var g1 = 0; g1 < 6; g1++) {
    var gz = 150 + g1 * 160;
    slab(150, 128, MAT.lawn, 0, 0.9, gz);
    slab(64, 128, MAT.lawn, -168, 0.9, gz);
    slab(64, 128, MAT.lawn,  168, 0.9, gz);
  }
  slab(300, 22, MAT.gravel, 0, 1.1, 90);
  /* École Militaire closing the far end */
  (function () {
    var b1 = new THREE.Mesh(new THREE.BoxGeometry(300, 46, 70), MAT.stone);
    b1.position.set(0, 23, 1120); scene.add(b1);
    var r1 = new THREE.Mesh(new THREE.BoxGeometry(306, 12, 76), MAT.roof);
    r1.position.set(0, 51, 1120); scene.add(r1);
    var dm = new THREE.Mesh(new THREE.CylinderGeometry(0, 22, 34, 12), MAT.roof);
    dm.position.set(0, 74, 1120); scene.add(dm);
  })();

  /* ── the Seine ── */
  /* A mirror-flat plane is the giveaway that this is a render. The river
     gets a normal map with a ripple in it, scrolled in the frame loop, so
     the sky and the tower's lights break up on it the way they do on water.
     Two layers moving at different speeds, because one reads as a pattern. */
  var rippleG = groundMaps(0x16304F, 0.5, 256, 5.5);
  var waterN1 = tex(rippleG.normal, false, 26, 3);
  var waterN2 = tex(rippleG.normal, false, 11, 2);
  var water = new THREE.Mesh(new THREE.PlaneGeometry(5200, 180, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0x16304F, metalness: .92, roughness: .13,
      normalMap: waterN1, normalScale: new THREE.Vector2(0.34, 0.34),
      envMapIntensity: 2.0 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, 0.7, -300); scene.add(water);
  /* the second layer, just under, catching the light at a different angle */
  var water2 = new THREE.Mesh(new THREE.PlaneGeometry(5200, 180, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0x1B3A5C, metalness: .9, roughness: .2, transparent: true, opacity: .55,
      normalMap: waterN2, normalScale: new THREE.Vector2(0.5, 0.5),
      envMapIntensity: 1.5 }));
  water2.rotation.x = -Math.PI / 2; water2.position.set(0, 0.72, -300); scene.add(water2);
  var quayG = groundMaps(0x6F6A5C, 0.55, 256, 3.0);
  var quayMat = new THREE.MeshStandardMaterial({
    map: tex(quayG.map, true, 24, 2),
    normalMap: tex(quayG.normal, false, 24, 2),
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: .9, metalness: .05, envMapIntensity: .25 });
  [-300 + 96, -300 - 96].forEach(function (qz) {
    var wall = new THREE.Mesh(new THREE.BoxGeometry(5200, 11, 26), quayMat);
    wall.position.set(0, 5, qz); scene.add(wall);
  });

  /* Pont d'Iéna, on the tower's axis */
  (function () {
    var deck = new THREE.Mesh(new THREE.BoxGeometry(42, 7, 250), quayMat);
    deck.position.set(0, 12, -300); scene.add(deck);
    for (var pr = -2; pr <= 2; pr++) {
      var pier = new THREE.Mesh(new THREE.BoxGeometry(38, 16, 16), quayMat);
      pier.position.set(0, 5, -300 + pr * 46); scene.add(pier);
    }
  })();

  /* ── Trocadéro: the Palais de Chaillot's two curved wings ── */
  (function () {
    var CZ = -700, R = 250;
    for (var wing = 0; wing < 2; wing++) {
      for (var k3 = 0; k3 < 9; k3++) {
        var aA = (wing ? 1 : -1) * (0.34 + k3 * 0.083);
        var bx = Math.sin(aA) * R, bz = CZ + Math.cos(aA) * R * 0.72;
        var blk = new THREE.Mesh(new THREE.BoxGeometry(46, 40, 34), MAT.stone);
        blk.position.set(bx, 20, bz); blk.rotation.y = -aA; scene.add(blk);
        var rf = new THREE.Mesh(new THREE.BoxGeometry(50, 7, 38), MAT.roof);
        rf.position.set(bx, 43, bz); rf.rotation.y = -aA; scene.add(rf);
      }
    }
    /* the terrace and its fountain basins, stepping down to the river */
    slab(360, 150, MAT.gravel, 0, 2, -560);
    var basin = new THREE.Mesh(new THREE.PlaneGeometry(96, 210),
      new THREE.MeshStandardMaterial({ color: 0x1E4661, metalness: .9, roughness: .08, envMapIntensity: 1.8 }));
    basin.rotation.x = -Math.PI / 2; basin.position.set(0, 3.2, -470); scene.add(basin);
    slab(300, 120, MAT.lawn, -230, 1.4, -470);
    slab(300, 120, MAT.lawn,  230, 1.4, -470);
  })();

  /* ── trees, in the rows the park is planted in ── */
  (function () {
    var pts = [], i5, z5;
    /* Rounder canopies cost four times the triangles of a faceted one, so
       the park is planted more sparsely to pay for it. Fewer trees that
       read as trees beats an avenue of polyhedra. */
    var TREE_STEP = C.quality === "full" ? 34 : 62;
    for (z5 = 130; z5 < 1060; z5 += TREE_STEP) {
      [-232, -206, 206, 232].forEach(function (tx) { pts.push([tx + (Math.random()-.5)*5, z5 + (Math.random()-.5)*6]); });
    }
    for (i5 = 0; i5 < (C.quality === "full" ? 64 : 26); i5++) pts.push([(Math.random()-.5)*760, -430 - Math.random()*230]);
    for (i5 = 0; i5 < (C.quality === "full" ? 48 : 20); i5++) pts.push([(Math.random()<.5?-1:1)*(300+Math.random()*420), -140 - Math.random()*120]);

    /* A sphere on a cylinder is a lollipop. A plane tree in the Champ de
       Mars is a mass of three or four overlapping lobes with a broken edge,
       which is all it takes for the silhouette to stop reading as a toy --
       and it is still one instanced draw for the whole park. */
    var crownGeo = (function () {
      var lobes = [], li2;
      var lv = new THREE.Vector3();
      for (li2 = 0; li2 < 3; li2++) {
        var lobe = new THREE.IcosahedronGeometry(1, 2), pos = lobe.attributes.position, vi;
        /* Displaced by a smooth function of the DIRECTION, not per vertex.
           An icosahedron is non-indexed -- every triangle carries its own
           three vertices -- so moving each one independently pulls the
           faces apart and the tree comes out a sea urchin. Two triangles
           meeting at a corner both evaluate this to the same number, so the
           surface stays closed and merely goes lumpy. */
        var ph = Math.random() * 6.283, ph2 = Math.random() * 6.283;
        for (vi = 0; vi < pos.count; vi++) {
          lv.fromBufferAttribute(pos, vi).normalize();
          var f = 1 + 0.15 * (Math.sin(lv.x * 2.7 + ph) * Math.cos(lv.y * 2.1 + ph2)
                            + Math.sin(lv.z * 3.3 + ph2) * 0.7);
          pos.setXYZ(vi, lv.x * f, lv.y * f, lv.z * f);
        }
        lobe.computeVertexNormals();
        var ls = 5.4 + Math.random() * 2.6;
        lobe.scale(ls * 1.1, ls * 0.86, ls * 1.05);
        lobe.translate((Math.random() - .5) * 6.5, (Math.random() - .3) * 3.4,
                       (Math.random() - .5) * 6.5);
        lobes.push(lobe);
      }
      try { return mergeGeometries(lobes, false) || lobes[0]; }
      catch (e) { return new THREE.SphereGeometry(8.5, 7, 6); }
    })();

    var trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.8, 1.7, 11, 6),
                  new THREE.MeshStandardMaterial({
                    map: tex(gravelG.map, true, 1, 3), color: 0x6B5942,
                    roughness: .95, envMapIntensity: .2 }), pts.length);
    var crown = new THREE.InstancedMesh(crownGeo,
                  new THREE.MeshStandardMaterial({ color: 0x4A6837, roughness: .93,
                    envMapIntensity: .3 }), pts.length);
    trunk.frustumCulled = false; crown.frustumCulled = false;
    var mm = new THREE.Matrix4(), qq = new THREE.Quaternion();
    var leaf = new THREE.Color();
    pts.forEach(function (pt, i6) {
      var sc = 0.8 + Math.random() * 0.55;
      /* Turned, so three lobes do not repeat down a row of forty trees. */
      qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
      mm.compose(new THREE.Vector3(pt[0], 5.5 * sc, pt[1]), qq, new THREE.Vector3(sc, sc, sc));
      trunk.setMatrixAt(i6, mm);
      mm.compose(new THREE.Vector3(pt[0], (11 + 5) * sc, pt[1]), qq,
                 new THREE.Vector3(sc, sc * 0.86, sc));
      crown.setMatrixAt(i6, mm);
      /* No two trees are the same green, and that alone stops a row of them
         reading as one stamped object repeated. */
      leaf.setHSL(0.24 + (Math.random() - .5) * 0.05,
                  0.30 + Math.random() * 0.14,
                  0.20 + Math.random() * 0.09);
      crown.setColorAt(i6, leaf);
    });
    trunk.instanceMatrix.needsUpdate = true; crown.instanceMatrix.needsUpdate = true;
    if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
    scene.add(trunk); scene.add(crown);
  })();

  /* ── the city beyond: Haussmann blocks, and towers on the skyline ── */
  (function () {
    var spots = [], i8, ang8, rr;
    var CITY_N = C.quality === "full" ? 520 : 260;
    /* The camera orbits the tower at somewhere between 400 and 800 metres,
       looking in at it, so anything standing inside that ring ends up
       between the reader and the subject -- and with the blocks carrying
       real elevations and mansards now, one landing on the axis fills the
       top of the frame with roof. It is also simply wrong: the Champ de
       Mars is open ground and the quays are the near edge of the city, not
       the middle of it. Spots inside the clearing are redrawn. */
    var CLEAR = 900;
    for (i8 = 0; i8 < CITY_N; i8++) {
      for (var tries = 0; tries < 24; tries++) {
        var side = Math.random(), sx, sz;
        if (side < 0.55) {                                 /* across the river */
          sx = (Math.random() - .5) * 3400; sz = -820 - Math.random() * 1500;
        } else if (side < 0.8) {                            /* flanking the park */
          sx = (Math.random() < .5 ? -1 : 1) * (330 + Math.random() * 1300);
          sz = -100 + Math.random() * 1500;
        } else {                                            /* along the near quay */
          sx = (Math.random() - .5) * 3200; sz = -150 - Math.random() * 90;
        }
        if (sx * sx + sz * sz > CLEAR * CLEAR) { spots.push([sx, sz]); break; }
      }
    }
    /* Six floors, seven bays, a zinc roof: a Paris block, not a tinted box.
       A cube's UVs run 0..1 on every face whatever the instance is scaled
       to, so one facade cannot serve both a mansard block and a tower --
       the floors would stretch to four times the height on the tall ones.
       Hence two classes, each with two elevations so a row of them does not
       repeat, and BoxGeometry's six material groups put the roof on top and
       the shadowed underside below rather than wrapping windows over both.
       Order is [+x, -x, +y, -y, +z, -z]. */
    function blockMesh(floors, bays, litRatio, modern, n) {
      var f = facadeMaps(floors, bays, litRatio, modern);
      var side = new THREE.MeshStandardMaterial({
        map: f.map, normalMap: f.normal, roughnessMap: f.rough,
        normalScale: new THREE.Vector2(0.85, 0.85),
        emissive: 0xFFFFFF, emissiveIntensity: modern ? 2.6 : 2.1, emissiveMap: f.emissive,
        roughness: 1, metalness: modern ? 0.35 : 0.05, envMapIntensity: modern ? 0.75 : 0.28
      });
      var top = new THREE.MeshStandardMaterial({
        map: zinc.map, normalMap: zinc.normal, normalScale: new THREE.Vector2(0.8, 0.8),
        roughness: .5, metalness: .6, envMapIntensity: .95
      });
      var under = new THREE.MeshStandardMaterial({ color: 0x14161A, roughness: 1 });
      var m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
        [side, side, top, under, side, side], n);
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
      return m;
    }

    var CLASSES = [
      blockMesh(6, 7, 0.30, false, spots.length),   /* haussmann, quiet     */
      blockMesh(6, 7, 0.52, false, spots.length),   /* haussmann, lit up    */
      blockMesh(18, 8, 0.34, true,  spots.length),  /* tower, quiet         */
      blockMesh(18, 8, 0.58, true,  spots.length)   /* tower, lit up        */
    ];
    var fill = [0, 0, 0, 0];

    var m8 = new THREE.Matrix4(), q8 = new THREE.Quaternion(),
        up8 = new THREE.Vector3(0, 1, 0), tone = new THREE.Color(), roofs = [];
    spots.forEach(function (sp8) {
      var far = Math.abs(sp8[1]) > 900 || Math.abs(sp8[0]) > 900;
      var w8 = 48 + Math.random() * 46;
      var tall = far && Math.random() < 0.06;
      var h8 = tall ? 120 + Math.random() * 90 : 26 + Math.random() * 34;
      var ci = (tall ? 2 : 0) + (Math.random() < 0.34 ? 1 : 0);
      q8.setFromAxisAngle(up8, Math.random() * 0.5);
      m8.compose(new THREE.Vector3(sp8[0], h8 / 2, sp8[1]), q8,
                 new THREE.Vector3(w8, h8, w8 * (0.75 + Math.random() * 0.6)));
      var mesh = CLASSES[ci], k8 = fill[ci]++;
      mesh.setMatrixAt(k8, m8);
      /* Limestone is never one colour across a street. A little spread in
         hue and lightness per building is what turns a row of identical
         extrusions into a skyline. */
      tone.setHSL(0.09 + (Math.random() - .5) * 0.05,
                  0.10 + Math.random() * 0.10,
                  (tall ? 0.42 : 0.55) + (Math.random() - .5) * 0.16);
      mesh.setColorAt(k8, tone);

      if (!tall) {
        var rh = 6 + Math.random() * 5, dz = w8 * (0.75 + Math.random() * 0.6);
        /* The 4-sided cylinder's flat starts at 45 degrees, so it is turned
           an eighth of a turn to sit square on the block under it. */
        var rq = new THREE.Quaternion().setFromAxisAngle(up8, Math.PI / 4);
        rq.premultiply(q8);
        roofs.push(new THREE.Matrix4().compose(
          new THREE.Vector3(sp8[0], h8 + rh / 2, sp8[1]), rq,
          new THREE.Vector3(w8 * 0.72, rh, dz * 0.72)));
      }
    });
    for (var ci2 = 0; ci2 < CLASSES.length; ci2++) {
      CLASSES[ci2].count = fill[ci2];
      CLASSES[ci2].instanceMatrix.needsUpdate = true;
      if (CLASSES[ci2].instanceColor) CLASSES[ci2].instanceColor.needsUpdate = true;
    }
    /* The mansard. Every Paris block is a stone wall stopped by a cornice
       with a steep grey roof set back above it, and the roofline is most of
       what you actually recognise a Paris skyline by -- a flat-topped box
       could be any city. One tapered instance per block, sat on the parapet
       of the ones that were given a Haussmann elevation. */
    var mans = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.62, 1, 1, 4, 1),
      new THREE.MeshStandardMaterial({
        map: zinc.map, normalMap: zinc.normal, normalScale: new THREE.Vector2(0.7, 0.7),
        roughness: .55, metalness: .5, envMapIntensity: .9 }),
      roofs.length);
    mans.frustumCulled = false;
    for (var ri = 0; ri < roofs.length; ri++) mans.setMatrixAt(ri, roofs[ri]);
    mans.instanceMatrix.needsUpdate = true;
    scene.add(mans);
  })();

  /* ── people, walking the esplanade and the gardens ── */
  var walkers = [], people;
  (function () {
    var N = C.quality === "full" ? 190 : 90;
    people = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.9, 1.1, 5.4, 5),
      new THREE.MeshStandardMaterial({ color: 0x2E3440, roughness: .85, envMapIntensity: .4 }), N);
    people.frustumCulled = false;
    for (var i7 = 0; i7 < N; i7++) {
      var lane = Math.random();
      var w7 = lane < 0.55
        ? { x: (Math.random() - .5) * 320, z: 90 + Math.random() * 900 }        /* the gardens */
        : (lane < 0.8
            ? { x: (Math.random() - .5) * 300, z: -520 - Math.random() * 120 }  /* Trocadéro terrace */
            : { x: (Math.random() - .5) * 240, z: -180 + Math.random() * 190 });/* under the tower */
      w7.a = Math.random() * Math.PI * 2; w7.sp = 3 + Math.random() * 5;
      walkers.push(w7);
    }
    scene.add(people);
  })();

  var boats = [];
  (function () {
    var hullMat  = new THREE.MeshStandardMaterial({ color: 0xD8D3C6, metalness: .5, roughness: .45 });
    var glassMat = new THREE.MeshStandardMaterial({
      color: 0xFFE2A8, emissive: 0xFFC96B, emissiveIntensity: 1.5, roughness: .3, metalness: .2 });
    for (var i2 = 0; i2 < 4; i2++) {
      var g2 = new THREE.Group();
      var hull = new THREE.Mesh(new THREE.BoxGeometry(58, 6, 13), hullMat); hull.position.y = 4; g2.add(hull);
      var deck2 = new THREE.Mesh(new THREE.BoxGeometry(46, 7, 11), glassMat); deck2.position.y = 10; g2.add(deck2);
      var roof2 = new THREE.Mesh(new THREE.BoxGeometry(48, 1.4, 12), hullMat); roof2.position.y = 14.2; g2.add(roof2);
      var wake = new THREE.Mesh(new THREE.PlaneGeometry(130, 14),
        new THREE.MeshBasicMaterial({ color: 0xBFD3E4, transparent: true, opacity: .16 }));
      wake.rotation.x = -Math.PI / 2; wake.position.set(-95, 1.2, 0); g2.add(wake);
      g2.position.set(-2000 + i2 * 1000, 0, -300 + (i2 % 2 ? 40 : -42));
      g2.userData = { sp: 24 + i2 * 6, dir: (i2 % 2) ? 1 : -1 };
      if (g2.userData.dir < 0) g2.rotation.y = Math.PI;
      scene.add(g2); boats.push(g2);
    }
  })();

  /* ── lights ── */
  scene.add(new THREE.AmbientLight(0x6C7CA6, 0.4));
  var key = new THREE.DirectionalLight(0xFFD9A0, 1.5); key.position.set(320, 300, 240); scene.add(key);
  var fill = new THREE.DirectionalLight(0x7FA0EC, 1.25); fill.position.set(-340, 160, -300); scene.add(fill);
  var rim  = new THREE.DirectionalLight(0xC77FB0, 0.75);  rim.position.set(-120, 300, 340); scene.add(rim);
  var uplight = new THREE.PointLight(0xFFB861, 260000, 640, 2); uplight.position.set(0, 10, 0); scene.add(uplight);
  var upper = new THREE.PointLight(0xFFC87A, 90000, 460, 2); upper.position.set(0, 150, 0); group.add(upper);
  var rove = new THREE.PointLight(0xD8B577, 60000, 520, 2); scene.add(rove);

  /* ── shadows ──────────────────────────────────────────────────────────
     Without them every solid in the scene is lit identically on every face
     and the whole park reads as painted card. One caster is enough: the
     low key light throws the tower's own lattice across the Champ de Mars,
     which is both the cheapest and the most legible shadow in the frame.
     The ortho box is framed on the tower rather than the site, so the
     2048 map is spent entirely on the ironwork. */
  /* A second full pass over the tower is not free. Phones and low-core
     machines get the scene without it rather than a slideshow with it --
     everything else about the frame is unchanged, so nothing looks broken,
     it just loses the cast shadow. */
  var HEAVY = !(window.matchMedia && window.matchMedia("(pointer: coarse)").matches) &&
              (navigator.hardwareConcurrency || 4) >= 4 &&
              Math.min(window.innerWidth, window.innerHeight) > 520;
  var SHADOW_MAP = (navigator.hardwareConcurrency || 4) >= 8 ? 2048 : 1024;

  renderer.shadowMap.enabled = HEAVY;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  key.castShadow = HEAVY;
  key.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  key.shadow.camera.left = -300; key.shadow.camera.right = 300;
  key.shadow.camera.top = 360;   key.shadow.camera.bottom = -70;
  key.shadow.camera.near = 60;   key.shadow.camera.far = 1600;
  key.shadow.bias = -0.0007;
  key.shadow.normalBias = 1.1;
  key.shadow.camera.updateProjectionMatrix();

  /* == compositing =======================================================
     Rendering straight to the canvas clips every value at white, so a lit
     window, a lamp and the beacon all come out the same flat cream and the
     scene reads as a drawing of night rather than night. This renders into
     a half-float target instead, where a light can be brighter than white,
     and lets the bright parts bleed the way a camera's does before the tone
     curve brings it back. It is the difference between paint and light.

     Same gate as the shadow: a machine that cannot afford a second pass
     gets the scene rendered directly, which is exactly what it was. */
  var composer = null, bloom = null;
  if (HEAVY) {
    try {
      var sz0 = renderer.getDrawingBufferSize(new THREE.Vector2());
      var hdr = new THREE.WebGLRenderTarget(sz0.x, sz0.y, {
        type: THREE.HalfFloatType,
        samples: 4                       /* antialias:true does not reach a
                                            render target; this does */
      });
      composer = new EffectComposer(renderer, hdr);
      composer.addPass(new RenderPass(scene, camera));
      /* Threshold high enough that the dusk sky itself does not bloom --
         only the things that are actually emitting. */
      bloom = new UnrealBloomPass(new THREE.Vector2(sz0.x, sz0.y), 0.9, 0.55, 0.78);
      composer.addPass(bloom);
      /* OutputPass is what applies the tone map and the colour space now:
         the renderer only does that when it draws to the canvas itself. */
      composer.addPass(new OutputPass());
    } catch (e) { composer = null; }
  }

  function draw() {
    if (composer) composer.render(); else renderer.render(scene, camera);
  }

  if (HEAVY) {
    scene.traverse(function (o) {
      if (!o.isMesh && !o.isInstancedMesh) return;
      /* Unlit materials neither cast a believable shadow nor receive one --
         the lamps and the beacon tip are meant to be sources, not solids. */
      if (o.material && o.material.isMeshBasicMaterial) return;
      o.castShadow = true;
      o.receiveShadow = true;
    });
    ground.castShadow = false;
  }

  /* ── drive ── */
  var progress = 0, eased = 0, clock = 0, visible = false, raf = null;
  var builtH = 30, camH = 30;
  var STAGES = [[0.06,"Footings"],[0.2,"The four legs"],[0.34,"The great arch"],
                [0.46,"First platform"],[0.6,"The body"],[0.72,"Second platform"],
                [0.86,"The shaft"],[0.97,"Summit"],[1.01,"Complete"]];

  function apply(p) {
    var total = members.length;
    lattice.count = Math.max(0, Math.min(total, Math.floor(p * total)));

    var topH = 0;
    if (lattice.count > 0) {
      var last = members[lattice.count - 1];
      topH = Math.max(last[0].y, last[1].y);
    }
    builtH = Math.max(28, topH);
    decks.forEach(function (d) { d.mesh.visible = topH > d.h; });
    for (var q2 = 0; q2 < SUMMIT.length; q2++) SUMMIT[q2][0].visible = p > SUMMIT[q2][1];
    var ln = 0; for (var j = 0; j < lampH.length; j++) if (topH > lampH[j] + 2) ln = j + 1;
    lamps.count = ln;
    beacon.intensity = p > 0.984 ? 90000 : 0;
    lighthouse.visible = p > 0.984;

    var pct = Math.round(Math.min(p, 1) * 100);
    if (roFill) roFill.style.transform = "scaleX(" + Math.min(p, 1).toFixed(3) + ")";
    if (roPct) roPct.textContent = pct + "%";
    if (roLabel) roLabel.textContent = pct >= 100 ? "Assembled" : "Assembling";
    if (roStage && pct >= 100) roStage.textContent = "330 m \u00b7 complete";
    if (roStage) {
      for (var s = 0; s < STAGES.length; s++) {
        if (p < STAGES[s][0]) { roStage.textContent = STAGES[s][1]; break; }
        roStage.textContent = STAGES[STAGES.length - 1][1];
      }
    }
    if (typeof opts.onProgress === "function") opts.onProgress(Math.min(p, 1));
  }

  function resize() {
    var w = canvas.clientWidth || 1, hgt = canvas.clientHeight || 1;
    /* Compositing means every pixel is touched several times over -- the
       scene, then the bloom's mip chain, then the tone pass. On a retina
       hero that is four times the work of the plain path, so the ratio is
       capped lower when it is on. Bloom softens edges anyway, which is
       exactly the detail the extra samples were buying. */
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, composer ? 1.5 : 2));
    renderer.setSize(w, hgt, false);
    if (composer) {
      var dpr = renderer.getPixelRatio();
      composer.setSize(w, hgt);
      if (bloom) bloom.setSize(w * dpr, hgt * dpr);
    }
    camera.aspect = w / hgt; camera.updateProjectionMatrix();
  }

  function frame() {
    eased += (progress - eased) * 0.085;
    clock += 0.0045;

    var p = 0.012 + Math.min(eased / 0.58, 1) * 0.988;
    apply(p);

    camH += (builtH - camH) * 0.16;
    var held = Math.max(0, (eased - 0.58) / 0.42);          /* 0 while building, 1 at rest */
    var ang = -1.45 + eased * 1.72 + Math.sin(clock * 0.25) * 0.05;
    var framed = Math.max(camH, C.minFrame);
    var rad = 108 + framed * 1.96 + held * 150;
    camera.position.set(Math.sin(ang) * rad, 9 + framed * 0.26 + held * 120 + Math.sin(clock * 0.7) * 3, Math.cos(ang) * rad);
    camera.lookAt(0, framed * 0.54 - held * 40, 0);

    var pm = new THREE.Matrix4(), pq = new THREE.Quaternion(), ps = new THREE.Vector3(1, 1, 1);
    for (var wi = 0; wi < walkers.length; wi++) {
      var wk = walkers[wi];
      wk.x += Math.cos(wk.a) * wk.sp * 0.016;
      wk.z += Math.sin(wk.a) * wk.sp * 0.016;
      if (wk.x < -420 || wk.x > 420) wk.a = Math.PI - wk.a;
      if (wk.z < -700 || wk.z > 1050) wk.a = -wk.a;
      pm.compose(new THREE.Vector3(wk.x, 3.4, wk.z), pq, ps);
      people.setMatrixAt(wi, pm);
    }
    people.instanceMatrix.needsUpdate = true;

    for (var bi = 0; bi < boats.length; bi++) {
      var bt = boats[bi];
      bt.position.x += bt.userData.dir * bt.userData.sp * 0.016;
      if (bt.position.x > 2100) bt.position.x = -2100;
      if (bt.position.x < -2100) bt.position.x = 2100;
    }
    /* the river runs; two normal layers at different speeds, so the
       highlights break up instead of sliding as one sheet */
    waterN1.offset.set(clock * 0.06, clock * 0.018);
    waterN2.offset.set(-clock * 0.035, clock * 0.03);
    lighthouse.rotation.y = clock * 3.4;
    rove.position.set(Math.sin(clock * 0.9 + 2) * 250, 150 + Math.sin(clock * 1.3) * 70, Math.cos(clock * 0.9 + 2) * 250);
    uplight.intensity = 2.4 + Math.sin(clock * 2.2) * 0.22;

    draw();
    raf = visible ? requestAnimationFrame(frame) : null;
  }

  /* Progress is the fraction of this section that has been scrolled through.
     A section taller than the viewport (a sticky/pinned hero) gives the build
     room to run. If the hero is only one screen tall there is no travel to
     measure, so fall back to the first two screens of page scroll — the build
     still runs rather than sitting frozen at zero. */
  var FALLBACK_TRAVEL = 2;
  function onScroll() {
    var r = section.getBoundingClientRect();
    var travel = r.height - window.innerHeight;
    if (travel > 40) {
      progress = Math.min(Math.max(-r.top / travel, 0), 1);
    } else {
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      progress = Math.min(Math.max(y / (window.innerHeight * FALLBACK_TRAVEL), 0), 1);
    }
  }

  window.addEventListener("resize", function () { resize(); onScroll(); });
  window.addEventListener("scroll", onScroll, { passive: true });

  new IntersectionObserver(function (entries) {
    visible = entries[0].isIntersecting;
    if (visible && !raf) { resize(); onScroll(); raf = requestAnimationFrame(frame); }
  }, { rootMargin: "120px" }).observe(section);

  resize(); onScroll(); apply(0.012); draw();
}
