// Отладочный стенд сцены без бэкенда: /dev-scene.html?zone=1&rain=1&t=12&led=neon
import { HomeEngine, type LedPalette } from "./engine";
import { FOCUS, ZONES } from "./camera";
import type { Interactive } from "./interior";

const q = new URLSearchParams(location.search);
const canvas = document.getElementById("c") as HTMLCanvasElement;
const eng = new HomeEngine(canvas, { quality: (q.get("q") as "high" | "low") ?? "high" });
eng.setRain(q.get("rain") === "1", true);
if (q.get("led")) eng.setLed(q.get("led") as LedPalette);
if (q.get("zone")) eng.shot(ZONES[Number(q.get("zone"))], true);
if (q.get("focus")) eng.shot(FOCUS[q.get("focus") as Interactive], true);
if (q.get("t")) eng.fixedTime = Number(q.get("t"));
(window as unknown as { __eng: HomeEngine }).__eng = eng;
if (q.get("static")) {
  for (let i = 0; i < 3; i++) eng.frame(0.016);
  (window as unknown as { __ready: boolean }).__ready = true;
} else {
  eng.start();
  let n = 0;
  let last = performance.now();
  eng.onFrame = () => {
    n++;
    const now = performance.now();
    if (now - last > 1000) {
      document.getElementById("fps")!.textContent = `${n} fps`;
      n = 0;
      last = now;
    }
  };
  (window as unknown as { __ready: boolean }).__ready = true;
}
