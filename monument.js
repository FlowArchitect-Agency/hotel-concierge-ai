/* ---------------------------------------------------------------------------
   Notre-Dame, reconstructed on scroll -- the chapter 03 opener.

   Uses the crowdsourced photogrammetry mesh rather than built geometry: hand-
   made axis-aligned boxes cannot describe Gothic architecture, which is arches,
   tracery and spires.

   The mesh is one continuous scanned surface with no separable parts, so doors
   and windows cannot fly in independently. What a single mesh does support is
   assembling the whole thing out of its own points: 63k vertices scatter into
   space and converge into solid stone. It suits the subject twice over -- the
   model was itself reconstructed from thousands of photographs, of a building
   that was being rebuilt.

   Self-contained: touches nothing in script.js and binds no demo state.
   ------------------------------------------------------------------------ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const stage  = document.getElementById('handoff-monument');
const canvas = document.getElementById('monument-canvas');
if (stage && canvas) start();

function start(){
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 4000);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;

  scene.add(new THREE.HemisphereLight(0xdff0ff, 0xb9ad93, 2.0));
  const key = new THREE.DirectionalLight(0xfff4e2, 3.0);
  key.position.set(-70, 120, 90);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbdd8f0, 1.3);
  rim.position.set(90, 40, -80);
  scene.add(rim);

  // Each vertex is pushed out along a stable pseudo-random direction by an
  // amount the scroll controls, so the building disperses and re-forms without
  // needing separable parts.
  const uniforms = { uAssemble: { value: 0 }, uRadius: { value: 45 } };

  const PREAMBLE = [
    'uniform float uAssemble;',
    'uniform float uRadius;',
    'float h31(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }'
  ].join('\n');

  const DISPERSE = [
    '#include <begin_vertex>',
    'float rr = h31(floor(position * 0.35));',
    'vec3 dir = normalize(vec3(h31(position.yzx)-0.5, h31(position.zxy)-0.5, h31(position.xyz)-0.5) + 1e-4);',
    'float amt = pow(1.0 - uAssemble, 1.7) * uRadius * (0.10 + rr * 0.30);',
    'transformed += dir * amt;'
  ].join('\n');

  function patch(mat){
    mat.onBeforeCompile = (sh)=>{
      sh.uniforms.uAssemble = uniforms.uAssemble;
      sh.uniforms.uRadius = uniforms.uRadius;
      sh.vertexShader = PREAMBLE + '\n' +
        sh.vertexShader.replace('#include <begin_vertex>', DISPERSE);
      mat.userData.shader = sh;
    };
    mat.needsUpdate = true;
  }

  let model = null, points = null, radius = 45;

  // A full turn, starting and ending on the west front. Coverage in a
  // crowdsourced model follows where people stood: the west front and the north
  // elevation are sharp, the south side is a dark, sparse guess -- so that
  // segment spans the most azimuth per pixel of scroll and sits further back.
  // Segments get equal scroll, so azimuth per segment is how long a face holds
  // the screen. The sharp arc is spent slowly and the sparse one is whipped past
  // from above, where the copper roof reads instead of the unlit south wall.
  const TURN = Math.PI * 2;
  const AZ0  = 3.28;
  const STOPS = [
    { az: AZ0,        el: 0.06, dist: 2.34 },  // the west front
    { az: AZ0 + 0.50, el: 0.10, dist: 2.26 },  // north-west three-quarter
    { az: AZ0 + 1.00, el: 0.13, dist: 2.26 },  // the north elevation
    { az: AZ0 + 1.52, el: 0.15, dist: 2.30 },  // fleche and flying buttresses
    { az: AZ0 + 2.57, el: 0.13, dist: 2.26 },  // past the north transept
    { az: AZ0 + 3.62, el: 0.11, dist: 2.26 },  // the chevet
    { az: AZ0 + 4.72, el: 0.30, dist: 2.62 },  // lifting over the sparse south side
    { az: AZ0 + TURN, el: 0.06, dist: 2.34 }   // the west front again: one full turn
  ];

  const lerp = (a,b,t)=>a+(b-a)*t;
  const easeInOut = t => t<.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2;

  const target = { az: STOPS[0].az, el: STOPS[0].el, dist: STOPS[0].dist, assemble: 0 };
  const cur = Object.assign({}, target);

  function onScroll(){
    const r = stage.getBoundingClientRect();
    const span = r.height - innerHeight;
    const p = Math.min(1, Math.max(0, -r.top / (span || 1)));

    target.assemble = Math.min(1, p / 0.16);   // solid early, then it turns

    const n = STOPS.length - 1;
    const seg = Math.min(n - 1, Math.floor(p * n));
    const local = easeInOut(Math.min(1, Math.max(0, p * n - seg)));
    const a = STOPS[seg], b = STOPS[seg+1];
    target.az   = lerp(a.az,   b.az,   local);
    target.el   = lerp(a.el,   b.el,   local);
    target.dist = lerp(a.dist, b.dist, local);

    stage.classList.toggle('is-assembled', p > 0.13);
  }

  function resize(){
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = renderer.getPixelRatio();
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)){
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  // The scan is Z-up with the building's 128m length running along Y -- the
  // RealityCapture export convention. three.js is Y-up, so untouched it stands
  // on its west front with the nave pointing at the sky. Rotate it onto its
  // feet inside a wrapper, so the wrapper stays axis-aligned for centring.
  function stand(obj){
    const g = new THREE.Group();
    obj.rotation.x = -Math.PI / 2;
    g.add(obj);
    return g;
  }

  function load(){
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    loader.load('assets/3d/notredame.glb', (gltf)=>{
      model = stand(gltf.scene);
      const box = new THREE.Box3().setFromObject(model);
      const centre = box.getCenter(new THREE.Vector3());
      // Frame on the bounding sphere, not the longest edge: the nave is nearly
      // twice the height, and the longest edge pushes the camera much too far back.
      radius = box.getBoundingSphere(new THREE.Sphere()).radius;
      uniforms.uRadius.value = radius;
      model.position.sub(centre);

      const pos = [];
      model.traverse(o=>{
        if (!o.isMesh) return;
        o.material.side = THREE.DoubleSide;
        patch(o.material);
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i += 2) pos.push(p.getX(i), p.getY(i), p.getZ(i));
      });

      // the same vertices as a drifting point cloud, shown while dispersed
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      points = new THREE.Points(g, new THREE.PointsMaterial({
        color: 0x8a7f66, size: radius * 0.0042,
        transparent: true, opacity: 0, depthWrite: false }));
      patch(points.material);
      const cloud = stand(points);
      cloud.position.copy(model.position);
      scene.add(cloud);
      scene.add(model);

      stage.classList.add('is-ready');
      onScroll();
      Object.assign(cur, target);
    }, null, ()=>{ stage.classList.add('is-failed'); });
  }

  const DIR = new THREE.Vector3(), RIGHT = new THREE.Vector3(), AIM = new THREE.Vector3();
  let last = performance.now();
  let visible = false;

  function frame(now){
    requestAnimationFrame(frame);
    const t = now || performance.now();
    // Time-based smoothing, not per-frame: a throttled or low frame rate must
    // not change how long the assembly takes to settle.
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    if (!visible || !model) return;

    resize();
    const k = reduce ? 1 : 1 - Math.exp(-4.7 * dt);
    cur.az   = lerp(cur.az,   target.az,   k);
    cur.el   = lerp(cur.el,   target.el,   k);
    cur.dist = lerp(cur.dist, target.dist, k);
    cur.assemble = lerp(cur.assemble, target.assemble, k);

    uniforms.uAssemble.value = cur.assemble;
    for (const o of [model, points]){
      if (!o || !o.traverse) continue;
      o.traverse(n=>{
        const sh = n.material && n.material.userData && n.material.userData.shader;
        if (sh) sh.uniforms.uAssemble.value = cur.assemble;
      });
    }
    if (points) points.material.opacity = Math.max(0, 1 - cur.assemble * 1.25);
    model.visible = cur.assemble > 0.04;

    // a portrait viewport sees far less width, so pull back to keep the nave in
    const fit = camera.aspect < 1 ? 1.55 : camera.aspect < 1.5 ? 1.2 : 1;
    const d = radius * cur.dist * fit;
    // aim a little under the centre so the island the cathedral stands on has
    // room at the bottom of the frame rather than running off it
    AIM.set(0, -radius * 0.07, 0);
    camera.position.set(
      Math.sin(cur.az) * Math.cos(cur.el) * d,
      Math.sin(cur.el) * d + radius * 0.06,
      Math.cos(cur.az) * Math.cos(cur.el) * d);
    camera.lookAt(AIM);

    // The caption lives in the left gutter on wide screens, so slide the whole
    // view sideways to clear it -- moving the camera and its aim by the same
    // vector translates the image without changing the angle we chose.
    if (camera.aspect >= 1.5){
      RIGHT.crossVectors(camera.getWorldDirection(DIR), camera.up)
           .normalize().multiplyScalar(-radius * 0.34);
      camera.position.add(RIGHT);
      camera.lookAt(AIM.add(RIGHT));
    }
    renderer.render(scene, camera);
  }

  // don't spend 1.6MB or a render loop on a section nobody has scrolled near
  new IntersectionObserver((entries)=>{
    for (const e of entries){
      visible = e.isIntersecting;
      if (visible && !model) load();
    }
  }, { rootMargin: '300px 0px' }).observe(stage);

  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  addEventListener('visibilitychange', ()=>{
    last = performance.now();
    if (!document.hidden){ onScroll(); Object.assign(cur, target); }
  });
  onScroll();
  requestAnimationFrame(frame);
}
