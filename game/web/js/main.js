// Workshop view: one machine on a studio floor. URL parameters make every screenshot reproducible:
//   ?asset=tree|pump  &explode=0..1  &cam=<preset>  &part=<id>  &ui=0 (hide HUD)  &perf=1 (frame rate)
// window.__ready becomes true after the scene has rendered a few frames.
import * as THREE from 'three';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { Stage } from './engine/stage.js';
import { library } from './engine/materials.js';
import * as Tree from './assets/fracTree.js';
import * as Pump from './assets/pumpTrailer.js';

const q = new URLSearchParams(location.search);
const ASSETS = {
  tree: {
    title: 'Frac tree', sub: '7-1/16 in bore, 15,000 psi. Click a part to inspect it, or pull the stack apart below.',
    build: Tree.buildFracTree, explode: Tree.setExplode, cards: Tree.CARDS,
    list: ['goat', 'swab', 'cross', 'umv', 'lmv', 'wellhead'], listLabel: 'Parts, top of the tree first',
    cams: (H, d) => ({
      hero: [[d * 0.5, H * 0.62, d * 0.8], [0, H * 0.5, 0]],
      front: [[0, H * 0.5, d], [0, H * 0.5, 0]],
      flange: [[0.9, 0.85, 1.0], [0, 0.62, 0]],
      top: [[1.2, H + 1.2, 1.4], [0, H - 0.3, 0]],
    }),
    span: (r) => r.userData.height,
  },
  pump: {
    title: 'Frac pump', sub: '2,500 hp diesel pump trailer. The pump is running; pull it apart to see the power train.',
    build: Pump.buildPumpTrailer, explode: Pump.setExplode, cards: Pump.CARDS,
    list: ['tractor', 'radiator', 'engine', 'transmission', 'driveshaft', 'powerEnd', 'plungers', 'fluidEnd'],
    listLabel: 'Power train, front to back',
    cams: (H, d) => ({
      hero: [[2.6 + d * 0.42, 4.4, d * 0.72], [2.4, 1.5, 0]],
      side: [[2.6, 2.2, d * 0.95], [2.6, 1.8, 0]],
      pump: [[-8.2, 2.8, 3.6], [-4.8, 1.7, 0]],
      engine: [[3.4, 4.6, 4.0], [1.9, 2.2, 0]],
    }),
    span: (r) => r.userData.length * 0.44,
  },
};
const key = ASSETS[q.get('asset')] ? q.get('asset') : 'tree';
const A = ASSETS[key];

const stage = new Stage(document.getElementById('view'));
const M = library();
stage.addStudioFloor();
stage.configure({ size: key === 'pump' ? 16 : 4 });   // shadow box, fog and key light sized to the machine

const root = A.build(M);
stage.scene.add(root);
const H = root.userData.height;
const span = A.span(root);
const fitDist = (span * 0.8) / Math.tan(THREE.MathUtils.degToRad(stage.camera.fov / 2));
const CAMS = A.cams(H, fitDist);
const c0 = CAMS[q.get('cam')] || CAMS.hero;
stage.camera.position.set(...c0[0]); stage.controls.target.set(...c0[1]);

document.querySelector('.title h1').textContent = A.title;
document.querySelector('.title p').textContent = A.sub;
document.title = `Frac Challenge: ${A.title}`;
document.querySelector('.stack').setAttribute('aria-label', A.listLabel);
document.getElementById('view').setAttribute('aria-label', `3D view of a ${A.title.toLowerCase()}`);

