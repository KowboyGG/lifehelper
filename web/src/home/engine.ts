// Движок сцены «Дом»: рендер в несколько проходов.
//  1) город → текстура (rtOut)
//  2) отражение в полу: город и комната из зеркальной камеры (пол не рисуем)
//  3) комната; стёкла берут город из rtOut с преломлением в каплях
//  4) свечение (bloom) → тонмаппинг, виньетка, зерно
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { CameraRig, FOCUS, ZONES, type Shot } from "./camera";
import { makeGlassUniforms } from "./glass";
import { buildInterior, type Interactive, type Interior } from "./interior";
import { buildOutside, makeOutsideUniforms } from "./outside";
import { furnishDesk, furnishKitchen, furnishNeon, loadKit } from "./models";
import { Props, loadFonts, type HomeData } from "./props";
import { damp } from "./util";

export const LED_PALETTES = {
  neon: { name: "Неон", a: "#9d1cff", b: "#2a3dff" },
  sunset: { name: "Закат", a: "#ff3b12", b: "#ff0f5a" },
  cyber: { name: "Кибер", a: "#00c8ff", b: "#ff1590" },
  red: { name: "Красный", a: "#ff0418", b: "#ff2a08" },
  warm: { name: "Тёплый", a: "#ff8436", b: "#ff6a20" },
  off: { name: "Выкл", a: "#000000", b: "#000000" },
} as const;
export type LedPalette = keyof typeof LED_PALETTES;

export type Quality = "high" | "medium" | "low";

/** Пресеты графики. Город и отражение рисуются в пониженном разрешении — они всё равно в тумане */
const PRESETS: Record<Quality, { dprMax: number; scale: number; msaa: number; out: number; refl: number; bloom: boolean; skip: boolean }> = {
  high: { dprMax: 1.25, scale: 1, msaa: 2, out: 0.7, refl: 0.33, bloom: true, skip: false },
  medium: { dprMax: 1, scale: 0.85, msaa: 0, out: 0.55, refl: 0.25, bloom: true, skip: false },
  low: { dprMax: 1, scale: 0.7, msaa: 0, out: 0.45, refl: 0, bloom: false, skip: true },
};

