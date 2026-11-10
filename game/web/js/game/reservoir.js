// The lease in 3D: a cutaway of the reservoir at well depth, the lateral, the player's fractures, and the simulator's
// pressure field painted on the cut plane, one flat colour per simulator cell (nearest sampling, never blended
// between cells, so the map never shows a pressure the simulator did not produce).
//
// Frame: world x along the lateral (toe at x_ft = 0, heel at x_ft = lateral), world z across it (the well centreline
// is z = 0), world y up with the well at y = 0. Scale: 1 world unit = 100 ft horizontally; vertical exaggerated x3.
import * as THREE from 'three';
import { surface } from '../engine/materials.js';
import { lathe, mesh, tagFlat, box } from '../engine/kit.js';

export const S = 0.01;     // world units per foot
export const VE = 3;       // vertical exaggeration, labelled on screen

// Sequential amber ramp for depletion (one hue, dark = untouched rock, bright = drawn down to well pressure).
export const RAMP = ['#2b2219', '#5a3b18', '#93591a', '#cf8526', '#f6b553', '#ffe2a8'];

// ---- inverse of three's ACES filmic tone map, so the colours that reach the screen are the legend's colours ----
const IN = new THREE.Matrix3().set(0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777);
const OUT = new THREE.Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602);
const IN_INV = IN.clone().invert(), OUT_INV = OUT.clone().invert();
function rrtInv(y) {   // solve (v^2 + 0.0245786 v - 0.000090537) / (0.983729 v^2 + 0.432951 v + 0.238081) = y for v >= 0
  y = Math.min(Math.max(y, 0), 0.999);
  const a = 1 - 0.983729 * y, b = 0.0245786 - 0.432951 * y, c = -(0.000090537 + 0.238081 * y);
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}
export function preToneMap(hex, exposure) {
  const lin = new THREE.Color(hex);   // three stores linear-light components
  const v = new THREE.Vector3(lin.r, lin.g, lin.b).applyMatrix3(OUT_INV);
  v.set(rrtInv(v.x), rrtInv(v.y), rrtInv(v.z)).applyMatrix3(IN_INV).multiplyScalar(0.6 / exposure);
  return [Math.max(v.x, 0), Math.max(v.y, 0), Math.max(v.z, 0)];
}
export function rampAt(t) {
  const k = Math.min(RAMP.length - 1.0001, Math.max(0, t) * (RAMP.length - 1));
  const i = Math.floor(k);
  return new THREE.Color(RAMP[i]).lerp(new THREE.Color(RAMP[i + 1]), k - i);
}

