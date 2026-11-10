// Renderer, lighting, post-processing and camera control shared by every scene.
// One unit = one metre. Post chain: render -> GTAO -> bloom (gentle) -> output (tone map + sRGB) -> SMAA.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

export class Stage {
  constructor(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;   // keeps safety reds red; AgX pushed them to salmon
    r.toneMappingExposure = 0.95;
    r.localClippingEnabled = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.02, 2000);
    this.camera.position.set(3.2, 2.2, 3.6);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 400;
    this.controls.target.set(0, 1.4, 0);

    // studio environment for reflections: neutral, soft. Intensity is set per material (~0.5 on big surfaces).
    const pmrem = new THREE.PMREMGenerator(r);
    this.envStudio = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envStudio;
    this.scene.background = new THREE.Color('#16202a');
    this.scene.fog = new THREE.Fog('#16202a', 7, 30);   // the floor dissolves into the background: no horizon edge

    this._buildLights();

    const composer = this.composer = new EffectComposer(r);
    this.renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(this.renderPass);
    this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.0, scale: 1.2, samples: 16 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    this.gtao.blendIntensity = 0.85;
    composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.18, 0.5, 0.92);  // gentle: bloom eats detail
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.smaa = new SMAAPass(1, 1);
    composer.addPass(this.smaa);

    this.clock = new THREE.Clock();
    this.updaters = new Set();
    this.frameTimes = [];
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  _buildLights() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight('#dfe8f2', '#3a342c', 0.35);
    s.add(this.hemi);
    // key: warm, high, casting the only hard shadow
    const key = this.key = new THREE.DirectionalLight('#fff1dc', 2.6);
    key.position.set(5, 9, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(4096, 4096);
    const sc = key.shadow.camera; sc.left = -4; sc.right = 4; sc.top = 6; sc.bottom = -2; sc.near = 1; sc.far = 30;
    key.shadow.bias = -0.0002; key.shadow.normalBias = 0.02; key.shadow.radius = 3;
    s.add(key, key.target);
    // fill: cool, opposite side, no shadow
    const fill = new THREE.DirectionalLight('#cfe0ff', 0.6);
    fill.position.set(-6, 3, 2);
    s.add(fill);
    // rim: the one accent, from behind, picks out silhouettes and bevels
    const rim = this.rim = new THREE.DirectionalLight('#9fd4ff', 1.4);
    rim.position.set(-2, 5, -7);
    s.add(rim);
  }

  // Scene scale preset: fog range, shadow box and key-light position for objects of a given size (metres or units).
  configure({ size = 4, fog = true } = {}) {
    const k = this.key, sc = k.shadow.camera, h = size * 0.75;
    sc.left = -h; sc.right = h; sc.top = h; sc.bottom = -h; sc.near = 0.5; sc.far = size * 6;
    k.position.set(size * 0.9, size * 1.8, size * 0.75); k.target.position.set(0, 0, 0);
    sc.updateProjectionMatrix();
    if (fog && this.scene.fog) { this.scene.fog.near = size * 2.5; this.scene.fog.far = size * 9; } else if (!fog) this.scene.fog = null;
    this.controls.maxDistance = size * 8;
  }

  // ground that catches shadows and grounds the object: a soft studio floor
  addStudioFloor({ radius = 200, color = '#1f2830' } = {}) {
    const g = new THREE.CircleGeometry(radius, 96);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, envMapIntensity: 0.3 });
    const floor = new THREE.Mesh(g, m);
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.scene.add(floor);
    return floor;
  }

  // Clipping planes must also reach GTAO's normal material, or the cut half returns as a pale ghost.
  setClipping(planes) {
    this.scene.traverse(o => {
      if (!o.isMesh || !o.material) return;
      for (const m of [].concat(o.material)) { m.clippingPlanes = planes; m.clipShadows = true; m.needsUpdate = true; }
    });
    if (this.gtao.normalMaterial) { this.gtao.normalMaterial.clippingPlanes = planes; this.gtao.normalMaterial.needsUpdate = true; }
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
  }

  onUpdate(fn) { this.updaters.add(fn); return () => this.updaters.delete(fn); }

  start() {
    const loop = () => {
      const raw = this.clock.getDelta();
      const dt = Math.min(raw, 0.05);
      this.controls.update();
      for (const fn of this.updaters) fn(dt, this.clock.elapsedTime);
      this.composer.render(dt);
      this.frameTimes.push(raw * 1000);   // wall time between frames, so fps() reflects GPU-bound rate too
      if (this.frameTimes.length > 120) this.frameTimes.shift();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  fps() {
    if (!this.frameTimes.length) return 0;
    return 1000 / (this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length);
  }

  // smooth camera move between presets
  flyTo(pos, target, seconds = 1.2) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) seconds = 0.001;   // jump, don't fly
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    const p1 = new THREE.Vector3(...pos), t1 = new THREE.Vector3(...target);
    let t = 0;
    const off = this.onUpdate((dt) => {
      t = Math.min(1, t + dt / seconds);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.position.lerpVectors(p0, p1, e);
      this.controls.target.lerpVectors(t0, t1, e);
      if (t >= 1) off();
    });
  }
}
