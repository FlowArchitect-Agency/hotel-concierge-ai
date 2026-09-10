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

/* The run begins AFTER the cathedral, not before it. Night operations used
   to be part of it, which put one slide of arch in front of the Notre-Dame
   stage: the turn started, the cathedral took the screen for five thousand
   pixels, and the turn resumed on the other side. One monument interrupting
   another. Now the cathedral has the page to itself and hands over to the
   arch, which then turns without a break to the end. */
const RUN_SEL = '#human-handoff, #demo, #operating-layer,' +
                '#implementation, #control';

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
  renderer.toneMappingExposure = 1.0;

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 12000);
  /* The place is a disc with an edge. Fog is what turns that edge into a
     city carrying on out of sight instead of the rim of a plate. */
  /* Daylight, and no sky of its own. The canvas is transparent and the page
     paints the sky behind it -- the same arrangement the cathedral uses,
     which is why that one sits in the page instead of being a dark window
     cut into it. The fog went with the night: there is nothing left at the
     edge of the world to hide, because the world is now one monument on
     clean ground. */
  const envCv = document.createElement('canvas');
  envCv.width = 8; envCv.height = 128;
  (function () {
    const c2 = envCv.getContext('2d');
    const g2 = c2.createLinearGradient(0, 0, 0, 128);
    g2.addColorStop(0.00, '#8FB3D8');
    g2.addColorStop(0.42, '#BFD3E2');
    g2.addColorStop(0.68, '#E7E2D6');
    g2.addColorStop(1.00, '#C8BCA6');
    c2.fillStyle = g2; c2.fillRect(0, 0, 8, 128);
  })();
  const envTex = new THREE.CanvasTexture(envCv);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  envTex.colorSpace = THREE.SRGBColorSpace;
  scene.environment = envTex;

  /* Overcast-afternoon light on limestone: a broad sky term doing most of
     the work, one sun for the modelling, and a bounce off the pavement so
     the undersides of the cornices are not black. Carved stone wants soft
     light -- it is the shadow inside the relief that reads, and a hard key
     flattens it. */
  scene.add(new THREE.HemisphereLight(0xDCEBFF, 0xBBAE97, 2.7));
  const key = new THREE.DirectionalLight(0xFFF6E4, 2.1);
  key.position.set(-120, 150, 110); scene.add(key);
  const rim = new THREE.DirectionalLight(0xCFE0F5, 0.95);
  rim.position.set(140, 70, -120); scene.add(rim);
  const bounce = new THREE.DirectionalLight(0xEFE6D4, 0.5);
  bounce.position.set(20, -80, 40); scene.add(bounce);

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
        m.color.setHex(0xDCCFB8);
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
  /* One full revolution across the run, close enough that the arch fills
     the frame behind the panes. Nearly level: the reliefs are on the piers
     and only read from something like eye height, and a camera that climbs
     to look down at a monument turns it into a map of itself. */
  const STOPS = [
    { az: 0.00, el: 0.30, dist: 2.30 },   /* the east face, from the Champs */
    { az: 0.90, el: 0.21, dist: 2.14 },
    { az: 1.80, el: 0.14, dist: 2.02 },   /* along the flank, nearly level */
    { az: 2.70, el: 0.19, dist: 2.08 },
    { az: 3.60, el: 0.29, dist: 2.22 },   /* the west face */
    { az: 4.50, el: 0.21, dist: 2.08 },
    { az: 5.40, el: 0.15, dist: 2.02 },
    { az: 6.28, el: 0.30, dist: 2.30 }    /* back where it began: one turn */
  ];
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  /* Progress is measured across the six sections THEMSELVES, added together,
     rather than across the distance from the first to the last.

     Two reasons, and the second one is the whole bug. The Notre-Dame stage
     sits inside that distance and is over five thousand pixels of opaque
     section: measured end to end, a third of the turn was spent behind it,
     unseen. Adding the sections up instead means the arch turns while a
     slide is on screen and waits while the cathedral has it, so the
     revolution maps onto the slides -- which is what it is for.

     And the reason it was turning once at the top and then standing still
     for the rest of the page: the old version took getBoundingClientRect()
     and then asked the RECT for offsetHeight. A DOMRect has no such
     property, so the end of the run was NaN, and `(NaN) || 1` -- NaN being
     falsy -- quietly made the whole run one pixel long. Every scroll after
     the first landed at progress 1. The `|| 1` read like a divide-by-zero
     guard and was actually swallowing a typo, so nothing ever complained. */
  function onScroll() {
    const vh = innerHeight || document.documentElement.clientHeight || 0;
    if (vh <= 0) return;              /* a zero viewport makes every ratio NaN */

    let total = 0, acc = 0, done = false;
    const eye = scrollY + vh * 0.5;
    let firstTop = Infinity, lastBottom = -Infinity;

    for (const el of runs) {
      const r = el.getBoundingClientRect();
      const a = r.top + scrollY, b = r.bottom + scrollY, h = b - a;
      if (h <= 0) continue;
      total += h;
      firstTop = Math.min(firstTop, r.top);
      lastBottom = Math.max(lastBottom, r.bottom);
      if (done) continue;
      if (eye >= b) acc += h;
      else if (eye > a) { acc += eye - a; done = true; }
      else done = true;
    }

    if (total > 0) {
      const next = acc / total;
      if (isFinite(next)) p = Math.min(Math.max(next, 0), 1);
    }

    /* Only paint while some part of the run is actually on screen. */
    const on = firstTop < vh && lastBottom > 0;
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
    /* Mostly linear between waypoints. Full ease-in-out at every stop made
       the camera settle eight separate times across the run, and a turn
       that keeps stopping does not read as a turn at all -- it reads as
       eight different shots. This keeps a little of the settle and lets the
       rest run at rate, so it is always visibly going round. */
    const legs = STOPS.length - 1;
    const f = Math.min(0.9999, Math.max(0, eased)) * legs;
    const i = Math.floor(f), t0 = f - i;
    const k = t0 * 0.68 + easeInOut(t0) * 0.32;
    const A = STOPS[i], B = STOPS[i + 1];
    const az = lerp(A.az, B.az, k),
          el = lerp(A.el, B.el, k),
          ds = lerp(A.dist, B.dist, k) * radius;

    /* The turn is the camera's, not the model's: spinning the pivot instead
       would take the avenues and the traffic round with it, and the place
       would rotate under its own cars. */
    camera.position.set(Math.sin(az) * Math.cos(el) * ds,
                        Math.sin(el) * ds + radius * 0.16,
                        Math.cos(az) * Math.cos(el) * ds);
    camera.lookAt(0, radius * 0.52, 0);


    draw();
  }

  /* No compositing. The bloom existed to make headlights bleed, and there
     are no headlights any more -- in daylight it only lifts the highlights
     off the stone and lays a haze over the carving. */
  function draw() { renderer.render(scene, camera); }

  function resize() {
    const w = host.clientWidth || innerWidth || 1280;
    const h = host.clientHeight || innerHeight || 800;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
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
