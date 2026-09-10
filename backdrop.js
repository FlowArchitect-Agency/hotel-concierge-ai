/* ---------------------------------------------------------------------------
   backdrop.js -- the monument behind the middle of the page.

   The deck (sections that slide over one another like dealt cards) is a good
   trick that stops being a trick the fourth time you see it. It is kept for
   the two chapters that open the page; from there the page changes mechanic
   entirely: the sections go back to ordinary scrolling and travel across a
   monument standing behind them, seen through the glass the content sits on.

   Nothing here binds demo state, i18n or any handler. It is a decorative
   layer: if WebGL is missing, the model 404s, or anything throws, the page
   keeps its own solid backgrounds and reads exactly as it did before.

   Model: "Arc de Triomphe, Paris (with texture)" by HoangHiepVu,
   CC Attribution. Credited in the page, which the licence requires.
   ------------------------------------------------------------------------ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const RUN_SEL = '#night-operations, #human-handoff, #demo,' +
                '#operating-layer, #implementation, #control';

/* A handle on the running scene, so it can be driven and looked at without
   a scroll and without requestAnimationFrame -- which a hidden tab never
   delivers, and which would otherwise make this impossible to check from
   anywhere but a foreground window. Null until the scene starts. */
export let probe = null;

const host = document.querySelector('.backdrop');
const runs = Array.prototype.slice.call(document.querySelectorAll(RUN_SEL));

/* A phone gets none of this. The glass needs margins the monument can be seen
   in, and a 380px screen has none to give -- the pane would end up narrower
   than the words in it, with a full-screen WebGL layer and a 1.9 MB download
   paid for a sliver of stone down each side. The sections keep their solid
   backgrounds and the page reads as it always did. */
/* A width of zero is not a narrow screen, it is a screen that has not been
   measured yet -- a hidden tab, a pane before layout. Treating it as narrow
   switched the whole layer off permanently on a viewport that was about to
   turn out to be 1400px wide. Fall through to what the display says, and let
   the pointer test carry the actual phone case. */
const VW = innerWidth || document.documentElement.clientWidth || screen.width || 1280;
const ROOM = VW >= 760 && !matchMedia('(pointer: coarse)').matches;

if (host && runs.length && ROOM &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches) start();