const WEATHER = {
  fog: {
    fogLow: new THREE.Color(0.085, 0.05, 0.045),
    fogHigh: new THREE.Color(0.022, 0.024, 0.038),
    density: 0.0014,
    cloudBase: 105,
    city: new THREE.Color("#8f96b8"),
  },
  rain: {
    fogLow: new THREE.Color(0.06, 0.042, 0.045),
    fogHigh: new THREE.Color(0.016, 0.021, 0.034),
    density: 0.0012,
    cloudBase: 150,
    city: new THREE.Color("#7f8cb0"),
  },
};

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uExposure: { value: 1.0 },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 1.0 },
    uGrain: { value: 0.035 },
    uCA: { value: 0.012 },
    uFade: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uExposure;
    uniform float uTime;
    uniform vec2 uRes;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uCA;
    uniform float uFade;
    varying vec2 vUv;
    vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 aces(vec3 color) {
      const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      color = inM * color; color = RRTAndODTFit(color); color = outM * color;
      return clamp(color, 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * r2 * uCA;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;
      c *= uExposure / 0.6;
      c = aces(c);
      // чуть холоднее в тенях — ночная плёнка
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, c * vec3(0.92, 0.97, 1.08), (1.0 - l) * 0.35);
      c = toSRGB(c);
      float vig = smoothstep(0.95, 0.15, r2 * 1.7);
      c *= mix(1.0, vig, uVignette);
      float n = hash(vUv * uRes + fract(uTime * 13.7) * 431.0) + hash(vUv * uRes * 1.37 - fract(uTime * 7.3) * 117.0) - 1.0;
      c += n * uGrain * (0.6 + 0.4 * (1.0 - l));
      c *= 1.0 - uFade;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

const _dir = new THREE.Vector3();
const _up = new THREE.Vector3();
const _look = new THREE.Vector3();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();
const _n = new THREE.Vector3(0, 1, 0);

/** Отражение камеры относительно пола y=0 c косой плоскостью отсечения */
function mirrorCamera(src: THREE.PerspectiveCamera, dst: THREE.PerspectiveCamera) {
  dst.position.set(src.position.x, -src.position.y, src.position.z);
  const dir = _dir.set(0, 0, -1).applyQuaternion(src.quaternion);
  dir.y *= -1;
  const up = _up.set(0, 1, 0).applyQuaternion(src.quaternion);
  up.y *= -1;
  dst.up.copy(up);
  dst.lookAt(_look.copy(dst.position).add(dir));
  dst.updateMatrixWorld();
  dst.projectionMatrix.copy(src.projectionMatrix);
  const plane = _plane.set(_n.set(0, 1, 0), 0).applyMatrix4(dst.matrixWorldInverse);
  const clip = _clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  const pm = dst.projectionMatrix.elements;
  const q = _q.set((Math.sign(clip.x) + pm[8]) / pm[0], (Math.sign(clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
  clip.multiplyScalar(2 / clip.dot(q));
  pm[2] = clip.x;
  pm[6] = clip.y;
  pm[10] = clip.z + 1 - 0.003;
  pm[14] = clip.w;
  dst.projectionMatrixInverse.copy(dst.projectionMatrix).invert();
}

function makeRT(w: number, h: number, mips: boolean, samples = 0) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    generateMipmaps: mips,
    minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    samples,
  });
}

export interface EngineEvents {
  onQuality?: (q: Quality, auto: boolean) => void;
  onHover?: (key: Interactive | null) => void;
  onPick?: (key: Interactive) => void;
  onZone?: (index: number) => void;
}

export class HomeEngine {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: CameraRig;
  readonly interior: Interior;
  private outCam: THREE.PerspectiveCamera;
  private vCam = new THREE.PerspectiveCamera();
  private vOutCam = new THREE.PerspectiveCamera();
  private outside: ReturnType<typeof buildOutside>;
  private U = makeOutsideUniforms();
  private G = makeGlassUniforms();
  private refl = { tex: { value: null as THREE.Texture | null }, matrix: { value: new THREE.Matrix4() }, strength: { value: 0.55 } };
  private rtOut!: THREE.WebGLRenderTarget;
  private rtRefl!: THREE.WebGLRenderTarget;
  private rtReflOut!: THREE.WebGLRenderTarget;
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private final!: ShaderPass;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private clock = new THREE.Timer();
  private raf = 0;
  private running = false;
  private quality: Quality;
  private auto = true;
  private mobile = false;
  private frameTimes: number[] = [];
  private settle = 40;
  private upgraded = false;
  private lastTs = 0;
  private skipFlip = false;
  private shadowDirty = 3;
  private dpr = 1;
  private size = new THREE.Vector2(1, 1);
  private rain = 0;
  private rainTarget = 0;
  private led: LedPalette = "neon";
  private ledLevel = 1;
  private events: EngineEvents;
  private raycaster = new THREE.Raycaster();
  private pickables: THREE.Object3D[] = [];
  private keyOf = new WeakMap<THREE.Object3D, Interactive>();
  private hovered: Interactive | null = null;
  private zone = 1;
  private disposers: (() => void)[] = [];
  /** фиксированное время (для скриншотов) */
  fixedTime: number | null = null;
  time = 0;
  onFrame: ((dt: number, t: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, opts: { quality?: Quality; auto?: boolean; mobile?: boolean; events?: EngineEvents } = {}) {
    this.canvas = canvas;
    this.events = opts.events ?? {};
    this.mobile = !!opts.mobile;
    this.quality = opts.quality ?? (this.mobile ? "low" : "medium");
    this.auto = opts.auto ?? true;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", alpha: false, stencil: false });
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setClearColor(0x000000, 1);
    RectAreaLightUniformsLib.init();
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.04, 60);
    this.outCam = new THREE.PerspectiveCamera(55, 1, 1, 14000);
    this.vOutCam.near = 1;
    this.vOutCam.far = 14000;
    this.rig = new CameraRig(this.camera);

    this.outside = buildOutside(this.U);
    this.interior = buildInterior(this.G, this.refl);
    this.interior.scene.environmentIntensity = 0.35;

    this.interior.interactive.forEach((obj) => this.pickables.push(obj));
    this.refreshPickables();

    this.props = new Props(this.interior);
    void loadFonts().then(() => this.props.refresh());
    this.setupPost();
    this.setLed("neon");
    this.resize();
    this.bindInput();
  }

  // ------------------------------------------------------------------ публичное API

  /** Догрузить модели (мебель, декор, дома за окном). Сцена работает и без них. */
  async loadModels(base = "/models/") {
    const [kitchen, desk, neon, city1, city2] = await Promise.all(["kitchen", "desk", "neon", "city1", "city2"].map((n) => loadKit(n, base)));
    if (this.disposed) return;
    this.shadowDirty = 3;
    if (kitchen) furnishKitchen(this.interior, kitchen);
    if (desk) furnishDesk(this.interior, desk);
    if (neon) furnishNeon(this.interior, neon);
    this.outside.addModels(city1, city2);
    this.refreshPickables();
    this.modelsLoaded = true;
    this.onModels?.();
  }
  modelsLoaded = false;
  readonly props: Props;

  setData(d: HomeData) {
    this.props.setData(d);
    this.shadowDirty = 2;
  }

  /** Уровень графики: вручную или «авто» (подстраивается по частоте кадров) */
  setQuality(q: Quality | "auto") {
    if (q === "auto") {
      this.auto = true;
      this.upgraded = false;
      this.frameTimes = [];
      this.settle = 40;
      this.events.onQuality?.(this.quality, true);
      return;
    }
    this.auto = false;
    this.applyQuality(q);
  }
  get qualityLevel() {
    return this.quality;
  }
  get qualityAuto() {
    return this.auto;
  }

  private applyQuality(q: Quality) {
    const prevMsaa = PRESETS[this.quality].msaa;
    this.quality = q;
    if (PRESETS[q].msaa !== prevMsaa) {
      this.composer.dispose();
      this.setupPost();
    }
    this.resize();
    this.frameTimes = [];
    this.settle = 40;
    this.events.onQuality?.(q, this.auto);
  }

  /** Автоподстройка: средний кадр медленнее ~33 к/с — снижаем, очень быстрый — разок повышаем */
  private measure(ms: number) {
    if (!this.auto) return;
    if (this.settle > 0) {
      this.settle--;
      return;
    }
    this.frameTimes.push(ms);
    if (this.frameTimes.length < 90) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    this.frameTimes = [];
    const order: Quality[] = ["low", "medium", "high"];
    const i = order.indexOf(this.quality);
    // на «низком» кадр рисуется через раз, поэтому порог вдвое мягче
    const slow = this.quality === "low" ? 60 : 30;
    if (med > slow && i > 0) this.applyQuality(order[i - 1]);
    else if (med < 13 && i < 2 && !this.upgraded && !this.mobile) {
      this.upgraded = true;
      this.applyQuality(order[i + 1]);
    }
  }
  onModels: (() => void) | null = null;
  private disposed = false;

  private refreshPickables() {
    this.keyOf = new WeakMap();
    this.interior.interactive.forEach((obj, key) => obj.traverse((o) => this.keyOf.set(o, key)));
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.update();
    this.lastTs = 0;
    const loop = (ts: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      // на «низком» рисуем через кадр — вдвое меньше нагрузки
      if (PRESETS[this.quality].skip) {
        this.skipFlip = !this.skipFlip;
        if (this.skipFlip) return;
      }
      if (this.lastTs) this.measure(ts - this.lastTs);
      this.lastTs = ts;
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Отрисовать один кадр (используется и в цикле, и для скриншотов) */
  frame(dtOverride?: number) {
    this.clock.update();
    const dt = dtOverride ?? Math.min(0.05, this.clock.getDelta());
    this.time = this.fixedTime ?? this.time + dt;
    this.update(dt);
    this.composer.render(dt);
  }

  setRain(on: boolean, instant = false) {
    this.rainTarget = on ? 1 : 0;
    if (instant) this.rain = this.rainTarget;
  }
  get raining() {
    return this.rainTarget > 0.5;
  }

  setLed(p: LedPalette) {
    this.led = p;
    const pal = LED_PALETTES[p];
    const a = new THREE.Color(pal.a);
    const b = new THREE.Color(pal.b);
    const L = this.interior.led;
    const lvl = this.ledLevel;
    L.primary.forEach((m) => m.color.copy(a).multiplyScalar(14 * lvl));
    L.secondary.forEach((m) => m.color.copy(b).multiplyScalar(10 * lvl));
    L.primaryLights.forEach((l) => {
      l.color.copy(a);
      l.intensity = 9 * lvl;
    });
    L.secondaryLights.forEach((l) => {
      l.color.copy(b);
      l.intensity = 5 * lvl;
    });
    this.G.uTint.value.copy(a).lerp(b, 0.3).multiplyScalar(p === "off" ? 0 : 1);
    this.props?.setLedColor(p === "off" ? "#ff3b30" : "#" + a.clone().lerp(new THREE.Color("#ffffff"), 0.35).getHexString());
    this.rebuildEnv(a, b);
  }
  get ledPalette() {
    return this.led;
  }

  goZone(i: number) {
    const n = ZONES.length;
    this.zone = ((i % n) + n) % n;
    this.rig.free = false;
    this.rig.setShot(ZONES[this.zone]);
    this.events.onZone?.(this.zone);
  }
  nextZone(d: number) {
    this.goZone(this.zone + d);
  }
  get zoneIndex() {
    return this.zone;
  }

  /** Подлететь к предмету. Карточка справа (компьютер) или снизу (телефон) — сдвигаем кадр, чтобы предмет не прятался под ней */
  focus(key: Interactive, panel: "right" | "bottom" | null = null) {
    this.rig.setShot(FOCUS[key]);
    if (panel === "right") this.rig.tYaw -= 0.2;
    if (panel === "bottom") this.rig.tPitch -= 0.2;
  }
  shot(s: Shot, instant = false) {
    this.rig.setShot(s, instant);
  }

  /** Экранные координаты точки (для подписей поверх канваса) */
  project(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * this.size.x, y: (-p.y * 0.5 + 0.5) * this.size.y, visible: p.z < 1 };
  }

  resize() {
    const parent = this.canvas.parentElement ?? document.body;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.size.set(w, h);
    const P = PRESETS[this.quality];
    this.dpr = Math.min(window.devicePixelRatio || 1, P.dprMax) * P.scale;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const W = Math.floor(w * this.dpr);
    const H = Math.floor(h * this.dpr);
    this.rtOut?.dispose();
    this.rtRefl?.dispose();
    this.rtReflOut?.dispose();
    this.rtOut = makeRT(Math.floor(W * P.out), Math.floor(H * P.out), true);
    const rs = Math.max(P.refl, 0.1);
    this.rtRefl = makeRT(Math.floor(W * rs), Math.floor(H * rs), true);
    this.rtReflOut = makeRT(Math.floor(W * rs * 0.8), Math.floor(H * rs * 0.8), false);
    this.refl.strength.value = P.refl > 0 ? 0.55 : 0;
    this.bloom.enabled = P.bloom;
    this.shadowDirty = 2;
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(w, h);
    this.final.uniforms.uRes.value.set(W, H);
    this.refl.tex.value = this.rtRefl.texture;
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.disposers.forEach((d) => d());
    this.rtOut.dispose();
    this.rtRefl.dispose();
    this.rtReflOut.dispose();
    this.envRT?.dispose();
    this.composer.dispose();
    const kill = (s: THREE.Scene) =>
      s.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        mats.forEach((mm) => {
          Object.values(mm).forEach((v) => (v as THREE.Texture)?.isTexture && (v as THREE.Texture).dispose());
          mm.dispose();
        });
      });
    kill(this.interior.scene);
    kill(this.outside.scene);
    this.pmrem.dispose();
    this.renderer.dispose();
    // сразу отдать видеопамять, не дожидаясь сборщика мусора
    this.renderer.forceContextLoss();
  }

  // ------------------------------------------------------------------ внутреннее

  private setupPost() {
    const engine = this;
    class ScenePass extends Pass {
      constructor() {
        super();
        this.needsSwap = false;
      }
      render(_r: THREE.WebGLRenderer, _w: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
        engine.renderScene(readBuffer);
      }
    }
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: PRESETS[this.quality].msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new ScenePass());
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.7, 0.92);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
  }

  private renderScene(target: THREE.WebGLRenderTarget) {
    const r = this.renderer;
    const cam = this.camera;
    cam.updateMatrixWorld();
    this.outCam.position.copy(cam.position);
    this.outCam.quaternion.copy(cam.quaternion);
    this.outCam.fov = cam.fov;
    this.outCam.aspect = cam.aspect;
    this.outCam.updateProjectionMatrix();
    this.outCam.updateMatrixWorld();

    const floor = this.interior.floor;
    // тень от лампы на столике меняется, только когда меняются деньги — не пересчитываем каждый кадр
    if (this.shadowDirty > 0) {
      r.shadowMap.needsUpdate = true;
      this.shadowDirty--;
    }
    // 1) отражение
    if (this.refl.strength.value > 0) {
      mirrorCamera(cam, this.vCam);
      mirrorCamera(this.outCam, this.vOutCam);
      this.refl.matrix.value
        .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
        .multiply(this.vCam.projectionMatrix)
        .multiply(this.vCam.matrixWorldInverse);
      this.G.tOut.value = this.rtReflOut.texture;
      this.G.uRes.value.set(this.rtRefl.width, this.rtRefl.height);
      this.G.uLod.value = 0.5;
      this.outside.setPixelScale(this.rtReflOut.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))));
      r.setRenderTarget(this.rtReflOut);
      r.clear();
      r.render(this.outside.scene, this.vOutCam);
      floor.visible = false;
      r.setRenderTarget(this.rtRefl);
      r.clear();
      r.render(this.interior.scene, this.vCam);
      floor.visible = true;
    }
    // 2) город
    this.G.tOut.value = this.rtOut.texture;
    this.G.uRes.value.set(target.width, target.height);
    this.G.uLod.value = 0;
    this.outside.setPixelScale(this.rtOut.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))));
    r.setRenderTarget(this.rtOut);
    r.clear();
    r.render(this.outside.scene, this.outCam);
    // 3) комната
    r.setRenderTarget(target);
    r.clear();
    r.render(this.interior.scene, cam);
  }

  private update(dt: number) {
    const t = this.time;
    this.rain = damp(this.rain, this.rainTarget, 0.6, dt);
    const k = this.rain;
    const F = WEATHER.fog;
    const R = WEATHER.rain;
    this.U.uTime.value = t;
    this.U.uRain.value = k;
    this.U.uFogLow.value.copy(F.fogLow).lerp(R.fogLow, k);
    this.U.uFogHigh.value.copy(F.fogHigh).lerp(R.fogHigh, k);
    this.U.uFogDensity.value = F.density + (R.density - F.density) * k;
    this.U.uCloudBase.value = F.cloudBase + (R.cloudBase - F.cloudBase) * k;
    this.G.uTime.value = t;
    this.G.uRain.value = k;
    this.outside.update();

    const L = this.interior.lights;
    L.cityN.color.copy(F.city).lerp(R.city, k);
    L.cityE.color.copy(L.cityN.color);
    L.cityN.intensity = 1.1;
    L.cityE.intensity = 0.9;
    // огонёк свечи дрожит
    const fl = 0.85 + 0.1 * Math.sin(t * 13.1) + 0.07 * Math.sin(t * 23.7 + 1.1) + 0.05 * Math.sin(t * 5.3);
    L.candle.intensity = 0.06 * fl;
    L.flame.scale.set(1, 2.2 * (0.9 + 0.1 * fl), 1);

    this.rig.update(dt);
    this.props.tick();
    this.onFrame?.(dt, t);
    this.final.uniforms.uTime.value = t;
  }

  private rebuildEnv(a: THREE.Color, b: THREE.Color) {
    // простая «комната» для отражений на металле и стекле
    const env = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(12, 3.5, 8), new THREE.MeshBasicMaterial({ color: "#040406", side: THREE.BackSide }));
    room.position.y = 1.75;
    env.add(room);
    const win = (w: number, h: number, x: number, z: number, ry: number, c: THREE.ColorRepresentation, i: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i), side: THREE.DoubleSide }));
      m.position.set(x, 1.6, z);
      m.rotation.y = ry;
      env.add(m);
    };
    win(12, 3.2, 0, -3.95, 0, "#6a6f88", 0.14);
    win(5, 3.2, 5.95, -1.5, Math.PI / 2, "#6a6f88", 0.12);
    const strip = (w: number, x: number, z: number, ry: number, c: THREE.Color, i: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.5), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(i), side: THREE.DoubleSide }));
      m.position.set(x, 3.35, z);
      m.rotation.set(Math.PI / 2, 0, ry);
      env.add(m);
    };
    strip(8, -5.6, 0, Math.PI / 2, a, 3);
    strip(11, 0, 3.6, 0, a, 3);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff8a40").multiplyScalar(6) }));
    lamp.position.set(-1.2, 1.8, -1.6);
    env.add(lamp);
    const floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ color: b.clone().multiplyScalar(0.8) }));
    floorGlow.rotation.x = -Math.PI / 2;
    floorGlow.position.set(0, 0.02, 0.6);
    env.add(floorGlow);
    const rt = this.pmrem.fromScene(env, 0.02, 0.1, 50, { position: new THREE.Vector3(0, 1.4, 0) });
    this.envRT?.dispose();
    this.envRT = rt;
    this.interior.scene.environment = rt.texture;
    env.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
  }

  private bindInput() {
    const el = this.canvas;
    let down: { x: number; y: number; id: number; moved: number } | null = null;
    const pinch = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;

    const pickAt = (cx: number, cy: number): Interactive | null => {
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hits = this.raycaster.intersectObjects(this.pickables, true);
      for (const h of hits) {
        const k = this.keyOf.get(h.object);
        if (k) return k;
      }
      return null;
    };

    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.size === 2) {
        const [p1, p2] = [...pinch.values()];
        pinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        down = null;
        return;
      }
      down = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: 0 };
    };
    const onMove = (e: PointerEvent) => {
      if (pinch.has(e.pointerId)) pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.size === 2) {
        const [p1, p2] = [...pinch.values()];
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        this.rig.walk((d - pinchDist) * 0.01);
        pinchDist = d;
        return;
      }
      if (down && e.pointerId === down.id) {
        const dx = e.clientX - down.x;
        const dy = e.clientY - down.y;
        down.moved += Math.abs(dx) + Math.abs(dy);
        down.x = e.clientX;
        down.y = e.clientY;
        this.rig.look(dx, dy);
        return;
      }
      if (e.pointerType === "mouse") {
        const k = pickAt(e.clientX, e.clientY);
        if (k !== this.hovered) {
          this.hovered = k;
          el.style.cursor = k && k !== "window" ? "pointer" : "grab";
          this.events.onHover?.(k);
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      pinch.delete(e.pointerId);
      if (down && e.pointerId === down.id && down.moved < 6) {
        const k = pickAt(e.clientX, e.clientY);
        if (k) this.events.onPick?.(k);
      }
      if (down && e.pointerId === down.id) down = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.rig.walk(-Math.sign(e.deltaY) * Math.min(0.6, Math.abs(e.deltaY) * 0.004));
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable]")) return;
      if (e.type === "keydown") {
        if (e.code === "ArrowLeft" || e.code === "KeyQ") return this.nextZone(-1);
        if (e.code === "ArrowRight" || e.code === "KeyE") return this.nextZone(1);
        this.rig.keyDown(e.code);
      } else this.rig.keyUp(e.code);
    };
    const onBlur = () => this.rig.clearKeys();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(el.parentElement ?? el);

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    el.style.cursor = "grab";
    el.style.touchAction = "none";
    this.disposers.push(() => {
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    });
  }
}

export { ZONES, FOCUS };
