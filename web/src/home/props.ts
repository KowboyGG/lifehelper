// Данные на предметах: монитор, календарь, часы, магниты, пачки денег.
// Всё рисуется на холстах и обновляется, когда приходят новые данные.
import * as THREE from "three";
import type { Interior } from "./interior";
import { canvasTexture, redraw, rng, roundRect, wrapText } from "./util";

import { SYM, bundleValue, fmtNum, splitMoney, type HomeData, type HomeSticker } from "./data";
export type { HomeData } from "./data";

// ------------------------------------------------------------------ шрифты

const FONT_HAND = "'Caveat', 'Segoe Print', 'Comic Sans MS', cursive";
const FONT_UI = "'Manrope', 'Segoe UI', system-ui, sans-serif";
const FONT_SERIF = "'Playfair Display', Georgia, serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

export async function loadFonts() {
  if (!("fonts" in document)) return;
  try {
    await Promise.all(
      ["600 40px Caveat", "700 40px Caveat", "600 20px Manrope", "800 20px Manrope", "700 40px 'Playfair Display'", "700 20px 'JetBrains Mono'"].map((f) =>
        document.fonts.load(f).catch(() => undefined),
      ),
    );
  } catch {
    /* шрифты не критичны */
  }
}

// ------------------------------------------------------------------ текстуры купюр

const NOTE_COLORS: Record<string, [string, string]> = {
  UAH: ["#5d6f98", "#8ea2c8"],
  USD: ["#6b7a63", "#a3b398"],
  EUR: ["#7a6a8e", "#b6a6cc"],
};

function noteTexture(cur: string, denom: string, bundleLabel: string) {
  const [dark, light] = NOTE_COLORS[cur] ?? NOTE_COLORS.UAH;
  return canvasTexture(512, 240, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, light);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // гильош
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    for (let k = 0; k < 26; k++) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 6) {
        const y = h * 0.5 + Math.sin(x * 0.03 + k * 0.5) * (20 + k * 3) + Math.sin(x * 0.011 + k) * 12;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(20,20,30,0.35)";
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    // «портрет»
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.beginPath();
    ctx.ellipse(w * 0.27, h * 0.5, 52, 66, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(20,24,34,0.55)";
    ctx.font = `800 74px ${FONT_UI}`;
    ctx.textAlign = "right";
    ctx.fillText(denom, w - 34, 96);
    ctx.font = `800 40px ${FONT_UI}`;
    ctx.fillText(SYM[cur] ?? cur, w - 36, h - 40);
    // бандероль
    ctx.fillStyle = "#efe8d6";
    ctx.fillRect(w * 0.5 - 34, 0, 68, h);
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(w * 0.5 - 34, 0, 3, h);
    ctx.fillRect(w * 0.5 + 31, 0, 3, h);
    ctx.save();
    ctx.translate(w * 0.5, h * 0.5);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "#3a3226";
    ctx.textAlign = "center";
    ctx.font = `800 26px ${FONT_UI}`;
    ctx.fillText(bundleLabel, 0, 9);
    ctx.restore();
  });
}

let edgeTex: THREE.Texture | null = null;
function edgeTexture() {
  if (edgeTex) return edgeTex;
  edgeTex = canvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = "#d9d2bf";
    ctx.fillRect(0, 0, w, h);
    const r = rng(17);
    for (let y = 0; y < h; y += 2) {
      ctx.fillStyle = `rgba(${90 + r.int(0, 40)},${90 + r.int(0, 40)},${100 + r.int(0, 40)},${r.range(0.15, 0.45)})`;
      ctx.fillRect(0, y, w, 1);
    }
  });
  return edgeTex;
}

const BUNDLE = { w: 0.155, h: 0.013, d: 0.072 };
const bundleGeo = new THREE.BoxGeometry(BUNDLE.w, BUNDLE.h, BUNDLE.d);

