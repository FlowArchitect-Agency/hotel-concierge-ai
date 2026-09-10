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
const PLATFORMS = [57.6, 115.7, 276.1];


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

  /* -- the tower's plan, kept only to hang lights on ---------------------
     The geometry is the capture's now. This profile survives because the
     lamps, the summit beacon and its sweeping beam have to sit at the right
     radius for the height they are at, and reading that back off a fused
     1.4-million-triangle mesh is far more trouble than the seven numbers the
     tower was actually built to. */
  var HS = [0, 8, 18, 30, 42, 57.6, 72, 90, 115.7, 145, 180, 215, 250, 276.1, 292, 300],
      WS = [62.5, 55.8, 48.2, 41.6, 36.4, 31.2, 27.8, 24.0, 20.1, 16.4, 12.9, 10.1, 7.9, 6.4, 5.4, 4.9];
  function halfw(h) {
    if (h <= HS[0]) return WS[0];
    if (h >= HS[HS.length - 1]) return WS[WS.length - 1];
    for (var i = 1; i < HS.length; i++) {
      if (h <= HS[i]) {
        var t = (h - HS[i - 1]) / (HS[i] - HS[i - 1]);
        t = t * t * (3 - 2 * t);
        return WS[i - 1] + (WS[i] - WS[i - 1]) * t;
      }
    }
    return WS[WS.length - 1];
  }

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

  /* -- the build front --------------------------------------------------
     One uniform, uBuild, running 0 to 1, and everything the scroll does to
     the tower comes out of it. No timeline, no tween state: give it the same
     number twice and you get the same frame twice. */
  var uBuild   = { value: 0 },
      uBand    = { value: 74 },     /* how deep the band of flying iron is  */
      uScatter = { value: 27 },     /* how far a piece flies before landing */
      uClear   = { value: 72 },     /* the tower's own footprint, in plan   */
      uSite    = { value: 150 };    /* beyond this, ground: never disperses */

  var PREAMBLE = [
    'uniform float uBuild;',
    'uniform float uBand;',
    'uniform float uScatter;',
    'uniform float uClear;',
    'uniform float uSite;',
    'varying float vBuilt;',
    'float h31(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }'
  ].join('\n');

  /* Positions are baked into world metres at load, so this reads plainly:
     how high is this vertex, how far from the tower's axis, and has the
     front got here yet. */
  var DISPERSE = [
    '#include <begin_vertex>',
    'float dAxis = length(position.xz);',
    /* the park, the river, the far blocks: always standing */
    'float site  = smoothstep(uClear, uSite, dAxis);',
    'float front = uBuild * (' + TOP + '.0 + uBand);',
    'float rise  = clamp((front - position.y) / uBand, 0.0, 1.0);',
    /* A second exemption, and between them they say "the tower, and only
       the tower". Distance from the axis covers the park, the river, the
       quays and the far blocks. Height covers the ground directly beneath
       it: without this the lawn flies apart along with the ironwork
       standing on it, because the front has to start at zero. */
    'float low   = 1.0 - smoothstep(1.5, 8.0, position.y);',
    'float built = clamp(max(max(site, low), rise), 0.0, 1.0);',
    'vBuilt = built;',
    'vec3 dir = normalize(vec3(h31(position.yzx) - 0.5,',
    '                          h31(position.zxy) - 0.5,',
    '                          h31(position.xyz) - 0.5) + 1e-4);',
    'transformed += dir * pow(1.0 - built, 1.7) * uScatter;'
  ].join('\n');

  /* Discarded rather than blended: a million triangles of half-transparent
     ironwork cannot be depth-sorted, and pieces snapping in one at a time is
     closer to how the thing was actually put together anyway. */
  var FRAG_PRE = 'varying float vBuilt;';
  var FRAG_CUT = [
    'if (vBuilt < 0.02) discard;',
    '#include <dithering_fragment>'
  ].join('\n');

  function patch(mat) {
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uBuild = uBuild;
      sh.uniforms.uBand = uBand;
      sh.uniforms.uScatter = uScatter;
      sh.uniforms.uClear = uClear;
      sh.uniforms.uSite = uSite;
      sh.vertexShader = PREAMBLE + '\n' +
        sh.vertexShader.replace('#include <begin_vertex>', DISPERSE);
      sh.fragmentShader = FRAG_PRE + '\n' +
        sh.fragmentShader.replace('#include <dithering_fragment>', FRAG_CUT);
    };
    mat.needsUpdate = true;
  }

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
        m.side = THREE.DoubleSide;   /* a capture is a shell; it has holes */
        patch(m);
      }

      site = mesh;
      group.add(mesh);
      siteReady = true;
      root.classList.add("eiffel-hero--ready");
      resize(); onScroll();
    }, undefined, function () {
      /* No model, no scene. The page keeps its own artwork. */
      bail();
    });
  })();

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
  lighthouse.position.y = TOP - 8;
  (function () {
    var beamMat = new THREE.MeshBasicMaterial({
      color: 0xFFEBC0, transparent: true, opacity: 0.05,
      side: THREE.DoubleSide, depthWrite: false });
    for (var bm = 0; bm < 2; bm++) {
      var beam = new THREE.Mesh(new THREE.ConeGeometry(16, 640, 4, 1, true), beamMat);
      beam.rotation.z = Math.PI / 2;
      beam.position.x = bm ? 320 : -320;
      beam.rotation.y = bm ? 0 : Math.PI;
      lighthouse.add(beam);
    }
    lighthouse.add(new THREE.PointLight(0xFFE7BA, 90000, 700, 2));
  })();
  lighthouse.visible = false;
  group.add(lighthouse);

  var beacon = new THREE.PointLight(0xFFE3AE, 0, 300, 2);
  beacon.position.set(0, TOP + 12, 0); group.add(beacon);

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
      composer = new EffectComposer(renderer,
        new THREE.WebGLRenderTarget(sz0.x, sz0.y, { type: THREE.HalfFloatType, samples: 4 }));
      composer.addPass(new RenderPass(scene, camera));
      /* Threshold high, strength modest: only the lamps and the beacon are
         meant to bleed. Lower and the whole lit face of the tower blooms and
         the picture turns to milk. */
      bloom = new UnrealBloomPass(new THREE.Vector2(sz0.x, sz0.y), 0.42, 0.5, 0.95);
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
    /* Belt and braces: the shader must never be handed a NaN, because a
       NaN there does not read as zero, it reads as "built". */
    uBuild.value = isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;

    var topH = uBuild.value * TOP;
    builtH = Math.max(28, topH);

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
      if (bloom) bloom.setSize(w * dpr, hgt * dpr);
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
    var ang = -0.32 + eased * 0.62 + Math.sin(clock * 0.25) * 0.03;
    var framed = Math.max(camH, C.minFrame);
    var rad = 155 + framed * 1.16 + held * 60;
    camera.position.set(Math.sin(ang) * rad,
                        34 + framed * 0.30 + held * 70 + Math.sin(clock * 0.7) * 3,
                        Math.cos(ang) * rad);
    camera.lookAt(0, framed * 0.48 - held * 14, 0);

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
