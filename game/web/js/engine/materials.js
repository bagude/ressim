// Material library. Every material is a MeshPhysicalMaterial whose surface detail is computed in the shader from
// world position (3D noise, so no UVs and no texture files) and from the aEdge / aCavity attributes written by kit.js.
//
// Rules carried from the Teardown skill checklist:
//   - roughness >= 0.45 and envMapIntensity ~0.5 on large painted surfaces; only machined faces go glossy
//   - emissive stays under 1.0 so bloom never eats detail
//   - no pure black or pure white base colours
import * as THREE from 'three';

const NOISE = /* glsl */`
float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int k = 0; k < 5; k++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

// opts:
//   paint      THREE.Color or null (bare metal)       base colour of the coating
//   under      colour revealed by chips (bare steel)
//   chip       0..1 how much edge wear exposes the under-layer
//   grime      0..1 dirt in cavities and toward the ground
//   grimeColor colour of the dirt
//   rough      base roughness, roughVar random variation
//   metal      base metalness of the coating
//   bump       amplitude of cast / orange-peel surface texture (metres-ish), bumpFreq its spatial frequency
//   streak     0..1 vertical run-off streaks (weathering on painted sides)
//   machined   0..1 fine concentric-ish lines for turned faces
export function surface(opts = {}) {
  const o = Object.assign({
    paint: new THREE.Color('#b8322a'), under: new THREE.Color('#3f4143'), chip: 0.5, grime: 0.4,
    grimeColor: new THREE.Color('#3b3228'), rough: 0.55, roughVar: 0.15, metal: 0.0, bump: 0.25, bumpFreq: 140,
    streak: 0.2, machined: 0, tread: 0, bands: 0, clearcoat: 0, envMapIntensity: 0.55, groundY: 0, name: 'surface'
  }, opts);
  const m = new THREE.MeshPhysicalMaterial({
    color: o.paint || o.under, roughness: o.rough, metalness: o.paint ? o.metal : 1.0,
    clearcoat: o.clearcoat, clearcoatRoughness: 0.35, envMapIntensity: o.envMapIntensity,
  });
  m.name = o.name;
  const U = {
    uUnder: { value: o.under }, uChip: { value: o.chip }, uGrime: { value: o.grime }, uGrimeCol: { value: o.grimeColor },
    uRoughVar: { value: o.roughVar }, uBump: { value: o.bump }, uBumpFreq: { value: o.bumpFreq },
    uStreak: { value: o.streak }, uMachined: { value: o.machined }, uGroundY: { value: o.groundY },
    uBare: { value: o.paint ? 0 : 1 }, uTread: { value: o.tread }, uBands: { value: o.bands },
  };
  m.userData.uniforms = U;
  m.customProgramCacheKey = () => 'surface-v1';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aEdge; attribute float aCavity;
        varying float vEdge; varying float vCav; varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vOPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vEdge = aEdge; vCav = aCavity; vOPos = position;
        vec4 wp_ = vec4(transformed, 1.0);
        vec3 wn_ = objectNormal;
        #ifdef USE_INSTANCING
          wp_ = instanceMatrix * wp_; wn_ = mat3(instanceMatrix) * wn_;
          vOPos = (instanceMatrix * vec4(position, 1.0)).xyz;
        #endif
        wp_ = modelMatrix * wp_; vWPos = wp_.xyz; vWNrm = normalize(mat3(modelMatrix) * wn_);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uUnder; uniform float uChip; uniform float uGrime; uniform vec3 uGrimeCol; uniform float uRoughVar;
        uniform float uBump; uniform float uBumpFreq; uniform float uStreak; uniform float uMachined; uniform float uGroundY;
        uniform float uBare; uniform float uTread; uniform float uBands;
        varying float vEdge; varying float vCav; varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vOPos;
        ${NOISE}
        float gChipMask; float gGrimeMask; float gHeight;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 P = vWPos;
          float n1 = fbm(P * 9.0);
          float n2 = fbm(P * 41.0 + 3.7);
          // chips: only some stretches of an edge are worn through, plus the odd knock on a flat face
          float edgeChip = vEdge * smoothstep(1.02 - uChip * 0.6, 1.06 - uChip * 0.6, n1 * 0.7 + n2 * 0.55);
          float faceChip = smoothstep(0.80, 0.83, fbm(P * 23.0 + 9.1)) * uChip * 0.8;
          gChipMask = (1.0 - uBare) * clamp(edgeChip + faceChip, 0.0, 1.0);
          // grime: cavities + low on the part + streaks down vertical faces
          float low = 1.0 - smoothstep(uGroundY, uGroundY + 1.2, P.y);
          float streak = pow(vnoise(vec3(P.x * 38.0, P.y * 1.6, P.z * 38.0)), 3.0) * (1.0 - abs(vWNrm.y)) * uStreak;
          gGrimeMask = clamp(vCav * 0.9 + low * 0.35 + streak * 1.6 + (n1 - 0.55) * 0.6, 0.0, 1.0) * uGrime;
          vec3 base = diffuseColor.rgb * (0.88 + 0.24 * n2);                       // paint tone variation
          if (uBands > 0.0) {   // sedimentary layering: horizontal bands, gently warped
            float y = P.y * 7.0 + fbm(vec3(P.x * 0.4, 0.0, P.z * 0.4)) * 1.6;
            float band = fbm(vec3(0.0, y, 0.0) * 1.0 + 4.0);
            base *= mix(1.0, 0.7 + 0.6 * band, uBands);
          }
          base = mix(base, uUnder * (0.8 + 0.4 * n2), gChipMask);
          base = mix(base, uGrimeCol, gGrimeMask * 0.85);
          // machined faces: fine turning marks around the local axis
          float rr = length(vOPos.xz);
          base *= 1.0 - uMachined * 0.08 * (0.5 + 0.5 * sin(rr * 9000.0 + n2 * 6.0));
          diffuseColor.rgb = base;
          gHeight = (n2 * 0.6 + fbm(P * uBumpFreq) * 0.4) * (1.0 - gChipMask * 0.5);
          if (uTread > 0.0) {
            // diamond tread plate: raised lozenges on a 30 mm grid, alternating direction (top faces only)
            vec2 c = P.xz / 0.03; vec2 cell = floor(c); vec2 f = fract(c) - 0.5;
            float flip = mod(cell.x + cell.y, 2.0) * 2.0 - 1.0;
            vec2 r = vec2(f.x * 0.7071 - f.y * 0.7071 * flip, f.x * 0.7071 * flip + f.y * 0.7071);
            float loz = 1.0 - smoothstep(0.05, 0.09, length(vec2(r.x * 0.32, r.y * 1.5)));
            vec2 fw = fwidth(c); loz *= 1.0 - smoothstep(0.15, 0.45, max(fw.x, fw.y));   // fade out before it aliases
            gHeight += loz * uTread * step(0.7, vWNrm.y) * 6.0;
            diffuseColor.rgb *= 1.0 + loz * 0.12 * step(0.7, vWNrm.y);
          }
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (fbm(vWPos * 23.0) - 0.5) * uRoughVar * 2.0
          + gGrimeMask * 0.25 - gChipMask * 0.12, 0.04, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 1.0, gChipMask);
        metalnessFactor = mix(metalnessFactor, 0.0, gGrimeMask * 0.8);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
          float hx = dFdx(gHeight), hy = dFdy(gHeight);
          vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
          float det = dot(dpdx, r1);
          vec3 grad = sign(det) * (hx * r1 + hy * r2);
          normal = normalize(abs(det) * normal - uBump * 0.004 * grad);
        }`);
  };
  return m;
}

