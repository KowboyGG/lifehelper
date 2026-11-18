// Растения у окна. В темноте читаются как силуэты на фоне города —
// поэтому важнее форма листа, чем текстура.
import * as THREE from "three";
import { rng } from "./util";

const leafMat = () =>
  new THREE.MeshStandardMaterial({ color: new THREE.Color("#16261a"), roughness: 0.85, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.15 });

function pot(r: number, h: number, color: THREE.ColorRepresentation, rough = 0.85) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.78, h, 32), new THREE.MeshStandardMaterial({ color, roughness: rough }));
  body.position.y = h / 2;
  g.add(body);
  const soil = new THREE.Mesh(new THREE.CircleGeometry(r * 0.94, 24), new THREE.MeshStandardMaterial({ color: "#14100c", roughness: 1 }));
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = h - 0.03;
  g.add(soil);
  return g;
}

/** Лист монстеры с прорезями */
function monsteraLeafGeometry() {
  const s = new THREE.Shape();
  const N = 64;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    // сердцевидная форма
    const x = 0.5 * Math.sin(t) * (1 - 0.08 * Math.cos(2 * t));
    const y = 0.55 * Math.cos(t) * 0.9 - 0.12 * Math.cos(2 * t) + 0.5;
    pts.push(new THREE.Vector2(x, y));
  }
  s.setFromPoints(pts);
  // прорези — узкие треугольники от края к центру
  const holes: THREE.Path[] = [];
  const cuts = [0.3, 0.55, 0.78, 1.0, 1.25];
  for (const side of [-1, 1]) {
    for (const k of cuts) {
      const a = side * k;
      const p = new THREE.Path();
      const cx = Math.sin(a) * 0.3;
      const cy = 0.5 + Math.cos(a) * 0.32;
      const ex = Math.sin(a) * 0.12;
      const ey = 0.5 + Math.cos(a) * 0.12;
      const nx = Math.cos(a) * 0.025;
      const ny = -Math.sin(a) * 0.025;
      p.moveTo(ex, ey);
      p.lineTo(cx + nx, cy + ny);
      p.lineTo(cx - nx, cy - ny);
      p.closePath();
      holes.push(p);
    }
  }
  s.holes = holes;
  const g = new THREE.ShapeGeometry(s, 6);
  // лёгкий изгиб листа
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, -Math.abs(x) * 0.25 - (y - 0.5) * (y - 0.5) * 0.3);
  }
  g.computeVertexNormals();
  return g;
}

export function monstera(seed: number) {
  const r = rng(seed);
  const g = new THREE.Group();
  g.add(pot(0.26, 0.42, "#1a1a1c", 0.7));
  const leafGeo = monsteraLeafGeometry();
  const mat = leafMat();
  const stemMat = new THREE.MeshStandardMaterial({ color: "#26381f", roughness: 0.7 });
  for (let i = 0; i < 11; i++) {
    const ang = (i / 11) * Math.PI * 2 + r.range(-0.3, 0.3);
    const lean = r.range(0.35, 0.95);
    const len = r.range(0.7, 1.35);
    const tip = new THREE.Vector3(Math.cos(ang) * Math.sin(lean) * len, 0.4 + Math.cos(lean) * len, Math.sin(ang) * Math.sin(lean) * len);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.4, 0), new THREE.Vector3(tip.x * 0.3, tip.y * 0.85, tip.z * 0.3), tip);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.009, 5), stemMat));
    const leaf = new THREE.Mesh(leafGeo, mat);
    const size = r.range(0.42, 0.7);
    leaf.scale.setScalar(size);
    leaf.position.copy(tip);
    // лист смотрит наружу и немного вниз
    leaf.lookAt(tip.clone().add(new THREE.Vector3(Math.cos(ang), r.range(0.4, 1.2), Math.sin(ang))));
    leaf.rotateX(-Math.PI / 2 + r.range(0.2, 0.7));
    leaf.rotateZ(r.range(-0.4, 0.4));
    g.add(leaf);
  }
  return g;
}

