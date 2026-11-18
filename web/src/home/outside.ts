// Город за окном: башни с окнами, улицы с машинами, туман, облака, дождь.
// Всё процедурное и рисуется шейдерами — никаких текстур и моделей.
import * as THREE from "three";
import { GLSL_NOISE, rng } from "./util";

/** Общие для всего «улица»-слоя параметры */
export function makeOutsideUniforms() {
  return {
    uTime: { value: 0 },
    uRain: { value: 0 }, // 0 — туман, 1 — дождь
    uFogLow: { value: new THREE.Color(0.2, 0.13, 0.12) },
    uFogHigh: { value: new THREE.Color(0.075, 0.075, 0.1) },
    uFogDensity: { value: 0.0011 },
    uCloudBase: { value: 120 },
    uMist: { value: 1 },
  };
}
export type OutsideUniforms = ReturnType<typeof makeOutsideUniforms>;

export const STREET_Y = -140; // мы на ~40-м этаже

const FOG_GLSL = /* glsl */ `
uniform vec3 uFogLow;
uniform vec3 uFogHigh;
uniform float uFogDensity;
uniform float uCloudBase;
uniform float uMist;
uniform float uTime;
uniform float uRain;

vec3 fogColorAt(vec3 wp, vec3 dir) {
  // туман подсвечен городом снизу: тёплый у земли, холодный вверху
  float h = smoothstep(${STREET_Y.toFixed(1)}, 260.0, wp.y);
  vec3 c = mix(uFogLow, uFogHigh, h);
  return c;
}

vec3 applyFog(vec3 col, vec3 wp) {
  vec3 d = wp - cameraPosition;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-3);
  float dens = uFogDensity * (1.0 + 0.6 * uRain);
  // пятнистая дымка, медленно плывёт по ветру
  vec3 mp = wp * vec3(0.0045, 0.009, 0.0045) + vec3(uTime * 0.012, -uTime * 0.004, uTime * 0.007);
  float m = vnoise3(mp) * 0.62 + vnoise3(mp * 2.13 + 7.1) * 0.3;
  float patchy = mix(1.0, 0.35 + 1.5 * m, uMist);
  // у нас на высоте — полоса низких облаков
  float band = exp(-pow((wp.y - 15.0) / 70.0, 2.0)) * 0.9;
  float base = 1.0 - exp(-dist * dens * (patchy + band));
  // верхушки небоскрёбов уходят в облака
  float cloud = smoothstep(uCloudBase - 50.0, uCloudBase + 70.0, wp.y) * (1.0 - exp(-dist * 0.006));
  float a = clamp(base + cloud, 0.0, 1.0);
  return mix(col, fogColorAt(wp, dir), a);
}
`;

// ------------------------------------------------------------------ небоскрёбы

const TOWER_VS = /* glsl */ `
attribute float aSeed;
attribute float aType;
attribute float aLit;
attribute float aCrown;
varying vec3 vFacade;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vSize;
varying float vSeed;
varying float vType;
varying float vLit;
varying float vCrown;
void main() {
  vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vFacade = (position + vec3(0.5, 0.0, 0.5)) * sc;
  vSize = sc;
  vN = normal;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vSeed = aSeed; vType = aType; vLit = aLit; vCrown = aCrown;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const TOWER_FS = /* glsl */ `
varying vec3 vFacade;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vSize;
varying float vSeed;
varying float vType;
varying float vLit;
varying float vCrown;
${GLSL_NOISE}
${FOG_GLSL}

vec3 winColor(float h) {
  vec3 warm = vec3(1.0, 0.5, 0.2);
  vec3 neutral = vec3(1.0, 0.72, 0.42);
  vec3 cool = vec3(0.62, 0.78, 1.0);
  vec3 c = h < 0.55 ? warm : (h < 0.9 ? neutral : cool);
  return c;
}

vec3 crownColor(float k) {
  if (k < 1.5) return vec3(1.0, 0.86, 0.66);   // тёплая подсветка
  if (k < 2.5) return vec3(0.35, 1.0, 0.62);   // зелёная, как у Эмпайр-стейт
  if (k < 3.5) return vec3(0.35, 0.7, 1.0);    // голубая
  return vec3(1.0, 0.32, 0.5);                 // малиновая
}

