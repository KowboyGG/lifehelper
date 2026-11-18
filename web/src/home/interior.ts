// Квартира: угловая студия с панорамными окнами на север и восток.
// Оси: x — на восток, z — на юг, y — вверх. Пол на y=0, окна: z=-4 и x=6.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { makeGlassMaterial, type GlassUniforms } from "./glass";
import { concreteTexture, fabricTexture, glow, phys, rugTexture, std, stoneTexture, woodTextures } from "./materials";
import { fiddleFig, monstera, oliveTree, smallPlant, snakePlant } from "./plants";
import { canvasTexture, contactShadow, rng } from "./util";

export const ROOM = { x0: -6, x1: 6, z0: -4, z1: 4, h: 3.5, winTop: 3.2, eastGlassEnd: 1.0 };

export interface ReflectionHooks {
  tex: { value: THREE.Texture | null };
  matrix: { value: THREE.Matrix4 };
  strength: { value: number };
}

export type Interactive = "fridge" | "money" | "safe" | "monitor" | "calendar" | "window";

export interface Anchors {
  /** центр фасада холодильника (магниты), смотрит в +x */
  fridgeFront: THREE.Group;
  /** столешница журнального столика (деньги) */
  tableTop: THREE.Group;
  /** полка внутри сейфа */
  safeInside: THREE.Group;
  /** экран монитора */
  monitorScreen: THREE.Mesh;
  /** бумажный календарь на колонне */
  calendar: THREE.Mesh;
  /** электронные часы */
  clock: THREE.Mesh;
  /** соотношение сторон экрана монитора */
  monitorAspect?: number;
}

/** Прямоугольный источник: pos — центр, dir — куда светит, along — вдоль ширины */
function rectLight(color: THREE.ColorRepresentation, intensity: number, w: number, h: number, pos: THREE.Vector3, dir: THREE.Vector3, along: THREE.Vector3) {
  const l = new THREE.RectAreaLight(color, intensity, w, h);
  const z = dir.clone().normalize().negate();
  const x = along.clone().normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  l.quaternion.setFromRotationMatrix(m);
  l.position.copy(pos);
  return l;
}

