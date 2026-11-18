// Стекло панорамных окон: сквозь него видно отрендеренный город (текстура),
// по нему ползут капли — каждая работает как линза и переворачивает картинку.
import * as THREE from "three";
import { GLSL_NOISE } from "./util";

export function makeGlassUniforms() {
  return {
    tOut: { value: null as THREE.Texture | null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uRain: { value: 0 },
    uTint: { value: new THREE.Color(0.8, 0.25, 0.9) },
    uLod: { value: 0 }, // доп. размытие (в отражении пола)
  };
}
export type GlassUniforms = ReturnType<typeof makeGlassUniforms>;

const VS = /* glsl */ `
varying vec2 vP;
varying vec3 vWorld;
varying vec3 vNormalW;
uniform vec2 uSize;
uniform vec2 uOffset;
void main() {
  vP = uv * uSize + uOffset;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FS = /* glsl */ `
uniform sampler2D tOut;
uniform vec2 uRes;
uniform float uTime;
uniform float uRain;
uniform vec3 uTint;
uniform float uLod;
varying vec2 vP;
varying vec3 vWorld;
varying vec3 vNormalW;
${GLSL_NOISE}

// Неподвижные капли: появляются, растут, высыхают
vec4 staticLayer(vec2 p, float cells, float t, float density, float seed) {
  vec2 q = p * cells;
  vec2 id = floor(q);
  vec2 f = fract(q) - 0.5;
  vec3 h = hash32(id + seed * 17.0);
  if (h.z > density) return vec4(0.0, 0.0, 0.0, 1.0);
  vec2 c = (h.xy - 0.5) * 0.55;
  float life = fract(t * (0.03 + 0.05 * h.y) + h.x * 5.0);
  float grow = smoothstep(0.0, 0.1, life) * smoothstep(1.0, 0.7, life);
  float rad = (0.14 + 0.2 * fract(h.x * 7.13)) * mix(0.55, 1.0, grow);
  vec2 d = (f - c) / rad;
  d.y *= 1.08;
  float l = length(d);
  float m = smoothstep(1.0, 0.82, l) * smoothstep(0.0, 0.02, grow);
  return vec4(d * m, m, l);
}

// Сползающие капли: «прилипают» и срываются, оставляя чистую дорожку и бисер
vec4 slideLayer(vec2 p, vec2 cell, float t, float seed, out float wipe) {
  wipe = 0.0;
  vec2 q = p / cell;
  float colId = floor(q.x);
  float ch = hash11(colId * 1.31 + seed * 7.0);
  float v = 0.22 + 0.3 * ch;
  q.y += t * v + ch * 11.0;
  vec2 id = vec2(colId, floor(q.y));
  vec2 f = fract(q) - 0.5;
  vec3 h = hash32(id * vec2(1.0, 0.731) + seed * 13.0);
  if (h.z > 0.62) return vec4(0.0);

  float s = fract(t * v / 0.8 + h.x * 3.0);
  float Y = -0.36 + 0.7 * (smoothstep(0.0, 0.85, s) - smoothstep(0.85, 1.0, s));
  float X = (h.x - 0.5) * 0.5 + 0.09 * sin(p.y * 7.0 + h.y * 6.28) + 0.04 * sin(p.y * 23.0 + h.x * 3.0);

  // основная капля (в метрах, чуть вытянута книзу)
  vec2 dm = (f - vec2(X, Y)) * cell;
  float r = 0.0055 + 0.0045 * h.y;
  dm.y *= dm.y < 0.0 ? 0.8 : 1.25;
  float l = length(dm) / r;
  float m = smoothstep(1.0, 0.8, l);
  vec2 n = dm / r * m;

  // дорожка над каплей
  float dx = abs((f.x - X) * cell.x);
  float above = f.y - Y;
  float trailW = r * 0.75;
  float trail = smoothstep(trailW, trailW * 0.4, dx) * smoothstep(-0.02, 0.05, above) * smoothstep(0.55, 0.0, above);
  wipe = trail;
  // бисер в дорожке
  float tq = p.y / 0.011;
  float tid = floor(tq);
  vec2 td = vec2((f.x - X) * cell.x + (hash11(tid + colId) - 0.5) * r * 0.6, (fract(tq) - 0.5) * 0.011);
  float tr = r * (0.22 + 0.25 * hash11(tid * 3.1 + colId));
  float tl = length(td) / tr;
  float tm = smoothstep(1.0, 0.75, tl) * step(0.45, hash11(tid * 1.7 + colId * 2.3)) * trail * smoothstep(0.02, 0.08, above);
  n += td / tr * tm;
  m = max(m, tm);
  return vec4(n, m, l);
}

vec3 sampleOut(vec2 uv, float lod) {
  uv = clamp(uv, vec2(0.001), vec2(0.999));
  if (lod < 0.2) return textureLod(tOut, uv, 0.0).rgb;
  vec2 px = exp2(lod) / uRes * 0.9;
  vec3 c = textureLod(tOut, uv, lod).rgb * 0.36;
  c += textureLod(tOut, uv + vec2(px.x, px.y * 0.6), lod).rgb * 0.16;
  c += textureLod(tOut, uv + vec2(-px.x, -px.y * 0.6), lod).rgb * 0.16;
  c += textureLod(tOut, uv + vec2(-px.x * 0.6, px.y), lod).rgb * 0.16;
  c += textureLod(tOut, uv + vec2(px.x * 0.6, -px.y), lod).rgb * 0.16;
  return c;
}

void main() {
  vec2 suv = gl_FragCoord.xy / uRes;
  float rain = uRain;
  float drops = mix(0.35, 0.95, rain);
  float slide = mix(0.15, 1.0, rain);

  float w1, w2;
  vec4 l1 = slideLayer(vP, vec2(0.085, 0.42), uTime, 1.0, w1);
  vec4 l2 = slideLayer(vP + vec2(0.37, 0.0), vec2(0.06, 0.3), uTime * 1.07, 2.0, w2);
  // в туман сползающих мало: гасим половину столбцов
  float slideMask1 = step(hash11(floor(vP.x / 0.085) * 3.3), slide);
  float slideMask2 = step(hash11(floor((vP.x + 0.37) / 0.06) * 5.1), slide * 0.8);
  l1 *= slideMask1; w1 *= slideMask1;
  l2 *= slideMask2; w2 *= slideMask2;
  float wipe = clamp(w1 + w2, 0.0, 1.0);

  vec4 s1 = staticLayer(vP, 48.0, uTime, drops * 0.75, 1.0);
  vec4 s2 = staticLayer(vP + 3.7, 110.0, uTime * 1.3, drops * 0.6, 2.0);
  s1.xyz *= 1.0 - wipe;
  s2.xyz *= 1.0 - wipe;

  vec2 n = s1.xy + s2.xy * 0.8 + l1.xy + l2.xy;
  float mask = clamp(s1.z + s2.z + l1.z + l2.z, 0.0, 1.0);

  // запотевшее стекло: в дождь всё за окном чуть расплывается, в каплях — резко
  float haze = rain * 2.4 * (1.0 - wipe * 0.75) * (1.0 - mask) + 0.35 * (1.0 - mask) * (1.0 - rain) * 0.0;
  float lod = haze + uLod;
  vec2 off = -n * mix(0.018, 0.03, rain) * (uRes.y / uRes.x * 1.6);
  vec3 col = sampleOut(suv + off, lod * (1.0 - mask * 0.85));

  // тёмный ободок капли и блик от ленты в комнате
  float ln = length(n);
  float rim = smoothstep(0.5, 1.0, ln) * mask;
  col *= 1.0 - 0.5 * rim;
  vec2 nd = n / max(ln, 1e-4);
  float glint = pow(max(0.0, dot(nd, normalize(vec2(-0.55, 0.85)))), 10.0) * smoothstep(0.4, 0.9, ln) * mask;
  col += uTint * glint * 0.35 + vec3(0.6, 0.7, 0.8) * glint * 0.08;

  // само стекло: лёгкий тон и отражение комнаты по краям
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(V, normalize(vNormalW))), 4.0);
  col *= 0.86;
  col += uTint * (0.004 + 0.05 * fres);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function makeGlassMaterial(G: GlassUniforms, width: number, height: number, offset = new THREE.Vector2()) {
  return new THREE.ShaderMaterial({
    vertexShader: VS,
    fragmentShader: FS,
    uniforms: {
      ...G,
      uSize: { value: new THREE.Vector2(width, height) },
      uOffset: { value: offset },
    },
  });
}