function start() {
  const canvas = document.createElement('canvas');
  canvas.className = 'backdrop-canvas';

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (e) { return; }
  host.insertBefore(canvas, host.firstChild);

  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 12000);
  /* The place is a disc with an edge. Fog is what turns that edge into a
     city carrying on out of sight instead of the rim of a plate. */
  scene.fog = new THREE.FogExp2(0x1B2030, 0.00072);

  /* A dusk behind it, and reflected in it. This layer is seen through glass
     with a scrim over it, so it has to be brighter than a correct night:
     everything the reader actually sees has already been through two coats
     of translucency. */
  (function () {
    const cv = document.createElement('canvas');
    cv.width = 8; cv.height = 256;
    const c2 = cv.getContext('2d');
    const g2 = c2.createLinearGradient(0, 0, 0, 256);
    g2.addColorStop(0.00, '#0B1026');
    g2.addColorStop(0.42, '#1B2440');
    g2.addColorStop(0.66, '#3B3350');
    g2.addColorStop(0.80, '#6B4A52');
    g2.addColorStop(0.90, '#9A6448');
    g2.addColorStop(1.00, '#241C22');
    c2.fillStyle = g2; c2.fillRect(0, 0, 8, 256);
    const t2 = new THREE.CanvasTexture(cv);
    t2.mapping = THREE.EquirectangularReflectionMapping;
    t2.colorSpace = THREE.SRGBColorSpace;
    scene.background = t2;
    scene.environment = t2;
  })();

  /* Dusk, so the stone sits in the same hour as the Champ de Mars in the hero
     rather than reading as a second, unrelated photograph. */
  scene.add(new THREE.HemisphereLight(0x9FB4D8, 0x3A3226, 1.55));
  const key = new THREE.DirectionalLight(0xFFD9A6, 2.9);
  key.position.set(-90, 105, 70); scene.add(key);
  const rim = new THREE.DirectionalLight(0x8FA8DE, 1.15);
  rim.position.set(110, 55, -95); scene.add(rim);
  /* A warm bounce off the ground, which is what actually reads as evening on
     carved stone: the undersides of the cornices pick it up. */
  const bounce = new THREE.DirectionalLight(0xFFB271, 0.6);
  bounce.position.set(20, -60, 40); scene.add(bounce);
  /* The Arc is floodlit off its own pavement every night of the year, and
     without that it sits in the middle of a lit roundabout as the one dark
     object in the frame. */
  const floodA = new THREE.PointLight(0xFFCE93, 1, 0, 2);
  const floodB = new THREE.PointLight(0xFFCE93, 1, 0, 2);
  /* On the scene, not the pivot: the pivot is declared further down, and
     since the turn became the camera's the two are equivalent anyway. */
  scene.add(floodA); scene.add(floodB);

  const pivot = new THREE.Group();
  scene.add(pivot);

  let ready = false, radius = 60;

  /* The stone assembles out of its own vertices, the way the cathedral two
     sections earlier does: each is pushed along a direction fixed by its own
     position, by an amount the scroll controls, so the Arc gathers itself as
     the run begins instead of simply being there. One uniform, and it is a
     pure function of scroll -- reverse and it comes apart again. */
  const uAssemble = { value: 0 };
  const uReach    = { value: 40 };

  const PREAMBLE = [
    'uniform float uAssemble;',
    'uniform float uReach;',
    'float h31(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }'
  ].join('\n');

  const DISPERSE = [
    '#include <begin_vertex>',
    'float rr = h31(floor(position * 0.35));',
    'vec3 dir = normalize(vec3(h31(position.yzx) - 0.5,',
    '                          h31(position.zxy) - 0.5,',
    '                          h31(position.xyz) - 0.5) + 1e-4);',
    'transformed += dir * pow(1.0 - uAssemble, 1.7) * uReach * (0.12 + rr * 0.34);'
  ].join('\n');

  function patchStone(mat) {
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uAssemble = uAssemble;
      sh.uniforms.uReach = uReach;
      sh.vertexShader = PREAMBLE + '\n' +
        sh.vertexShader.replace('#include <begin_vertex>', DISPERSE);
    };
    mat.needsUpdate = true;
  }

  const draco = new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  loader.load('assets/3d/arc.glb', function (gltf) {
    /* Photogrammetry ships Z-up: the capture software's convention, not
       three's. Straight in, the Arc lies on its back and you scroll past the
       underside of its vault. The wrapper stands it up, and everything below
       measures the wrapper so the framing is done in world axes. */
    const model = new THREE.Group();
    model.rotation.x = -Math.PI / 2;
    model.add(gltf.scene);

    const frame = new THREE.Group();
    frame.add(model);

    /* Centre it on its own footprint and scale to a known radius, so the
       framing below does not depend on whatever units the model shipped in. */
    let box = new THREE.Box3().setFromObject(frame);
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z) || 1;
    frame.scale.setScalar(100 / span);

    box = new THREE.Box3().setFromObject(frame);
    const mid = box.getCenter(new THREE.Vector3());
    frame.position.sub(mid);
    /* Sit it on its base rather than its centre: a monument floating at eye
       height with its plinth in mid-air is the tell of a model dropped in. */
    box = new THREE.Box3().setFromObject(frame);
    /* On the ground exactly: there is a road surface under it now, and a
       monument hovering a few metres over its own pavement is the one thing
       that gives a dropped-in model away. */
    frame.position.y -= box.min.y;

    radius = box.getSize(new THREE.Vector3()).length() * 0.5;
    uReach.value = radius * 0.45;
    /* Placed off the fitted size, so they light the arch and not the sky. */
    const fl = radius * 0.5, fh = radius * 0.17;
    floodA.position.set(fl, fh, fl * 0.7);
    floodB.position.set(-fl, fh, -fl * 0.7);
    floodA.distance = floodB.distance = radius * 2.8;
    floodA.intensity = floodB.intensity = radius * radius * 0.72;
    etoile(box.getSize(new THREE.Vector3()).y);

    frame.traverse(function (o) {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const m = o.material;
      if (m && m.isMeshStandardMaterial) {
        m.roughness = Math.min(1, (m.roughness ?? 1) * 0.9 + 0.12);
        m.metalness = 0;
        m.envMapIntensity = 0.4;
        /* The capture baked scraps of Paris sky into the stone -- cold blue
           flecks scattered over the reliefs. The base colour multiplies the
           map, so a warm sandstone tint mutes them towards the rest of the
           carving instead of leaving them reading as damage. */
        m.color.setHex(0xC9AE8C);
        patchStone(m);
      }
    });

    pivot.add(frame);
    ready = true;
    host.classList.add('is-ready');
    /* The glass in the stylesheet is gated on this class, so the run only
       gives up its solid backgrounds once there is genuinely something behind
       them to look at. Set here rather than at parse time on purpose: a 404,
       a decode failure or a missing WebGL context all leave the page with the
       backgrounds it was designed with instead of six transparent sections
       over nothing. */
    document.documentElement.classList.add('has-backdrop');
    resize(); onScroll();
  }, undefined, function () { /* no model, no backdrop; the page is unchanged */ });

  /* ── the Place Charles de Gaulle ───────────────────────────────────────
     The capture is the monument and nothing else: it stops at a torn edge a
     few metres above the pavement, and an Arc de Triomphe with no place
     round it is a model on a shelf. What makes the Etoile recognisable is
     not the arch, it is the ring of traffic and the twelve avenues going off
     it, so that is what gets built -- in the plainest geometry that will
     carry a headlight, because it is seen through glass at a distance and
     what registers is the moving light, not the coachwork. */
  let cars = null, carN = 0, placeR = 300;
  const lanes = [];

  /* A block of flat colour is the one thing that makes a city read as
     scenery. Windows are what it needs, and at this distance -- behind
     glass, past a roundabout -- a grid of lit and unlit panes is all that
     registers, so that is all this draws. */
  function facadeTex(floors, bays, lit) {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const x = cv.getContext('2d');
    x.fillStyle = '#000000'; x.fillRect(0, 0, 128, 128);
    const fh = 128 / floors, bw = 128 / bays;
    for (let f = 0; f < floors; f++) {
      for (let b = 0; b < bays; b++) {
        if (Math.random() > lit) continue;
        const warm = Math.random();
        x.fillStyle = warm < 0.16 ? '#8FB6D8' : (warm < 0.6 ? '#FFC26B' : '#FFE0AC');
        x.globalAlpha = 0.5 + Math.random() * 0.5;
        x.fillRect(b * bw + bw * 0.28, f * fh + fh * 0.24, bw * 0.44, fh * 0.44);
      }
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    return t;
  }

  function etoile(archH) {
    /* Everything is quoted off the Arc's own height, so it stays in
       proportion whatever the model measures. The real arch is 50 m and the
       ring it stands in is about 120 m across. */
    const U = archH / 50;
    const RING = 120 * U, AVE = 640 * U, N_AVE = 12;
    /* What the camera has to be framed on. The arch is 50 m and the circle
       it stands in is 240 m across, so a distance quoted off the monument
       alone puts the camera inside the roundabout looking at rubble. */
    placeR = RING * 2.5;

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(AVE * 1.5, 64),
      new THREE.MeshStandardMaterial({ color: 0x24242B, roughness: 0.95, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.2 * U;
    pivot.add(ground);

    const tarmac = new THREE.MeshStandardMaterial({
      color: 0x35363E, roughness: 0.66, metalness: 0.08, envMapIntensity: 0.6 });

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(RING * 0.74, RING * 1.16, 96), tarmac);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.4 * U;
    pivot.add(ring);

    /* Twelve avenues. It is the only city in the world that is instantly
       identifiable from a plan, and this is why. */
    for (let a = 0; a < N_AVE; a++) {
      const th = (a / N_AVE) * Math.PI * 2 + 0.13;
      const road = new THREE.Mesh(new THREE.PlaneGeometry(56 * U, AVE), tarmac);
      road.rotation.x = -Math.PI / 2;
      road.rotation.z = -th;
      road.position.set(Math.sin(th) * (RING + AVE / 2), 0.4 * U, Math.cos(th) * (RING + AVE / 2));
      pivot.add(road);

      /* The blocks between them: Haussmann's wedges, closing the circle.
         Six storeys, which is the height the whole quarter was built to and
         the reason the Arc still stands over it. */
      const bth = th + Math.PI / N_AVE;
      for (let d = 0; d < 5; d++) {
        const rr = RING * 1.42 + d * 76 * U;
        const bh = (19 + Math.random() * 5) * U;
        const blk = new THREE.Mesh(
          new THREE.BoxGeometry((44 + Math.random() * 16) * U, bh, (36 + Math.random() * 14) * U),
          new THREE.MeshStandardMaterial({
            color: 0x3A3A42, roughness: 0.92, metalness: 0.03,
            emissive: 0xFFFFFF, emissiveIntensity: 0.9,
            emissiveMap: facadeTex(6, 7, 0.22 + Math.random() * 0.24) })
        );
        blk.position.set(Math.sin(bth) * rr + (Math.random() - 0.5) * 30 * U,
                         bh / 2,
                         Math.cos(bth) * rr + (Math.random() - 0.5) * 30 * U);
        blk.rotation.y = -bth + (Math.random() - 0.5) * 0.2;
        pivot.add(blk);
        /* zinc on top, at the angle every roof in the quarter is at */
        const roof = new THREE.Mesh(
          new THREE.CylinderGeometry(0.62, 1, 1, 4, 1),
          new THREE.MeshStandardMaterial({ color: 0x363B45, roughness: 0.6, metalness: 0.45 })
        );
        const rh = 3.4 * U;
        roof.scale.set(30 * U, rh, 25 * U);
        roof.rotation.y = Math.PI / 4;
        roof.position.set(blk.position.x, bh + rh / 2, blk.position.z);
        pivot.add(roof);
      }

      /* Two streams of traffic down every avenue, and one round the ring. */
      lanes.push({ kind: 'ave', th: th, off: -13 * U, dir: 1, r0: RING * 1.05, len: AVE });
      lanes.push({ kind: 'ave', th: th, off: 13 * U, dir: -1, r0: RING * 1.05, len: AVE });
    }
    lanes.push({ kind: 'ring', r: RING * 0.84, dir: 1 });
    lanes.push({ kind: 'ring', r: RING * 1.02, dir: -1 });

    /* Cars: two instanced meshes, one for the bodies and one for the lamps,
       because the lamp material has to be unlit and above white to bleed. */
    /* What you actually see of traffic at this distance and this hour is
       the lamps. The body is there to occlude them from behind and to catch
       a little of the streetlight, and it is deliberately small and dark:
       at the size a car is on this screen, an accurate one reads as a brick. */
    carN = 230;
    const body = new THREE.MeshStandardMaterial({ color: 0x15161B, roughness: 0.36, metalness: 0.6 });
    const lampM = new THREE.MeshBasicMaterial({ color: 0xFFE7C2 });
    lampM.color.multiplyScalar(3.4);
    const tailM = new THREE.MeshBasicMaterial({ color: 0xFF3A18 });
    tailM.color.multiplyScalar(2.8);

    cars = {
      body: new THREE.InstancedMesh(new THREE.BoxGeometry(2.4 * U, 1.7 * U, 5.4 * U), body, carN),
      head: new THREE.InstancedMesh(new THREE.BoxGeometry(1.9 * U, 0.42 * U, 0.4 * U), lampM, carN),
      tail: new THREE.InstancedMesh(new THREE.BoxGeometry(1.9 * U, 0.38 * U, 0.4 * U), tailM, carN),
      U: U, seed: []
    };
    for (const key of ['body', 'head', 'tail']) {
      cars[key].frustumCulled = false;
      pivot.add(cars[key]);
    }
    for (let i = 0; i < carN; i++) {
      cars.seed.push({
        lane: lanes[Math.floor(Math.random() * lanes.length)],
        t: Math.random(),
        sp: 0.045 + Math.random() * 0.05
      });
    }
  }

  const cm = new THREE.Matrix4(), cq = new THREE.Quaternion(),
        cp = new THREE.Vector3(), cs = new THREE.Vector3(1, 1, 1),
        CUP = new THREE.Vector3(0, 1, 0);

  function driveCars(t) {
    if (!cars) return;
    const U = cars.U;
    for (let i = 0; i < carN; i++) {
      const c = cars.seed[i], L = c.lane;
      let x, z, head;
      const u = (c.t + t * c.sp) % 1;
      if (L.kind === 'ring') {
        const a = u * Math.PI * 2 * L.dir;
        x = Math.sin(a) * L.r; z = Math.cos(a) * L.r;
        head = a + (L.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      } else {
        const d = L.r0 + u * L.len * (L.dir > 0 ? 1 : 1);
        const r = L.dir > 0 ? d : (L.r0 + L.len) - (d - L.r0);
        x = Math.sin(L.th) * r + Math.cos(L.th) * L.off;
        z = Math.cos(L.th) * r - Math.sin(L.th) * L.off;
        head = L.th + (L.dir > 0 ? 0 : Math.PI);
      }
      cq.setFromAxisAngle(CUP, head);
      cp.set(x, 1.0 * U, z);
      cm.compose(cp, cq, cs);
      cars.body.setMatrixAt(i, cm);
      cp.set(x + Math.sin(head) * 2.8 * U, 1.0 * U, z + Math.cos(head) * 2.8 * U);
      cm.compose(cp, cq, cs);
      cars.head.setMatrixAt(i, cm);
      cp.set(x - Math.sin(head) * 2.8 * U, 1.1 * U, z - Math.cos(head) * 2.8 * U);
      cm.compose(cp, cq, cs);
      cars.tail.setMatrixAt(i, cm);
    }
    cars.body.instanceMatrix.needsUpdate = true;
    cars.head.instanceMatrix.needsUpdate = true;
    cars.tail.instanceMatrix.needsUpdate = true;
  }

  /* ── the reader drives it ──────────────────────────────────────────────
     Progress is measured across the whole run of sections rather than any
     one of them, so the monument turns once, slowly, through the middle of
     the page instead of restarting at every heading. Everything below is a
     pure function of that number: no timers, no easing state, no memory --
     scroll back up and it winds back exactly the way it came. */
  let p = 0, eased = 0, raf = null, seen = false, clock = 0;

  /* A full turn, and it starts overhead. Straight down on the Etoile is the
     one view that explains the place -- twelve avenues and a ring of light --
     and it descends to street level through the middle of the run, which is
     also where the reader has the most to read and wants the least going on
     behind it. Equal scroll per leg, so the distance between stops is how
     long each attitude holds the screen. */
  const STOPS = [
    { az: 0.00, el: 1.16, dist: 1.90 },   /* overhead: the star */
    { az: 0.95, el: 0.76, dist: 1.52 },
    { az: 1.90, el: 0.44, dist: 1.06 },
    { az: 2.85, el: 0.21, dist: 0.74 },   /* down among the avenues */
    { az: 3.80, el: 0.13, dist: 0.63 },
    { az: 4.75, el: 0.23, dist: 0.79 },
    { az: 5.60, el: 0.46, dist: 1.16 },
    { az: 6.28, el: 0.72, dist: 1.62 }    /* rising away, one full turn */
  ];
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  function onScroll() {
    const vh = innerHeight || document.documentElement.clientHeight || 0;
    if (vh <= 0) return;              /* a zero viewport makes every ratio NaN */

    const first = runs[0].getBoundingClientRect();
    const last  = runs[runs.length - 1].getBoundingClientRect();
    const top   = first.top + scrollY;
    const end   = last.top + scrollY + last.offsetHeight;
    const travel = (end - top - vh) || 1;
    const next = (scrollY - top + vh * 0.85) / travel;
    if (!isFinite(next)) return;
    p = Math.min(Math.max(next, 0), 1);

    /* Only paint while some part of the run is actually on screen. */
    const on = first.top < vh && last.bottom > 0;
    host.classList.toggle('is-live', on);
    if (on && !raf) raf = requestAnimationFrame(frame);
    if (on && !seen) { seen = true; eased = p; }
  }

  function frame() {
    raf = null;
    if (!ready) { raf = requestAnimationFrame(frame); return; }
    step();
    if (host.classList.contains('is-live')) raf = requestAnimationFrame(frame);
  }

  function step() {

    /* Close enough to the hand to feel driven. It was 0.12, which coasts on
       for the better part of a second after the reader stops -- long enough
       that the turn reads as a clip playing rather than as something being
       scrolled. */
    if (!isFinite(eased)) eased = isFinite(p) ? p : 0;
    eased += (p - eased) * 0.34;
    if (!isFinite(eased)) eased = 0;
    clock += 0.016;

    /* The stone gathers over the first fifth of the run and holds. */
    uAssemble.value = Math.min(1, eased / 0.22);

    /* Between waypoints, eased so the camera settles into each attitude
       rather than sweeping through it at constant speed. */
    const legs = STOPS.length - 1;
    const f = Math.min(0.9999, Math.max(0, eased)) * legs;
    const i = Math.floor(f), k = easeInOut(f - i);
    const A = STOPS[i], B = STOPS[i + 1];
    const az = lerp(A.az, B.az, k),
          el = lerp(A.el, B.el, k),
          ds = lerp(A.dist, B.dist, k) * placeR * 0.86;

    /* The turn is the camera's, not the model's: spinning the pivot instead
       would take the avenues and the traffic round with it, and the place
       would rotate under its own cars. */
    camera.position.set(Math.sin(az) * Math.cos(el) * ds,
                        Math.sin(el) * ds + radius * 0.14,
                        Math.cos(az) * Math.cos(el) * ds);
    camera.lookAt(0, radius * 0.28, 0);

    /* Traffic runs on its own clock. Everything else here answers the wheel,
       but a city that stops moving the moment the reader stops reading is a
       photograph, and the whole point of the light down those avenues is
       that it is going somewhere. */
    driveCars(clock);

    renderer.render(scene, camera);
  }

  function resize() {
    const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', function () { resize(); onScroll(); });
  resize(); onScroll();

  probe = {
    canvas: canvas,
    ready: function () { return ready; },
    tick: function (v, n) {
      p = Math.min(1, Math.max(0, v));
      eased = p;
      if (!ready) return false;
      for (let i = 0, N = n || 30; i < N; i++) step();
      return true;
    }
  };
}
