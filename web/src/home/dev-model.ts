// Отладка моделей: /dev-model.html?f=__src/x.glb&yaw=40&pitch=25&only=regex&hide=regex&dist=1
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const q = new URLSearchParams(location.search);
const canvas = document.getElementById("c") as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas, antialias: true });
r.setSize(innerWidth, innerHeight, false);
r.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#2a2d33");
scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
const cam = new THREE.PerspectiveCamera(Number(q.get("fov") ?? 40), innerWidth / innerHeight, 0.01, 5000);
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
loader.load(q.get("f")!, (g) => {
  const root = g.scene;
  const only = q.get("only") ? new RegExp(q.get("only")!, "i") : null;
  const hide = q.get("hide") ? new RegExp(q.get("hide")!, "i") : null;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    let name = "";
    for (let p: THREE.Object3D | null = o; p; p = p.parent) name += "/" + p.name;
    if ((only && !only.test(name)) || (hide && hide.test(name))) o.visible = false;
  });
  scene.add(root);
  const names: string[] = [];
  if (q.get("sheet")) {
    // раскладываем предметы кита сеткой, чтобы рассмотреть
    const items = root.getObjectByName("kit")?.children ?? root.children[0]?.children ?? [];
    const list = [...(root.children.length === 1 ? root.children[0].children : root.children)].filter((o) => o.name.startsWith("item_"));
    const cols = Math.ceil(Math.sqrt(list.length));
    const cell = Number(q.get("cell") ?? 1.2);
    list.forEach((o, i) => {
      o.position.set((i % cols) * cell, 0, Math.floor(i / cols) * cell);
      names.push(`${i}:${o.name}`);
    });
    void items;
    root.updateMatrixWorld(true);
  }
  const box = new THREE.Box3();
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.visible) box.expandByObject(o);
  });
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3()).length();
  const yaw = THREE.MathUtils.degToRad(Number(q.get("yaw") ?? 35));
  const pitch = THREE.MathUtils.degToRad(Number(q.get("pitch") ?? 25));
  const d = s * Number(q.get("dist") ?? 1.1);
  cam.position.set(c.x + Math.sin(yaw) * Math.cos(pitch) * d, c.y + Math.sin(pitch) * d, c.z + Math.cos(yaw) * Math.cos(pitch) * d);
  cam.lookAt(c);
  r.render(scene, cam);
  (window as unknown as { __info: unknown }).__info = { min: box.min.toArray(), max: box.max.toArray(), names };
  (window as unknown as { __ready: boolean }).__ready = true;
});