function makeBundleMaterials(cur: string, value: number) {
  const denomOf = (v: number) => (v >= 10000 ? 1000 : v >= 1000 ? (cur === "UAH" ? 1000 : 100) : v >= 100 ? 100 : 10);
  const denom = denomOf(value);
  const face = new THREE.MeshStandardMaterial({ map: noteTexture(cur, String(denom), `${fmtNum(value)} ${SYM[cur] ?? cur}`), roughness: 0.8 });
  const edge = new THREE.MeshStandardMaterial({ map: edgeTexture(), roughness: 0.95 });
  // +x, -x, +y, -y, +z, -z
  return [edge, edge, face, face, edge, edge];
}

/** Стопки пачек в точках slots; count пачек раскладывается по стопкам */
function buildStacks(cur: string, value: number, count: number, slots: [number, number][], maxPer: number, seed: number) {
  const g = new THREE.Group();
  const mats = makeBundleMaterials(cur, value);
  const r = rng(seed);
  const per = slots.map(() => 0);
  for (let i = 0; i < count; i++) {
    // кладём в стопку, где пока меньше всего
    let best = 0;
    for (let k = 1; k < slots.length; k++) if (per[k] < per[best] - (r.chance(0.3) ? 1 : 0)) best = k;
    if (per[best] >= maxPer) break;
    per[best]++;
  }
  slots.forEach(([x, z], k) => {
    const baseRot = r.range(-0.25, 0.25);
    for (let i = 0; i < per[k]; i++) {
      const m = new THREE.Mesh(bundleGeo, mats);
      m.position.set(x + r.range(-0.004, 0.004), BUNDLE.h / 2 + i * BUNDLE.h, z + r.range(-0.003, 0.003));
      m.rotation.y = baseRot + r.range(-0.05, 0.05);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
  });
  return g;
}

// ------------------------------------------------------------------ магниты на холодильнике

const PAPER: Record<string, string> = {
  yellow: "#fde58a",
  pink: "#f9b9cc",
  green: "#b7ebc9",
  blue: "#b9d6fb",
  purple: "#d7c6fb",
  orange: "#fcc79b",
  white: "#fbfaf6",
};

function diffDays(a: string, b: string) {
  const u = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, dd);
  };
  return Math.round((u(b) - u(a)) / 86400000);
}
const plural = (n: number, a: string, b: string, c: string) => {
  const x = Math.abs(n) % 100;
  const y = x % 10;
  if (x > 10 && x < 20) return c;
  if (y > 1 && y < 5) return b;
  if (y === 1) return a;
  return c;
};

function stickerLines(s: HomeSticker, d: HomeData): { kind?: string; big?: string; text: string } {
  const today = d.today?.today ?? new Date().toISOString().slice(0, 10);
  switch (s.kind) {
    case "goal": {
      const g = d.goals?.find((x) => x.id === s.ref_id);
      if (!g) return { kind: "цель", text: "Цель завершена" };
      return { kind: "цель", big: g.progress !== null ? `${Math.round(g.progress * 100)}%` : "", text: `${g.emoji ?? ""} ${g.title}`.trim() };
    }
    case "wish": {
      const w = d.wishes?.find((x) => x.id === s.ref_id);
      if (!w) return { kind: "хочу", text: "Желание" };
      return {
        kind: "хочу",
        big: w.price ? `${fmtNum(w.price)} ${SYM[w.currency] ?? ""}` : "",
        text: `${w.title}${w.status === "bought" ? " ✓" : w.cooldown_left > 0 ? ` · ещё ${w.cooldown_left} дн.` : ""}`,
      };
    }
    case "countdown": {
      if (!s.date) return { kind: "отсчёт", text: s.text ?? "" };
      const n = diffDays(today, s.date);
      return { kind: "отсчёт", big: String(Math.abs(n)), text: `${plural(n, "день", "дня", "дней")} ${n >= 0 ? "до" : "назад"} · ${s.text ?? ""}` };
    }
    case "money":
      return { kind: "все деньги", big: d.money ? `${fmtNum(d.money.total)} ${SYM[d.money.currency] ?? ""}` : "…", text: "" };
    case "streak": {
      const n = d.today?.streak.current ?? 0;
      return { kind: "стрик", big: `${n}`, text: `${plural(n, "день", "дня", "дней")} подряд` };
    }
    default:
      return { text: s.text || "…" };
  }
}

