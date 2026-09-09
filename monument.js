/* ---------------------------------------------------------------------------
   Notre-Dame, reconstructed on scroll -- the chapter 03 opener.

   The cathedral assembles out of its own vertices: they scatter into space and
   converge into solid stone as you scroll, then the camera turns a full circle.

   This replaced a crowdsourced photogrammetry scan. The scan had real
   photographed stone, but its coverage followed where tourists stood -- the apse
   was torn open and the south flank was a dark guess -- so a full turn had to
   dodge its own gaps. This model is built rather than scanned: complete and
   equally sharp from every angle, and a third of the file size.

   Model: "NOTRE DAME DE PARIS" by Arquitecto Tecnico Luis Alberto Galdames
   Marquez, CC-BY-4.0. Credited in the page, which the licence requires.

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
  renderer.toneMappingExposure = 1.0;
  renderer.localClippingEnabled = true;

  // The scan carries the ground it was standing on: a slab of the Ile de la Cite
  // that reads as a lump of terrain rather than architecture. It is fused into
  // the same continuous mesh, so it cannot be hidden as a separate object --
  // this plane cuts it away at the cathedral's footing instead.
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  scene.add(new THREE.HemisphereLight(0xdff0ff, 0xb9ad93, 1.15));
  const key = new THREE.DirectionalLight(0xfff4e2, 1.7);
  key.position.set(-70, 120, 90);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbdd8f0, 0.75);
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

  // Orientation is a property of the file, not something to guess at. This is a
  // hand-built model exported Y-up, so it stands correctly as loaded. The
  // photogrammetry scan it replaced was Z-up (RealityCapture's convention) and
  // needed a quarter turn about X, or it stood on its west front.
  const MODEL = { url: 'assets/3d/notredame.glb?v=galdames', uprightX: 0 };

  let model = null, points = null, radius = 45;

  // A full turn, starting and ending on the west front. Coverage in a
  // crowdsourced model follows where people stood: the west front and the north
  // elevation are sharp, the south side is a dark, sparse guess -- so that
  // segment spans the most azimuth per pixel of scroll and sits further back.
  // Segments get equal scroll, so azimuth per segment is how long a face holds
  // the screen. The sharp arc is spent slowly and the sparse one is whipped past
  // from above, where the copper roof reads instead of the unlit south wall.
  const TURN = Math.PI * 2;
  const AZ0  = 4.71;                 // the west front, head on
  // An even turn. The model this replaced was a photogrammetry scan whose
  // coverage followed where tourists stood, so the waypoints had to hurry past
  // the sides nobody photographed. This one is built rather than scanned and is
  // equally good from every angle, so the camera can simply go round.
  const STOPS = [
    { az: AZ0,        el: 0.06, dist: 2.20 },  // the west front
    { az: AZ0 + 0.90, el: 0.10, dist: 2.10 },
    { az: AZ0 + 1.80, el: 0.13, dist: 2.10 },
    { az: AZ0 + 2.70, el: 0.15, dist: 2.16 },  // the flank, fleche and buttresses
    { az: AZ0 + 3.60, el: 0.13, dist: 2.10 },  // the chevet
    { az: AZ0 + 4.50, el: 0.10, dist: 2.10 },
    { az: AZ0 + 5.40, el: 0.08, dist: 2.10 },
    { az: AZ0 + TURN, el: 0.06, dist: 2.20 }   // the west front again: one full turn
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

  // Wrap the model so the wrapper stays axis-aligned for centring whatever
  // rotation the file needs to stand upright.
  function stand(obj){
    const g = new THREE.Group();
    obj.rotation.x = MODEL.uprightX;
    g.add(obj);
    return g;
  }

  // Where does the ground stop and the building start? The terrain slab is a
  // block sampled around the cathedral, so it is noticeably longer and wider
  // than the building standing on it. Walking up from the bottom, the first
  // height at which the footprint contracts is the footing.
  function groundLevel(meshes, box){
    const N = 64, lo = box.min.y, span = box.max.y - lo, step = span / N;
    const reach = new Float32Array(N);
    const v = new THREE.Vector3();
    for (const o of meshes){
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i += 3){
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        const b = Math.min(N - 1, Math.max(0, Math.floor((v.y - lo) / step)));
        const r = Math.max(Math.abs(v.x - box.min.x), Math.abs(v.x - box.max.x),
                           Math.abs(v.z - box.min.z), Math.abs(v.z - box.max.z));
        if (r > reach[b]) reach[b] = r;
      }
    }
    let widest = 0;
    for (let i = 0; i < N; i++) widest = Math.max(widest, reach[i]);
    let i = 0;
    while (i < N && reach[i] >= widest * 0.95) i++;
    // nothing contracted -- the scan is all building, so keep every bit of it
    if (i >= N) return box.min.y - 1;
    return lo + i * step + span * 0.02;   // clear of the footing, not into it
  }

  function load(){
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    loader.load(MODEL.url, (gltf)=>{
      model = stand(gltf.scene);
      model.updateMatrixWorld(true);

      const meshes = [];
      model.traverse(o=>{ if (o.isMesh) meshes.push(o); });

      const full = new THREE.Box3().setFromObject(model);
      const cut = groundLevel(meshes, full);

      // A mesh lying entirely under the cut is ground, not building. Drop it
      // rather than leaving it to the clipping plane: the plane tests the
      // dispersed position, so during assembly scattered ground rises above the
      // cut and shows as a slab drifting behind the cathedral. The plane still
      // handles geometry that straddles the line.
      for (let i = meshes.length - 1; i >= 0; i--){
        if (new THREE.Box3().setFromObject(meshes[i]).max.y <= cut){
          meshes[i].removeFromParent();
          meshes.splice(i, 1);
        }
      }

      // Centre and frame on what survives the cut, not on the whole scan --
      // otherwise the removed slab still pulls the camera down and back.
      const kept = new THREE.Box3();
      const keptCloud = [];
      const v = new THREE.Vector3();
      for (const o of meshes){
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i++){
          v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
          if (v.y < cut) continue;
          kept.expandByPoint(v);
          // every other vertex again, as the cloud shown while dispersed
          if (i % 2 === 0) keptCloud.push(p.getX(i), p.getY(i), p.getZ(i));
        }
      }
      const centre = kept.getCenter(new THREE.Vector3());
      // Frame on the bounding sphere, not the longest edge: the nave is nearly
      // twice the height, and the longest edge pushes the camera much too far back.
      radius = kept.getBoundingSphere(new THREE.Sphere()).radius;
      uniforms.uRadius.value = radius;
      // Models arrive in whatever units their author worked in -- this one is
      // ~130x the scale of the scan it replaced. Derive the clip planes from the
      // subject rather than hardcoding them, or the camera sits beyond `far` and
      // the whole cathedral is clipped away to nothing.
      camera.near = radius * 0.02;
      camera.far  = radius * 24;
      camera.updateProjectionMatrix();
      model.position.sub(centre);
      ground.constant = -(cut - centre.y);   // the plane lives in world space

      for (const o of meshes){
        o.material.side = THREE.DoubleSide;
        o.material.clippingPlanes = [ground];
        patch(o.material);
      }

      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(keptCloud, 3));
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

    const solid = cur.assemble;
    uniforms.uAssemble.value = solid;
    for (const o of [model, points]){
      if (!o || !o.traverse) continue;
      o.traverse(n=>{
        const sh = n.material && n.material.userData && n.material.userData.shader;
        if (sh) sh.uniforms.uAssemble.value = solid;
      });
    }
    if (points) points.material.opacity = Math.max(0, 1 - solid * 1.25);
    model.visible = solid > 0.04;

    // a portrait viewport sees far less width, so pull back to keep the nave in
    const fit = camera.aspect < 1 ? 1.55 : camera.aspect < 1.5 ? 1.2 : 1;
    const d = radius * cur.dist * fit;
    AIM.set(0, 0, 0);
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
