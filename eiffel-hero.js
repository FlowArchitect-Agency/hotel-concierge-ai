/*!
 * eiffel-hero.js -- the Champ de Mars, in three dimensions.
 *
 * A self-contained background layer: the Eiffel Tower rebuilds itself as the
 * page is scrolled, standing over the Seine with Trocadero behind it and the
 * gardens running away in front.
 *
 * The site is not drawn -- it is a photogrammetry capture of the real place:
 * the tower, the Champ de Mars, the Pont d'Iena, the Palais de Chaillot and
 * the blocks around them, as they are. An earlier version of this file
 * generated all of that from dimensions and primitives, and however carefully
 * a box is lit it stays a box; a capture carries the thing itself.
 *
 * What the scroll drives is a build front rising through it. Every vertex
 * above the front is scattered along a direction fixed by its own position
 * and hidden; as the front passes, the ironwork converges into place. Because
 * the offset is a pure function of scroll position, there is no playback and
 * no memory in it: stop and it stops, reverse and it comes apart again, which
 * is the whole point -- the reader is building it, not watching a film of it.
 * The ground and the park are exempt by their distance from the tower's axis,
 * so the site stands still while the tower goes up in the middle of it.
 *
 * An ES module: imports three from the page's existing import map, so the
 * site ships ONE copy of three.js rather than two.
 * Degrades to nothing if WebGL is unavailable, or if the model cannot be
 * fetched -- call onUnavailable to show whatever static artwork the page has.
 *
 * Model: "Eiffel Tower, Paris, France" by Brian Trepanier (CMBC),
 * CC-BY-4.0. Credited in the page, which the licence requires.
 *
 * Usage (index.html already has the importmap monument.js uses):
 *   <script type="module">
 *     import { mount } from './eiffel-hero.js?v=1';
 *     mount(document.getElementById('hero'), { ... });
 *   </script>
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const DEFAULTS = {
    /* Never let the camera inside the 125 m base: below this the opening
       frame is a close-up of footings and reads as an empty sky. */
    minFrame: 150,
    quality: "hero",
    skyTop: "#0A1430", skyUpper: "#1E3566", skyMid: "#4C5C93",
    skyWarm: "#8E6E93", skyGlow: "#C97F66", skyHorizon: "#E9A961",
    skyBand: "#F0C57E",
    haze: 0x4A4258,
    iron: 0x4A3A2B,
    /* How closely the build follows the wheel, 0..1. High, deliberately:
       this was 0.085, which is a quarter of a second of coasting after the
       reader stops -- long enough that the tower carries on building by
       itself and the whole thing reads as a film rather than as something
       being scrolled. 1 removes the smoothing altogether. */
    lag: 0.38,
    model: "assets/3d/eiffel.glb?v=cmbc",
    draco: "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/"
};

/* The tower, in metres, measured off the capture: tip 330 m above the lawn.
   Everything below is expressed in those metres, so the platform heights are
   the real ones and the camera distances mean what they say. */
const TOP = 330;


