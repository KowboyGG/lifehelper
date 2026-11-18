// Процедурные текстуры и материалы интерьера (без внешних файлов)
import * as THREE from "three";
import { canvasTexture, makeNoise2, rng } from "./util";

const cache = new Map<string, THREE.Texture>();
const once = <T extends THREE.Texture>(key: string, make: () => T): T => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
};

/** Тёмный орех: доски 18 см, разная длина, лёгкий разброс тона */
export function woodTextures() {
  const color = once("wood", () =>
    canvasTexture(1024, 1024, (ctx, w, h) => {
      const r = rng(7);
      const noise = makeNoise2(3);
      const img = ctx.createImageData(w, h);
      const plankW = w / 22; // 4 м → 22 доски
      const rows: { len: number; tone: number; off: number }[][] = [];
      for (let c = 0; c < 22; c++) {
        const segs: { len: number; tone: number; off: number }[] = [];
        let y = -r.range(0, 300);
        while (y < h) {
          const len = r.range(250, 550);
          segs.push({ len: y, tone: r.range(-0.18, 0.18), off: r.range(0, 1000) });
          y += len;
        }
        rows.push(segs);
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const c = Math.floor(x / plankW);
          const segs = rows[c];
          let seg = segs[0];
          for (const s of segs) if (s.len <= y) seg = s;
          const lx = (x % plankW) / plankW;
          // волокна вдоль доски
          const grain = noise(x * 0.18 + seg.off, y * 0.008 + c * 7, 3);
          const fine = noise(x * 1.2 + seg.off, y * 0.04, 2);
          let v = 0.55 + 0.45 * grain + 0.18 * (fine - 0.5) + seg.tone;
          // шов между досками
          const edge = Math.min(lx, 1 - lx) * plankW;
          if (edge < 1.1) v *= 0.35;
          if (Math.abs(y - seg.len) < 1.1) v *= 0.4;
          const i = (y * w + x) * 4;
          img.data[i] = Math.max(0, Math.min(255, 58 * v));
          img.data[i + 1] = Math.max(0, Math.min(255, 38 * v));
          img.data[i + 2] = Math.max(0, Math.min(255, 26 * v));
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }),
  );
  const rough = once("woodRough", () =>
    canvasTexture(
      512,
      512,
      (ctx, w, h) => {
        const noise = makeNoise2(11);
        const img = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const v = 0.3 + 0.35 * noise(x * 0.03, y * 0.004, 3) + 0.12 * noise(x * 0.3, y * 0.3, 2);
            const i = (y * w + x) * 4;
            const g = Math.max(0, Math.min(255, v * 255));
            img.data[i] = g;
            img.data[i + 1] = g;
            img.data[i + 2] = g;
            img.data[i + 3] = 255;
          }
        ctx.putImageData(img, 0, 0);
      },
      false,
    ),
  );
  for (const t of [color, rough]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  return { color, rough };
}

/** Бетонный потолок с опалубкой (как на первых фото) */
export function concreteTexture(key: string, panels: boolean, base = 0.5) {
  return once(`concrete-${key}`, () =>
    canvasTexture(1024, 1024, (ctx, w, h) => {
      const noise = makeNoise2(key.length * 13 + 5);
      const r = rng(key.length * 31);
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let v = base + 0.22 * (noise(x * 0.008, y * 0.008, 5) - 0.5) + 0.07 * (noise(x * 0.15, y * 0.15, 2) - 0.5);
          const i = (y * w + x) * 4;
          const g = Math.max(0, Math.min(255, v * 255));
          img.data[i] = g * 0.98;
          img.data[i + 1] = g * 0.97;
          img.data[i + 2] = g;
          img.data[i + 3] = 255;
        }
      ctx.putImageData(img, 0, 0);
      if (panels) {
        // швы опалубки и отверстия от стяжек
        ctx.strokeStyle = "rgba(20,20,22,0.55)";
        ctx.lineWidth = 2;
        for (let i = 0; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(0, (i * h) / 2);
          ctx.lineTo(w, (i * h) / 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo((i * w) / 2, 0);
          ctx.lineTo((i * w) / 2, h);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(15,15,17,0.6)";
        for (let a = 0; a < 2; a++)
          for (let b = 0; b < 2; b++)
            for (const [px, py] of [
              [0.2, 0.25],
              [0.8, 0.25],
              [0.2, 0.75],
              [0.8, 0.75],
            ]) {
              ctx.beginPath();
              ctx.arc(((a + px) * w) / 2, ((b + py) * h) / 2, 4, 0, Math.PI * 2);
              ctx.fill();
            }
        // подтёки
        for (let k = 0; k < 18; k++) {
          ctx.fillStyle = `rgba(0,0,0,${r.range(0.02, 0.06)})`;
          ctx.beginPath();
          ctx.ellipse(r.range(0, w), r.range(0, h), r.range(30, 140), r.range(10, 60), r.range(0, 3), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }),
  );
}

/** Шумовая текстура для ткани / штукатурки */
export function fabricTexture(key: string, rgb: [number, number, number], scale = 1) {
  return once(`fabric-${key}`, () => {
    const t = canvasTexture(512, 512, (ctx, w, h) => {
      const noise = makeNoise2(key.length * 7 + 1);
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          // букле: мелкие узелки
          const v = 0.82 + 0.25 * (noise(x * 0.35 * scale, y * 0.35 * scale, 2) - 0.5) + 0.12 * (noise(x * 0.02, y * 0.02, 3) - 0.5);
          const i = (y * w + x) * 4;
          img.data[i] = Math.min(255, rgb[0] * v);
          img.data[i + 1] = Math.min(255, rgb[1] * v);
          img.data[i + 2] = Math.min(255, rgb[2] * v);
          img.data[i + 3] = 255;
        }
      ctx.putImageData(img, 0, 0);
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

/** Ковёр с волнистым рельефом (как на фото с диваном) */
export function rugTexture() {
  return once("rug", () =>
    canvasTexture(1024, 1024, (ctx, w, h) => {
      const noise = makeNoise2(99);
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const v = 0.86 + 0.14 * (noise(x * 0.5, y * 0.5, 2) - 0.5);
          const i = (y * w + x) * 4;
          img.data[i] = 168 * v;
          img.data[i + 1] = 160 * v;
          img.data[i + 2] = 150 * v;
          img.data[i + 3] = 255;
        }
      ctx.putImageData(img, 0, 0);
      ctx.strokeStyle = "rgba(60,55,50,0.45)";
      ctx.lineWidth = 5;
      for (let k = 0; k < 9; k++) {
        ctx.beginPath();
        ctx.arc(w * 0.15, h * 1.05, 120 + k * 70, Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(w * 0.95, h * -0.05, 100 + k * 64, Math.PI * 0.05, Math.PI * 0.95);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(60,55,50,0.5)";
      ctx.lineWidth = 10;
      ctx.strokeRect(24, 24, w - 48, h - 48);
    }),
  );
}

/** Каменная столешница: тёмный кварц с вкраплениями */
export function stoneTexture(key: string, dark: boolean) {
  return once(`stone-${key}`, () =>
    canvasTexture(1024, 1024, (ctx, w, h) => {
      const noise = makeNoise2(key.length * 3 + 77);
      const r = rng(key.length * 5);
      const img = ctx.createImageData(w, h);
      const base = dark ? 26 : 200;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const v = 1 + 0.25 * (noise(x * 0.006, y * 0.006, 5) - 0.5);
          const i = (y * w + x) * 4;
          img.data[i] = base * v;
          img.data[i + 1] = base * v;
          img.data[i + 2] = base * v * 1.04;
          img.data[i + 3] = 255;
        }
      ctx.putImageData(img, 0, 0);
      // прожилки
      ctx.strokeStyle = dark ? "rgba(150,150,160,0.18)" : "rgba(60,60,70,0.22)";
      for (let k = 0; k < 7; k++) {
        ctx.lineWidth = r.range(0.6, 2.2);
        ctx.beginPath();
        let x = r.range(0, w);
        let y = 0;
        ctx.moveTo(x, y);
        while (y < h) {
          x += r.range(-40, 40);
          y += r.range(20, 60);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }),
  );
}

export function std(params: THREE.MeshStandardMaterialParameters) {
  return new THREE.MeshStandardMaterial(params);
}
export function phys(params: THREE.MeshPhysicalMaterialParameters) {
  return new THREE.MeshPhysicalMaterial(params);
}

/** Светящийся материал (светодиоды, экраны): значения больше 1 = HDR, дают свечение */
export function glow(color: THREE.ColorRepresentation, intensity = 1) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });
}