export class Reservoir {
  constructor(stage, { labelParent = document.body } = {}) {
    this.stage = stage;
    this.root = new THREE.Group();
    stage.scene.add(this.root);
    this.labels = [];
    this.layer = document.createElement('div');
    this.layer.className = 'labels';
    labelParent.appendChild(this.layer);
    this.mat = {
      rock: surface({ name: 'reservoir rock', paint: new THREE.Color('#6b5d4c'), chip: 0, grime: 0.15, rough: 0.85, bump: 1.2,
        bumpFreq: 60, bands: 0.8, streak: 0 }),
      shale: surface({ name: 'shale', paint: new THREE.Color('#3a3d40'), chip: 0, grime: 0.1, rough: 0.8, bump: 0.8, bumpFreq: 40,
        bands: 1, streak: 0 }),
      casing: surface({ name: 'casing', paint: null, under: new THREE.Color('#9aa0a4'), chip: 0, grime: 0.3, rough: 0.35 }),
      cement: surface({ name: 'cement', paint: new THREE.Color('#8b8a84'), chip: 0, grime: 0.2, rough: 0.9, bump: 0.6 }),
      frac: new THREE.MeshPhysicalMaterial({ color: '#f0a53a', roughness: 0.4, transparent: true, opacity: 0.32, depthWrite: false,
        side: THREE.DoubleSide, emissive: '#7a4a10', emissiveIntensity: 0.35 }),
      fracLost: new THREE.MeshBasicMaterial({ color: '#c8463a', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    };
    this.stage.onUpdate((dt) => this._tick(dt));
  }

  _clear() {
    for (const c of [...this.root.children]) this.root.remove(c);
    this.layer.replaceChildren();
    this.labels = [];
    this.heat = null;
  }

  label(text, pos, cls = '') {
    const el = document.createElement('div');
    el.className = 'lbl ' + cls; el.textContent = text;
    this.layer.appendChild(el);
    const l = { el, pos: pos.clone() };
    this.labels.push(l);
    return l;
  }

  // world position of a point given in feet (x along the lateral, y across, z_ft depth offset above the well)
  w(xft, yft, zft = 0) { return new THREE.Vector3((xft - this.L / 2) * S, zft * S * VE, yft * S); }

  setLevel(level) {
    this._clear();
    this.level = level;
    const L = this.L = level.lateral_ft, W = this.W = level.lease_width_ft;
    const T = level.thickness_ft ?? 100;
    this.T = T;
    const hw = T / 2 * S * VE;
    // lower half of the pay zone (the cutaway is at well depth), on a bed of shale
    const pay = mesh(box(L * S, hw, W * S, 0.02), this.mat.rock); pay.position.set(0, -hw / 2 - 0.002, 0); this.root.add(pay);
    const sh = mesh(box(L * S + 0.8, 1.4, W * S + 0.8, 0.04), this.mat.shale); sh.position.set(0, -hw - 0.7, 0); this.root.add(sh);
    // ghost of the upper half that was cut away: edges only
    const ghost = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(L * S, hw, W * S)),
      new THREE.LineBasicMaterial({ color: '#8a9aa6', transparent: true, opacity: 0.35 }));
    ghost.position.set(0, hw / 2, 0); this.root.add(ghost);
    // cut plane before any run: uniform untouched-rock colour with a faint 100 ft grid
    this.cut = new THREE.Mesh(new THREE.PlaneGeometry(L * S, W * S).rotateX(-Math.PI / 2), this._flatMaterial());
    this.cut.position.y = 0.001; this.root.add(this.cut);
    // lease lines: amber dashes along both long sides
    const dash = new THREE.LineDashedMaterial({ color: '#f0a53a', dashSize: 0.18, gapSize: 0.12 });
    for (const s of [-1, 1]) {
      const g = new THREE.BufferGeometry().setFromPoints([this.w(0, s * W / 2, 0.4), this.w(L, s * W / 2, 0.4)]);
      const line = new THREE.Line(g, dash); line.computeLineDistances(); this.root.add(line);
    }
    this.label('Lease line', this.w(L * 0.02, -W / 2, 2), 'lease');
    // wellbore: horizontal lateral (drawn at 10x true diameter so it reads), vertical section rising at the heel
    const rWell = 0.045;
    const lat = mesh(lathe([[0, 0], [rWell, 0], [rWell, L * S], [0, L * S]], { segments: 24, radius: 0.004 }).rotateZ(-Math.PI / 2), this.mat.casing);
    lat.position.copy(this.w(0, 0, 0)); this.root.add(lat);
    const bend = new THREE.QuadraticBezierCurve3(this.w(L, 0), this.w(L + 160, 0), this.w(L + 160, 0, 70));
    this.root.add(mesh(new THREE.TubeGeometry(bend, 24, rWell, 16), this.mat.casing));
    const vert = mesh(lathe([[0, 0], [rWell, 0], [rWell, 6], [0, 6]], { segments: 24, radius: 0 }), this.mat.casing);
    vert.position.copy(this.w(L + 160, 0, 70)); this.root.add(vert);
    const depth = level.top_depth_ft != null ? Math.round(level.top_depth_ft + T / 2) : null;
    this.label(depth ? `To surface, ${depth.toLocaleString('en-US')} ft up` : 'To surface', this.w(L + 160, 0, 70).add(new THREE.Vector3(0, 6.2, 0)), 'muted');
    this.label('Toe', this.w(-40, 0, 6), 'muted');
    this.label('Heel', this.w(L + 40, 0, 6), 'muted');
    this.label(`Vertical scale x${VE}. Wellbore drawn wider than true size.`, this.w(L, W / 2 + 120, -T * 0.9), 'note');
    // scale bar along the near lease edge: 500 ft ticks
    for (let x = 0; x <= L + 1; x += 500) this.label(`${x.toLocaleString('en-US')} ft`, this.w(x, W / 2 + 60, -T / 2), 'tick');

    this.fracs = new THREE.Group(); this.root.add(this.fracs);
    this.stage.configure({ size: Math.max(L, W) * S * 1.1 });
  }