// machine switcher
const sw = document.getElementById('switch');
// opened from the career's field view: keep the way back (same-site relative pages only)
const back = /^[a-z]+\.html(\?[^#]*)?$/i.test(q.get('back') || '') ? q.get('back') : null;
for (const [k, a] of Object.entries(ASSETS)) {
  const b = document.createElement('a');
  b.href = `?asset=${k}${back ? `&back=${encodeURIComponent(back)}` : ''}`; b.textContent = a.title;
  if (k === key) b.setAttribute('aria-current', 'page');
  sw.appendChild(b);
}
{
  const home = document.createElement('a');
  home.href = back || './'; home.textContent = back ? 'Back to your field' : 'Main menu'; home.className = 'back';
  sw.appendChild(home);
}

// selection outline: amber, thin, no pulse
const outline = new OutlinePass(new THREE.Vector2(innerWidth, innerHeight), stage.scene, stage.camera);
outline.edgeStrength = 3.2; outline.edgeThickness = 1.0; outline.edgeGlow = 0;
outline.visibleEdgeColor.set('#f0a53a'); outline.hiddenEdgeColor.set('#5a3e16');
stage.composer.insertPass(outline, 2);
addEventListener('resize', () => outline.setSize(innerWidth, innerHeight));

// ------------------------------------------------------------------ explode
const slider = document.getElementById('explode');
let explodeTarget = Number(q.get('explode') ?? 0), explodeNow = explodeTarget;
slider.value = explodeTarget;
slider.addEventListener('input', () => { explodeTarget = Number(slider.value); });
A.explode(root, explodeNow);
stage.onUpdate((dt) => {
  explodeNow += (explodeTarget - explodeNow) * (1 - Math.exp(-dt * 8));
  A.explode(root, explodeNow);
  root.userData.update?.(dt);
});

// ------------------------------------------------------------------ parts list and nameplate
const partsById = Object.fromEntries(root.userData.parts.map(p => [p.name, p]));
const list = document.getElementById('stack-list');
for (const id of A.list) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.textContent = A.cards[id].name; b.dataset.id = id;
  b.addEventListener('click', () => select(id, true));
  li.appendChild(b); list.appendChild(li);
}

const plate = document.getElementById('plate');
function select(id, fly = false) {
  const p = partsById[id];
  for (const b of list.querySelectorAll('button')) b.setAttribute('aria-current', String(b.dataset.id === id));
  if (!p) { outline.selectedObjects = []; plate.hidden = true; return; }
  outline.selectedObjects = [p];
  const c = p.userData.card;
  document.getElementById('plate-name').textContent = c.name;
  document.getElementById('plate-does').textContent = c.does;
  const dl = document.getElementById('plate-specs'); dl.replaceChildren();
  for (const s of c.specs) { const d = document.createElement('div'); d.textContent = s; dl.appendChild(d); }
  document.getElementById('plate-est').textContent = c.est ? `Estimated: ${c.est}.` : '';
  plate.hidden = false;
  if (fly) {
    const box = new THREE.Box3().setFromObject(p);
    const ctr = box.getCenter(new THREE.Vector3());
    const r = Math.max(0.6, box.getSize(new THREE.Vector3()).length() * 1.1);
    const dir = stage.camera.position.clone().sub(stage.controls.target).normalize();
    stage.flyTo(ctr.clone().addScaledVector(dir, r * 1.6).toArray(), ctr.toArray());
  }
}

// ------------------------------------------------------------------ picking
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tag = document.createElement('div'); tag.className = 'hover-tag'; tag.hidden = true; document.body.appendChild(tag);
function partAt(ev) {
  const r = stage.canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, stage.camera);
  const hit = ray.intersectObject(root, true)[0];
  let o = hit?.object;
  while (o && !o.userData?.card) o = o.parent;
  return o || null;
}
let down = null;
stage.canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
stage.canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;   // it was an orbit drag
  const p = partAt(e);
  select(p ? p.name : null);
});
stage.canvas.addEventListener('pointermove', (e) => {
  if (e.buttons) { tag.hidden = true; return; }
  const p = partAt(e);
  tag.hidden = !p;
  if (p) { tag.textContent = p.userData.card.name; tag.style.left = e.clientX + 'px'; tag.style.top = e.clientY + 'px'; }
  stage.canvas.style.cursor = p ? 'pointer' : '';
});

// ------------------------------------------------------------------ boot
if (q.get('ui') === '0') document.querySelectorAll('header, nav, aside, .explode, footer').forEach(e => e.style.display = 'none');
if (q.get('part')) select(q.get('part'));
const perf = document.getElementById('perf');
if (q.get('perf') === '1') perf.hidden = false;
let frames = 0;
stage.onUpdate(() => {
  frames++;
  if (frames === 30) window.__ready = true;
  if (!perf.hidden && frames % 30 === 0) perf.textContent = `${stage.fps().toFixed(0)} fps`;
});
window.__stage = stage; window.__root = root;
stage.start();