function drawSticker(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, lines: { kind?: string; big?: string; text: string }) {
  const paper = PAPER[color] ?? PAPER.yellow;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);
  // лёгкая тень у загнутого низа
  const g = ctx.createLinearGradient(0, h * 0.7, 0, h);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#26221c";
  ctx.textAlign = "left";
  let y = 34;
  if (lines.kind) {
    ctx.font = `800 17px ${FONT_UI}`;
    ctx.fillStyle = "rgba(38,34,28,0.55)";
    ctx.fillText(lines.kind.toUpperCase(), 18, y);
    y += 14;
    ctx.fillStyle = "#26221c";
  }
  if (lines.big) {
    ctx.font = `700 64px ${FONT_HAND}`;
    ctx.fillText(lines.big, 16, y + 52);
    y += 66;
  }
  const size = lines.big ? 34 : lines.text.length > 60 ? 32 : 40;
  ctx.font = `600 ${size}px ${FONT_HAND}`;
  const rows = wrapText(ctx, lines.text, w - 32).slice(0, lines.big ? 3 : 6);
  for (const row of rows) {
    y += size * 0.95;
    ctx.fillText(row, 16, y);
  }
}

// ------------------------------------------------------------------ класс

export class Props {
  private interior: Interior;
  private monitorTex: THREE.CanvasTexture;
  private calendarTex: THREE.CanvasTexture;
  private clockTex: THREE.CanvasTexture;
  private stickerGroup = new THREE.Group();
  private tableMoney = new THREE.Group();
  private safeMoney = new THREE.Group();
  private data: HomeData = {};
  private lastMinute = -1;
  private ledColor = "#7fe0ff";

  constructor(interior: Interior) {
    this.interior = interior;
    const A = interior.anchors;
    this.monitorTex = canvasTexture(1280, 720, (ctx, w, h) => this.drawMonitor(ctx, w, h));
    (A.monitorScreen.material as THREE.MeshBasicMaterial).map = this.monitorTex;
    (A.monitorScreen.material as THREE.MeshBasicMaterial).color.setScalar(1.25);
    (A.monitorScreen.material as THREE.MeshBasicMaterial).needsUpdate = true;
    this.calendarTex = canvasTexture(512, 740, (ctx, w, h) => this.drawCalendar(ctx, w, h));
    const calMat = A.calendar.material as THREE.MeshStandardMaterial;
    calMat.map = this.calendarTex;
    calMat.color.set("#ffffff");
    calMat.needsUpdate = true;
    this.clockTex = canvasTexture(512, 160, (ctx, w, h) => this.drawClock(ctx, w, h));
    const clockMat = A.clock.material as THREE.MeshBasicMaterial;
    clockMat.map = this.clockTex;
    clockMat.color.setScalar(3.2);
    clockMat.blending = THREE.AdditiveBlending;
    clockMat.depthWrite = false;
    clockMat.needsUpdate = true;
    A.fridgeFront.add(this.stickerGroup);
    A.tableTop.add(this.tableMoney);
    A.safeInside.add(this.safeMoney);
    this.rebuildStickers();
  }

  setLedColor(hex: string) {
    this.ledColor = hex;
    redraw(this.clockTex, (c, w, h) => this.drawClock(c, w, h));
  }

  setData(d: HomeData) {
    this.data = { ...this.data, ...d };
    redraw(this.monitorTex, (c, w, h) => this.drawMonitor(c, w, h));
    redraw(this.calendarTex, (c, w, h) => this.drawCalendar(c, w, h));
    this.rebuildStickers();
    this.rebuildMoney();
  }

  /** Перерисовать всё после загрузки шрифтов */
  refresh() {
    this.setData({});
    redraw(this.clockTex, (c, w, h) => this.drawClock(c, w, h));
  }