  _flatMaterial() {
    const [r, g, b] = preToneMap(RAMP[0], this.stage.renderer.toneMappingExposure);
    return new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Vector3(r, g, b) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uCol; varying vec3 vP;
        void main(){ vec2 g = abs(fract(vP.xz + 0.5) - 0.5) / fwidth(vP.xz); float line = 1.0 - min(min(g.x, g.y), 1.0);
          gl_FragColor = vec4(uCol * (1.0 + line * 0.6), 1.0); }`,
    });
  }

  // fractures as designed. half-lengths beyond the lease are shown as a faint red remainder (paid for, not effective)
  setDesign(design, { effective = null, grow = 1 } = {}) {
    const n = design.stages, L = this.L, W = this.W;
    const hl = Array.isArray(design.half_length_ft) ? design.half_length_ft : Array(n).fill(design.half_length_ft);
    this.fracs.clear();
    for (const l of this.labels.filter(l => l.stage)) l.el.remove();
    this.labels = this.labels.filter(l => !l.stage);
    const H = this.T * S * VE;
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * L / n;
      const want = hl[i], eff = effective ? effective[i] : Math.min(want, W / 2);
      const g = Math.min(1, Math.max(0, grow * n - i));         // staged growth: stage 1 (toe) first
      if (g <= 0) continue;
      const e = eff * g;
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(2 * e * S, H), this.mat.frac);
      pane.rotation.y = Math.PI / 2; pane.position.copy(this.w(x, 0)); this.fracs.add(pane);
      const rim = new THREE.LineSegments(new THREE.EdgesGeometry(pane.geometry), new THREE.LineBasicMaterial({ color: '#f0a53a', transparent: true, opacity: 0.8 }));
      rim.rotation.copy(pane.rotation); rim.position.copy(pane.position); this.fracs.add(rim);
      if (want > eff + 1 && g >= 1) {
        for (const s of [-1, 1]) {
          const lost = new THREE.Mesh(new THREE.PlaneGeometry((want - eff) * S, H * 0.6), this.mat.fracLost);
          lost.rotation.y = Math.PI / 2; lost.position.copy(this.w(x, s * (eff + (want - eff) / 2))); this.fracs.add(lost);
        }
      }
      // perforation cluster collar on the casing
      const collar = mesh(tagFlat(new THREE.TorusGeometry(0.06, 0.018, 8, 24)), this.mat.casing);
      collar.rotation.y = Math.PI / 2; collar.position.copy(this.w(x, 0)); this.fracs.add(collar);
      if (g >= 1) { const lb = this.label(String(i + 1), this.w(x, 0, this.T * 0.62), 'stage'); lb.stage = true; }
    }
  }

  // animate the design being placed, toe first; resolves when done. This is not simulated fracture growth.
  place(design, seconds = 2.4) {
    return new Promise((res) => {
      let t = 0;
      const off = this.stage.onUpdate((dt) => {
        t = Math.min(1, t + dt / seconds);
        this.setDesign(design, { grow: t });
        if (t >= 1) { off(); res(); }
      });
    });
  }

  // ---- pressure field ----
  setField(field, effective) {
    this.field = field;
    const { nx, ny, x_edges_ft: xe, y_edges_ft: ye } = field;
    const p0 = field.initial_pressure_psi, pw = field.bhp_psi;
    // one RGBA8 slice per stored month: depletion fraction 0..1 in R
    this.slices = field.pressure_psi.map((arr) => {
      const d = new Uint8Array(nx * ny * 4);
      for (let k = 0; k < nx * ny; k++) d[4 * k] = Math.round(255 * Math.min(1, Math.max(0, (p0 - arr[k]) / (p0 - pw))));
      const t = new THREE.DataTexture(d, nx, ny, THREE.RGBAFormat);
      t.magFilter = t.minFilter = THREE.NearestFilter; t.needsUpdate = true;
      return t;
    });
    // LUT pre-compensated for the tone mapper, so pixels match the legend
    const lut = new Float32Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = preToneMap('#' + rampAt(i / 255).getHexString(), this.stage.renderer.toneMappingExposure);
      lut.set([r, g, b, 1], i * 4);
    }
    const lutTex = new THREE.DataTexture(lut, 256, 1, THREE.RGBAFormat, THREE.FloatType);
    lutTex.magFilter = lutTex.minFilter = THREE.LinearFilter; lutTex.needsUpdate = true;
    // grid with vertices on the real (non-uniform) cell edges; UVs in index space so each cell samples itself
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const p = this.w(xe[i], ye[j]); pos.push(p.x, 0.002, p.z); uv.push(i / nx, j / ny);
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: this.slices[0] }, uB: { value: this.slices[0] }, uT: { value: 0 }, uLut: { value: lutTex },
        uCell: { value: new THREE.Vector2(nx, ny) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D uA, uB, uLut; uniform float uT; uniform vec2 uCell; varying vec2 vUv;
        void main(){
          vec2 c = (floor(vUv * uCell) + 0.5) / uCell;            // centre of this cell: never sample a neighbour
          float d = mix(texture2D(uA, c).r, texture2D(uB, c).r, uT);
          gl_FragColor = vec4(texture2D(uLut, vec2(d * (255.0/256.0) + 0.5/256.0, 0.5)).rgb, 1.0);
        }`,
    });
    mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;   // always wins over the rock top
    if (this.heat) this.root.remove(this.heat);
    this.heat = new THREE.Mesh(g, mat);
    this.root.add(this.heat);
    this.cut.visible = false;
  }

  // t is a fractional index into field.months
  setMonth(t) {
    if (!this.heat) return;
    const n = this.slices.length - 1, k = Math.min(n, Math.max(0, t));
    const i = Math.floor(k), j = Math.min(n, i + 1);
    const u = this.heat.material.uniforms;
    u.uA.value = this.slices[i]; u.uB.value = this.slices[j]; u.uT.value = k - i;
  }

  clearField() {
    if (this.heat) { this.root.remove(this.heat); this.heat = null; }
    if (this.cut) this.cut.visible = true;
  }

  _tick() {
    const cam = this.stage.camera, cw = this.stage.canvas.clientWidth, ch = this.stage.canvas.clientHeight;
    for (const l of this.labels) {
      const p = l.pos.clone().project(cam);
      const vis = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      l.el.style.display = vis ? '' : 'none';
      if (vis) {   // labels near the right edge hang to the left of their point, so they never clip
        const px = (p.x * 0.5 + 0.5) * cw, py = (-p.y * 0.5 + 0.5) * ch;
        const flip = px > cw - 240;
        l.el.style.transform = `translate(${px}px, ${py}px)${flip ? ' translateX(-100%) translateX(-12px)' : ''}`;
      }
    }
  }
}