/** Оливковое дерево: тонкий ствол и облако узких листьев */
export function oliveTree(seed: number) {
  const r = rng(seed);
  const g = new THREE.Group();
  g.add(pot(0.32, 0.5, "#c8bfae", 0.95));
  const bark = new THREE.MeshStandardMaterial({ color: "#2a241e", roughness: 0.9 });
  const branches: THREE.Vector3[] = [];
  const trunk = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.45, 0),
    new THREE.Vector3(0.05, 1.0, 0.02),
    new THREE.Vector3(-0.04, 1.5, -0.03),
    new THREE.Vector3(0.02, 1.85, 0.0),
  ]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(trunk, 16, 0.035, 6), bark));
  for (let i = 0; i < 9; i++) {
    const start = trunk.getPoint(r.range(0.45, 0.95));
    const a = r.range(0, Math.PI * 2);
    const end = start.clone().add(new THREE.Vector3(Math.cos(a) * r.range(0.25, 0.5), r.range(0.1, 0.45), Math.sin(a) * r.range(0.25, 0.5)));
    const c = new THREE.QuadraticBezierCurve3(start, start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.08, 0)), end);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 6, 0.012, 4), bark));
    for (let k = 0; k < 4; k++) branches.push(c.getPoint(r.range(0.3, 1)));
  }
  const leaf = new THREE.PlaneGeometry(0.025, 0.11);
  leaf.translate(0, 0.055, 0);
  const COUNT = 520;
  const inst = new THREE.InstancedMesh(leaf, new THREE.MeshStandardMaterial({ color: "#223022", roughness: 0.85, side: THREE.DoubleSide, envMapIntensity: 0.15 }), COUNT);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let i = 0; i < COUNT; i++) {
    const b = branches[i % branches.length];
    const p = b.clone().add(new THREE.Vector3(r.range(-0.18, 0.18), r.range(-0.12, 0.16), r.range(-0.18, 0.18)));
    e.set(r.range(-1.2, 1.2), r.range(0, Math.PI * 2), r.range(-1.2, 1.2));
    q.setFromEuler(e);
    m.compose(p, q, new THREE.Vector3(1, r.range(0.7, 1.2), 1));
    inst.setMatrixAt(i, m);
  }
  g.add(inst);
  return g;
}

/** Сансевиерия: вертикальные мечи */
export function snakePlant(seed: number) {
  const r = rng(seed);
  const g = new THREE.Group();
  g.add(pot(0.17, 0.34, "#5a4436", 0.7));
  const mat = new THREE.MeshStandardMaterial({ color: "#1d3020", roughness: 0.75, side: THREE.DoubleSide, envMapIntensity: 0.2 });
  for (let i = 0; i < 9; i++) {
    const h = r.range(0.45, 0.9);
    const s = new THREE.Shape();
    s.moveTo(-0.035, 0);
    s.quadraticCurveTo(-0.05, h * 0.6, 0, h);
    s.quadraticCurveTo(0.05, h * 0.6, 0.035, 0);
    const geo = new THREE.ShapeGeometry(s, 8);
    const leaf = new THREE.Mesh(geo, mat);
    leaf.position.set(r.range(-0.07, 0.07), 0.32, r.range(-0.07, 0.07));
    leaf.rotation.set(r.range(-0.15, 0.15), r.range(0, Math.PI), r.range(-0.15, 0.15));
    g.add(leaf);
  }
  return g;
}

/** Фикус лировидный: ствол и крупные овальные листья */
export function fiddleFig(seed: number) {
  const r = rng(seed);
  const g = new THREE.Group();
  g.add(pot(0.24, 0.46, "#141416", 0.5));
  const bark = new THREE.MeshStandardMaterial({ color: "#3a3127", roughness: 0.9 });
  const trunk = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.42, 0), new THREE.Vector3(0.03, 1.1, 0.02), new THREE.Vector3(-0.02, 1.75, 0)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(trunk, 12, 0.025, 6), bark));
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.16, 0.05, 0.2, 0.32, 0.1, 0.4);
  s.bezierCurveTo(0.04, 0.44, -0.04, 0.44, -0.1, 0.4);
  s.bezierCurveTo(-0.2, 0.32, -0.16, 0.05, 0, 0);
  const geo = new THREE.ShapeGeometry(s, 10);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, -Math.abs(pos.getX(i)) * 0.35);
  geo.computeVertexNormals();
  const mat = leafMat();
  for (let i = 0; i < 26; i++) {
    const t = r.range(0.35, 1);
    const p = trunk.getPoint(t);
    const a = r.range(0, Math.PI * 2);
    const leaf = new THREE.Mesh(geo, mat);
    leaf.position.copy(p);
    leaf.rotation.set(r.range(-0.9, -0.2), a, r.range(-0.3, 0.3), "YXZ");
    leaf.scale.setScalar(r.range(0.8, 1.15));
    g.add(leaf);
  }
  return g;
}

/** Маленький суккулент на стол */
export function smallPlant(seed: number) {
  const r = rng(seed);
  const g = new THREE.Group();
  g.add(pot(0.055, 0.08, "#d8d0c4", 0.6));
  const mat = new THREE.MeshStandardMaterial({ color: "#3d5a3a", roughness: 0.5 });
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), mat);
    leaf.scale.set(1, 2.2, 0.6);
    const a = (i / 9) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.022, 0.1, Math.sin(a) * 0.022);
    leaf.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
    leaf.rotation.y = r.range(0, 1);
    g.add(leaf);
  }
  return g;
}
