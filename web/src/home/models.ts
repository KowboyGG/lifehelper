// Модели со Sketchfab (CC-BY 4.0, авторы — в web/public/models/CREDITS.md).
// Грузятся после того, как сцена уже показана; если файла нет — остаются
// процедурные заглушки из interior.ts.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { Interior } from "./interior";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

export async function loadKit(name: string, base = "/models/"): Promise<THREE.Object3D | null> {
  try {
    const g = await loader.loadAsync(`${base}${name}.glb`);
    return g.scene;
  } catch (e) {
    console.warn(`[дом] модель ${name} не загрузилась`, e);
    return null;
  }
}

/** Достать предмет из кита и поставить: центр основания в pos, поворот вокруг Y */
function place(kit: THREE.Object3D, item: string, pos: [number, number, number], rotY = 0, scale = 1) {
  const src = kit.getObjectByName("item_" + item);
  if (!src) return null;
  const inner = src.clone(true);
  inner.position.set(0, 0, 0);
  const g = new THREE.Group();
  g.name = item;
  g.add(inner);
  g.position.set(...pos);
  g.rotation.y = rotY;
  g.scale.setScalar(scale);
  g.updateMatrixWorld(true);
  return g;
}

/** Подогнать материалы моделей под тёмную сцену: меньше «пластика», мягче отражения */
function tune(root: THREE.Object3D, opts: { env?: number; shadows?: boolean } = {}) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = !!opts.shadows;
    m.receiveShadow = true;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats as THREE.MeshStandardMaterial[]) {
      if ("envMapIntensity" in mat) mat.envMapIntensity = opts.env ?? 0.6;
    }
  });
}

const hideTag = (interior: Interior, tag: string) =>
  interior.scene.traverse((o) => {
    if (o.userData.proc === tag) o.visible = false;
  });

const worldBox = (o: THREE.Object3D, filter?: (m: THREE.Mesh) => boolean) => {
  const b = new THREE.Box3();
  o.updateMatrixWorld(true);
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh && (!filter || filter(m))) b.expandByObject(m);
  });
  return b;
};

export function furnishKitchen(interior: Interior, kit: THREE.Object3D) {
  const K = interior.spots.kitchen;
  const s = interior.scene;
  const top = K.counterY + 0.005;
  const cx = K.x0 + 0.33; // середина столешницы по глубине

  // холодильник: в нишу между столешницей и пеналом
  const slotW = K.fz1 - K.fz0;
  const fridgeScale = slotW / 1.18;
  const fridge = place(kit, "fridge", [0, 0, K.fMid], 0, fridgeScale);
  if (fridge) {
    const b = worldBox(fridge);
    fridge.position.x += K.x0 + 0.01 - b.min.x;
    tune(fridge, { env: 0.8 });
    interior.groups.fridge.add(fridge);
    hideTag(interior, "fridge");
    // магниты — на плоскость дверей: щупаем её лучами из комнаты, берём самую выступающую точку
    const front = interior.anchors.fridgeFront;
    const fb = worldBox(fridge);
    let fx = -Infinity;
    for (const dz of [-0.36, -0.28, -0.2, 0.2, 0.28, 0.36])
      for (const y of [1.0, 1.3, 1.6]) {
        const hit = new THREE.Raycaster(new THREE.Vector3(K.x0 + 3, y, K.fMid + dz * (slotW / 0.94)), new THREE.Vector3(-1, 0, 0)).intersectObject(fridge, true)[0];
        if (hit) fx = Math.max(fx, hit.point.x);
      }
    front.position.x = (Number.isFinite(fx) ? fx : fb.max.x - 0.05) + 0.006;
    // верхний шкаф — от холодильника до ниши
    const topCab = interior.groups.fridgeTop;
    const h = K.soffitY - fb.max.y;
    if (h > 0.05) {
      topCab.scale.y = h / (K.soffitY - 1.9);
      topCab.position.y = fb.max.y + h / 2;
    } else topCab.visible = false;
  }

  // мойка-чаша из мрамора на столешнице
  const sink = place(kit, "sink", [cx - 0.02, top, -1.1], Math.PI / 2, 0.72);
  if (sink) {
    tune(sink, { env: 0.7 });
    s.add(sink);
    hideTag(interior, "sink");
  }
  // рейлинг с утварью и специями на фартуке
  const rail = place(kit, "u1", [K.x0 + 0.13, top + 0.05, 0.45], Math.PI / 2, 0.85);
  if (rail) {
    tune(rail, { env: 0.8 });
    s.add(rail);
  }
  // кастрюля на варочной панели
  const pot = place(kit, "u6", [cx, top, 0.55], 0, 0.85);
  if (pot) {
    tune(pot);
    s.add(pot);
  }
  // банки у кофемашины
  const jars = place(kit, "jars", [K.x0 + 0.22, top, -0.4], Math.PI / 2, 1);
  if (jars) {
    tune(jars);
    s.add(jars);
  }
  // крупы — на столешнице у окна
  const grains = place(kit, "u2", [K.x0 + 0.2, top, -1.95], Math.PI, 0.6);
  if (grains) {
    tune(grains);
    grains.rotation.y = 0;
    s.add(grains);
  }

  // остров: вино, бокалы, чашки, бананы
  const iy = 0.93;
  const wine = place(kit, "wine", [K.iMid + 0.25, iy, 0.45], Math.PI / 2, 0.75);
  const glasses = place(kit, "glasses", [K.iMid + 0.05, iy, 0.75], Math.PI / 2 + 0.2, 0.75);
  const cups = place(kit, "cups", [K.iMid - 0.15, iy, -0.75], 0.4, 0.9);
  const bowl = place(kit, "bowl", [K.iMid + 0.1, iy, 0.05], 0.3, 1);
  for (const o of [wine, glasses, cups, bowl]) {
    if (!o) continue;
    tune(o, { env: 0.7 });
    s.add(o);
  }
  if (wine || glasses) hideTag(interior, "islandBottle");

  // барные стулья из дуба — к острову
  const stools = place(kit, "stools", [K.ix1 + 0.55, 0, 0], Math.PI / 2, 1);
  if (stools) {
    tune(stools);
    s.add(stools);
    hideTag(interior, "stools");
  }
}

