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
  sky.width = 16; sky.height = 512;
  (function () {
    var g = sky.getContext("2d").createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0.00, C.skyTop);
    g.addColorStop(0.26, C.skyUpper);
    g.addColorStop(0.46, C.skyMid);
    g.addColorStop(0.60, C.skyWarm);
    g.addColorStop(0.71, C.skyGlow);
    g.addColorStop(0.80, C.skyHorizon);
    g.addColorStop(0.87, C.skyBand);
    g.addColorStop(0.93, "#5A4A44");
    g.addColorStop(1.00, "#221C1B");
    var c = sky.getContext("2d"); c.fillStyle = g; c.fillRect(0, 0, 16, 512);
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
  var beam = new THREE.BoxGeometry(1, 1, 1);
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
  var lampMat = new THREE.MeshBasicMaterial({ color: 0xF2D9A6 });
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

  /* ground, so the uplight has something to pool on */
  var ground = new THREE.Mesh(
    new THREE.CircleGeometry(2600, 64),
    new THREE.MeshStandardMaterial({ color: 0x101725, roughness: 0.97, metalness: 0.06, envMapIntensity: 0.14 })
  );
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.5; scene.add(ground);

  /* ═══ the site: Champ de Mars to the south, the Seine and
         Trocadéro to the north — the tower stands at the join ═══ */
  var MAT = {
    lawn:   new THREE.MeshStandardMaterial({ color: 0x33482B, roughness: .97, metalness: 0, envMapIntensity: .18 }),
    gravel: new THREE.MeshStandardMaterial({ color: 0x736C5E, roughness: .96, metalness: 0, envMapIntensity: .2 }),
    stone:  new THREE.MeshStandardMaterial({ color: 0x847C6C, roughness: .86, metalness: .05, envMapIntensity: .3 }),
    roof:   new THREE.MeshStandardMaterial({ color: 0x4A4E56, roughness: .7,  metalness: .3 }),
    hedge:  new THREE.MeshStandardMaterial({ color: 0x33482C, roughness: .95, metalness: 0 })
  };
  function slab(w, d, mat, x, y, z, ry) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, d), mat);
    m.position.set(x, y, z); if (ry) m.rotation.y = ry; scene.add(m); return m;
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
  var water = new THREE.Mesh(new THREE.PlaneGeometry(5200, 180),
    new THREE.MeshStandardMaterial({ color: 0x16304F, metalness: .96, roughness: .055, envMapIntensity: 2.0 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, 0.7, -300); scene.add(water);
  var quayMat = new THREE.MeshStandardMaterial({ color: 0x6F6a5C, roughness: .9, metalness: .05, envMapIntensity: .25 });
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
    var TREE_STEP = C.quality === "full" ? 26 : 44;
    for (z5 = 130; z5 < 1060; z5 += TREE_STEP) {
      [-232, -206, 206, 232].forEach(function (tx) { pts.push([tx + (Math.random()-.5)*5, z5 + (Math.random()-.5)*6]); });
    }
    for (i5 = 0; i5 < (C.quality === "full" ? 90 : 40); i5++) pts.push([(Math.random()-.5)*760, -430 - Math.random()*230]);
    for (i5 = 0; i5 < (C.quality === "full" ? 70 : 30); i5++) pts.push([(Math.random()<.5?-1:1)*(300+Math.random()*420), -140 - Math.random()*120]);

    var trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.1, 1.5, 11, 5),
                  new THREE.MeshStandardMaterial({ color: 0x54432F, roughness: .95 }), pts.length);
    var crown = new THREE.InstancedMesh(new THREE.SphereGeometry(8.5, 7, 6),
                  new THREE.MeshStandardMaterial({ color: 0x3C5730, roughness: .95, envMapIntensity: .3 }), pts.length);
    trunk.frustumCulled = false; crown.frustumCulled = false;
    var mm = new THREE.Matrix4(), qq = new THREE.Quaternion();
    pts.forEach(function (pt, i6) {
      var sc = 0.8 + Math.random() * 0.55;
      mm.compose(new THREE.Vector3(pt[0], 5.5 * sc, pt[1]), qq, new THREE.Vector3(sc, sc, sc));
      trunk.setMatrixAt(i6, mm);
      mm.compose(new THREE.Vector3(pt[0], (11 + 7) * sc, pt[1]), qq,
                 new THREE.Vector3(sc, sc * 0.86, sc));
      crown.setMatrixAt(i6, mm);
    });
    trunk.instanceMatrix.needsUpdate = true; crown.instanceMatrix.needsUpdate = true;
    scene.add(trunk); scene.add(crown);
  })();

  /* ── the city beyond: Haussmann blocks, and towers on the skyline ── */
  (function () {
    var spots = [], i8, ang8, rr;
    var CITY_N = C.quality === "full" ? 520 : 260;
    for (i8 = 0; i8 < CITY_N; i8++) {
      var side = Math.random();
      if (side < 0.55) {                                   /* across the river */
        spots.push([(Math.random() - .5) * 3400, -820 - Math.random() * 1500]);
      } else if (side < 0.8) {                              /* flanking the park */
        spots.push([(Math.random() < .5 ? -1 : 1) * (330 + Math.random() * 1300),
                    -100 + Math.random() * 1500]);
      } else {                                              /* along the near quay */
        spots.push([(Math.random() - .5) * 3200, -150 - Math.random() * 90]);
      }
    }
    var plain = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x5C5A52, roughness: .92, metalness: .05, envMapIntensity: .22 }),
      spots.length);
    var lit = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x494740, roughness: .8, metalness: .08,
        emissive: 0xFFC272, emissiveIntensity: 0.5 }), spots.length);
    plain.frustumCulled = false; lit.frustumCulled = false;
    var m8 = new THREE.Matrix4(), q8 = new THREE.Quaternion(), np = 0, nl = 0;
    spots.forEach(function (sp8) {
      var far = Math.abs(sp8[1]) > 900 || Math.abs(sp8[0]) > 900;
      var w8 = 48 + Math.random() * 46;
      var h8 = far && Math.random() < 0.06 ? 120 + Math.random() * 90 : 26 + Math.random() * 34;
      m8.compose(new THREE.Vector3(sp8[0], h8 / 2, sp8[1]),
                 new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), Math.random() * 0.5),
                 new THREE.Vector3(w8, h8, w8 * (0.75 + Math.random() * 0.6)));
      if (Math.random() < 0.3) lit.setMatrixAt(nl++, m8); else plain.setMatrixAt(np++, m8);
    });
    plain.count = np; lit.count = nl;
    plain.instanceMatrix.needsUpdate = true; lit.instanceMatrix.needsUpdate = true;
    scene.add(plain); scene.add(lit);
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, hgt, false);
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
    lighthouse.rotation.y = clock * 3.4;
    rove.position.set(Math.sin(clock * 0.9 + 2) * 250, 150 + Math.sin(clock * 1.3) * 70, Math.cos(clock * 0.9 + 2) * 250);
    uplight.intensity = 2.4 + Math.sin(clock * 2.2) * 0.22;

    renderer.render(scene, camera);
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

  resize(); onScroll(); apply(0.012); renderer.render(scene, camera);
}