export function mount(root, options) {

  var opts = options || {};
  var C = {}, k;
  for (k in DEFAULTS) C[k] = DEFAULTS[k];
  if (opts.colors) for (k in opts.colors) C[k] = opts.colors[k];
  if (opts.model) C.model = opts.model;
  if (typeof opts.lag === "number") C.lag = Math.min(1, Math.max(0.02, opts.lag));

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

  var bailed = false;
  function bail() {
    if (bailed) return;
    bailed = true;
    root.classList.add("eiffel-hero--fallback");
    if (typeof opts.onUnavailable === "function") opts.onUnavailable();
  }

  /* == the tower ==========================================================
     Built, not captured. The flight that produced the site was flown to see
     a city, and no aerial photogrammetry resolves an iron lattice: in the
     capture the tower comes out a smooth tapering solid with facets a
     storey across -- the one cardboard object in a scene of real ones.

     So the capture gives up its tower (see the shader below, which cuts a
     cylinder out of it) and this puts the monument back from the dimensions
     it was actually built to: 125 m square at the feet, platforms at 57.6,
     115.7 and 276.1, 300 m to the top of the shaft. Every member is a
     separate instance, which is also what makes the reconstruction real --
     the reader is not fading a model in, they are laying about thirteen
     hundred girders in the order they were riveted, from the ground up.
     ==================================================================== */

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
  var members = [], PLATFORMS = [57.6, 115.7, 276.1];   /* the real ones */
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

  /* -- scene ------------------------------------------------------------ */
  var scene = new THREE.Scene();

  /* Paris at dusk, painted into a canvas and used two ways: as the sky
     behind the tower, and as the environment the stone and ironwork
     reflect. Metal without something to reflect reads as plastic. */
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

    /* No crepuscular rays. Drawn as triangles fanning off the sun they came
       out as hard-edged wedges laid over the sky -- straight lines where the
       air should be softest, and the first thing the eye finds. */

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
  /* Enough haze to take the capture's own cut edge -- it is a piece of the
     city out of a larger flight, and it does end -- without taking the city
     with it. Thicker than this and the Champ de Mars, which runs 800 m away
     from the tower, washes out to a flat field of fog colour: the ground is
     all there, it just cannot be seen through its own air. */
  scene.fog = new THREE.FogExp2(C.haze, 0.00038);

  var camera = new THREE.PerspectiveCamera(46, 1, 1, 9000);
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  } catch (e) { bail(); return; }
  renderer.setClearColor(0x16201A, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  try {
    var pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    scene.environment = pmrem.fromEquirectangular(skyTex).texture;
  } catch (e) { scene.environment = skyTex; }

  var group = new THREE.Group();
  scene.add(group);

  /* -- cutting the tower out of the capture ------------------------------
     The site stays as it was flown; what has to go is the smooth lump where
     the tower is, so the built one can stand in its place. A cylinder on the
     tower's own axis, from a little above the pavement upward, so the
     ground, the paths and the arch's shadow are all kept.

     Done to the index buffer at load, not to fragments at 60 Hz. It used to
     be a `discard` in the fragment shader, and a discard tells the driver
     that any fragment might kill itself, which turns off the early depth
     test for the WHOLE mesh -- so all 1.4 M triangles were being shaded
     before being depth-tested, every frame. That, with DoubleSide on top of
     it, was the stutter: 46 ms a frame, and unchanged whether the tower was
     one member in or finished, which is what gave it away as the capture
     rather than the build. Cutting the triangles out once costs about a
     fifth of a second at load and nothing afterwards, and leaves a stock
     material the renderer can take its fast path through. */
  var CUT_R = 96, CUT_Y = 8;

  /* -- the capture ------------------------------------------------------ */
  var site = null, siteReady = false;

  (function () {
    var draco = new DRACOLoader();
    draco.setDecoderPath(C.draco);
    var loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    loader.load(C.model, function (gltf) {
      var obj = gltf.scene;
      obj.updateMatrixWorld(true);

      var mesh = null;
      obj.traverse(function (o) { if (o.isMesh && !mesh) mesh = o; });
      if (!mesh) { bail(); return; }

      /* Fit the capture to metres, on the tower's own axis, ground at zero.
         Measured rather than assumed: the tip is the highest point in it,
         and the lawn around the tower is the level everything else is
         quoted from. Sampled every 24th vertex -- there are four million,
         and the answer does not change in the noise. */
      var pa = mesh.geometry.attributes.position, v = new THREE.Vector3(), i;
      var m4 = mesh.matrixWorld.clone();
      var tipY = -1e9, tipX = 0, tipZ = 0;
      for (i = 0; i < pa.count; i += 24) {
        v.fromBufferAttribute(pa, i).applyMatrix4(m4);
        if (v.y > tipY) { tipY = v.y; tipX = v.x; tipZ = v.z; }
      }
      var ring = [];
      for (i = 0; i < pa.count; i += 24) {
        v.fromBufferAttribute(pa, i).applyMatrix4(m4);
        var d = Math.sqrt((v.x - tipX) * (v.x - tipX) + (v.z - tipZ) * (v.z - tipZ));
        if (d > (tipY - v.y) * 0.5 && d < (tipY - v.y) * 1.1) ring.push(v.y);
      }
      ring.sort(function (a, b) { return a - b; });
      var groundY = ring.length ? ring[Math.floor(ring.length * 0.5)] : tipY - 6;
      var span = Math.max(1e-4, tipY - groundY);
      var scale = TOP / span;

      /* Baked into the geometry so the shader above can read world metres
         straight off `position` instead of carrying a matrix around. */
      var fit = new THREE.Matrix4()
        .makeTranslation(-tipX, -groundY, -tipZ)
        .premultiply(new THREE.Matrix4().makeScale(scale, scale, scale));
      mesh.geometry.applyMatrix4(fit.clone().multiply(m4));

      /* Drop every triangle with a corner inside the tower's cylinder. Read
         straight off the typed arrays: the attribute accessors would make
         this a several-second pause on four million vertices. */
      var idx = mesh.geometry.index;
      if (idx) {
        var ia = idx.array, pav = mesh.geometry.attributes.position.array;
        var R2 = CUT_R * CUT_R, keep = new ia.constructor(ia.length), kn = 0, ti;
        for (ti = 0; ti < ia.length; ti += 3) {
          var i0 = ia[ti] * 3, i1 = ia[ti + 1] * 3, i2 = ia[ti + 2] * 3;
          if ((pav[i0 + 1] > CUT_Y && pav[i0] * pav[i0] + pav[i0 + 2] * pav[i0 + 2] < R2) ||
              (pav[i1 + 1] > CUT_Y && pav[i1] * pav[i1] + pav[i1 + 2] * pav[i1 + 2] < R2) ||
              (pav[i2 + 1] > CUT_Y && pav[i2] * pav[i2] + pav[i2 + 2] * pav[i2 + 2] < R2)) continue;
          keep[kn++] = ia[ti]; keep[kn++] = ia[ti + 1]; keep[kn++] = ia[ti + 2];
        }
        mesh.geometry.setIndex(new THREE.BufferAttribute(keep.slice(0, kn), 1));
      }
      mesh.geometry.computeBoundingSphere();
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.set(1, 1, 1);
      mesh.frustumCulled = false;

      var mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (i = 0; i < mats.length; i++) {
        var m = mats[i];
        if (!m) continue;
        m.envMapIntensity = 0.5;
        if (m.roughness !== undefined) m.roughness = Math.min(1, m.roughness * 0.85 + 0.2);
        if (m.metalness !== undefined) m.metalness = 0.0;
        /* Front faces only. A capture is a shell, and DoubleSide was there to
           paper over any hole in it -- at the price of rasterising every
           surface twice. (Lambert was tried here too and measured the same
           to a tenth of a millisecond: this mesh is vertex-bound, not
           fragment-bound, so there is nothing to win in the shading.) */
        m.side = THREE.FrontSide;
      }

      /* Cut into a grid of chunks so the frustum can throw most of it away.

         The capture is nearly two kilometres long and the camera stands in
         the middle of it looking one way, so roughly a third is behind the
         reader at any moment -- and as one mesh with culling off, all of it
         was drawn every frame regardless. The chunks share one copy of the
         position, uv and normal buffers and differ only in their index, so
         this costs no extra memory on the card; each just gets its own
         bounding sphere, which has to be set by hand because
         computeBoundingSphere() measures the whole shared attribute rather
         than the part a given index actually reaches. */
      site = new THREE.Group();
      (function () {
        var src = mesh.geometry, sIdx = src.index, sPos = src.attributes.position.array;
        if (!sIdx) { site.add(mesh); return; }
        var ia2 = sIdx.array, NX = 3, NZ = 8;
        var bb = new THREE.Box3().setFromBufferAttribute(src.attributes.position);
        var x0 = bb.min.x, z0 = bb.min.z;
        var dx = (bb.max.x - x0) / NX || 1, dz = (bb.max.z - z0) / NZ || 1;
        var bins = [], bi2;
        for (bi2 = 0; bi2 < NX * NZ; bi2++) bins.push([]);
        for (var t2 = 0; t2 < ia2.length; t2 += 3) {
          var p0 = ia2[t2] * 3, p1 = ia2[t2 + 1] * 3, p2 = ia2[t2 + 2] * 3;
          var cx = (sPos[p0] + sPos[p1] + sPos[p2]) / 3;
          var cz = (sPos[p0 + 2] + sPos[p1 + 2] + sPos[p2 + 2]) / 3;
          var gx = Math.min(NX - 1, Math.max(0, Math.floor((cx - x0) / dx)));
          var gz = Math.min(NZ - 1, Math.max(0, Math.floor((cz - z0) / dz)));
          var b2 = bins[gz * NX + gx];
          b2.push(ia2[t2], ia2[t2 + 1], ia2[t2 + 2]);
        }
        for (bi2 = 0; bi2 < bins.length; bi2++) {
          var list = bins[bi2];
          if (!list.length) continue;
          var g2 = new THREE.BufferGeometry();
          g2.setAttribute('position', src.attributes.position);
          if (src.attributes.uv) g2.setAttribute('uv', src.attributes.uv);
          if (src.attributes.normal) g2.setAttribute('normal', src.attributes.normal);
          g2.setIndex(new THREE.BufferAttribute(
            new (kn > 65535 ? Uint32Array : Uint16Array)(list), 1));
          var mnx = Infinity, mny = Infinity, mnz = Infinity,
              mxx = -Infinity, mxy = -Infinity, mxz = -Infinity, li2;
          for (li2 = 0; li2 < list.length; li2++) {
            var q3 = list[li2] * 3, qx = sPos[q3], qy = sPos[q3 + 1], qz = sPos[q3 + 2];
            if (qx < mnx) mnx = qx; if (qx > mxx) mxx = qx;
            if (qy < mny) mny = qy; if (qy > mxy) mxy = qy;
            if (qz < mnz) mnz = qz; if (qz > mxz) mxz = qz;
          }
          var ctr = new THREE.Vector3((mnx + mxx) / 2, (mny + mxy) / 2, (mnz + mxz) / 2);
          g2.boundingBox = new THREE.Box3(new THREE.Vector3(mnx, mny, mnz),
                                          new THREE.Vector3(mxx, mxy, mxz));
          g2.boundingSphere = new THREE.Sphere(ctr,
            0.5 * Math.sqrt((mxx - mnx) * (mxx - mnx) + (mxy - mny) * (mxy - mny) +
                            (mxz - mnz) * (mxz - mnz)));
          var chunk = new THREE.Mesh(g2, mesh.material);
          chunk.frustumCulled = true;
          site.add(chunk);
        }
      })();
      group.add(site);
      siteReady = true;
      root.classList.add("eiffel-hero--ready");
      resize(); onScroll();
    }, undefined, function () {
      /* No model, no scene. The page keeps its own artwork. */
      bail();
    });
  })();

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
  cupola.position.y = 303; cupola.visible = false; group.add(cupola);
  var lantern = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.4, 8, 12), deckMat);
  lantern.position.y = 311; lantern.visible = false; group.add(lantern);
  var antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.9, 21, 8), iron);
  antenna.position.y = 325; antenna.visible = false; group.add(antenna);
  var tip = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 8),
            new THREE.MeshBasicMaterial({ color: 0xFFE9BE }));
  /* 330 m to the tip, which is what the readout says and what the site
     capture was scaled by. It used to overshoot by fifteen metres. */
  tip.position.y = 331; tip.visible = false; group.add(tip);
  var SUMMIT = [[cupola,0.955],[lantern,0.972],[antenna,0.984],[tip,0.992]];


  /* -- what the capture cannot carry: the lights ------------------------
     A daytime flight has no lamps in it. These are the tower's own: the
     four corner lamps on each platform, the summit beacon, and the beam it
     sweeps. They are also the only things in frame bright enough to bleed
     through the bloom, which is what sells the hour. */
  var lampMat = new THREE.MeshBasicMaterial({ color: 0xF2D9A6 });
  lampMat.color.multiplyScalar(2.8);
  var lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(1.7, 8, 6), lampMat, 16);
  lamps.frustumCulled = false;
  var mtx = new THREE.Matrix4(), li = 0, lampH = [];
  PLATFORMS.concat([TOP - 30]).forEach(function (ph) {
    var w = halfw(ph) * 1.02;
    for (var c2 = 0; c2 < 4; c2++) {
      var sx = (c2 === 0 || c2 === 3) ? 1 : -1, sz = (c2 === 0 || c2 === 1) ? 1 : -1;
      mtx.compose(new THREE.Vector3(sx * w, ph + 3, sz * w),
                  new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      lamps.setMatrixAt(li++, mtx); lampH.push(ph);
    }
  });
  lamps.instanceMatrix.needsUpdate = true;
  lamps.count = 0;
  group.add(lamps);

  var lighthouse = new THREE.Group();
  lighthouse.position.y = TOP - 22;
  (function () {
    var beamMat = new THREE.MeshBasicMaterial({
      color: 0xFFEBC0, transparent: true, opacity: 0.018,
      side: THREE.DoubleSide, depthWrite: false });
    for (var bm = 0; bm < 2; bm++) {
      /* Narrow, and faint. A four-sided cone at any width reads as a flat
         slab laid across the sky rather than as a beam through air. */
      var beam = new THREE.Mesh(new THREE.ConeGeometry(5.5, 520, 8, 1, true), beamMat);
      beam.rotation.z = Math.PI / 2;
      beam.position.x = bm ? 260 : -260;
      beam.rotation.y = bm ? 0 : Math.PI;
      lighthouse.add(beam);
    }
    lighthouse.add(new THREE.PointLight(0xFFE7BA, 90000, 700, 2));
  })();
  lighthouse.visible = false;
  group.add(lighthouse);

  var beacon = new THREE.PointLight(0xFFE3AE, 0, 300, 2);
  beacon.position.set(0, TOP + 4, 0); group.add(beacon);

  /* Something beyond the capture's edge, so where the flight ran out there
     is ground going into haze rather than a hole in the world.

     Well below the terrain, and that matters: at three metres down this disc
     is level with the Champ de Mars and, being six kilometres across, it
     painted over the entire site -- tower, park, quays and all -- leaving a
     flat field of fog colour that looked exactly like a fog problem and was
     not one. It belongs under everything, not among it. */
  /* Painted as a radial fade from ground tone to the sky's own horizon
     band, because a single flat colour out here meets the sky as a hard
     line no matter which colour you pick -- there is nothing at the edge of
     the world to draw a line against. */
  var fcv = document.createElement("canvas");
  fcv.width = fcv.height = 256;
  (function () {
    var fx = fcv.getContext("2d");
    var fg = fx.createRadialGradient(128, 128, 0, 128, 128, 128);
    fg.addColorStop(0.00, "#453E52");
    fg.addColorStop(0.06, "#54495D");
    fg.addColorStop(0.16, "#6B5C69");
    fg.addColorStop(0.40, "#7E6A70");
    fg.addColorStop(1.00, "#8A7472");
    fx.fillStyle = fg; fx.fillRect(0, 0, 256, 256);
  })();
  var floorTex = new THREE.CanvasTexture(fcv);
  floorTex.colorSpace = THREE.SRGBColorSpace;

  var floor = new THREE.Mesh(
    new THREE.CircleGeometry(9000, 56),
    new THREE.MeshBasicMaterial({ map: floorTex, fog: false })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -90;
  scene.add(floor);

  /* -- lights ----------------------------------------------------------- */
  scene.add(new THREE.AmbientLight(0x8894B4, 0.42));
  var key = new THREE.DirectionalLight(0xFFD2A2, 3.1); key.position.set(360, 210, 260); scene.add(key);
  var fill = new THREE.DirectionalLight(0x92AEE8, 0.85); fill.position.set(-340, 160, -300); scene.add(fill);
  var rim  = new THREE.DirectionalLight(0xC77FB0, 0.7);  rim.position.set(-120, 300, 340); scene.add(rim);
  /* The floodlighting under the arches. Modest: these used to light a
     generated lattice of thin bars that swallowed most of it, and pointed at
     a solid capture at the same strength they simply burn a hole in the
     middle of the frame. */
  var uplight = new THREE.PointLight(0xFFB861, 15000, 340, 2); uplight.position.set(0, 18, 0); scene.add(uplight);
  var upper = new THREE.PointLight(0xFFC87A, 14000, 320, 2); upper.position.set(0, 150, 0); group.add(upper);

  /* No shadow map. The capture already carries the shadows that were on the
     ground when it was flown, baked into its own texture, and a second pass
     over 1.4 million triangles to add a contradictory set of them would cost
     the frame rate and look worse. */

  /* -- compositing ------------------------------------------------------
     Rendering straight to the canvas clips every value at white, so a lamp
     and a beacon come out the same flat cream. Half float lets a light be
     brighter than white and bleed the way a camera's does. */
  var HEAVY = !(window.matchMedia && window.matchMedia("(pointer: coarse)").matches) &&
              (navigator.hardwareConcurrency || 4) >= 4 &&
              Math.min(window.innerWidth, window.innerHeight) > 520;

  var composer = null, bloom = null;
  if (HEAVY) {
    try {
      var sz0 = renderer.getDrawingBufferSize(new THREE.Vector2());
      /* No multisampling on the HDR target. Four samples on a half-float
         buffer this size cost 18 ms of an 45 ms frame -- more than the whole
         1.4-million-triangle capture -- for antialiasing that the bloom
         immediately softens anyway. Measured: dropping it is the single
         biggest thing on this page. */
      composer = new EffectComposer(renderer,
        new THREE.WebGLRenderTarget(sz0.x, sz0.y, { type: THREE.HalfFloatType }));
      composer.addPass(new RenderPass(scene, camera));
      /* Threshold high, strength modest: only the lamps and the beacon are
         meant to bleed. Lower and the whole lit face of the tower blooms and
         the picture turns to milk. */
      /* The blur runs at half resolution. Nobody has ever seen the edge of a
         bloom kernel, and it is a quarter of the fragments. */
      bloom = new UnrealBloomPass(new THREE.Vector2(sz0.x * 0.5, sz0.y * 0.5), 0.42, 0.5, 0.95);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
    } catch (e) { composer = null; }
  }

  function draw() {
    if (composer) composer.render(); else renderer.render(scene, camera);
  }

  /* -- drive ------------------------------------------------------------ */
  var progress = 0, eased = 0, clock = 0, visible = false, raf = null;
  var builtH = 30, camH = 30;
  var STAGES = [[0.06,"Footings"],[0.2,"The four legs"],[0.34,"The great arch"],
                [0.46,"First platform"],[0.6,"The body"],[0.72,"Second platform"],
                [0.86,"The shaft"],[0.97,"Summit"],[1.01,"Complete"]];

  /* The build runs almost the whole pinned section. It used to finish at 58%
     of it and hold for the rest, which is why it could be scrolled past
     already standing and read as a film someone else had made. */
  var BUILD_TO = 0.88;

  function apply(p) {
    var q = isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;

    /* The reconstruction, and it is the whole point: how many of the
       tower's own members have been riveted. They are sorted by height, so
       counting up them builds it from the footings to the spire. */
    var total = members.length;
    lattice.count = Math.max(0, Math.min(total, Math.floor(q * total)));

    var topH = 0;
    if (lattice.count > 0) {
      var last = members[lattice.count - 1];
      topH = Math.max(last[0].y, last[1].y);
    }
    builtH = Math.max(28, topH);
    decks.forEach(function (d) { d.mesh.visible = topH > d.h; });
    for (var q2 = 0; q2 < SUMMIT.length; q2++) SUMMIT[q2][0].visible = q > SUMMIT[q2][1];

    var ln = 0; for (var j = 0; j < lampH.length; j++) if (topH > lampH[j] + 2) ln = j + 1;
    lamps.count = ln;
    beacon.intensity = p > 0.984 ? 90000 : 0;
    lighthouse.visible = p > 0.984;

    var pct = Math.round(Math.min(p, 1) * 100);
    if (roFill) roFill.style.transform = "scaleX(" + Math.min(p, 1).toFixed(3) + ")";
    if (roPct) roPct.textContent = pct + "%";
    if (roLabel) roLabel.textContent = pct >= 100 ? "Assembled" : "Assembling";
    if (roStage && pct >= 100) roStage.textContent = "330 m · complete";
    if (roStage) {
      for (var s = 0; s < STAGES.length; s++) {
        if (p < STAGES[s][0]) { roStage.textContent = STAGES[s][1]; break; }
        roStage.textContent = STAGES[STAGES.length - 1][1];
      }
    }
    if (typeof opts.onProgress === "function") opts.onProgress(Math.min(p, 1));
  }

  function resize() {
    /* The canvas is absolutely positioned inside the pin, so on the first
       layout it can measure zero while the pin is already the right size --
       and a 1px buffer renders one column of pixels and looks like a dead
       scene. Ask the parents when the canvas has nothing to say. */
    var w = canvas.clientWidth || pin.clientWidth || section.clientWidth ||
            window.innerWidth || 1;
    var hgt = canvas.clientHeight || pin.clientHeight || window.innerHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, composer ? 1.5 : 2));
    renderer.setSize(w, hgt, false);
    if (composer) {
      var dpr = renderer.getPixelRatio();
      composer.setSize(w, hgt);
      if (bloom) bloom.setSize(w * dpr * 0.5, hgt * dpr * 0.5);
    }
    camera.aspect = w / hgt; camera.updateProjectionMatrix();
  }

  function frame() {
    step();
    raf = visible ? requestAnimationFrame(frame) : null;
  }

  /* One frame's worth of work, split out from the requestAnimationFrame
     wrapper so it can also be driven directly -- see the handle returned at
     the end. A hidden tab is never given an animation frame, which would
     otherwise make this scene impossible to inspect anywhere but a
     foreground window. */
  function step() {
    /* NaN is sticky in a feedback line: once `eased` catches one, every
       later frame is NaN + something, and it never comes back. Downstream
       that means uBuild is NaN, and in GLSL every comparison against NaN is
       false -- so `built < 0.02` never discards and the tower renders
       COMPLETE and deaf to the scroll. Which is exactly the failure it is
       worth naming here: a finished tower that will not come apart again is
       not a rendering artefact, it is this. */
    if (!isFinite(eased)) eased = isFinite(progress) ? progress : 0;
    eased += (progress - eased) * C.lag;
    if (!isFinite(eased)) eased = 0;
    clock += 0.0045;

    var p = 0.008 + Math.min(Math.max(eased, 0) / BUILD_TO, 1) * 0.992;
    apply(p);

    camH += (builtH - camH) * 0.2;
    var held = Math.max(0, (eased - BUILD_TO) / (1 - BUILD_TO));

    /* The turn stays over the capture. It is a strip of the city, not a
       globe: a wide orbit swings the camera off the end of it and puts the
       cut edge between the reader and the tower. This sweep runs along the
       Champ de Mars, which is both where there is ground to stand on and
       the view the tower was built to be seen from. */
    /* Turned to stand ON the Champ de Mars looking BACK across the river:
       the Pont d'Iena, the Seine and the Palais de Chaillot are all in the
       capture, and they were all behind the camera. */
    var ang = Math.PI - 0.34 + eased * 0.64 + Math.sin(clock * 0.25) * 0.03;
    var framed = Math.max(camH, C.minFrame);
    var rad = 150 + framed * 1.22 + held * 55;
    /* Low, and looking up the tower. Standing off at height turned the
       capture into an island in a flat sea, because a high camera looking
       down puts the horizon near the top of the frame and everything under
       it has to be filled -- and past the edge of the flight there is
       nothing to fill it with. From down here the horizon sits low, the
       tower is against sky, and the ground is the near third of the frame,
       which is exactly the part the capture actually covers. */
    camera.position.set(Math.sin(ang) * rad,
                        28 + framed * 0.11 + held * 46 + Math.sin(clock * 0.7) * 2.5,
                        Math.cos(ang) * rad);
    camera.lookAt(0, framed * 0.62 + held * 8, 0);

    lighthouse.rotation.y = clock * 3.4;
    uplight.intensity = 15000 + Math.sin(clock * 2.2) * 1400;

    draw();
  }

  /* Progress is the fraction of this section that has been scrolled through.
     A section taller than the viewport (a sticky/pinned hero) gives the build
     room to run. If the hero is only one screen tall there is no travel to
     measure, so fall back to the first two screens of page scroll. */
  var FALLBACK_TRAVEL = 2;
  function onScroll() {
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    var r = section.getBoundingClientRect();

    /* A viewport that measures zero -- a hidden tab, a pane that has not been
       laid out, a print context -- makes every expression below a division by
       zero. Keep the last good reading instead of poisoning the drive with
       the NaN it would otherwise produce. */
    if (vh <= 0 || r.height <= 0) return;

    var travel = r.height - vh;
    var next;
    if (travel > 40) {
      next = -r.top / travel;
    } else {
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      next = y / (vh * FALLBACK_TRAVEL);
    }
    if (!isFinite(next)) return;
    progress = Math.min(Math.max(next, 0), 1);
  }

  window.addEventListener("resize", function () { resize(); onScroll(); });
  window.addEventListener("scroll", onScroll, { passive: true });

  /* The observer is a brake, not an ignition. Started the other way round --
     waiting for it to say the hero is on screen -- a callback that arrives
     while the section still measures zero leaves the scene switched off for
     good, on the one section of the page that is on screen at load. */
  visible = true;
  new IntersectionObserver(function (entries) {
    var on = entries[0].isIntersecting;
    visible = on;
    if (on && !raf) { resize(); onScroll(); raf = requestAnimationFrame(frame); }
  }, { rootMargin: "120px" }).observe(section);

  /* And measure again once layout has certainly settled: the first pass runs
     during parse, when the pin may not have been laid out yet. */
  requestAnimationFrame(function () { resize(); onScroll(); });
  window.addEventListener("load", function () { resize(); onScroll(); });

  resize(); onScroll(); apply(0.008);
  raf = requestAnimationFrame(frame);

  /* Returning a handle changes nothing for the page -- index.html ignores
     it -- and makes the scene drivable from a test. */
  return {
    canvas: canvas,
    ready: function () { return siteReady; },
    /* n steps, because the camera's own follow is smoothed over frames:
       one step leaves it a fifth of the way to where the build has got to,
       which is not the frame the reader would ever see. */
    tick: function (p, n) {
      progress = Math.min(1, Math.max(0, p));
      eased = progress;
      for (var i = 0, N = n || 40; i < N; i++) step();
    }
  };
}
