// Камера: точки обзора по зонам (листаются), свободный взгляд мышью/пальцем,
// ходьба WASD/колесом, плавный перелёт к предмету и лёгкая «ручная» качка.
import * as THREE from "three";
import { ROOM, type Interactive } from "./interior";
import { clamp, damp } from "./util";

export interface Shot {
  pos: [number, number, number];
  look: [number, number, number];
  fov?: number;
}
export interface Zone extends Shot {
  id: string;
  label: string;
}

export const ZONES: Zone[] = [
  { id: "kitchen", label: "Кухня", pos: [-3.85, 1.6, 3.7], look: [-4.35, 1.12, -2.5] },
  { id: "living", label: "Гостиная", pos: [-2.75, 1.58, 3.7], look: [1.4, 0.95, -3.6] },
  { id: "window", label: "Окно", pos: [2.7, 1.62, -2.35], look: [8.0, 1.3, -9.6] },
  { id: "desk", label: "Рабочее место", pos: [2.9, 1.5, 1.25], look: [5.6, 0.95, -1.1] },
  { id: "safe", label: "Сейф", pos: [2.55, 1.4, 2.0], look: [5.75, 0.45, 3.3] },
];

export const FOCUS: Record<Interactive, Shot> = {
  fridge: { pos: [-3.7, 1.38, 1.85], look: [-5.3, 1.28, 1.85], fov: 52 },
  money: { pos: [-0.05, 1.22, -0.3], look: [-0.05, 0.4, -1.32], fov: 50 },
  safe: { pos: [4.25, 1.05, 2.7], look: [5.7, 0.38, 3.35], fov: 50 },
  monitor: { pos: [4.35, 1.3, -0.95], look: [5.56, 1.18, -0.95], fov: 50 },
  calendar: { pos: [2.05, 1.5, -0.95], look: [2.86, 1.45, -0.95], fov: 50 },
  window: { pos: [0.4, 1.6, -3.0], look: [1.6, 1.25, -12], fov: 55 },
};

const EYE = 1.58;

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  pos = new THREE.Vector3(...ZONES[1].pos);
  yaw = 0;
  pitch = 0;
  fov = 55;
  tPos = this.pos.clone();
  tYaw = 0;
  tPitch = 0;
  tFov = 55;
  /** «Свободный режим»: пользователь ходит сам — зона снимается */
  free = false;
  private keys = new Set<string>();
  private t = 0;
  private wheelV = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.setShot(ZONES[1], true);
  }

  static anglesFor(pos: THREE.Vector3, look: THREE.Vector3) {
    const d = look.clone().sub(pos).normalize();
    return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(clamp(d.y, -1, 1)) };
  }

  setShot(shot: Shot, instant = false) {
    this.tPos.set(...shot.pos);
    const { yaw, pitch } = CameraRig.anglesFor(this.tPos, new THREE.Vector3(...shot.look));
    // кратчайший поворот
    let dy = yaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.tYaw = this.yaw + dy;
    this.tPitch = pitch;
    this.tFov = shot.fov ?? 55;
    if (instant) {
      this.pos.copy(this.tPos);
      this.yaw = this.tYaw = yaw;
      this.pitch = pitch;
      this.fov = this.tFov;
    }
  }

  look(dx: number, dy: number) {
    const k = this.fov / 55;
    this.tYaw -= dx * 0.0042 * k;
    this.tPitch = clamp(this.tPitch - dy * 0.0035 * k, -1.2, 1.0);
  }

  walk(amount: number) {
    this.wheelV += amount;
    this.free = true;
  }

  keyDown(code: string) {
    this.keys.add(code);
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown"].includes(code)) this.free = true;
  }
  keyUp(code: string) {
    this.keys.delete(code);
  }
  clearKeys() {
    this.keys.clear();
  }

  update(dt: number) {
    this.t += dt;
    // ходьба
    const fwd = new THREE.Vector3(-Math.sin(this.tYaw), 0, -Math.cos(this.tYaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = new THREE.Vector3();
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) move.add(fwd);
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) move.sub(fwd);
    if (this.keys.has("KeyD")) move.add(right);
    if (this.keys.has("KeyA")) move.sub(right);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(1.6 * dt);
      this.tPos.add(move);
      this.tPos.y = damp(this.tPos.y, EYE, 4, dt);
      this.tFov = damp(this.tFov, 55, 3, dt);
    }
    if (Math.abs(this.wheelV) > 0.001) {
      const step = this.wheelV * Math.min(1, dt * 8);
      this.tPos.addScaledVector(fwd, step);
      this.wheelV -= step;
      this.tPos.y = damp(this.tPos.y, EYE, 3, dt);
    }
    this.tPos.x = clamp(this.tPos.x, ROOM.x0 + 0.35, ROOM.x1 - 0.35);
    this.tPos.z = clamp(this.tPos.z, ROOM.z0 + 0.35, ROOM.z1 - 0.3);

    const k = 3.2;
    this.pos.x = damp(this.pos.x, this.tPos.x, k, dt);
    this.pos.y = damp(this.pos.y, this.tPos.y, k, dt);
    this.pos.z = damp(this.pos.z, this.tPos.z, k, dt);
    this.yaw = damp(this.yaw, this.tYaw, k * 1.3, dt);
    this.pitch = damp(this.pitch, this.tPitch, k * 1.3, dt);
    this.fov = damp(this.fov, this.tFov, k, dt);

    // лёгкая «ручная» качка, как на видео с телефона
    const t = this.t;
    const swayYaw = 0.0045 * Math.sin(t * 0.43) + 0.002 * Math.sin(t * 1.13 + 1.3);
    const swayPitch = 0.003 * Math.sin(t * 0.37 + 0.5) + 0.0015 * Math.sin(t * 1.41);
    const bob = 0.004 * Math.sin(t * 0.8);

    this.camera.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    this.camera.rotation.set(this.pitch + swayPitch, this.yaw + swayYaw, 0.0015 * Math.sin(t * 0.29), "YXZ");
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