  tick() {
    const now = new Date();
    const m = now.getHours() * 60 + now.getMinutes();
    if (m !== this.lastMinute) {
      this.lastMinute = m;
      redraw(this.clockTex, (c, w, h) => this.drawClock(c, w, h));
      redraw(this.monitorTex, (c, w, h) => this.drawMonitor(c, w, h));
    }
  }

  // ---------------------------------------------------------------- монитор

  private drawMonitor(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.data.today;
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#0d1117");
    bg.addColorStop(1, "#141b24");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const now = new Date();
    const mint = "#4fc491";
    // шапка
    ctx.fillStyle = mint;
    roundRect(ctx, 48, 40, 44, 44, 12);
    ctx.fill();
    ctx.fillStyle = "#0c261b";
    ctx.font = `800 26px ${FONT_SERIF}`;
    ctx.textAlign = "center";
    ctx.fillText("L", 70, 72);
    ctx.textAlign = "left";
    ctx.fillStyle = "#eef0f3";
    ctx.font = `700 30px ${FONT_SERIF}`;
    ctx.fillText("Сегодня", 108, 72);
    const dateStr = now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    ctx.fillStyle = "#8b93a1";
    ctx.font = `500 22px ${FONT_UI}`;
    ctx.fillText(dateStr, 250, 71);
    ctx.textAlign = "right";
    ctx.fillStyle = "#eef0f3";
    ctx.font = `700 30px ${FONT_MONO}`;
    ctx.fillText(now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }), w - 48, 72);
    ctx.textAlign = "left";

    if (!t) {
      ctx.fillStyle = "#8b93a1";
      ctx.font = `600 34px ${FONT_UI}`;
      ctx.fillText("Загрузка…", 48, 200);
      return;
    }
    // большой счёт
    ctx.fillStyle = "#eef0f3";
    ctx.font = `800 132px ${FONT_SERIF}`;
    ctx.fillText(String(t.done), 48, 250);
    const dw = ctx.measureText(String(t.done)).width;
    ctx.fillStyle = "#8b93a1";
    ctx.font = `700 54px ${FONT_SERIF}`;
    ctx.fillText(`из ${t.total}`, 60 + dw, 250);
    // прогресс
    const pw = 470;
    ctx.fillStyle = "#222a35";
    roundRect(ctx, 48, 286, pw, 14, 7);
    ctx.fill();
    ctx.fillStyle = t.pass.usedToday ? "#74a9ff" : mint;
    roundRect(ctx, 48, 286, Math.max(14, (pw * t.done) / Math.max(1, t.total)), 14, 7);
    ctx.fill();
    ctx.fillStyle = "#8b93a1";
    ctx.font = `600 22px ${FONT_UI}`;
    const left = t.habits.filter((x) => !x.done && !x.skipped).map((x) => x.title);
    ctx.fillText(t.pass.usedToday ? "Сегодня пропуск — стрик заморожен" : left.length ? `Осталось: ${left.join(", ")}`.slice(0, 44) : "Всё сделано. Красавчик.", 48, 340);

    // привычки
    let y = 400;
    for (const hb of t.habits.slice(0, 5)) {
      const done = hb.done;
      ctx.fillStyle = done ? "rgba(79,196,145,0.12)" : "#171d26";
      roundRect(ctx, 48, y - 34, 600, 56, 12);
      ctx.fill();
      ctx.fillStyle = done ? mint : "#3a4352";
      roundRect(ctx, 64, y - 20, 28, 28, 8);
      ctx.fill();
      if (done) {
        ctx.strokeStyle = "#0c261b";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(70, y - 6);
        ctx.lineTo(77, y + 1);
        ctx.lineTo(87, y - 12);
        ctx.stroke();
      }
      ctx.fillStyle = "#eef0f3";
      ctx.font = `700 24px ${FONT_UI}`;
      ctx.fillText(`${hb.emoji ?? ""} ${hb.title}`.trim().slice(0, 26), 108, y + 2);
      if (hb.type === "minutes" && hb.target_minutes) {
        const k = Math.min(1, hb.minutes / hb.target_minutes);
        ctx.fillStyle = "#222a35";
        roundRect(ctx, 430, y - 10, 130, 8, 4);
        ctx.fill();
        ctx.fillStyle = mint;
        roundRect(ctx, 430, y - 10, Math.max(8, 130 * k), 8, 4);
        ctx.fill();
        ctx.fillStyle = "#8b93a1";
        ctx.font = `600 18px ${FONT_MONO}`;
        ctx.fillText(`${Math.round(hb.minutes)}/${hb.target_minutes}`, 572, y);
      } else if (hb.streak) {
        ctx.fillStyle = "#f0b75e";
        ctx.font = `700 20px ${FONT_UI}`;
        ctx.fillText(`🔥 ${hb.streak}`, 572, y);
      }
      y += 66;
    }

    // правая колонка
    const cx = 730;
    const card = (yy: number, label: string, value: string, color: string) => {
      ctx.fillStyle = "#171d26";
      roundRect(ctx, cx, yy, 500, 110, 18);
      ctx.fill();
      ctx.fillStyle = "#8b93a1";
      ctx.font = `800 17px ${FONT_UI}`;
      ctx.fillText(label.toUpperCase(), cx + 26, yy + 38);
      ctx.fillStyle = color;
      ctx.font = `800 44px ${FONT_UI}`;
      ctx.fillText(value, cx + 26, yy + 88);
    };
    card(130, "Стрик", `🔥 ${t.streak.current} ${plural(t.streak.current, "день", "дня", "дней")}`, "#eef0f3");
    card(258, "Фокус сегодня", fmtMinutes(t.focus.seconds / 60), mint);
    const yt = t.distractions.reduce((a, x) => a + x.seconds, 0);
    card(386, "Отвлечения (YouTube и др.)", fmtMinutes(yt / 60), yt > 1800 ? "#f07a7a" : "#eef0f3");
    card(514, "Все деньги", `${fmtNum(t.money.total)} ${SYM[t.money.currency] ?? ""}`, "#eef0f3");
  }

  // ---------------------------------------------------------------- календарь

  private drawCalendar(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = "#ece6da";
    ctx.fillRect(0, 0, w, h);
    const r = rng(5);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(0,0,0,${r.range(0.01, 0.04)})`;
      ctx.fillRect(r.range(0, w), r.range(0, h), 2, 2);
    }
    // пружина
    ctx.fillStyle = "#1b1b1d";
    ctx.fillRect(0, 0, w, 22);
    for (let x = 30; x < w - 20; x += 26) {
      ctx.strokeStyle = "#8a8a90";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(x, 22, 5, 14, 0, Math.PI, Math.PI * 2.0);
      ctx.stroke();
    }
    const cal = this.data.calendar;
    const now = new Date();
    const month = cal?.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const today = cal?.today ?? now.toISOString().slice(0, 10);
    const [Y, M] = month.split("-").map(Number);
    const names = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
    // фото-шапка: ночной город
    const g = ctx.createLinearGradient(0, 40, 0, 250);
    g.addColorStop(0, "#151a2a");
    g.addColorStop(1, "#3a2638");
    ctx.fillStyle = g;
    ctx.fillRect(24, 40, w - 48, 210);
    const rr = rng(Y * 13 + M);
    for (let i = 0; i < 16; i++) {
      const bw = rr.range(18, 44);
      const bh = rr.range(50, 170);
      const bx = 24 + rr.range(0, w - 48 - bw);
      ctx.fillStyle = "#0b0d14";
      ctx.fillRect(bx, 250 - bh, bw, bh);
      for (let k = 0; k < bh / 9; k++)
        for (let j = 0; j < bw / 8; j++)
          if (rr.chance(0.28)) {
            ctx.fillStyle = rr.chance(0.8) ? "#f5b46a" : "#9cc4ff";
            ctx.fillRect(bx + 3 + j * 8, 250 - bh + 4 + k * 9, 3, 4);
          }
    }
    ctx.fillStyle = "#1b1b1d";
    ctx.font = `700 64px ${FONT_SERIF}`;
    ctx.textAlign = "left";
    ctx.fillText(names[M - 1], 28, 326);
    ctx.font = `600 28px ${FONT_UI}`;
    ctx.fillStyle = "#6b6f78";
    ctx.textAlign = "right";
    ctx.fillText(String(Y), w - 28, 324);
    // сетка
    const wd = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    const cw = (w - 40) / 7;
    ctx.textAlign = "center";
    ctx.font = `800 17px ${FONT_UI}`;
    wd.forEach((d, i) => {
      ctx.fillStyle = i >= 5 ? "#b0453c" : "#6b6f78";
      ctx.fillText(d.toUpperCase(), 20 + cw * (i + 0.5), 370);
    });
    const first = new Date(Date.UTC(Y, M - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7;
    const daysIn = new Date(Date.UTC(Y, M, 0)).getUTCDate();
    const rowH = 58;
    for (let d = 1; d <= daysIn; d++) {
      const idx = offset + d - 1;
      const cx = 20 + cw * ((idx % 7) + 0.5);
      const cy = 410 + rowH * Math.floor(idx / 7);
      const iso = `${month}-${String(d).padStart(2, "0")}`;
      const info = cal?.days[iso];
      const past = iso < today;
      // отметки маркером
      if (info && past && info.total > 0) {
        if (info.pass) {
          ctx.fillStyle = "rgba(80,130,230,0.45)";
          ctx.beginPath();
          ctx.arc(cx, cy - 8, 20, 0, Math.PI * 2);
          ctx.fill();
        } else if (info.done >= info.total) {
          ctx.fillStyle = "rgba(60,190,120,0.55)";
          ctx.beginPath();
          ctx.ellipse(cx, cy - 8, 23, 19, -0.2, 0, Math.PI * 2);
          ctx.fill();
        } else if (info.done > 0) {
          ctx.fillStyle = "rgba(240,180,60,0.55)";
          ctx.beginPath();
          ctx.ellipse(cx, cy - 8, 22, 18, 0.3, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = "rgba(200,50,40,0.75)";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(cx - 15, cy - 22);
          ctx.lineTo(cx + 15, cy + 6);
          ctx.moveTo(cx + 15, cy - 22);
          ctx.lineTo(cx - 15, cy + 6);
          ctx.stroke();
        }
      }
      ctx.fillStyle = (idx % 7) >= 5 ? "#9a3a32" : "#1b1b1d";
      ctx.font = `700 26px ${FONT_UI}`;
      ctx.fillText(String(d), cx, cy);
      if (iso === today) {
        // сегодня — обведено красным маркером
        ctx.strokeStyle = "rgba(210,40,40,0.9)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        for (let a = 0; a <= Math.PI * 2.15; a += 0.15) {
          const rad = 26 + Math.sin(a * 3) * 2;
          const px = cx + Math.cos(a) * rad;
          const py = cy - 9 + Math.sin(a) * (rad - 4);
          if (a === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
    const streak = this.data.today?.streak.current;
    if (streak !== undefined) {
      ctx.textAlign = "left";
      ctx.fillStyle = "#2a2a30";
      ctx.font = `700 34px ${FONT_HAND}`;
      ctx.fillText(`стрик: ${streak} ${plural(streak, "день", "дня", "дней")}!`, 28, h - 22);
    }
  }

  // ---------------------------------------------------------------- часы

  private drawClock(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 118px ${FONT_MONO}`;
    ctx.shadowColor = this.ledColor;
    ctx.shadowBlur = 18;
    ctx.fillStyle = this.ledColor;
    ctx.fillText(`${hh}:${mm}`, w / 2, h / 2 + 6);
    ctx.shadowBlur = 0;
  }

  // ---------------------------------------------------------------- магниты

  private rebuildStickers() {
    const g = this.stickerGroup;
    g.children.slice().forEach((c) => {
      g.remove(c);
      const m = c as THREE.Mesh;
      if (m.isMesh) {
        ((m.material as THREE.MeshStandardMaterial).map as THREE.Texture | null)?.dispose();
        (m.material as THREE.Material).dispose();
      }
      c.traverse((x) => {
        const mm = x as THREE.Mesh;
        if (mm.isMesh && mm !== m) (mm.material as THREE.Material).dispose();
      });
    });
    const all = this.data.stickers ?? [];
    // сначала закреплённые, потом остальные
    const list = [...all].sort((a, b) => b.pinned - a.pinned).slice(0, 10);
    const items =
      list.length > 0
        ? list.map((s) => ({ color: s.color, lines: stickerLines(s, this.data), id: s.id }))
        : this.data.stickers
          ? [{ color: "yellow", lines: { text: "Добавь заметку на «Стене» — она появится тут" }, id: 0 }]
          : [];
    // места на двух дверцах (локальные координаты фасада: x — вдоль, y — вверх)
    const spots: [number, number][] = [
      [-0.3, 0.33],
      [0.3, 0.32],
      [-0.27, 0.14],
      [0.26, 0.12],
      [-0.31, -0.06],
      [0.31, -0.07],
      [-0.25, -0.25],
      [0.27, -0.26],
      [-0.33, 0.48],
      [0.33, 0.47],
    ];
    const r = rng(7 + list.length);
    const magnetColors = ["#d64545", "#2c2c30", "#3e7ad6", "#e6b030", "#f2f2f2"];
    items.forEach((it, i) => {
      const [x, y] = spots[i % spots.length];
      const size = it.lines.big ? 0.15 : 0.135;
      const tex = canvasTexture(256, 256, (ctx, w, h) => drawSticker(ctx, w, h, it.color, it.lines));
      // бумага чуть «светится», чтобы читалась в полумраке кухни
      const paper = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, envMapIntensity: 0.2, emissiveMap: tex, emissive: new THREE.Color(0.32, 0.3, 0.3) }),
      );
      paper.position.set(x + r.range(-0.02, 0.02), y + r.range(-0.015, 0.015), 0.001 + i * 0.0006);
      paper.rotation.z = r.range(-0.14, 0.14);
      const magnet = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.008, 18),
        new THREE.MeshStandardMaterial({ color: magnetColors[i % magnetColors.length], roughness: 0.35 }),
      );
      magnet.rotation.x = Math.PI / 2;
      magnet.position.set(0, size / 2 - 0.018, 0.005);
      paper.add(magnet);
      g.add(paper);
    });
  }

  // ---------------------------------------------------------------- деньги

  private rebuildMoney() {
    for (const grp of [this.tableMoney, this.safeMoney]) {
      grp.children.slice().forEach((c) => grp.remove(c));
    }
    const m = this.data.money;
    if (!m) return;
    const { table, safeAcc } = splitMoney(m);
    // стол: стопки на половине, обращённой к дивану
    if (table > 0) {
      const slots: [number, number][] = [];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) slots.push([-0.17 + i * 0.17, 0.08 + j * 0.088]);
      const maxPer = 7;
      const value = bundleValue(table, slots.length * maxPer);
      const count = Math.max(1, Math.round(table / value));
      this.tableMoney.add(buildStacks(m.currency || "UAH", value, count, slots, maxPer, 11));
    }
    // сейф: накопления в валюте счёта, две полки
    let shelf = 0;
    for (const a of safeAcc) {
      if (a.balance <= 0 || shelf > 1) continue;
      const slots: [number, number][] = [
        [-0.08, -0.1],
        [-0.08, 0.1],
        [0.1, -0.1],
        [0.1, 0.1],
      ];
      const maxPer = 18;
      const value = bundleValue(a.balance, slots.length * maxPer);
      const count = Math.max(1, Math.round(a.balance / value));
      const st = buildStacks(a.currency, value, count, slots, maxPer, 31 + shelf);
      st.position.y = shelf === 0 ? 0.0 : 0.33;
      this.safeMoney.add(st);
      shelf++;
    }
  }
}

function fmtMinutes(min: number) {
  const m = Math.round(min);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} ч ${r} мин` : `${h} ч`;
}