// The library. Colours are linear-light approximations of common oilfield finishes.
export function library() {
  const c = (h) => new THREE.Color(h);
  return {
    // frac tree body paint: service companies run red, blue, yellow or white trees; we use a worn safety red
    treePaint: surface({ name: 'tree paint', paint: c('#8a140d'), chip: 0.7, grime: 0.6, rough: 0.5, roughVar: 0.2, streak: 0.5 }),
    // ring-groove and flange faces: bare machined steel with a light oil film
    machined: surface({ name: 'machined steel', paint: null, under: c('#8a8d90'), chip: 0, grime: 0.15, rough: 0.28,
      roughVar: 0.06, bump: 0.05, machined: 1 }),
    // B7 studs and 2H nuts are usually black-oxide or xylan-coated
    stud: surface({ name: 'B7 stud', paint: null, under: c('#2e2f31'), chip: 0, grime: 0.25, rough: 0.5, bump: 0.6, bumpFreq: 400 }),
    nut: surface({ name: '2H nut', paint: null, under: c('#3a3b3d'), chip: 0, grime: 0.3, rough: 0.48, bump: 0.3 }),
    // ring gasket: soft iron / stainless, cadmium or zinc plated
    gasket: surface({ name: 'BX gasket', paint: null, under: c('#b9b4a6'), chip: 0, grime: 0.05, rough: 0.22, bump: 0.02 }),
    // handwheel and actuator housings
    handwheel: surface({ name: 'handwheel', paint: c('#1f2124'), chip: 0.7, grime: 0.3, rough: 0.55, under: c('#6f7173') }),
    actuator: surface({ name: 'actuator', paint: c('#c9a227'), chip: 0.45, grime: 0.4, rough: 0.5 }),
    galv: surface({ name: 'galvanised', paint: null, under: c('#9da3a6'), chip: 0, grime: 0.3, rough: 0.62, roughVar: 0.3, bump: 0.2 }),
    rubber: surface({ name: 'rubber', paint: c('#1c1c1d'), chip: 0, grime: 0.35, rough: 0.85, bump: 0.4, bumpFreq: 300 }),
    brass: surface({ name: 'brass', paint: null, under: c('#b08d57'), chip: 0, grime: 0.2, rough: 0.32 }),
    plate: surface({ name: 'nameplate', paint: null, under: c('#a7aaad'), chip: 0, grime: 0.1, rough: 0.4, bump: 0.02 }),
    gaugeFace: new THREE.MeshPhysicalMaterial({ color: c('#e8e4da'), roughness: 0.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: c('#ffffff'), roughness: 0.03, transmission: 1, thickness: 0.004, ior: 1.5 }),
  };
}
