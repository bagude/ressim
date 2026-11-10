// The career field in 3D: one square-mile sections on the surface, pads, and every well's path down to its lateral.
// What stands on each pad this month comes from the schedule (the plan's Gantt bars at the current month):
//   construction -> a gravel pad; drilling -> a rig; fracturing -> the frac spread; producing -> wellheads and a tank battery.
// Scale: 1 world unit = 100 ft horizontally and vertically. Depth is drawn true to scale when the server reports it,
// otherwise schematically (and labelled so).
import * as THREE from 'three';
import { Stage } from '../engine/stage.js';
import { surface } from '../engine/materials.js';
import { box, mesh, lathe, tagFlat, setDetail, bakeInstanced, FT } from '../engine/kit.js';
import { library } from '../engine/materials.js';
import { buildPumpTrailer } from '../assets/pumpTrailer.js';
import { buildFracTree } from '../assets/fracTree.js';
import * as PE from '../assets/padEquipment.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { buildBase, drawOverlay, hashStr } from './mapTexture.js';

const S = 0.01;
const WH_SPACING = 0.30;   // 30 ft between wellheads (COGCC example of wells offset by 30 ft; docs/gaps-site.md)
const C_PDP = new THREE.Color('#3d8be0'), C_DEV = new THREE.Color('#c98322');
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Field3D {
  constructor(canvas) {
    this.stage = new Stage(canvas, { quality: 'high' });
    const st = this.stage;
    st.gtao.enabled = false;            // the scene spans miles; AO at this scale only adds noise
    st.bloom.strength = 0.25;
    st.scene.background = new THREE.Color('#16202a');
    st.configure({ size: 220 });
    st.camera.far = 4000; st.camera.updateProjectionMatrix();
    st.scene.fog = null;   // the whole field must stay legible from a framing distance of ~500 units
    st.controls.maxPolarAngle = Math.PI * 0.62;   // allow looking up at the underground from just below the surface
    this.root = new THREE.Group(); st.scene.add(this.root);
    this.labelsEl = document.createElement('div'); this.labelsEl.className = 'labels field-labels';
    canvas.parentElement.appendChild(this.labelsEl);
    this.labels = [];
    this.underground = false;   // opens as a map; the underground view is a toggle
    try { this.mapStyle = localStorage.getItem('field.mapStyle') || 'aerial'; } catch { this.mapStyle = 'aerial'; }
    // map furniture: north arrow and scale bar, kept true to the camera every frame
    this.hud = document.createElement('div'); this.hud.className = 'map-hud';
    this.hud.innerHTML = `<svg class="north" viewBox="-20 -20 40 40" width="40" height="40" role="img" aria-label="North arrow">
        <g class="needle"><path d="M0 -15 L6 6 L0 2 L-6 6 Z" fill="#e7e2d6" stroke="#16202a" stroke-width="1"/><text x="0" y="-5" text-anchor="middle" font-size="0">N</text></g>
        <text class="n" x="0" y="17" text-anchor="middle">N</text></svg>
      <div class="scale" aria-label="Scale bar"><div class="bar"><i></i><i></i></div><div class="ticks"><span>0</span><span class="mid"></span><span class="endv"></span></div></div>`;
    canvas.parentElement.appendChild(this.hud);
    this.mat = {
      ground: surface({ name: 'ground', paint: new THREE.Color('#5b5340'), chip: 0, grime: 0.25, rough: 0.95, bump: 0.8, bumpFreq: 0.6, streak: 0, envMapIntensity: 0.25 }),
      gravel: surface({ name: 'pad gravel', paint: new THREE.Color('#6b665d'), chip: 0, grime: 0.35, rough: 0.95, bump: 1.5, bumpFreq: 30, streak: 0 }),
      steel: surface({ name: 'equipment', paint: new THREE.Color('#c9c6bd'), chip: 0.3, grime: 0.5, rough: 0.5 }),
      red: surface({ name: 'red equipment', paint: new THREE.Color('#8a140d'), chip: 0.4, grime: 0.5, rough: 0.5 }),
      dark: surface({ name: 'dark equipment', paint: new THREE.Color('#2b2f33'), chip: 0.3, grime: 0.5, rough: 0.6 }),
      tank: surface({ name: 'tank', paint: new THREE.Color('#d6d2c6'), chip: 0.2, grime: 0.6, rough: 0.5, streak: 0.8 }),
      sand: surface({ name: 'sand silo', paint: new THREE.Color('#d98a1c'), chip: 0.4, grime: 0.4, rough: 0.5 }),
      mast: surface({ name: 'rig mast', paint: new THREE.Color('#c23b22'), chip: 0.4, grime: 0.5, rough: 0.5 }),
    };
    this.raycaster = new THREE.Raycaster();
    this.anims = [];
    this.changes = [];
    this._keys(canvas);
    // keep the whole field fitted when the view changes size, until the viewer moves the camera themselves
    st.controls.addEventListener('start', () => { this._fitted = false; });
    new ResizeObserver(() => { if (this._fitted && this.C) requestAnimationFrame(() => this.frame()); }).observe(canvas);
    st.onUpdate((dt, t) => this._tick(dt, t));
    st.start();
  }

  setUnderground(on) {
    this.underground = on;
    if (this.groundMesh) { this.groundMesh.visible = !on; }
    if (this.mapMat) { this.mapMat.opacity = on ? 0.4 : 1; this.mapMat.depthWrite = !on; this.mapMat.needsUpdate = true; }
    if (this.subsurface) this.subsurface.visible = on;
  }
  setLayer(layer) { this.layer = layer; this._drawMap(this.focus); }   // 'wells' | 'production'
  setMapStyle(style) {
    this.mapStyle = style; try { localStorage.setItem('field.mapStyle', style); } catch { /* per-viewer convenience only */ }
    this._drawMap(this.focus);
  }
  // the ground texture: the base terrain (cached per career, size and style) plus roads, pads and wells for this month
  _drawMap(focus) {
    const C = this.C; if (!C) return;
    const maxT = Math.min(8192, this.stage.renderer.capabilities.maxTextureSize);
    const Wc = Math.min(maxT, 4096), Hc = Math.round(Wc * this.gd / this.gw);
    const bkey = `${C.id}|${this.gw}|${this.gd}|${Wc}|${this.mapStyle}`;
    if (this.baseKey !== bkey) { this.base = buildBase({ seed: hashStr(C.id || 'field'), gw: this.gw, gd: this.gd, Wc, style: this.mapStyle }); this.baseKey = bkey; }
    const okey = `${bkey}|${this.layer}|${focus}|${JSON.stringify(this.pads.map(p => [p.section, p.state]))}|${this.mapWells.map(w => w.id + w.kind).join()}|${document.fonts?.status}`;
    if (okey === this.mapKey) return;
    this.mapKey = okey;
    if (this.mapCanvas.width !== Wc || this.mapCanvas.height !== Hc) { this.mapCanvas.width = Wc; this.mapCanvas.height = Hc; }
    drawOverlay(this.mapCanvas.getContext('2d'), this.base, { gw: this.gw, gd: this.gd, k: this.base.k, grid: this.grid, pads: this.pads, wells: this.mapWells, focus, layer: this.layer }, this.mapStyle);
    this.maxCum = Math.max(0, ...this.mapWells.map(w => w.cum));
    this.mapTex.needsUpdate = true;
    this.elevNote = `Elevations ${Math.round(this.base.minH).toLocaleString('en-US')} to ${Math.round(this.base.maxH).toLocaleString('en-US')} ft`;
  }

  _clear() { this.anims = []; this.root.clear(); this.labelsEl.replaceChildren(); this.labels = []; this.blinkers = []; this.lineMats = []; this.wellLines = []; this.pads = []; this.detail = null; this.detailPad = null; }
  _label(text, pos, cls = '') {
    const el = document.createElement('div'); el.className = 'lbl ' + cls; el.textContent = text; this.labelsEl.appendChild(el);
    this.labels.push({ el, pos: pos.clone() });
  }

  // career: GET /api/career view; analogs: GET /api/career/analogs; plan: POST /api/career/plan response for the active plan (or null)
  update(career, analogs, planRes, { focus = null } = {}) {
    // remember last month's pads and wells, so a month advance can show what changed
    const prevPads = this.pads ? new Map(this.pads.map(p => [p.section, p])) : null;
    const prevWells = new Set((this.wellLines || []).filter(l => l.userData.well.kind !== 'planned').map(l => l.userData.well.id));
    const prevMonth = this.month;
    this._clear();
    this.month = career.month;
    const C = this.C = career;
    const secs = C.sections, SEC = C.section_ft * S;
    const cols = Math.max(...secs.map(s => s.col)) + 1, rows = Math.max(...secs.map(s => s.row)) + 1;
    this.cols = cols; this.rows = rows; this.SEC = SEC;
    const depthFt = C.reservoir?.tvd_ft ?? C.tvd_ft ?? null;
    this.trueDepth = depthFt != null;
    const D = this.D = depthFt != null ? depthFt * S : 40;   // schematic fallback, labelled below
    const secXZ = (s) => [(s.col - cols / 2 + 0.5) * SEC, (s.row - rows / 2 + 0.5) * SEC];   // row 0 (A) is north (-z)

    // ground: one slab with a section grid drawn in the shader-free way (thin road strips on top)
    const gw = this.gw = cols * SEC + 60, gd = this.gd = rows * SEC + 60;
    const groundMat = this.mat.ground.clone();
    groundMat.transparent = true;
    this.groundMesh = mesh(box(gw, 1.2, gd, 0.2), groundMat); this.groundMesh.position.y = -0.62; this.root.add(this.groundMesh);
    if (!this.mapTex) {
      this.mapCanvas = document.createElement('canvas');
      this.mapTex = new THREE.CanvasTexture(this.mapCanvas);
      this.mapTex.colorSpace = THREE.SRGBColorSpace;
      this.mapTex.anisotropy = this.stage.renderer.capabilities.getMaxAnisotropy();
      this.mapMat = new THREE.MeshBasicMaterial({ map: this.mapTex, transparent: true, toneMapped: false });   // a map shows its own colours, unlit and untoned
      document.fonts?.ready.then(() => { if (this.C) { this.mapKey = null; this._drawMap(this.focus); } });
    }
    this.mapPlane = new THREE.Mesh(new THREE.PlaneGeometry(gw, gd), this.mapMat);
    this.mapPlane.rotation.x = -Math.PI / 2; this.mapPlane.position.y = 0.003; this.mapPlane.receiveShadow = true;
    this.root.add(this.mapPlane);
    this.grid = { x0: -cols * SEC / 2, z0: -rows * SEC / 2, SEC, cols, rows, sections: secs };
    this.mapWells = [];
    this.focus = focus;
    // subsurface: reservoir sheet at depth, well paths
    const sub = this.subsurface = new THREE.Group(); this.root.add(sub);
    const T = (C.reservoir?.thickness_ft ?? 100) * S;
    const sheet = new THREE.Mesh(new THREE.BoxGeometry(cols * SEC, T, rows * SEC),
      new THREE.MeshStandardMaterial({ color: '#3a4c5c', transparent: true, opacity: 0.35, depthWrite: false, roughness: 1 }));
    sheet.position.y = -D; sub.add(sheet);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(sheet.geometry), new THREE.LineBasicMaterial({ color: '#c98322', transparent: true, opacity: 0.4 }));
    edges.position.copy(sheet.position); sub.add(edges);
    this._label(this.trueDepth ? `Target zone, ${Math.round(depthFt).toLocaleString('en-US')} ft TVD` : 'Target zone (depth not to scale)',
      new THREE.Vector3(-cols * SEC / 2, -D, rows * SEC / 2), 'muted');
    this.labels[this.labels.length - 1].under = true;   // only in the underground view
    this.depthNote = this.trueDepth ? `Depth is true to scale. The zone is about ${C.reservoir?.thickness_ft ?? 100} ft thick (nominal; it varies by section) and its slab is not to scale.` : 'Depth is schematic.';

    // wells per section: producing (analogs: inherited + yours), planned (plan pads not yet producing)
    const bySec = {};
    for (const a of analogs) (bySec[a.section] ||= []).push(a);
    // current rate = median of the last 3 months (the last month alone dips with downtime)
    const nowRate = (a) => { const t = a.oil.slice(-3).slice().sort((p, q) => p - q); return t.length ? t[Math.floor(t.length / 2)] : 0; };
    const maxRate = Math.max(1, ...analogs.map(nowRate));
    const started = new Map(C.pads_started.map(p => [p.section, p]));
    const planPads = new Map((planRes?.pads || []).map(p => [p.section, p]));
    const month = C.month;
    // activity this month from the Gantt
    const active = {};
    for (const b of planRes?.gantt?.bars || []) {
      if (b.start_month <= month + 0.5 && b.end_month > month - 0.5 && b.status !== 'delayed') (active[b.pad] ||= new Set()).add(b.kind);
    }
    this.blinkers = [];
    for (const s of secs) {
      const [x, z] = secXZ(s);
      const prod = bySec[s.section] || [];
      const pp = planPads.get(s.section), sp = started.get(s.section);
      // producing sections draw exactly the wells that exist; empty slots are not invented as 'planned'
      const nWells = prod.length ? prod.length : (sp?.wells || pp?.wells || 0);
      if (!nWells && !pp) continue;
      // the server's geometry (game/geodesk slot rule): laterals run south (azimuth 180) from a heel 300 ft inside the
      // north line, each in its own slot across the section; the toe stops 300 ft short of the south line.
      // The pad sits just north of the section line, far enough for the curve to land at the heel.
      const zN = z - SEC / 2, padX = x, padZ = zN - 5.0;
      const kinds = active[s.section] || new Set();
      const isProducing = prod.length > 0;
      const state = kinds.has('drill') ? 'drilling' : kinds.has('complete') ? 'fracturing' : (kinds.has('wait') || kinds.has('facility_build')) ? 'construction'
        : kinds.has('tie_in') ? 'tie-in' : isProducing ? 'producing' : sp ? 'construction' : 'planned';
      const proxy = this._pad(padX, padZ, state, nWells, s.section);
      this.pads.push({ section: s.section, x: padX, z: padZ, roadZ: zN, x0: x - SEC / 2, state, nWells, proxy });
      // well paths
      for (let k = 0; k < nWells; k++) {
        const per = prod.length ? Math.max(prod[0].wells_per_section || nWells, nWells) : nWells;   // laterals sit at the real spacing
        const xSlot = x - SEC / 2 + (k + 0.5) * SEC / per;
        const w = prod[k];
        const rate = w ? nowRate(w) / maxRate : 0;
        const kind = w ? (w.owner === 'you' ? 'you' : 'pdp') : 'planned';
        this._well({ id: w ? w.id : `${s.section}-${String(k + 1).padStart(2, '0')}`, section: s.section, k, n: nWells, kind, rate, lateralFt: w?.lateral_ft ?? C.lateral_ft,
          cum: w ? w.oil.reduce((a, b) => a + b, 0) : 0,
          sx: padX + (k - (nWells - 1) / 2) * WH_SPACING, sz: padZ + 1.2,
          x0: x - SEC / 2, zN, xSlot, SEC, D });
      }
      const tag = state === 'planned' ? `Pad ${s.section}: planned${pp?.online_month != null ? `, online ${fmtM(pp.online_month)}` : ', unscheduled'}`
        : state === 'producing' ? `Pad ${s.section}: producing` : `Pad ${s.section}: ${state}`;
      if (state !== 'producing' || focus === s.section) this._label(tag, new THREE.Vector3(padX, state === 'drilling' ? 2.2 : 1.0, padZ), 'pad ' + state);
    }
    this._drawMap(focus);
    if (!this._framed) { this.frame(); this._framed = true; }
    this.setUnderground(this.underground);
    if (prevPads && prevMonth != null && career.month > prevMonth) this._monthChanges(prevPads, prevWells);
    else if (prevMonth !== career.month) this.changes = [];
  }

  // ---- what changed since the last month this view drew: crews that moved, pads that changed state, wells that came online.
  // Described in words (this.changes, for the page's live region) and, unless the viewer prefers reduced motion, animated:
  // rigs and frac crews drive along the section roads to their next pad, equipment rises on pads that changed, new wells draw in.
  _monthChanges(prev, prevWells) {
    const out = this.changes = [], moves = [];
    const now = new Map(this.pads.map(p => [p.section, p]));
    for (const kind of ['drilling', 'fracturing']) {
      const what = kind === 'drilling' ? 'rig' : 'frac crew';
      const left = [...prev.values()].filter(p => p.state === kind && now.get(p.section)?.state !== kind);
      const arrived = this.pads.filter(p => p.state === kind && prev.get(p.section)?.state !== kind);
      for (const a of arrived) {
        let from = null, bd = Infinity;
        for (const l of left) { const d = Math.hypot(l.x - a.x, l.z - a.z); if (d < bd) { bd = d; from = l; } }
        if (from) left.splice(left.indexOf(from), 1);
        out.push(from ? `The ${what} moved from pad ${from.section} to pad ${a.section}.` : `A ${what} arrived at pad ${a.section}.`);
        moves.push({ from, to: a, kind });
      }
      for (const l of left) out.push(`The ${what} left pad ${l.section}.`);
    }
    for (const p of this.pads) {
      const q = prev.get(p.section);
      if (['drilling', 'fracturing'].includes(p.state)) continue;
      if (q && q.state !== p.state) out.push(`Pad ${p.section} is now ${p.state === 'tie-in' ? 'being tied in' : p.state}.`);
      else if (!q && p.state !== 'planned') out.push(`Pad ${p.section}: ${p.state}.`);
    }
    const fresh = this.wellLines.filter(l => l.userData.well.kind !== 'planned' && !prevWells.has(l.userData.well.id));
    if (fresh.length) out.push(`${fresh.length} new well${fresh.length > 1 ? 's' : ''} online.`);
    if (reducedMotion()) return;
    for (const p of this.pads) {
      const q = prev.get(p.section);
      if (p.state === 'planned' || (q && q.state === p.state)) continue;
      const mv = moves.find(m => m.to === p && m.from);
      this._grow(p, mv ? this._convoy(mv.from, p, mv.kind) : 0, 0.9);
    }
    fresh.forEach((l, i) => this._drawIn(l, 0.4 + 0.15 * i, 2.0));
  }
  _anim(delay, dur, fn) { fn(0); this.anims.push({ t: -delay, dur, fn }); }
  _grow(p, delay, dur) {   // equipment rises out of the pad
    this._anim(delay, dur, (e) => {
      const s = Math.max(0.001, 1 - Math.pow(1 - e, 3));
      p.proxy.scale.y = s;
      if (this.detailPad === p && this.detail) this.detail.scale.y = s;
    });
  }
  _drawIn(line, delay, dur) {   // the well path draws from surface to toe
    const g = line.geometry, n = g.attributes.instanceStart.count;
    this._anim(delay, dur, (e) => { g.instanceCount = Math.max(1, Math.round(n * easeInOut(e))); });
  }
  // a convoy of trucks drives from one pad to the next along the section-line roads; returns its travel time
  _convoy(from, to, kind) {
    // out the lease road to the section-line road, along it to the target section's west line, down that road, then in
    const bx = to.x0 ?? (to.x - this.SEC / 2);
    const pts = [[from.x, from.z], [from.x, from.roadZ], [bx, from.roadZ], [bx, to.roadZ], [to.x, to.roadZ], [to.x, to.z]].map(([x, z]) => new THREE.Vector3(x, 0.12, z));
    const path = new THREE.CurvePath();
    for (let i = 1; i < pts.length; i++) if (pts[i].distanceTo(pts[i - 1]) > 1e-3) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
    const len = path.getLength(), dur = Math.min(4.5, Math.max(2.2, len / 45));
    const route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path.getSpacedPoints(80)),
      new THREE.LineDashedMaterial({ color: '#f0a53a', dashSize: 0.8, gapSize: 0.6, transparent: true, opacity: 0.9 }));
    route.computeLineDistances(); route.position.y = 0.05; this.root.add(route);
    const cab = kind === 'drilling' ? this.mat.mast : this.mat.red, trucks = [];
    for (let k = 0; k < 4; k++) {
      const t = new THREE.Group();
      t.add(at(mesh(box(0.55, 0.13, 0.09, 0.01), this.mat.steel), -0.1, 0.08, 0));   // trailer, about 55 ft
      t.add(at(mesh(box(0.13, 0.12, 0.09, 0.01), cab), 0.25, 0.08, 0));              // tractor
      this.root.add(t); trucks.push(t);
    }
    const label = { el: document.createElement('div'), pos: pts[0].clone() };
    label.el.className = 'lbl pad moving';
    label.el.textContent = kind === 'drilling' ? `Rig moving to ${to.section}` : `Frac crew moving to ${to.section}`;
    this.labelsEl.appendChild(label.el); this.labels.push(label);
    const tan = new THREE.Vector3();
    this._anim(0.2, dur, (e) => {
      const u = easeInOut(e);
      trucks.forEach((t, k) => {
        const uk = Math.max(0, Math.min(1, u - k * 0.9 / len));        // trucks about 90 ft apart
        t.position.copy(path.getPointAt(uk)); path.getTangentAt(Math.min(0.999, uk), tan);
        t.rotation.y = Math.atan2(-tan.z, tan.x);
      });
      label.pos.copy(trucks[0].position).setY(1.2);
      route.material.opacity = 0.9 * (1 - u * 0.6);
      if (e >= 1) {
        for (const t of trucks) this.root.remove(t);
        this.root.remove(route); label.el.remove();
        const i = this.labels.indexOf(label); if (i >= 0) this.labels.splice(i, 1);
      }
    });
    return 0.2 + dur;
  }

  // keyboard: arrows orbit, + and - zoom, Home shows the whole field (the canvas takes focus with Tab)
  _keys(canvas) {
    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', (e) => {
      const c = this.stage.controls, cam = this.stage.camera, off = cam.position.clone().sub(c.target);
      const sph = new THREE.Spherical().setFromVector3(off), step = 0.12;
      if (e.key === 'ArrowLeft') sph.theta -= step;
      else if (e.key === 'ArrowRight') sph.theta += step;
      else if (e.key === 'ArrowUp') sph.phi = Math.max(0.15, sph.phi - step);
      else if (e.key === 'ArrowDown') sph.phi = Math.min(c.maxPolarAngle, sph.phi + step);
      else if (e.key === '+' || e.key === '=') sph.radius = Math.max(c.minDistance || 1, sph.radius * 0.85);
      else if (e.key === '-' || e.key === '_') sph.radius = Math.min(Math.min(c.maxDistance, 3000), sph.radius / 0.85);
      else if (e.key === 'Home') { e.preventDefault(); this.frame(); return; }
      else return;
      e.preventDefault();
      cam.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(sph));
      cam.lookAt(c.target);
    });
  }

  frame() {
    this._fitted = true;
    if (!this.underground) {   // the map: straight down, north up, the whole field filling the view
      const cam = this.stage.camera, t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), a = cam.aspect || 1.6;
      const W = this.cols * this.SEC + 8, Dp = this.rows * this.SEC + 16;   // the row-A pads sit just north of the field
      const h = Math.max(Dp / 2 / t, W / 2 / (t * a)) * 1.04;
      this.stage.flyTo([0, h, -3 + 0.001 * h], [0, 0, -3], 1.0);
      return;
    }
    // fit the field box (surface to the target zone) in view: bounding radius / sin(fov/2), from the south-east, above
    const W = this.cols * this.SEC, Dp = this.rows * this.SEC;
    const r = 0.5 * Math.hypot(W, Dp, this.D), dist = r / Math.sin(THREE.MathUtils.degToRad(this.stage.camera.fov / 2)) * 0.82;
    const dir = new THREE.Vector3(0.28, 0.5, 0.82).normalize(), tgt = new THREE.Vector3(0, -this.D * 0.5, 0);
    this.stage.flyTo(tgt.clone().addScaledVector(dir, dist).toArray(), tgt.toArray(), 1.2);
  }
  flyToSection(name) {
    this._fitted = false;
    const s = this.C.sections.find(x => x.section === name); if (!s) return;
    const x = (s.col - this.cols / 2 + 0.5) * this.SEC, z = (s.row - this.rows / 2 + 0.5) * this.SEC;
    if (!this.underground) { this.stage.flyTo([x, this.SEC * 1.95, z + this.SEC * 0.35], [x, 0, z - this.SEC * 0.06], 1.0); return; }
    this.stage.flyTo([x + this.SEC * 0.55, this.SEC * 0.6, z + this.SEC * 0.95], [x - this.SEC * 0.15, -this.D * 0.35, z], 1.0);
  }

  // One well's own trajectory, surface to toe. Every well on a pad differs:
  //   surface location: its own slot in the wellhead row (30 ft apart)
  //   upper hole: vertical to its own nudge depth (staggered, so neighbouring wellbores separate early)
  //   nudge: an S-shaped section that drifts the well across to its own lateral position, back to vertical
  //   curve: an 8 deg/100 ft build (radius about 716 ft) landing horizontal at its own heel
  //   lateral: south along the section to its own toe, i.e. its own bottom-hole location
  // Shapes are illustrative directional profiles, not survey data. Locations are quoted like a permit: feet from the
  // north line (FNL) and west line (FWL) of the section.
  _well(o) {
    const { sx, sz, x0, zN, xSlot, SEC, D, k, kind, rate } = o;
    const h = hash01(o.section + ':' + k);
    const R = 7.16;
    const kop1 = Math.min(D - R - 18, 10 + 3.2 * k + 3 * h);
    // heel 300 ft inside the north line, toe at its lateral length or 300 ft short of the south line (the server's slot rule)
    const heelZ = zN + 3.0, toeZ = Math.min(heelZ + (o.lateralFt || 4620) * S, zN + SEC - 3.0);
    const dir = new THREE.Vector3(0, 0, 1);
    const V1 = new THREE.Vector3(sx, -kop1, sz), H = new THREE.Vector3(xSlot, -D, heelZ), C0 = H.clone().addScaledVector(dir, -R).setY(-(D - R));
    const L = Math.abs(V1.y - C0.y) * 0.42, kc = R * 0.5523;
    const curve = new THREE.CurvePath();
    curve.add(new THREE.LineCurve3(new THREE.Vector3(sx, 0, sz), V1));
    curve.add(new THREE.CubicBezierCurve3(V1, V1.clone().add(new THREE.Vector3(0, -L, 0)), C0.clone().add(new THREE.Vector3(0, L, 0)), C0));
    curve.add(new THREE.CubicBezierCurve3(C0, C0.clone().add(new THREE.Vector3(0, -kc, 0)), H.clone().addScaledVector(dir, -kc), H));
    curve.add(new THREE.LineCurve3(H, new THREE.Vector3(xSlot, -D, toeZ)));
    const ft = (v) => Math.round(v / S);
    this.mapWells.push({ kind, sx, sz, hx: xSlot, hz: heelZ, tx: xSlot, tz: toeZ, id: o.id, cum: o.cum || 0 });
    const info = { id: o.id, kind, shl: { fnl: ft(sz - zN), fwl: ft(sx - x0) }, bhl: { fnl: ft(toeZ - zN), fwl: ft(xSlot - x0) },
      heel: { fnl: ft(heelZ - zN), fwl: ft(xSlot - x0) }, kop: ft(kop1), landed: ft(D), lateral: ft(toeZ - heelZ) };
    // constant screen width (pixels), so wells stay readable from miles away and separate when you zoom onto a pad
    const samples = curve.getSpacedPoints(160), pos = [];
    for (const p of samples) pos.push(p.x, p.y, p.z);
    const geo = new LineGeometry(); geo.setPositions(pos);
    const col = kind === 'you' ? C_DEV.clone() : kind === 'pdp' ? C_PDP.clone() : new THREE.Color('#e7e2d6');
    if (kind !== 'planned') col.multiplyScalar(0.55 + 0.6 * Math.min(1, rate));   // brighter = producing more now
    const mat = new LineMaterial({ color: col, linewidth: kind === 'planned' ? 1.5 : 2.5, transparent: kind === 'planned', opacity: kind === 'planned' ? 0.45 : 1,
      dashed: kind === 'planned', dashSize: 2, gapSize: 1.5, worldUnits: false });
    mat.resolution.set(this.stage.canvas.clientWidth, this.stage.canvas.clientHeight);
    this.lineMats.push(mat);
    const line = new Line2(geo, mat); line.computeLineDistances();
    line.userData.well = info;
    this.mapWells[this.mapWells.length - 1].info = info;
    this.wellLines.push(line);
    this.subsurface.add(line);
  }

  // pad and whatever is on it this month. Equipment here is simplified for the field view (true size, few parts).
  _pad(x, z, state, nWells, section) {
    const g = new THREE.Group(); g.position.set(x, 0, z); this.root.add(g);
    if (state === 'planned') {
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(4.6, 0.02, 3.6)),
        new THREE.LineDashedMaterial({ color: '#f0a53a', dashSize: 0.3, gapSize: 0.2 }));
      outline.computeLineDistances(); outline.position.y = 0.08; g.add(outline);
      return g;
    }
    const pad = mesh(box(4.6, 0.12, 3.6, 0.05), this.mat.gravel); pad.position.y = 0.06; g.add(pad);
    // wellheads in a row
    for (let k = 0; k < nWells; k++) {
      const wh = mesh(lathe([[0, 0], [0.05, 0], [0.05, 0.14], [0.03, 0.18], [0, 0.18]], { segments: 12, radius: 0.005 }), this.mat.red);
      wh.position.set(-1.2, 0.12, (k - (nWells - 1) / 2) * WH_SPACING); g.add(wh);
    }
    if (state === 'drilling') {
      // rig: substructure, mast (~150 ft), drawworks, mud tanks, pipe racks
      const sub = mesh(box(0.45, 0.3, 0.45, 0.02), this.mat.dark); sub.position.set(0.0, 0.27, 0.0); g.add(sub);
      const mast = new THREE.Group(); mast.position.set(0, 0.42, 0); g.add(mast);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const leg = mesh(box(0.025, 1.5, 0.025, 0.004), this.mat.mast); leg.position.set(dx * 0.11 * 0.6, 0.75, dz * 0.11 * 0.6);
        leg.rotation.set(-dz * 0.045, 0, dx * 0.045); mast.add(leg);
      }
      for (let k = 1; k < 8; k++) { const bar = mesh(box(0.15 - k * 0.008, 0.012, 0.15 - k * 0.008, 0.002), this.mat.mast); bar.position.y = k * 0.19; mast.add(bar); }
      const crown = mesh(box(0.1, 0.06, 0.1, 0.01), this.mat.mast); crown.position.y = 1.53; mast.add(crown);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), new THREE.MeshBasicMaterial({ color: '#ff3b2a' }));
      beacon.position.y = 1.6; mast.add(beacon); this.blinkers.push(beacon);
      for (let k = 0; k < 3; k++) { const t = mesh(box(0.42, 0.14, 0.12, 0.01), this.mat.steel); t.position.set(-1.0 + k * 0.45, 0.19, 0.9); g.add(t); }
      const rack = mesh(box(1.2, 0.06, 0.25, 0.01), this.mat.dark); rack.position.set(1.2, 0.15, 0); g.add(rack);
      const dw = mesh(box(0.3, 0.16, 0.18, 0.01), this.mat.steel); dw.position.set(-0.4, 0.2, 0); g.add(dw);
    } else if (state === 'fracturing') {
      // frac spread: two rows of pump trailers facing the manifold, blender, sand silos, water tanks, data van
      for (let side = -1; side <= 1; side += 2) for (let k = 0; k < 6; k++) {
        const t = new THREE.Group();
        t.add(at(mesh(box(0.4, 0.13, 0.08, 0.01), this.mat.steel), 0, 0.17, 0));
        t.add(at(mesh(box(0.12, 0.12, 0.08, 0.01), this.mat.dark), 0.25, 0.16, 0));   // tractor cab
        t.position.set(-1.6 + k * 0.42 + 0.2, 0, side * 0.55); t.rotation.y = Math.PI / 2 * 0; g.add(t);
      }
      const missile = mesh(box(2.6, 0.06, 0.08, 0.01), this.mat.red); missile.position.set(-0.5, 0.15, 0); g.add(missile);
      const blender = mesh(box(0.36, 0.13, 0.08, 0.01), this.mat.steel); blender.position.set(1.35, 0.18, -0.2); g.add(blender);
      for (let k = 0; k < 3; k++) { const silo = mesh(lathe([[0, 0], [0.07, 0], [0.07, 0.55], [0.03, 0.62], [0, 0.62]], { segments: 16, radius: 0.005 }), this.mat.sand); silo.position.set(1.55 + k * 0.17, 0.12, 0.7); g.add(silo); }
      for (let k = 0; k < 8; k++) { const ft = mesh(box(0.45, 0.11, 0.08, 0.02), this.mat.tank); ft.position.set(-1.9 + k * 0.5, 0.17, 1.45); g.add(ft); }
      const van = mesh(box(0.26, 0.11, 0.08, 0.01), this.mat.tank); van.position.set(1.6, 0.17, -1.3); g.add(van);
    } else if (state === 'producing' || state === 'tie-in') {
      // tank battery and a separator
      for (let k = 0; k < 4; k++) { const tk = mesh(lathe([[0, 0], [0.12, 0], [0.12, 0.2], [0, 0.22]], { segments: 20, radius: 0.005 }), this.mat.tank); tk.position.set(1.3 + (k % 2) * 0.28, 0.12, -1.1 + Math.floor(k / 2) * 0.28); g.add(tk); }
      const sep = mesh(box(0.25, 0.1, 0.08, 0.02), this.mat.steel); sep.position.set(0.9, 0.17, -1.2); g.add(sep);
    } else if (state === 'construction') {
      const dozer = mesh(box(0.14, 0.08, 0.1, 0.01), this.mat.sand); dozer.position.set(1.2, 0.16, 0.8); g.add(dozer);
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  // ---- level of detail: the pad nearest the camera, when close, swaps its proxies for full-detail equipment ----
  _lod() {
    const cam = this.stage.camera.position;
    let best = null, bd = 1e9;
    for (const p of this.pads || []) {
      if (p.state === 'planned') continue;
      const d = Math.hypot(cam.x - p.x, cam.y, cam.z - p.z);
      if (d < bd) { bd = d; best = p; }
    }
    const want = best && bd < 28 ? best : null;
    if (want === this.detailPad) return;
    if (this.detail) { this.root.remove(this.detail); this.detail.traverse(o => o.geometry?.dispose()); this.detail = null; }
    if (this.detailPad) this.detailPad.proxy.visible = true;
    this.detailPad = want;
    if (!want) { this._shadowsWide(); return; }
    this.detail = this._padDetail(want);
    this.detail.position.set(want.x, 0, want.z);
    this.root.add(this.detail);
    want.proxy.visible = false;
    this._shadowsOn(want);
  }
  _shadowsOn(p) {   // a tight shadow box around the detailed pad, so trailers cast crisp shadows
    const k = this.stage.key, sc = k.shadow.camera;
    sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12; sc.near = 1; sc.far = 120; sc.updateProjectionMatrix();
    k.position.set(p.x + 20, 45, p.z + 18); k.target.position.set(p.x, 0, p.z); k.target.updateMatrixWorld();
  }
  _shadowsWide() { this.stage.configure({ size: 220 }); this.stage.scene.fog = null; }

  // full-detail pad in metres, scaled into field units (1 unit = 100 ft)
  _padDetail(p) {
    const M = this._lib || (this._lib = library());
    const K = this._K || (this._K = PE.padMaterials(M));
    const g = new THREE.Group();
    const WH = 30 * FT, rowX = -120 * FT;
    const wellZ = (k) => (k - (p.nWells - 1) / 2) * WH;
    setDetail(0.4);
    try {
      const whs = [];
      for (let k = 0; k < p.nWells; k++) whs.push(new THREE.Matrix4().makeTranslation(rowX, 0, wellZ(k)));
      if (p.state === 'fracturing' || p.state === 'tie-in') {
        g.add(tag(bakeInstanced(buildFracTree(M), whs, { minRadius: 0.09 }), 'tree'));
        const z = PE.zipper(K, p.nWells, WH); z.position.set(rowX + 9, 0, 0); g.add(z);
        const n = 6, mis = PE.missile(K, n); mis.position.set(6, 0, 0); g.add(mis);
        const L = mis.userData.length, place = [];
        for (let k = 0; k < n; k++) for (const sg of [-1, 1]) {
          const m = new THREE.Matrix4().makeRotationY(sg > 0 ? -Math.PI / 2 : Math.PI / 2);
          m.setPosition(6 - L / 2 + 1.5 + k * (L - 3) / (n - 1), 0, sg * 8.6);
          place.push(m);
        }
        g.add(tag(bakeInstanced(buildPumpTrailer(M), place, { minRadius: 0.09 }), 'pump'));
        const bl = PE.blender(K); bl.position.set(6 + L / 2 + 9, 0, 0); g.add(bl);
        const silo = PE.siloBattery(K); silo.position.set(6 + L / 2 + 34, 0, 2); g.add(silo);
        const tanks = [];
        for (let k = 0; k < 8; k++) tanks.push(new THREE.Matrix4().makeTranslation(-6 + k * 3.3, 0, -30).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)));
        g.add(bakeInstanced(PE.fracTank(K), tanks));
        const van = PE.dataVan(K); van.position.set(6 + L / 2 + 6, 0, 22); g.add(van);
        const len = (6 - L / 2) - (rowX + 9) + 1;
        for (const z of [-0.25, 0.25]) {
          const pipe = mesh(lathe([[0, 0], [0.06, 0], [0.06, len], [0, len]], { segments: 12, radius: 0 }), K.iron);
          pipe.rotation.z = Math.PI / 2; pipe.position.set(6 - L / 2 + 0.5, 1.75, z); g.add(pipe);
        }
      } else if (p.state === 'drilling') {
        g.add(bakeInstanced(wellheadSmall(K), whs));
        const rig = PE.drillingRig(K); rig.position.set(rowX, 0, wellZ(Math.floor(p.nWells / 2))); g.add(rig);
      } else {
        g.add(bakeInstanced(wellheadSmall(K), whs));
        if (p.state === 'producing') g.add(battery(K));
      }
      const lt = [];
      for (const [x, z] of [[-55, -45], [55, -45], [-55, 45], [55, 45]]) lt.push(new THREE.Matrix4().makeTranslation(x, 0, z));
      g.add(bakeInstanced(PE.lightTower(K), lt));
      const pad = mesh(box(460 * FT, 0.3, 360 * FT, 0.1), this.mat.gravel); g.add(pad);   // the gravel pad, true size
    } finally { setDetail(1); }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const out = new THREE.Group(); g.scale.setScalar(1 / 30.48); out.add(g);
    return out;
  }

  _tick(dt, t) {
    this._lodT = (this._lodT || 0) + dt;
    if (this._lodT > 0.25) { this._lodT = 0; this._lod(); }
    const still = reducedMotion();
    for (const b of this.blinkers || []) b.visible = still || Math.sin(t * 4) > 0;
    for (const a of this.anims) { a.t += dt; a.fn(Math.max(0, Math.min(1, a.t / a.dur))); }
    this.anims = this.anims.filter(a => a.t < a.dur);
    for (const m of this.lineMats || []) m.resolution.set(this.stage.canvas.clientWidth, this.stage.canvas.clientHeight);
    const cam = this.stage.camera, cv = this.stage.canvas, cw = cv.clientWidth, ch = cv.clientHeight;
    this._hud(cw, ch);
    for (const l of this.labels) {
      const p = l.pos.clone().project(cam);
      const vis = p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05 && !(l.under && !this.underground);
      l.el.style.display = vis ? '' : 'none';
      if (vis) l.el.style.transform = `translate(${(p.x * 0.5 + 0.5) * cw}px, ${(-p.y * 0.5 + 0.5) * ch}px)`;
    }
  }

  // north arrow (the screen direction of north at the view centre) and a scale bar sized to a round distance
  _hud(cw, ch) {
    const cam = this.stage.camera, tg = this.stage.controls.target;
    const a = tg.clone().project(cam), b = tg.clone().add(new THREE.Vector3(0, 0, -5)).project(cam);
    const ang = Math.atan2((b.x - a.x) * cw, (b.y - a.y) * ch);
    const deg = Math.round(THREE.MathUtils.radToDeg(ang));
    if (deg !== this._hudDeg) { this._hudDeg = deg; this.hud.querySelector('.needle').setAttribute('transform', `rotate(${deg})`); }
    // feet per pixel at the view centre; only shown when looking down (a scale bar on an oblique view would lie)
    const dist = cam.position.distanceTo(tg), off = cam.position.clone().sub(tg).normalize();
    const tilt = Math.acos(Math.min(1, off.y));
    const ftPerPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) / ch) / S;
    const sc = this.hud.querySelector('.scale');
    if (tilt > 0.5 || !isFinite(ftPerPx)) { sc.hidden = true; return; }
    sc.hidden = false;
    const NICE = [100, 200, 500, 1000, 2000, 2640, 5280, 10560, 15840, 26400];
    const maxPx = Math.min(170, cw * 0.28); let L = NICE[0]; for (const n of NICE) if (n / ftPerPx <= maxPx) L = n;
    const px = Math.round(L / ftPerPx), key = `${L}|${px}`;
    if (key === this._hudScale) return;
    this._hudScale = key;
    const fmt = (f) => (f >= 2640 && f % 1320 === 0 ? `${f / 5280 === 0.5 ? '½' : f / 5280} mi` : `${f.toLocaleString('en-US')} ft`);
    sc.querySelector('.bar').style.width = `${px}px`;
    sc.querySelector('.mid').textContent = fmt(L / 2).replace(' mi', '').replace(' ft', '');
    sc.querySelector('.endv').textContent = fmt(L);
    sc.setAttribute('aria-label', `Scale bar: ${fmt(L)}`);
  }

  // the well under the pointer, if any: on the map, the nearest well stick; underground, screen-space line picking
  wellAt(ev) {
    if (!this.underground) {
      const r = this.stage.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.stage.camera);
      const p = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return null;
      const cam = this.stage.camera, perPx = 2 * cam.position.distanceTo(p) * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) / r.height;
      let best = null, bd = 7 * perPx;
      const seg = (ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / L)); return Math.hypot(p.x - ax - t * dx, p.z - az - t * dz); };
      for (const w of this.mapWells || []) {
        const d = Math.min(seg(w.sx, w.sz, w.hx, w.hz), seg(w.hx, w.hz, w.tx, w.tz));
        if (d < bd) { bd = d; best = w.info; }
      }
      return best;
    }
    const r = this.stage.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    this.raycaster.camera = this.stage.camera;
    this.raycaster.params.Line2 = { threshold: 6 };
    if (!this.subsurface?.visible) return null;
    const hit = this.raycaster.intersectObjects(this.wellLines || [], false)[0];
    return hit ? hit.object.userData.well : null;
  }

  // the Workshop machine under the pointer, on a pad shown in full detail (frac trees and pump trailers)
  assetAt(ev) {
    if (!this.detail) return null;
    const r = this.stage.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    for (const hit of this.raycaster.intersectObject(this.detail, true)) {
      for (let o = hit.object; o; o = o.parent) if (o.userData.asset) return o.userData.asset;
      return null;   // the nearest surface is something else (the pad, a tank): no machine
    }
    return null;
  }

  // which section is under the pointer (by intersecting the surface plane)
  sectionAt(ev) {
    const r = this.stage.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return null;
    const col = Math.floor(p.x / this.SEC + this.cols / 2), row = Math.floor(p.z / this.SEC + this.rows / 2);
    return this.C.sections.find(s => s.col === col && s.row === row)?.section || null;
  }
}