void main() {
  vec3 n = normalize(vN);
  vec3 col;
  float type = vType;
  if (n.y > 0.5) {
    col = vec3(0.012, 0.012, 0.014);
  } else {
    vec2 fuv; float face;
    if (abs(n.x) > 0.5) { fuv = vec2(vFacade.z * sign(n.x), vFacade.y); face = n.x > 0.0 ? 1.0 : 2.0; }
    else { fuv = vec2(-vFacade.x * sign(n.z), vFacade.y); face = n.z > 0.0 ? 3.0 : 4.0; }

    vec2 cellSize = type < 0.5 ? vec2(3.1, 3.9) : (type < 1.5 ? vec2(3.8, 3.05) : (type < 2.5 ? vec2(1.6, 3.9) : vec2(3.4, 3.6)));
    vec2 g = fuv / cellSize;
    vec2 id = floor(g);
    vec2 f = fract(g);
    vec2 wm = type < 0.5 ? vec2(0.07, 0.16) : (type < 1.5 ? vec2(0.2, 0.24) : vec2(0.05, 0.1));
    float inWin = step(wm.x, f.x) * step(f.x, 1.0 - wm.x) * step(wm.y, f.y) * step(f.y, 0.92);

    float rowH = hash12(vec2(id.y * 1.13, vSeed * 97.0 + face * 3.7));
    float r = hash12(id + vec2(face * 31.7, vSeed * 517.0));
    // окна горят пятнами: соседние квартиры/офисы похожи
    float cluster = vnoise(id * vec2(0.22, 0.3) + vSeed * 40.0 + face * 9.0);
    float lit;
    if (type < 0.5) {
      // офисы: целые этажи горят, остальное — редкие окна
      float floorOn = step(rowH, vLit * 0.5);
      lit = max(floorOn * step(r, 0.93), step(r, vLit * 0.5 * smoothstep(0.35, 0.8, cluster)));
    } else if (type < 1.5) {
      lit = step(r, vLit * (0.25 + 1.3 * smoothstep(0.3, 0.85, cluster)));
    } else if (type < 2.5) {
      lit = step(r, vLit * 0.5 * cluster);
    } else {
      lit = step(r, vLit * 0.25);
    }
    // внутри одного этажа яркость ровнее, чем между этажами
    float br = 0.45 + 0.6 * hash12(vec2(id.y, vSeed * 7.0 + face)) + 0.35 * hash12(id * 1.7 + vSeed * 13.0 + face);
    vec3 wc = winColor(mix(hash12(id + 3.1 + vSeed * 9.0 + face), cluster, 0.5)) * br * 1.45;
    // кое-где мерцает телевизор
    float tv = step(0.985, hash12(id + 7.7 + vSeed));
    wc = mix(wc, vec3(0.45, 0.6, 1.0) * (0.8 + 0.6 * sin(uTime * 7.0 + r * 40.0) * sin(uTime * 2.3 + r * 10.0)), tv);
    // остывающая тёплая лампа внутри — свет ярче у пола окна, мягче у потолка
    wc *= 0.75 + 0.35 * (1.0 - f.y);

    vec3 wall = vec3(0.016, 0.017, 0.02);
    vec3 glass = vec3(0.016, 0.019, 0.028);
    if (type > 1.5 && type < 2.5) {
      // стеклянная башня со светодиодными рёбрами (как в «Скайфолле»)
      glass = vec3(0.01, 0.02, 0.04);
      wall = glass;
    }
    vec3 c = mix(wall, mix(glass, wc, lit), inWin);

    // фильтрация на расстоянии: окна мельче пикселя — берём среднее
    vec2 fw = fwidth(g);
    float aa = smoothstep(0.3, 1.1, max(fw.x, fw.y));
    float area = (1.0 - 2.0 * wm.x) * (0.92 - wm.y);
    float litAvg = type < 0.5 ? vLit * 0.62 : (type < 1.5 ? vLit : vLit * 0.4);
    vec3 avg = mix(wall, mix(glass, vec3(1.0, 0.62, 0.32) * 1.15, litAvg), area);
    // сохраняем полосатость этажей вдалеке
    avg *= 0.7 + 0.6 * step(rowH, 0.5 + vLit * 0.4);
    c = mix(c, avg, aa);

    if (type > 1.5 && type < 2.5) {
      float edge = abs(f.x - 0.5) * 2.0;
      float line = smoothstep(0.86, 1.0, edge);
      float wave = 0.55 + 0.45 * sin(fuv.y * 0.045 - uTime * 0.9 + vSeed * 20.0);
      vec3 led = vec3(0.12, 0.42, 1.0) * 3.2 * wave;
      float lineAA = mix(line, 0.12, aa);
      c += led * lineAA;
      // поэтажные полосы
      float fl = smoothstep(0.92, 1.0, abs(f.y - 0.5) * 2.0);
      c += vec3(0.1, 0.3, 0.8) * 0.5 * mix(fl, 0.08, aa);
    }

    // лобби у земли
    c += vec3(1.0, 0.7, 0.4) * 2.0 * smoothstep(9.0, 0.0, fuv.y) * (0.5 + 0.5 * hash12(vec2(face, vSeed)));

    // подсветка короны
    if (vCrown > 0.5) {
      float ch = min(vSize.y * 0.07, 28.0);
      float t = smoothstep(vSize.y - ch, vSize.y, fuv.y);
      c += crownColor(vCrown) * t * 3.0;
    }
    col = c;
  }
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------ земля: улицы и море огней

const GROUND_VS = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const GROUND_FS = /* glsl */ `
varying vec3 vWorld;
uniform float uBlock;
uniform float uStreet;
${GLSL_NOISE}
${FOG_GLSL}
void main() {
  vec2 p = vWorld.xz;
  vec2 bp = (p + uStreet * 0.5) / uBlock;
  vec2 bid = floor(bp);
  vec2 bf = fract(bp) * uBlock; // метры внутри квартала
  // расстояние до ближайшей улицы
  vec2 e = min(bf, uBlock - bf);
  float roadW = uStreet * 0.5;
  float roadX = 1.0 - smoothstep(roadW - 1.0, roadW + 1.0, e.x);
  float roadZ = 1.0 - smoothstep(roadW - 1.0, roadW + 1.0, e.y);
  float road = max(roadX, roadZ);
  // проспекты — каждый 4-й
  float aveX = step(mod(bid.x, 4.0), 0.5);
  float aveZ = step(mod(bid.y, 4.0), 0.5);

  vec3 col = vec3(0.008, 0.008, 0.01);
  // крыши малоэтажки и окна-огоньки
  vec2 lc = p / 9.0;
  vec2 lid = floor(lc);
  vec2 lf = fract(lc) - 0.5;
  vec3 h = hash32(lid);
  float on = step(h.x, 0.32) * (1.0 - road);
  float dotR = 0.12 + 0.1 * h.y;
  float dotv = smoothstep(dotR, 0.0, length(lf - (h.yz - 0.5) * 0.5));
  vec3 lightCol = h.z < 0.75 ? vec3(1.0, 0.62, 0.3) : vec3(0.7, 0.85, 1.0);
  vec2 fw = fwidth(lc);
  float aa = smoothstep(0.2, 0.9, max(fw.x, fw.y));
  vec3 dots = lightCol * mix(dotv * on * 4.0, 0.32 * 0.07 * 4.0 * 1.6, aa);
  col += dots * (1.0 - road);

  // фонари вдоль улиц: натриевые на обычных, белые на проспектах
  float along = (roadX > 0.5) ? p.y : p.x;
  float lampRow = fract(along / 28.0);
  float lamp = smoothstep(0.08, 0.0, abs(lampRow - 0.5) - 0.0) ;
  vec3 sodium = vec3(1.0, 0.5, 0.16);
  vec3 white = vec3(1.0, 0.9, 0.75);
  float ave = (roadX > 0.5) ? aveX : aveZ;
  vec3 lampCol = mix(sodium, white, ave);
  float lampAA = smoothstep(0.02, 0.2, fwidth(along / 28.0));
  col += road * lampCol * mix(lamp * 3.0 + 0.35, 0.65, lampAA) * (0.8 + 1.4 * ave);
  // мокрый асфальт: в дождь улицы блестят и краснеют от стоп-сигналов
  col += road * uRain * (vec3(1.0, 0.12, 0.08) * 0.6 * ave + vec3(0.25, 0.22, 0.2) * 0.4);

  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------ огни: машины, авиаогни

const POINTS_VS = /* glsl */ `
attribute vec3 aDir;     // направление движения (xz) и длина участка в .z
attribute float aSpeed;
attribute float aPhase;
attribute vec3 aColor;
attribute float aSize;
attribute float aBlink;
uniform float uTime;
uniform float uPx;
varying vec3 vColor;
varying vec3 vWorld;
varying float vA;
void main() {
  vec3 p = position;
  if (aSpeed != 0.0) {
    float s = mod(aPhase + uTime * aSpeed, aDir.z);
    p.xz += normalize(aDir.xy) * s;
  }
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  float sz = aSize * uPx / -mv.z;
  gl_PointSize = max(sz, 1.4);
  // мелкие точки гасим, чтобы не мерцали
  vA = clamp(sz / 1.4, 0.35, 1.0);
  float blink = 1.0;
  if (aBlink > 0.0) blink = step(0.62, fract(uTime * 0.75 + aBlink * 7.0)) * 1.0 + 0.04;
  vColor = aColor * blink;
  gl_Position = projectionMatrix * mv;
}
`;

const POINTS_FS = /* glsl */ `
varying vec3 vColor;
varying vec3 vWorld;
varying float vA;
${GLSL_NOISE}
${FOG_GLSL}
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  vec3 col = vColor * a * vA;
  // туман «съедает» огни, но они пробиваются ореолом
  vec3 fogged = applyFog(col, vWorld);
  col = mix(fogged, col, 0.25);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------ небо и облака

const SKY_FS = /* glsl */ `
varying vec3 vWorld;
${GLSL_NOISE}
${FOG_GLSL}
void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  float el = dir.y;
  vec3 horizon = mix(uFogLow, uFogHigh, 0.35) * 1.15;
  vec3 zenith = vec3(0.012, 0.013, 0.02);
  vec3 col = mix(horizon, zenith, smoothstep(-0.02, 0.55, el));
  // облака подсвечены городом снизу
  vec2 uv = dir.xz / max(el + 0.08, 0.04);
  float c1 = fbm(uv * 0.55 + vec2(uTime * 0.006, uTime * 0.002));
  float c2 = fbm(uv * 1.7 - vec2(uTime * 0.01, 0.0));
  float cl = smoothstep(0.32, 0.8, c1 * 0.75 + c2 * 0.35);
  vec3 lit = mix(uFogLow * 1.3, uFogHigh * 1.6, smoothstep(0.0, 0.4, el));
  col = mix(col, lit, cl * smoothstep(-0.02, 0.06, el) * 0.85);
  col = mix(col, horizon, smoothstep(0.06, -0.03, el));
  gl_FragColor = vec4(col, 1.0);
}
`;

const CLOUD_FS = /* glsl */ `
varying vec3 vWorld;
uniform float uLayer;
${GLSL_NOISE}
${FOG_GLSL}
void main() {
  vec2 p = vWorld.xz * 0.0016 + vec2(uTime * 0.004 + uLayer * 3.0, uTime * 0.0016);
  float n = fbm(p) * 0.7 + fbm(p * 3.1 + 5.0) * 0.4;
  float a = smoothstep(0.38, 0.85, n);
  float dist = length(vWorld - cameraPosition);
  a *= smoothstep(9000.0, 2500.0, dist) * smoothstep(60.0, 300.0, dist);
  vec3 col = mix(uFogLow, uFogHigh, 0.55) * (1.05 + 0.5 * n);
  gl_FragColor = vec4(col, a * (0.55 + 0.25 * uRain));
}
`;

const MIST_FS = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
uniform float uSeed;
${GLSL_NOISE}
${FOG_GLSL}
void main() {
  vec2 p = vWorld.xy * vec2(0.012, 0.02) + vec2(vWorld.z * 0.01, 0.0);
  p += vec2(-uTime * 0.035, uTime * 0.004) + uSeed * 10.0;
  float n = fbm(p) * 0.65 + fbm(p * 2.7 + uSeed) * 0.45;
  float a = smoothstep(0.42, 0.95, n);
  // мягкие края полотна
  a *= smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x) * smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
  vec3 col = fogColorAt(vWorld, vec3(0.0)) * (1.2 + 0.5 * n);
  gl_FragColor = vec4(col, a * uMist * (0.5 + 0.35 * uRain));
}
`;

const RAIN_VS = /* glsl */ `
attribute float aEnd;
uniform float uTime;
uniform float uRain;
varying float vA;
varying vec3 vWorld;
void main() {
  vec3 p = position;
  float speed = 9.0 + fract(p.x * 13.17 + p.z * 7.31) * 3.0;
  p.y = mod(p.y - uTime * speed, 60.0) - 30.0;
  p.x += uTime * 0.0;
  // штрих: вторая вершина ниже и чуть сбоку — ветер
  p += aEnd * vec3(-0.06, -0.55, 0.02);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vA = uRain * (1.0 - aEnd * 0.8);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const RAIN_FS = /* glsl */ `
varying float vA;
varying vec3 vWorld;
uniform vec3 uFogHigh;
uniform vec3 uFogLow;
void main() {
  float d = length(vWorld - cameraPosition);
  float a = vA * 0.32 * smoothstep(70.0, 6.0, d);
  gl_FragColor = vec4(mix(uFogLow, uFogHigh, 0.5) * 3.2, a);
}
`;

const BASIC_VS = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// ------------------------------------------------------------------ дома-модели (Sketchfab)

/** Где стоят дома-модели: x, z, поворот, имя узла в ките, радиус «расчистки» */
export const CITY_SLOTS: { x: number; z: number; rot: number; item: string; r: number }[] = [
  { x: -60, z: -250, rot: 0, item: "b23", r: 45 },
  { x: -270, z: -330, rot: Math.PI / 2, item: "b21", r: 40 },
  { x: -430, z: -520, rot: 0, item: "b25", r: 60 },
  { x: 40, z: -730, rot: Math.PI, item: "b18", r: 45 },
  { x: -190, z: -830, rot: 0, item: "b20", r: 40 },
  { x: 340, z: -640, rot: Math.PI / 2, item: "b0", r: 35 },
  { x: -530, z: -270, rot: 0, item: "b19", r: 45 },
  { x: 300, z: 130, rot: Math.PI / 2, item: "b24", r: 55 },
  { x: 250, z: -30, rot: 0, item: "b17", r: 35 },
  { x: 430, z: -190, rot: -Math.PI / 2, item: "b6", r: 45 },
  { x: 480, z: 40, rot: 0, item: "b2", r: 40 },
  { x: 570, z: -340, rot: Math.PI, item: "b8", r: 40 },
  { x: 390, z: 300, rot: 0, item: "b13", r: 45 },
  { x: 660, z: 160, rot: Math.PI / 2, item: "b12", r: 30 },
  { x: -120, z: -480, rot: Math.PI / 2, item: "b3", r: 35 },
  { x: -360, z: -700, rot: 0, item: "b7", r: 40 },
  { x: 700, z: -60, rot: 0, item: "b11", r: 45 },
];
export const SKYLINE_SLOT = { x: -760, z: -1350, rot: 0.3, scale: 2.4, r: 300 };

const BUILDING_FS = /* glsl */ `
uniform sampler2D map;
uniform vec3 uColor;
uniform float uHasMap;
varying vec2 vUv;
varying vec3 vWorld;
${GLSL_NOISE}
${FOG_GLSL}
void main() {
  vec3 c = uHasMap > 0.5 ? texture2D(map, vUv).rgb * uColor : uColor;
  // ночь: стены гасим, светящиеся окна раскаляем
  float m = max(c.r, max(c.g, c.b));
  float win = smoothstep(0.16, 0.55, m);
  vec3 col = c * mix(0.32, 3.2, win);
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;
const BUILDING_VS = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** Перекрасить загруженные дома в «ночной» шейдер с нашим туманом и расставить */
export function placeCityModels(scene: THREE.Scene, U: OutsideUniforms, kit: THREE.Object3D | null, skyline: THREE.Object3D | null) {
  const toNight = (root: THREE.Object3D) =>
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const src = m.material as THREE.MeshStandardMaterial;
      m.material = new THREE.ShaderMaterial({
        vertexShader: BUILDING_VS,
        fragmentShader: BUILDING_FS,
        uniforms: { ...U, map: { value: src.map ?? null }, uHasMap: { value: src.map ? 1 : 0 }, uColor: { value: (src.color ?? new THREE.Color(1, 1, 1)).clone() } },
      });
      src.dispose();
    });
  if (kit) {
    for (const slot of CITY_SLOTS) {
      const item = kit.getObjectByName("item_" + slot.item);
      if (!item) continue;
      const g = new THREE.Group();
      const c = item.clone(true);
      c.position.set(0, 0, 0);
      g.add(c);
      g.position.set(slot.x, STREET_Y, slot.z);
      g.rotation.y = slot.rot;
      toNight(g);
      scene.add(g);
    }
  }
  if (skyline) {
    const item = skyline.getObjectByName("item_skyline") ?? skyline;
    const g = new THREE.Group();
    const c = item.clone(true);
    c.position.set(0, 0, 0);
    g.add(c);
    g.position.set(SKYLINE_SLOT.x, STREET_Y, SKYLINE_SLOT.z);
    g.rotation.y = SKYLINE_SLOT.rot;
    g.scale.setScalar(SKYLINE_SLOT.scale);
    toNight(g);
    scene.add(g);
  }
}

const reserved = (x: number, z: number, half: number) =>
  CITY_SLOTS.some((s) => Math.hypot(x - s.x, z - s.z) < s.r + half + 8) || Math.hypot(x - SKYLINE_SLOT.x, z - SKYLINE_SLOT.z) < SKYLINE_SLOT.r + half;

// ------------------------------------------------------------------ сборка

interface TowerSpec {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rot: number;
  type: number;
  lit: number;
  crown: number;
  seed: number;
  base?: number;
}

export function buildOutside(U: OutsideUniforms) {
  const scene = new THREE.Scene();
  const r = rng(20261118);
  const BLOCK = 118;
  const STREET = 22;
  const towers: TowerSpec[] = [];
  const beacons: number[] = [];

  // Наш дом — в квартале с центром в (0,0); рядом — пара «героев»
  const hero: TowerSpec[] = [
    // стеклянная со светодиодами на северо-востоке
    { x: 210, z: -340, w: 40, d: 40, h: 300, rot: 0.3, type: 2, lit: 0.4, crown: 3, seed: 0.23 },
    // очень высокая со шпилем вдали (зелёная корона)
    { x: 760, z: -1250, w: 52, d: 52, h: 420, rot: 0.0, type: 0, lit: 0.45, crown: 2, seed: 0.51 },
    // ещё одна стеклянная вдали на востоке
    { x: 1150, z: -420, w: 46, d: 46, h: 360, rot: 0.6, type: 2, lit: 0.35, crown: 3, seed: 0.67 },
    // тёмный небоскрёб-силуэт
    { x: 90, z: -560, w: 50, d: 34, h: 380, rot: 0, type: 3, lit: 0.3, crown: 4, seed: 0.79 },
  ];
  towers.push(...hero);

  const core = new THREE.Vector2(700, -900); // деловой центр
  const R = 3400;
  const nb = Math.ceil(R / BLOCK);
  for (let bx = -nb; bx <= nb; bx++) {
    for (let bz = -nb; bz <= nb; bz++) {
      const cx = bx * BLOCK;
      const cz = bz * BLOCK;
      const dist = Math.hypot(cx, cz);
      if (dist > R) continue;
      if (Math.abs(bx) <= 1 && Math.abs(bz) <= 1) continue; // наш квартал и соседние — пусто/низко
      // за спиной (юго-запад) окон нет — экономим
      if (cx < -300 && cz > 300) continue;
      const dc = Math.hypot(cx - core.x, cz - core.y);
      const tall = Math.exp(-dc / 900);
      const density = 0.45 + 0.5 * tall;
      const n = r.chance(density) ? r.int(1, tall > 0.4 ? 3 : 2) : 0;
      const inner = BLOCK - STREET - 8;
      for (let i = 0; i < n; i++) {
        const w = r.range(18, 40) * (n > 1 ? 0.75 : 1);
        const d = r.range(18, 40) * (n > 1 ? 0.75 : 1);
        const ox = n === 1 ? r.range(-6, 6) : (i - (n - 1) / 2) * (inner / n);
        const oz = r.range(-(inner - d) / 2, (inner - d) / 2) * 0.6;
        const hBase = 18 + 70 * Math.pow(r.next(), 2.2);
        const h = hBase + tall * r.range(60, 330) * (r.chance(0.65) ? 1 : 0.4);
        const typeRoll = r.next();
        const type = typeRoll < 0.46 ? 0 : typeRoll < 0.84 ? 1 : typeRoll < 0.9 ? 2 : 3;
        if (reserved(cx + ox, cz + oz, Math.max(w, d) / 2)) continue;
        const t: TowerSpec = {
          x: cx + ox,
          z: cz + oz,
          w,
          d,
          h,
          rot: r.chance(0.12) ? r.range(-0.6, 0.6) : 0,
          type,
          lit: type === 1 ? r.range(0.18, 0.45) : r.range(0.25, 0.75),
          crown: h > 200 && r.chance(0.3) ? r.int(1, 4) : 0,
          seed: r.next(),
        };
        // уступы: верхняя часть уже
        if (h > 150 && r.chance(0.5)) {
          const k = r.range(0.55, 0.75);
          towers.push({ ...t, h: h * k, crown: 0 });
          towers.push({ ...t, base: h * k, h: h * (1 - k), w: w * 0.72, d: d * 0.72 });
        } else towers.push(t);
      }
      // малоэтажная застройка заполняет квартал, чтобы снизу не было пустой «доски»
      if (dist < 2200) {
        const m = r.int(3, 7);
        for (let i = 0; i < m; i++) {
          const w = r.range(10, 26);
          const d = r.range(10, 26);
          const lx = cx + r.range(-(inner - w) / 2, (inner - w) / 2);
          const lz = cz + r.range(-(inner - d) / 2, (inner - d) / 2);
          if (reserved(lx, lz, Math.max(w, d) / 2)) continue;
          towers.push({
            x: lx,
            z: lz,
            w,
            d,
            h: r.range(8, 34) + (r.chance(0.2) ? r.range(10, 40) : 0),
            rot: 0,
            type: r.chance(0.7) ? 1 : 0,
            lit: r.range(0.15, 0.45),
            crown: 0,
            seed: r.next(),
          });
        }
      }
    }
  }

  // InstancedMesh: коробка с основанием в нуле
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const count = towers.length;
  const seeds = new Float32Array(count);
  const types = new Float32Array(count);
  const lits = new Float32Array(count);
  const crowns = new Float32Array(count);
  const towerMat = new THREE.ShaderMaterial({
    vertexShader: TOWER_VS,
    fragmentShader: TOWER_FS,
    uniforms: { ...U },
  });
  const towerMesh = new THREE.InstancedMesh(box, towerMat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const pos = new THREE.Vector3();
  towers.forEach((t, i) => {
    const y0 = STREET_Y + (t.base ?? 0);
    pos.set(t.x, y0, t.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
    s.set(t.w, t.h, t.d);
    m.compose(pos, q, s);
    towerMesh.setMatrixAt(i, m);
    seeds[i] = t.seed;
    types[i] = t.type;
    lits[i] = t.lit;
    crowns[i] = t.crown;
    const top = y0 + t.h;
    if (top - STREET_Y > 170 && !t.crown) beacons.push(t.x, top + 1.5, t.z);
  });
  box.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
  box.setAttribute("aType", new THREE.InstancedBufferAttribute(types, 1));
  box.setAttribute("aLit", new THREE.InstancedBufferAttribute(lits, 1));
  box.setAttribute("aCrown", new THREE.InstancedBufferAttribute(crowns, 1));
  towerMesh.frustumCulled = false;
  scene.add(towerMesh);

  // шпили на героях
  for (const t of [hero[1], hero[0], hero[2]]) {
    const sp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 2.2, 70, 6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.022, 0.03) }),
    );
    sp.position.set(t.x, STREET_Y + t.h + 35, t.z);
    scene.add(sp);
    beacons.push(t.x, STREET_Y + t.h + 70, t.z);
  }

  // земля
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(18000, 18000),
    new THREE.ShaderMaterial({
      vertexShader: GROUND_VS,
      fragmentShader: GROUND_FS,
      uniforms: { ...U, uBlock: { value: BLOCK }, uStreet: { value: STREET } },
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = STREET_Y;
  scene.add(ground);

  // машины: точки бегут по улицам рядом с домом
  const carPos: number[] = [];
  const carDir: number[] = [];
  const carSpeed: number[] = [];
  const carPhase: number[] = [];
  const carCol: number[] = [];
  const carSize: number[] = [];
  const carBlink: number[] = [];
  const addLight = (x: number, y: number, z: number, dx: number, dz: number, len: number, speed: number, phase: number, c: THREE.Color, size: number, blink = 0) => {
    // отрицательная скорость — встречная полоса: стартуем с другого конца и едем обратно
    if (speed < 0) {
      x += dx * len;
      z += dz * len;
      dx = -dx;
      dz = -dz;
      speed = -speed;
    }
    carPos.push(x, y, z);
    carDir.push(dx, dz, len);
    carSpeed.push(speed);
    carPhase.push(phase);
    carCol.push(c.r, c.g, c.b);
    carSize.push(size);
    carBlink.push(blink);
  };
  const red = new THREE.Color(1.0, 0.06, 0.04).multiplyScalar(5);
  const white = new THREE.Color(1.0, 0.86, 0.66).multiplyScalar(4.5);
  const amber = new THREE.Color(1.0, 0.55, 0.1).multiplyScalar(3);
  const roadLen = 2400;
  for (let k = -10; k <= 10; k++) {
    const ave = Math.abs(k) % 4 === 0;
    const off = k * BLOCK - BLOCK / 2;
    const cars = ave ? 70 : 22;
    for (let i = 0; i < cars; i++) {
      const lane = r.chance(0.5);
      const sp = r.range(9, 16) * (ave ? 1.3 : 1);
      // вдоль оси z (с севера на юг и обратно)
      // вдоль оси z: к нам — фары, от нас — стоп-сигналы
      addLight(off + (lane ? 4 : -4), STREET_Y + 0.8, -roadLen / 2 - 600, 0, 1, roadLen, lane ? sp : -sp, r.range(0, roadLen), lane ? white : red, 2.6);
      const lane2 = r.chance(0.5);
      addLight(-roadLen / 2 + 600, STREET_Y + 0.8, off + (lane2 ? 4 : -4), 1, 0, roadLen, lane2 ? sp : -sp, r.range(0, roadLen), lane2 ? red : white, 2.6);
    }
    // жёлтые такси
    for (let i = 0; i < (ave ? 8 : 2); i++) {
      addLight(off + 2, STREET_Y + 0.8, -roadLen / 2 - 600, 0, 1, roadLen, r.range(8, 13), r.range(0, roadLen), amber, 2.4);
    }
  }
  // авиаогни
  for (let i = 0; i < beacons.length; i += 3) {
    addLight(beacons[i], beacons[i + 1], beacons[i + 2], 0, 0, 1, 0, 0, new THREE.Color(1, 0.05, 0.03).multiplyScalar(9), 5, r.range(0.01, 1));
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute("position", new THREE.Float32BufferAttribute(carPos, 3));
  cg.setAttribute("aDir", new THREE.Float32BufferAttribute(carDir, 3));
  cg.setAttribute("aSpeed", new THREE.Float32BufferAttribute(carSpeed, 1));
  cg.setAttribute("aPhase", new THREE.Float32BufferAttribute(carPhase, 1));
  cg.setAttribute("aColor", new THREE.Float32BufferAttribute(carCol, 3));
  cg.setAttribute("aSize", new THREE.Float32BufferAttribute(carSize, 1));
  cg.setAttribute("aBlink", new THREE.Float32BufferAttribute(carBlink, 1));
  const pointsMat = new THREE.ShaderMaterial({
    vertexShader: POINTS_VS,
    fragmentShader: POINTS_FS,
    uniforms: { ...U, uPx: { value: 800 } },
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const lights = new THREE.Points(cg, pointsMat);
  lights.frustumCulled = false;
  scene.add(lights);

  // небо
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(8500, 48, 24),
    new THREE.ShaderMaterial({ vertexShader: BASIC_VS, fragmentShader: SKY_FS, uniforms: { ...U }, side: THREE.BackSide, depthWrite: false }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  // слои облаков (снизу видим подсвеченное «брюхо»)
  const clouds: THREE.Mesh[] = [];
  [0, 1].forEach((layer) => {
    const c = new THREE.Mesh(
      new THREE.PlaneGeometry(20000, 20000),
      new THREE.ShaderMaterial({
        vertexShader: BASIC_VS,
        fragmentShader: CLOUD_FS,
        uniforms: { ...U, uLayer: { value: layer } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    c.rotation.x = Math.PI / 2;
    clouds.push(c);
    scene.add(c);
  });

  // клочья тумана прямо за окном
  const mists: THREE.Mesh[] = [];
  const addMist = (x: number, y: number, z: number, ry: number, w: number, h: number, seed: number) => {
    const mm = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.ShaderMaterial({
        vertexShader: BASIC_VS,
        fragmentShader: MIST_FS,
        uniforms: { ...U, uSeed: { value: seed } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mm.position.set(x, y, z);
    mm.rotation.y = ry;
    mists.push(mm);
    scene.add(mm);
  };
  addMist(20, 5, -38, 0, 360, 110, 0.1);
  addMist(-10, -15, -95, 0, 520, 160, 0.4);
  addMist(48, 0, -10, -Math.PI / 2, 300, 110, 0.7);
  addMist(110, -20, 10, -Math.PI / 2, 480, 170, 0.9);
  addMist(150, 30, -170, 0.5, 600, 180, 1.3);

  // дождь за стеклом
  const RN = 7000;
  const rp = new Float32Array(RN * 2 * 3);
  const re = new Float32Array(RN * 2);
  for (let i = 0; i < RN; i++) {
    let x: number;
    let z: number;
    do {
      x = r.range(-40, 70);
      z = r.range(-70, 35);
    } while (x < 7 && z > -5.5);
    const y = r.range(-30, 30);
    rp.set([x, y, z, x, y, z], i * 6);
    re[i * 2] = 0;
    re[i * 2 + 1] = 1;
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute("position", new THREE.BufferAttribute(rp, 3));
  rg.setAttribute("aEnd", new THREE.BufferAttribute(re, 1));
  const rain = new THREE.LineSegments(
    rg,
    new THREE.ShaderMaterial({
      vertexShader: RAIN_VS,
      fragmentShader: RAIN_FS,
      uniforms: { ...U },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  rain.frustumCulled = false;
  scene.add(rain);

  return {
    scene,
    addModels(kit: THREE.Object3D | null, skyline: THREE.Object3D | null) {
      placeCityModels(scene, U, kit, skyline);
    },
    setPixelScale(px: number) {
      pointsMat.uniforms.uPx.value = px;
    },
    update() {
      const cb = U.uCloudBase.value;
      clouds[0].position.y = cb;
      clouds[1].position.y = cb + 55;
      rain.visible = U.uRain.value > 0.01;
    },
  };
}