export function buildInterior(G: GlassUniforms, refl: ReflectionHooks) {
  const scene = new THREE.Scene();
  const interactive = new Map<Interactive, THREE.Object3D>();
  const r = rng(42);
  const { x0, x1, z0, z1, h: H, winTop } = ROOM;

  const add = <T extends THREE.Object3D>(o: T, parent: THREE.Object3D = scene) => {
    parent.add(o);
    return o;
  };
  /** Коробка, y — низ */
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    return add(m, parent);
  };
  const rbox = (w: number, h: number, d: number, rad: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, rad), mat);
    m.position.set(x, y + h / 2, z);
    return add(m, parent);
  };
  /** Метка «процедурной заглушки»: прячется, когда загрузится модель */
  const tag = <T extends THREE.Object3D>(o: T, t: string) => {
    o.userData.proc = t;
    return o;
  };
  const shadow = (w: number, d: number, x: number, z: number, o = 0.7) => {
    const s = contactShadow(w, d, o);
    s.position.x = x;
    s.position.z = z;
    return add(s);
  };

  // ------------------------------------------------------------ материалы
  const wood = woodTextures();
  const floorMat = std({ map: wood.color, roughnessMap: wood.rough, roughness: 0.9, metalness: 0 });
  floorMat.map!.repeat.set(3.1, 2.1);
  floorMat.roughnessMap!.repeat.set(3.1, 2.1);
  floorMat.onBeforeCompile = (sh) => {
    sh.uniforms.tRefl = refl.tex;
    sh.uniforms.uReflMatrix = refl.matrix;
    sh.uniforms.uReflStrength = refl.strength;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform mat4 uReflMatrix;\nvarying vec4 vReflCoord;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvReflCoord = uReflMatrix * modelMatrix * vec4( transformed, 1.0 );");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D tRefl;\nuniform float uReflStrength;\nvarying vec4 vReflCoord;")
      .replace(
        "#include <opaque_fragment>",
        /* glsl */ `
        {
          vec3 vdir = normalize( vViewPosition );
          float ndv = saturate( dot( normal, vdir ) );
          float fres = 0.04 + 0.96 * pow( 1.0 - ndv, 5.0 );
          vec2 ruv = vReflCoord.xy / vReflCoord.w;
          float seam = smoothstep( 0.004, 0.03, dot( diffuseColor.rgb, vec3( 0.333 ) ) );
          float lod = 1.2 + roughnessFactor * 4.5;
          vec2 wob = vec2( 0.0, ( roughnessFactor - 0.5 ) * 0.012 );
          vec3 rc = textureLod( tRefl, ruv + wob, lod ).rgb * 0.6 + textureLod( tRefl, ruv + wob, lod + 1.5 ).rgb * 0.4;
          outgoingLight += rc * mix( 0.1, 0.9, fres ) * seam * uReflStrength * ( 1.15 - roughnessFactor );
        }
        #include <opaque_fragment>`,
      );
  };

  const ceilingTex = concreteTexture("ceiling", true, 0.46);
  ceilingTex.wrapS = ceilingTex.wrapT = THREE.RepeatWrapping;
  ceilingTex.repeat.set(12 / 4.8, 8 / 4.8);
  const ceilingMat = std({ map: ceilingTex, roughness: 0.92 });
  const wallTex = fabricTexture("plaster", [58, 56, 58], 0.25);
  wallTex.repeat.set(3, 1);
  const wallMat = std({ map: wallTex, roughness: 0.95 });
  const columnTex = concreteTexture("column", false, 0.42);
  const columnMat = std({ map: columnTex, roughness: 0.9 });
  const steel = std({ color: "#0b0b0d", roughness: 0.42, metalness: 0.7 });
  const blackMatte = std({ color: "#0f0f11", roughness: 0.62, metalness: 0.05 });
  const stoneDark = phys({ map: stoneTexture("counter", true), roughness: 0.42, metalness: 0, envMapIntensity: 0.5, specularIntensity: 0.35 });
  const walnut = std({ map: wood.color, color: "#bba08a", roughness: 0.38 });
  const fabric = phys({
    map: fabricTexture("boucle", [150, 140, 128], 1.4),
    roughness: 0.95,
    sheen: 1,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color("#8a8178"),
  });
  (fabric.map as THREE.Texture).repeat.set(2, 2);
  const leather = std({ color: "#3a2416", roughness: 0.5 });
  const brass = std({ color: "#b48a4e", roughness: 0.28, metalness: 1 });
  const fridgeSteel = phys({ color: "#4a4c51", metalness: 1, roughness: 0.34, anisotropy: 0.6, anisotropyRotation: Math.PI / 2, envMapIntensity: 0.7 });

  // ------------------------------------------------------------ коробка комнаты
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12.2, 8.2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  add(ceiling);

  const wall = (w: number, x: number, z: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wallMat);
    m.position.set(x, H / 2, z);
    m.rotation.y = ry;
    return add(m);
  };
  wall(8, x0, 0, Math.PI / 2); // запад
  wall(12, 0, z1, Math.PI); // юг
  const eastSolid = z1 - ROOM.eastGlassEnd;
  wall(eastSolid, x1, ROOM.eastGlassEnd + eastSolid / 2, -Math.PI / 2); // восток (глухая часть)

  // плинтус
  const skirting = std({ color: "#0d0d0f", roughness: 0.5 });
  box(0.02, 0.08, 8, skirting, x0 + 0.01, 0, 0);
  box(12, 0.08, 0.02, skirting, 0, 0, z1 - 0.01);
  box(0.02, 0.08, eastSolid, skirting, x1 - 0.01, 0, ROOM.eastGlassEnd + eastSolid / 2);

  // ригели над окнами (бетон)
  box(12, H - winTop, 0.34, columnMat, 0, winTop, z0 + 0.17);
  box(0.34, H - winTop, 5, columnMat, x1 - 0.17, winTop, -1.5);

  // стекло
  const glassN = new THREE.Mesh(new THREE.PlaneGeometry(12, winTop), makeGlassMaterial(G, 12, winTop));
  glassN.position.set(0, winTop / 2, z0 - 0.02);
  add(glassN);
  const eastLen = ROOM.eastGlassEnd - z0;
  const glassE = new THREE.Mesh(new THREE.PlaneGeometry(eastLen, winTop), makeGlassMaterial(G, eastLen, winTop, new THREE.Vector2(17.3, 0.4)));
  glassE.position.set(x1 + 0.02, winTop / 2, z0 + eastLen / 2);
  glassE.rotation.y = -Math.PI / 2;
  add(glassE);
  const glassMeshes = [glassN, glassE];
  interactive.set("window", glassN);

  // переплёты: тонкий чёрный металл
  const frame = std({ color: "#08080a", roughness: 0.5, metalness: 0.6 });
  for (let k = 0; k <= 8; k++) box(0.07, winTop, 0.1, frame, x0 + k * 1.5, 0, z0 + 0.03);
  for (let k = 0; k <= 4; k++) box(0.1, winTop, 0.07, frame, x1 - 0.03, 0, z0 + k * 1.25);
  box(12, 0.06, 0.1, frame, 0, 0.92, z0 + 0.03);
  box(0.1, 0.06, eastLen, frame, x1 - 0.03, 0.92, z0 + eastLen / 2);
  box(12, 0.08, 0.16, frame, 0, 0, z0 + 0.06);
  box(0.16, 0.08, eastLen, frame, x1 - 0.06, 0, z0 + eastLen / 2);
  box(12, 0.06, 0.1, frame, 0, winTop - 0.06, z0 + 0.03);
  box(0.1, 0.06, eastLen, frame, x1 - 0.03, winTop - 0.06, z0 + eastLen / 2);
  box(0.16, winTop, 0.16, frame, x1 - 0.06, 0, z0 + 0.06); // угловая стойка

  // ------------------------------------------------------------ RGB-лента: ниши под потолком
  const ledPrimary: THREE.MeshBasicMaterial[] = [];
  const ledSecondary: THREE.MeshBasicMaterial[] = [];
  const primaryLights: THREE.RectAreaLight[] = [];
  const secondaryLights: THREE.RectAreaLight[] = [];
  const ledMat = (primary: boolean) => {
    const m = glow("#ffffff", 1);
    (primary ? ledPrimary : ledSecondary).push(m);
    return m;
  };

  const soffitY = 3.04;
  const soffitH = 0.16;
  // запад
  box(0.5, soffitH, 8, blackMatte, x0 + 0.25, soffitY, 0);
  box(0.03, 0.05, 8, blackMatte, x0 + 0.485, soffitY + soffitH, 0); // бортик скрывает ленту
  box(0.015, 0.012, 7.9, ledMat(true), x0 + 0.46, soffitY + soffitH, 0);
  // юг
  box(11.5, soffitH, 0.5, blackMatte, 0.25, soffitY, z1 - 0.25);
  box(11.5, 0.05, 0.03, blackMatte, 0.25, soffitY + soffitH, z1 - 0.485);
  box(11.4, 0.012, 0.015, ledMat(true), 0.3, soffitY + soffitH, z1 - 0.46);
  const coveW = rectLight("#ffffff", 1, 7.9, 0.05, new THREE.Vector3(x0 + 0.44, soffitY + soffitH + 0.02, 0), new THREE.Vector3(0.25, 1, 0), new THREE.Vector3(0, 0, 1));
  const coveS = rectLight("#ffffff", 1, 11.4, 0.05, new THREE.Vector3(0.3, soffitY + soffitH + 0.02, z1 - 0.44), new THREE.Vector3(0, 1, -0.25), new THREE.Vector3(1, 0, 0));
  add(coveW);
  add(coveS);
  primaryLights.push(coveW, coveS);

  // свет города через окна
  const cityN = rectLight("#9aa6c4", 1, 12, winTop, new THREE.Vector3(0, winTop / 2, z0 + 0.05), new THREE.Vector3(0, -0.15, 1), new THREE.Vector3(1, 0, 0));
  const cityE = rectLight("#a99ca8", 1, eastLen, winTop, new THREE.Vector3(x1 - 0.05, winTop / 2, z0 + eastLen / 2), new THREE.Vector3(-1, -0.15, 0), new THREE.Vector3(0, 0, -1));
  add(cityN);
  add(cityE);
  const hemi = new THREE.HemisphereLight("#5a6480", "#140f10", 0.05);
  add(hemi);

  // ------------------------------------------------------------ кухня вдоль западной стены
  const kz0 = -2.2;
  const kz1 = 1.32;
  const kLen = kz1 - kz0;
  const kMid = (kz0 + kz1) / 2;
  // цоколь
  box(0.55, 0.1, kLen, std({ color: "#050506", roughness: 0.8 }), x0 + 0.27, 0, kMid);
  // фасады нижних шкафов с зазорами
  const doors = 6;
  for (let i = 0; i < doors; i++) {
    const dz = kLen / doors;
    box(0.6, 0.77, dz - 0.006, blackMatte, x0 + 0.31, 0.1, kz0 + dz * (i + 0.5));
  }
  // столешница
  const counterTop = box(0.66, 0.04, kLen + 0.02, stoneDark, x0 + 0.33, 0.87, kMid);
  counterTop.receiveShadow = true;
  // фартук
  box(0.02, 0.58, kLen, stoneDark, x0 + 0.01, 0.91, kMid);
  // верхние шкафы до ниши
  const upper = 5;
  for (let i = 0; i < upper; i++) {
    const dz = kLen / upper;
    box(0.36, soffitY - 1.5, dz - 0.006, blackMatte, x0 + 0.18, 1.5, kz0 + dz * (i + 0.5));
  }
  // подсветка под верхними шкафами
  box(0.012, 0.01, kLen - 0.1, ledMat(false), x0 + 0.33, 1.49, kMid);
  const underCab = rectLight("#ffffff", 1, kLen - 0.1, 0.04, new THREE.Vector3(x0 + 0.3, 1.485, kMid), new THREE.Vector3(0.15, -1, 0), new THREE.Vector3(0, 0, 1));
  add(underCab);
  secondaryLights.push(underCab);
  // мойка и смеситель
  tag(box(0.42, 0.005, 0.6, std({ color: "#060607", roughness: 0.3, metalness: 0.4 }), x0 + 0.34, 0.912, -0.9), "sink");
  const faucet = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(0.12, 0.36, 0), new THREE.Vector3(0.2, 0.28, 0)]), 16, 0.012, 8),
    steel,
  );
  faucet.position.set(x0 + 0.1, 0.91, -0.9);
  add(tag(faucet, "sink"));
  // варочная панель
  box(0.52, 0.006, 0.6, std({ color: "#050506", roughness: 0.08, metalness: 0 }), x0 + 0.34, 0.912, 0.5);
  // кофемашина
  box(0.3, 0.38, 0.24, std({ color: "#18181a", roughness: 0.35, metalness: 0.6 }), x0 + 0.2, 0.91, -1.85);
  // точечный индикатор кофемашины
  box(0.004, 0.01, 0.01, glow("#4fc4ff", 6), x0 + 0.352, 1.2, -1.85);

  // холодильник (французские двери), фасад смотрит на восток
  const fz0 = 1.38;
  const fz1 = 2.32;
  const fW = fz1 - fz0;
  const fMid = (fz0 + fz1) / 2;
  const fx = x0 + 0.76; // плоскость фасада
  const fridge = new THREE.Group();
  add(fridge);
  tag(box(0.74, 1.84, fW, std({ color: "#1b1c1f", roughness: 0.5, metalness: 0.6 }), x0 + 0.38, 0.02, fMid, fridge), "fridge");
  const door = (z: number, w: number, y: number, h: number) => {
    const d = tag(rbox(0.04, h, w, 0.012, fridgeSteel, fx - 0.02, y, z, fridge), "fridge");
    return d;
  };
  door(fz0 + fW * 0.25, fW / 2 - 0.006, 0.76, 1.08);
  door(fz0 + fW * 0.75, fW / 2 - 0.006, 0.76, 1.08);
  door(fMid, fW - 0.006, 0.05, 0.68);
  // ручки
  for (const dz of [-0.05, 0.05]) {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.72, 10), steel);
    handle.position.set(fx + 0.04, 1.3, fMid + dz);
    add(tag(handle, "fridge"), fridge);
    for (const hy of [0.98, 1.62]) tag(box(0.04, 0.02, 0.02, steel, fx + 0.02, hy - 0.01, fMid + dz, fridge), "fridge");
  }
  const fridgeBar = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.5, 10), steel);
  fridgeBar.rotation.x = Math.PI / 2;
  fridgeBar.position.set(fx + 0.04, 0.64, fMid);
  add(tag(fridgeBar, "fridge"), fridge);
  // боковая панель-пенал
  box(0.76, soffitY, 0.03, blackMatte, x0 + 0.38, 0, fz1 + 0.015);
  const fridgeTop = box(0.76, soffitY - 1.9, fW + 0.03, blackMatte, x0 + 0.38, 1.9, fMid);
  const fridgeFront = new THREE.Group();
  fridgeFront.position.set(fx + 0.002, 1.3, fMid);
  fridgeFront.rotation.y = Math.PI / 2;
  add(fridgeFront, fridge);
  interactive.set("fridge", fridge);
  shadow(1.1, 1.3, x0 + 0.5, fMid, 0.6);

  // остров
  const ix0 = -4.15;
  const ix1 = -3.05;
  const iMid = (ix0 + ix1) / 2;
  box(ix1 - ix0 - 0.1, 0.88, 2.3, blackMatte, iMid - 0.05, 0, 0);
  const islandTop = box(1.3, 0.05, 2.5, stoneDark, iMid + 0.1, 0.88, 0);
  islandTop.receiveShadow = true;
  box(1.3, 0.88, 0.05, stoneDark, iMid + 0.1, 0, -1.225);
  box(1.3, 0.88, 0.05, stoneDark, iMid + 0.1, 0, 1.225);
  shadow(2.0, 3.2, iMid, 0, 0.75);
  // барные стулья
  for (const sz of [-0.75, 0, 0.75]) {
    const sx = ix1 + 0.55;
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.17, 0.07, 28), leather);
    seat.position.set(sx, 0.7, sz);
    add(tag(seat, "stools"));
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.66, 10), steel);
    post.position.set(sx, 0.34, sz);
    add(tag(post, "stools"));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.008, 6, 24), steel);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(sx, 0.26, sz);
    add(tag(ring, "stools"));
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.02, 28), steel);
    base.position.set(sx, 0.01, sz);
    add(tag(base, "stools"));
    tag(shadow(0.6, 0.6, sx, sz, 0.5), "stools");
  }
  // свеча на острове
  const candleGlass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.1, 20, 1, true),
    phys({ color: "#3a2a20", roughness: 0.15, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  candleGlass.position.set(iMid + 0.15, 0.98, -0.45);
  add(candleGlass);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), glow("#ffb070", 18));
  flame.scale.set(1, 2.2, 1);
  flame.position.set(iMid + 0.15, 1.0, -0.45);
  add(flame);
  const candle = new THREE.PointLight("#ff9a4a", 0.06, 2.5, 2);
  candle.position.set(iMid + 0.15, 1.12, -0.45);
  add(candle);
  // бутылка и бокалы
  const bottle = new THREE.Mesh(
    new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.037, 0), new THREE.Vector2(0.038, 0.2), new THREE.Vector2(0.015, 0.27), new THREE.Vector2(0.013, 0.32), new THREE.Vector2(0, 0.32)], 20),
    phys({ color: "#0d1a10", roughness: 0.12, metalness: 0.1, clearcoat: 1 }),
  );
  bottle.position.set(iMid + 0.25, 0.93, 0.35);
  add(tag(bottle, "islandBottle"));
  const glassMat = phys({ color: "#cfd6e0", roughness: 0.05, transparent: true, opacity: 0.25, metalness: 0, side: THREE.DoubleSide });
  for (const gz of [0.6, 0.72]) {
    const wg = new THREE.Mesh(
      new THREE.LatheGeometry([new THREE.Vector2(0.03, 0), new THREE.Vector2(0.004, 0.005), new THREE.Vector2(0.004, 0.09), new THREE.Vector2(0.038, 0.13), new THREE.Vector2(0.04, 0.2)], 20),
      glassMat,
    );
    wg.position.set(iMid + 0.05 + (gz - 0.6), 0.93, gz);
    add(tag(wg, "islandBottle"));
  }
  // подвесной светильник-барабан (еле тлеет)
  const shadeMat = std({ color: "#3a332c", roughness: 0.9, side: THREE.DoubleSide, emissive: new THREE.Color("#ff8a40"), emissiveIntensity: 0.05 });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.34, 40, 1, true), shadeMat);
  shade.position.set(iMid, 2.25, 0);
  add(shade);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, H - 2.42, 6), steel);
  cord.position.set(iMid, (H + 2.42) / 2, 0);
  add(cord);
  const diffuser = new THREE.Mesh(new THREE.CircleGeometry(0.36, 40), glow("#ff9a50", 0.45));
  diffuser.rotation.x = Math.PI / 2;
  diffuser.position.set(iMid, 2.1, 0);
  add(diffuser);
  const pendant = new THREE.PointLight("#ff9a55", 0.12, 3.5, 2);
  pendant.position.set(iMid, 2.15, 0);
  add(pendant);

  // ------------------------------------------------------------ гостиная
  // ковёр
  const rug = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.012, 2.8), std({ map: rugTexture(), roughness: 1 }));
  rug.position.set(0.3, 0.006, -0.75);
  rug.receiveShadow = true;
  add(rug);

  // диван-«облако», стоит спиной к нам, смотрит в окно
  const sofa = new THREE.Group();
  add(sofa);
  const sx0 = -1.75;
  const sx1 = 1.35;
  const sMidX = (sx0 + sx1) / 2;
  const sz0 = 0.15;
  const sz1 = 1.2;
  const sMidZ = (sz0 + sz1) / 2;
  const plinth = rbox(sx1 - sx0 - 0.3, 0.12, sz1 - sz0 - 0.3, 0.03, blackMatte, sMidX, 0.04, sMidZ, sofa);
  plinth.castShadow = false;
  for (let i = 0; i < 3; i++) {
    const w = (sx1 - sx0) / 3;
    rbox(w - 0.02, 0.26, sz1 - sz0 - 0.22, 0.1, fabric, sx0 + w * (i + 0.5), 0.16, sz0 + (sz1 - sz0 - 0.22) / 2, sofa);
    rbox(w - 0.03, 0.46, 0.3, 0.13, fabric, sx0 + w * (i + 0.5), 0.36, sz1 - 0.15, sofa);
  }
  // шезлонг на востоке
  const cx0 = sx1;
  const cx1 = sx1 + 1.05;
  const cz0 = -1.0;
  rbox(cx1 - cx0 - 0.3, 0.12, sz1 - cz0 - 0.3, 0.03, blackMatte, (cx0 + cx1) / 2, 0.04, (cz0 + sz1) / 2, sofa);
  rbox(cx1 - cx0 - 0.02, 0.26, sz1 - cz0 - 0.24, 0.1, fabric, (cx0 + cx1) / 2, 0.16, (cz0 + sz1 - 0.24) / 2, sofa);
  rbox(cx1 - cx0 - 0.03, 0.46, 0.3, 0.13, fabric, (cx0 + cx1) / 2, 0.36, sz1 - 0.15, sofa);
  // цельная спинка — сзади диван читается одним силуэтом
  rbox(cx1 - sx0 + 0.02, 0.6, 0.14, 0.06, fabric, (sx0 + cx1) / 2, 0.06, sz1 - 0.03, sofa);
  // подлокотник на западе
  rbox(0.32, 0.6, sz1 - sz0, 0.13, fabric, sx0 - 0.14, 0.02, sMidZ, sofa);
  // подушки
  const pillowMat = (c: string) => phys({ color: c, roughness: 0.95, sheen: 1, sheenColor: new THREE.Color(c) });
  const pillow = (x: number, z: number, ry: number, rz: number, c: string) => {
    const p = rbox(0.48, 0.44, 0.15, 0.07, pillowMat(c), x, 0.4, z, sofa);
    p.rotation.set(-0.25, ry, rz);
  };
  pillow(-1.25, 0.95, 0.1, 0.05, "#5b3a2a");
  pillow(-0.75, 0.92, -0.15, -0.08, "#8a7f72");
  pillow(1.85, 0.92, 0.05, 0.06, "#3d3a3c");
  // плед на шезлонге
  const throwGeo = new THREE.PlaneGeometry(0.9, 1.1, 24, 24);
  const tp = throwGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i);
    const y = tp.getY(i);
    tp.setZ(i, Math.sin(x * 9 + y * 3) * 0.025 + Math.sin(y * 13) * 0.015);
  }
  throwGeo.computeVertexNormals();
  const throwMesh = new THREE.Mesh(throwGeo, phys({ map: fabricTexture("throw", [110, 74, 58], 2.5), roughness: 1, sheen: 1, sheenColor: new THREE.Color("#7a5040"), side: THREE.DoubleSide }));
  throwMesh.rotation.set(-Math.PI / 2 + 0.08, 0, 0.35);
  throwMesh.position.set((cx0 + cx1) / 2 + 0.05, 0.445, -0.35);
  add(throwMesh, sofa);
  sofa.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.receiveShadow = true;
  });
  shadow(3.6, 1.6, sMidX - 0.1, sMidZ, 0.8);
  shadow(1.5, 2.6, (cx0 + cx1) / 2, (cz0 + sz1) / 2, 0.8);
  // подсветка под диваном
  box(sx1 - sx0 - 0.2, 0.01, 0.012, ledMat(false), sMidX, 0.05, sz0 + 0.03);
  box(0.012, 0.01, sz1 - cz0 - 0.2, ledMat(false), cx1 - 0.08, 0.05, (cz0 + sz1) / 2);
  const sofaGlow = rectLight("#ffffff", 1, cx1 - sx0 - 0.3, sz1 - cz0 - 0.4, new THREE.Vector3((sx0 + cx1) / 2, 0.06, (cz0 + sz1) / 2), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0));
  add(sofaGlow);
  secondaryLights.push(sofaGlow);

  // журнальный столик — круглый, орех
  const tx = -0.05;
  const tz = -1.3;
  const tableH = 0.38;
  const table = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, tableH, 64), walnut);
  table.position.set(tx, tableH / 2, tz);
  table.receiveShadow = true;
  table.castShadow = true;
  add(table);
  const tableTop = new THREE.Group();
  tableTop.position.set(tx, tableH, tz);
  add(tableTop);
  interactive.set("money", table);
  shadow(1.5, 1.5, tx, tz, 0.85);
  // беспроводная лампа-гриб
  const lampX = tx + 0.3;
  const lampZ = tz - 0.18;
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.012, 24), brass);
  lampBase.position.set(lampX, tableH + 0.006, lampZ);
  add(lampBase);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.2, 10), brass);
  stem.position.set(lampX, tableH + 0.11, lampZ);
  add(stem);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.075, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), brass);
  dome.position.set(lampX, tableH + 0.2, lampZ);
  add(dome);
  const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.07, 24), glow("#ffb27a", 9));
  bulb.rotation.x = Math.PI / 2;
  bulb.position.set(lampX, tableH + 0.199, lampZ);
  add(bulb);
  const tableLamp = new THREE.SpotLight("#ffa060", 2.6, 3.2, 1.25, 0.95, 2);
  tableLamp.position.set(lampX, tableH + 0.19, lampZ);
  tableLamp.target.position.set(lampX - 0.05, 0, lampZ + 0.05);
  tableLamp.castShadow = true;
  tableLamp.shadow.mapSize.set(1024, 1024);
  tableLamp.shadow.bias = -0.0004;
  tableLamp.shadow.radius = 6;
  tableLamp.shadow.camera.near = 0.02;
  tableLamp.shadow.camera.far = 3;
  add(tableLamp);
  add(tableLamp.target);
  [lampBase, stem, dome].forEach((m) => (m.castShadow = true));
  // книги
  const books = new THREE.Group();
  books.position.set(tx - 0.24, tableH, tz - 0.28);
  books.rotation.y = 0.35;
  add(books);
  [
    ["#1d2a33", 0.3, 0.22, 0.035],
    ["#3a2a22", 0.27, 0.2, 0.03],
  ].forEach(([c, w, d, h], i) => {
    const b = box(w as number, h as number, d as number, std({ color: c as string, roughness: 0.8 }), 0, i * 0.036, 0, books);
    b.rotation.y = i * 0.12;
    b.castShadow = true;
    b.receiveShadow = true;
  });

  // торшер-дуга с оранжевым шаром (как на фото с лентой)
  const arcBase = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.05, 32), std({ color: "#e8e2da", roughness: 0.3 }));
  arcBase.position.set(-2.1, 0.025, -2.75);
  add(arcBase);
  const arcCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-2.1, 0.05, -2.75),
    new THREE.Vector3(-2.1, 1.3, -2.75),
    new THREE.Vector3(-2.0, 2.05, -2.5),
    new THREE.Vector3(-1.6, 2.2, -2.0),
    new THREE.Vector3(-1.25, 2.0, -1.65),
  ]);
  add(new THREE.Mesh(new THREE.TubeGeometry(arcCurve, 40, 0.012, 8), steel));
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.19, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), std({ color: "#ff6a20", emissive: new THREE.Color("#ff5a10"), emissiveIntensity: 2.4, roughness: 0.5, side: THREE.DoubleSide }));
  globe.position.set(-1.25, 1.84, -1.65);
  add(globe);
  const arcLight = new THREE.PointLight("#ff6a28", 1.4, 4.5, 2);
  arcLight.position.set(-1.25, 1.78, -1.65);
  add(arcLight);
  shadow(0.5, 0.5, -2.1, -2.75, 0.5);

  // растения у окна
  const olive = oliveTree(3);
  olive.position.set(-4.85, 0, -3.3);
  add(olive);
  shadow(1.0, 1.0, -4.85, -3.3, 0.7);
  const mon = monstera(5);
  mon.position.set(-2.75, 0, -3.35);
  mon.rotation.y = 0.4;
  add(mon);
  shadow(1.0, 1.0, -2.75, -3.35, 0.7);
  const snake = snakePlant(8);
  snake.position.set(-0.9, 0, -3.5);
  add(snake);
  shadow(0.6, 0.6, -0.9, -3.5, 0.6);
  const fig = fiddleFig(12);
  fig.position.set(1.85, 0, -3.35);
  add(fig);
  shadow(0.9, 0.9, 1.85, -3.35, 0.7);

  // ------------------------------------------------------------ колонна с календарём и часами
  const colX = 3.15;
  const colZ = -0.95;
  box(0.56, H, 0.56, columnMat, colX, 0, colZ);
  shadow(1.0, 1.0, colX, colZ, 0.6);
  const calendar = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.52), std({ color: "#ffffff", roughness: 0.9 }));
  calendar.position.set(colX - 0.285, 1.28, colZ);
  calendar.rotation.y = -Math.PI / 2;
  add(calendar);
  // гвоздик
  const nail = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), brass);
  nail.position.set(colX - 0.285, 1.555, colZ);
  add(nail);
  const clockBody = rbox(0.03, 0.12, 0.34, 0.01, std({ color: "#050505", roughness: 0.15, metalness: 0.2 }), colX - 0.295, 1.72, colZ);
  clockBody.castShadow = false;
  const clock = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.1), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true }));
  clock.position.set(colX - 0.312, 1.78, colZ);
  clock.rotation.y = -Math.PI / 2;
  add(clock);
  interactive.set("calendar", calendar);

  // ------------------------------------------------------------ рабочее место у восточного окна
  // стол стоит вдоль стекла, монитор смотрит в комнату, за ним — город
  const dx = 5.4;
  const dz = -0.95;
  const desk = new THREE.Group();
  add(desk);
  const deskTop = box(0.72, 0.035, 1.8, std({ map: wood.color, color: "#5a4a40", roughness: 0.45 }), dx, 0.72, dz, desk);
  deskTop.receiveShadow = true;
  for (const lz of [-0.85, 0.85]) {
    box(0.04, 0.72, 0.04, steel, dx - 0.32, 0, dz + lz, desk);
    box(0.04, 0.72, 0.04, steel, dx + 0.32, 0, dz + lz, desk);
    box(0.64, 0.03, 0.04, steel, dx, 0.05, dz + lz, desk);
  }
  shadow(1.2, 2.2, dx, dz, 0.75);
  // монитор
  const monitor = new THREE.Group();
  add(monitor, desk);
  tag(rbox(0.035, 0.4, 0.9, 0.008, std({ color: "#0a0a0b", roughness: 0.4, metalness: 0.3 }), dx + 0.18, 1.0, dz, monitor), "deskset");
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.87, 0.37), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
  screen.position.set(dx + 0.161, 1.2, dz);
  screen.rotation.y = -Math.PI / 2;
  add(screen, monitor);
  tag(box(0.03, 0.28, 0.05, steel, dx + 0.22, 0.755, dz, monitor), "deskset");
  tag(box(0.2, 0.012, 0.28, steel, dx + 0.18, 0.755, dz, monitor), "deskset");
  // подсветка за монитором — светит в стекло
  box(0.01, 0.01, 0.8, ledMat(false), dx + 0.2, 1.2, dz, monitor);
  const screenLight = rectLight("#cfe0ff", 1.2, 0.85, 0.36, new THREE.Vector3(dx + 0.15, 1.2, dz), new THREE.Vector3(-1, -0.2, 0), new THREE.Vector3(0, 0, 1));
  add(screenLight);
  interactive.set("monitor", monitor);
  // клавиатура, мышь, кружка, суккулент
  tag(rbox(0.13, 0.02, 0.44, 0.006, std({ color: "#1a1a1c", roughness: 0.6 }), dx - 0.12, 0.755, dz, desk), "deskset");
  tag(rbox(0.1, 0.025, 0.06, 0.02, std({ color: "#1a1a1c", roughness: 0.4 }), dx - 0.14, 0.755, dz - 0.34, desk), "deskset");
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.095, 24), std({ color: "#e9e4dc", roughness: 0.35 }));
  mug.position.set(dx - 0.1, 0.755 + 0.048, dz + 0.55);
  add(tag(mug, "deskset"), desk);
  const succ = smallPlant(4);
  succ.position.set(dx + 0.15, 0.755, dz - 0.72);
  add(tag(succ, "deskset"), desk);
  // подсветка под столом
  box(0.012, 0.01, 1.6, ledMat(false), dx - 0.3, 0.715, dz);
  const deskGlow = rectLight("#ffffff", 1, 0.5, 1.6, new THREE.Vector3(dx, 0.71, dz), new THREE.Vector3(-0.1, -1, 0), new THREE.Vector3(1, 0, 0));
  add(deskGlow);
  secondaryLights.push(deskGlow);
  // кресло
  const chair = new THREE.Group();
  chair.position.set(dx - 0.8, 0, dz + 0.05);
  chair.rotation.y = -Math.PI / 2 + 0.2;
  add(tag(chair, "chair"));
  const chairMat = std({ color: "#121214", roughness: 0.7 });
  rbox(0.5, 0.08, 0.5, 0.03, chairMat, 0, 0.46, 0, chair);
  const back = rbox(0.46, 0.6, 0.06, 0.03, chairMat, 0, 0.58, 0.25, chair);
  back.rotation.x = -0.12;
  const gas = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 10), steel);
  gas.position.y = 0.26;
  add(gas, chair);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = box(0.3, 0.03, 0.04, steel, Math.cos(a) * 0.15, 0.06, Math.sin(a) * 0.15, chair);
    leg.rotation.y = -a;
  }
  shadow(0.8, 0.8, dx - 0.8, dz + 0.05, 0.6);

  // ------------------------------------------------------------ восточная стена: комод, картина, сейф
  const con = new THREE.Group();
  add(con);
  const conZ0 = 1.3;
  const conZ1 = 2.8;
  const conMid = (conZ0 + conZ1) / 2;
  box(0.46, 0.5, conZ1 - conZ0, walnut, x1 - 0.25, 0.12, conMid, con);
  for (const lz of [conZ0 + 0.06, conZ1 - 0.06]) {
    box(0.03, 0.12, 0.03, steel, x1 - 0.42, 0, lz, con);
    box(0.03, 0.12, 0.03, steel, x1 - 0.08, 0, lz, con);
  }
  // проигрыватель
  box(0.36, 0.08, 0.42, std({ color: "#141416", roughness: 0.4 }), x1 - 0.25, 0.62, conMid - 0.35, con);
  const vinyl = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.004, 48), std({ color: "#050505", roughness: 0.2 }));
  vinyl.position.set(x1 - 0.25, 0.705, conMid - 0.37);
  add(vinyl, con);
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.005, 24), std({ color: "#b0332a", roughness: 0.6 }));
  label.position.set(x1 - 0.25, 0.706, conMid - 0.37);
  add(label, con);
  // подсветка под комодом
  box(0.012, 0.01, conZ1 - conZ0 - 0.1, ledMat(false), x1 - 0.46, 0.115, conMid);
  shadow(0.9, 1.9, x1 - 0.25, conMid, 0.6);
  // картина
  const art = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 0.65),
    std({
      roughness: 0.85,
      map: canvasTexture(512, 350, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "#0d1420");
        g.addColorStop(1, "#1d1622");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#c2552d";
        ctx.beginPath();
        ctx.arc(w * 0.62, h * 0.45, h * 0.24, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(220,210,190,0.85)";
        ctx.fillRect(w * 0.18, h * 0.62, w * 0.62, 3);
        ctx.fillStyle = "#2c3b52";
        ctx.fillRect(w * 0.18, h * 0.66, w * 0.3, h * 0.18);
      }),
    }),
  );
  art.position.set(x1 - 0.015, 1.55, conMid);
  art.rotation.y = -Math.PI / 2;
  add(tag(art, "art"));
  tag(box(0.02, 0.69, 0.99, std({ color: "#0b0b0c", roughness: 0.5 }), x1 - 0.012, 1.55 - 0.345, conMid), "art");
  art.position.x = x1 - 0.024;
  // подсветка картины
  tag(box(0.06, 0.02, 0.5, brass, x1 - 0.06, 1.92, conMid), "art");
  const artLight = new THREE.SpotLight("#ffd2a0", 1.2, 1.6, 0.9, 0.8, 2);
  artLight.position.set(x1 - 0.1, 1.9, conMid);
  artLight.target.position.set(x1, 1.4, conMid);
  add(tag(artLight, "art"));
  add(artLight.target);

  // сейф
  const safe = new THREE.Group();
  safe.position.set(x1 - 0.32, 0, 3.35);
  add(safe);
  const safeMat = std({ color: "#25272b", roughness: 0.35, metalness: 0.75 });
  // корпус: открытая коробка
  const sw = 0.6;
  const sh = 0.78;
  const sd = 0.56;
  box(sd, 0.05, sw, safeMat, 0, 0, 0, safe);
  box(sd, 0.05, sw, safeMat, 0, sh - 0.05, 0, safe);
  box(0.05, sh, sw, safeMat, sd / 2 - 0.025, 0, 0, safe);
  box(sd, sh, 0.05, safeMat, 0, 0, -sw / 2 + 0.025, safe);
  box(sd, sh, 0.05, safeMat, 0, 0, sw / 2 - 0.025, safe);
  const shelfMat = std({ color: "#3a2a1e", roughness: 0.8 });
  box(sd - 0.08, 0.015, sw - 0.1, shelfMat, 0.02, 0.38, 0, safe);
  box(sd - 0.08, 0.015, sw - 0.1, shelfMat, 0.02, 0.05, 0, safe);
  // тёплый свет внутри
  const safeLight = new THREE.PointLight("#ffb070", 0.9, 1.4, 2);
  safeLight.position.set(0.0, sh - 0.12, 0);
  add(safeLight, safe);
  box(0.3, 0.01, 0.01, glow("#ffc890", 4), 0.05, sh - 0.06, 0, safe);
  // приоткрытая дверца на петлях с южной стороны
  const hinge = new THREE.Group();
  hinge.position.set(-sd / 2, 0, sw / 2);
  hinge.rotation.y = -0.55;
  add(hinge, safe);
  box(0.08, sh, sw, safeMat, -0.04, 0, -sw / 2, hinge);
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 32), brass);
  dial.rotation.z = Math.PI / 2;
  dial.position.set(-0.095, sh * 0.62, -sw / 2);
  add(dial, hinge);
  const handleS = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 8, 24, Math.PI), brass);
  handleS.rotation.y = Math.PI / 2;
  handleS.position.set(-0.09, sh * 0.38, -sw / 2);
  add(handleS, hinge);
  const safeInside = new THREE.Group();
  safeInside.position.set(0.02, 0.065, 0);
  add(safeInside, safe);
  interactive.set("safe", safe);
  shadow(1.0, 1.0, x1 - 0.32, 3.35, 0.8);

  // входная дверь на юге
  box(1.0, 2.25, 0.05, std({ color: "#1b1512", roughness: 0.6 }), 4.3, 0, z1 - 0.03);
  box(0.03, 0.03, 0.18, brass, 3.9, 1.05, z1 - 0.12);

  // мелкие пятна света от города на полу у окон
  void r;

  return {
    scene,
    floor,
    glassMeshes,
    interactive,
    anchors: { fridgeFront, tableTop, safeInside, monitorScreen: screen, calendar, clock } as Anchors,
    groups: { fridge, monitor, desk, fridgeTop },
    spots: { kitchen: { x0, kz0, kz1, fz0, fz1, fMid, soffitY, counterY: 0.91, ix0, ix1, iMid }, desk: { dx, dz }, console: { conMid, conZ0, conZ1 } },
    tag,
    lights: { candle, cityN, cityE, hemi, tableLamp, arcLight, pendant, screenLight, safeLight, flame },
    led: { primary: ledPrimary, secondary: ledSecondary, primaryLights, secondaryLights },
  };
}
export type Interior = ReturnType<typeof buildInterior>;