function wellheadSmall(K) {   // a producing wellhead with its small production tree, metres
  const g = new THREE.Group();
  g.add(mesh(lathe([[0, -0.5], [0.3, -0.5], [0.3, 0.7], [0.18, 0.8], [0.18, 1.9], [0.1, 2.0], [0, 2.0]], { segments: 24, radius: 0.02 }), K.treePaint));
  for (const y of [1.0, 1.5]) { const hw = mesh(lathe([[0, -0.03], [0.22, -0.03], [0.22, 0.03], [0, 0.03]], { segments: 20, radius: 0.005 }), K.handwheel); hw.rotation.z = Math.PI / 2; hw.position.set(0.32, y, 0); g.add(hw); }
  const wing = mesh(lathe([[0, 0], [0.08, 0], [0.08, 0.8], [0, 0.8]], { segments: 12, radius: 0 }), K.treePaint); wing.rotation.x = Math.PI / 2; wing.position.set(0, 1.3, 0); g.add(wing);
  return g;
}
function battery(K) {   // tank battery: 400 bbl tanks, a separator, a heater-treater and a flare (sizes estimated)
  const g = new THREE.Group();
  const tank = (x, z) => { const t = mesh(lathe([[0, 0], [1.83, 0], [1.83, 6.1], [1.6, 6.4], [0, 6.5]], { segments: 32, radius: 0.04 }), K.white); t.position.set(x, 0, z); g.add(t); };
  for (let k = 0; k < 4; k++) tank(30 + k * 4.6, -30);
  const sep = mesh(lathe([[0, 0], [0.75, 0], [0.75, 4.5], [0, 4.6]], { segments: 24, radius: 0.05 }), K.galv); sep.rotation.z = Math.PI / 2; sep.position.set(30, 1.5, -20); g.add(sep);
  const ht = mesh(lathe([[0, 0], [1.0, 0], [1.0, 6], [0, 6.2]], { segments: 24, radius: 0.05 }), K.white); ht.position.set(40, 0, -20); g.add(ht);
  const flare = mesh(lathe([[0, 0], [0.2, 0], [0.12, 12], [0, 12]], { segments: 12, radius: 0 }), K.galv); flare.position.set(60, 0, -45); g.add(flare);
  return g;
}

function hash01(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; }

function tag(o, asset) { o.userData.asset = asset; return o; }   // equipment the Workshop can open
function at(o, x, y, z) { o.position.set(x, y, z); return o; }
const fmtM = (m) => `Y${Math.floor(m / 12) + 1} M${Math.floor(m % 12) + 1}`;
