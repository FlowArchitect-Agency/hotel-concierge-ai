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

const host = document.querySelector('.backdrop');
const runs = Array.prototype.slice.call(document.querySelectorAll(RUN_SEL));

/* A phone gets none of this. The glass needs margins the monument can be seen
   in, and a 380px screen has none to give -- the pane would end up narrower
   than the words in it, with a full-screen WebGL layer and a 1.9 MB download
   paid for a sliver of stone down each side. The sections keep their solid
   backgrounds and the page reads as it always did. */
const ROOM = Math.min(innerWidth, screen.width || innerWidth) >= 760 &&
             !matchMedia('(pointer: coarse)').matches;

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
  renderer.toneMappingExposure = 0.95;

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 6000);

  /* Dusk, so the stone sits in the same hour as the Champ de Mars in the hero
     rather than reading as a second, unrelated photograph. */
  scene.add(new THREE.HemisphereLight(0x9FB4D8, 0x2A2418, 1.05));
  const key = new THREE.DirectionalLight(0xFFD9A6, 2.35);
  key.position.set(-90, 105, 70); scene.add(key);
  const rim = new THREE.DirectionalLight(0x8FA8DE, 1.15);
  rim.position.set(110, 55, -95); scene.add(rim);
  /* A warm bounce off the ground, which is what actually reads as evening on
     carved stone: the undersides of the cornices pick it up. */
  const bounce = new THREE.DirectionalLight(0xFFB271, 0.6);
  bounce.position.set(20, -60, 40); scene.add(bounce);

  const pivot = new THREE.Group();
  scene.add(pivot);

  let ready = false, radius = 60;

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
    /* Low in the frame on purpose: the content sits over the middle of the
       screen, so the half of the monument worth seeing is the half above it. */
    frame.position.y -= box.min.y * 0.1;

    radius = box.getSize(new THREE.Vector3()).length() * 0.5;

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
  let p = 0, eased = 0, raf = null, seen = false;

  function onScroll() {
    const first = runs[0].getBoundingClientRect();
    const last  = runs[runs.length - 1].getBoundingClientRect();
    const vh    = innerHeight;
    const top   = first.top + scrollY;
    const end   = last.top + scrollY + last.offsetHeight;
    const travel = (end - top - vh) || 1;
    p = Math.min(Math.max((scrollY - top + vh * 0.85) / travel, 0), 1);

    /* Only paint while some part of the run is actually on screen. */
    const on = first.top < vh && last.bottom > 0;
    host.classList.toggle('is-live', on);
    if (on && !raf) raf = requestAnimationFrame(frame);
    if (on && !seen) { seen = true; eased = p; }
  }

  function frame() {
    raf = null;
    if (!ready) { raf = requestAnimationFrame(frame); return; }

    /* A little lag, and only a little: enough that the stone feels heavy,
       not so much that it stops answering the hand on the wheel. */
    eased += (p - eased) * 0.12;

    /* Three quarters of a turn across the run, tipped a little as it goes, so
       it is never twice in the same attitude behind two different sections. */
    pivot.rotation.y = -0.62 + eased * 2.3;
    pivot.rotation.x = 0.02 - eased * 0.07;

    /* Far enough back that the whole monument is in frame with air around it:
       the content sits over the middle of the screen, so anything framed to
       fill the viewport is seen only as two slivers down the sides. It comes
       towards you across the run, which is what makes it read as depth behind
       the glass rather than wallpaper printed on it. */
    const dist = radius * (4.5 - eased * 1.15);
    camera.position.set(0, radius * (0.42 - eased * 0.2), dist);
    camera.lookAt(0, radius * 0.1, 0);

    renderer.render(scene, camera);
    if (host.classList.contains('is-live')) raf = requestAnimationFrame(frame);
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
}
