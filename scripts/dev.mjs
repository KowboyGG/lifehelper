// Локальная разработка: API (wrangler) на :8787 + сайт (vite) на :5173
import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";

if (!existsSync(".dev.vars")) {
  copyFileSync(".dev.vars.example", ".dev.vars");
  console.log("→ создал .dev.vars из примера (вход без Telegram включён)");
}
if (!existsSync("web/dist/index.html")) {
  mkdirSync("web/dist", { recursive: true });
  writeFileSync("web/dist/index.html", "<!doctype html><p>Открой http://localhost:5173</p>");
}
execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "lifehelper", "--local"], { stdio: "inherit" });

const run = (name, args) => {
  const p = spawn("npx", args, { stdio: ["ignore", "pipe", "pipe"] });
  const out = (d) => process.stdout.write(d.toString().replace(/^(?=.)/gm, `[${name}] `));
  p.stdout.on("data", out);
  p.stderr.on("data", out);
  return p;
};
const procs = [run("api", ["wrangler", "dev", "--port", "8787", "--test-scheduled"]), run("web", ["vite", "--config", "web/vite.config.ts"])];
console.log("\n  Сайт:  http://localhost:5173\n  API:   http://localhost:8787\n  Крон:  curl 'http://localhost:8787/__scheduled?cron=*+*+*+*+*'\n");
const stop = () => procs.forEach((p) => p.kill("SIGINT"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