export function furnishDesk(interior: Interior, kit: THREE.Object3D) {
  const { dx, dz } = interior.spots.desk;
  const set = place(kit, "deskset", [dx + 0.03, 0.7375 + 0.0175, dz], -Math.PI / 2, 1);
  if (set) {
    tune(set, { env: 0.7, shadows: false });
    interior.groups.monitor.add(set);
    hideTag(interior, "deskset");
    // наш экран с данными — поверх экрана iMac
    const disp = worldBox(set, (m) => /Display/i.test(m.name));
    if (!disp.isEmpty()) {
      const scr = interior.anchors.monitorScreen;
      const w = (disp.max.z - disp.min.z) * 0.93;
      const h = w * (9 / 16);
      scr.scale.set(w / 0.87, h / 0.37, 1);
      scr.position.set(disp.min.x - 0.0015, disp.max.y - (disp.max.z - disp.min.z) * 0.035 - h / 2, (disp.min.z + disp.max.z) / 2);
      interior.anchors.monitorAspect = 16 / 9;
    }
  }
  const chair = place(kit, "chair", [dx - 0.78, 0, dz + 0.05], -Math.PI / 2 + 0.25, 1);
  if (chair) {
    tune(chair, { env: 0.6 });
    interior.scene.add(chair);
    hideTag(interior, "chair");
  }
}

export function furnishNeon(interior: Interior, kit: THREE.Object3D) {
  const { conMid } = interior.spots.console;
  const neon = place(kit, "neon", [5.955, 1.25, conMid], -Math.PI / 2, 0.55);
  if (!neon) return null;
  const pink = new THREE.Color(1.0, 0.18, 0.62);
  neon.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = new THREE.MeshBasicMaterial({ color: pink.clone().multiplyScalar(2.2) });
  });
  interior.scene.add(neon);
  hideTag(interior, "art");
  const light = new THREE.PointLight(pink, 0.8, 3.5, 2);
  light.position.set(5.55, 1.6, conMid);
  interior.scene.add(light);
  const wash = new THREE.RectAreaLight(pink, 1.6, 1.0, 0.8);
  wash.position.set(5.9, 1.6, conMid);
  wash.lookAt(4, 1.6, conMid);
  interior.scene.add(wash);
  return { neon, light, wash };
}
