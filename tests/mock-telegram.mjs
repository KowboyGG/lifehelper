// Фейковый Telegram Bot API для локальных тестов: пишет все вызовы в память
import http from "node:http";

export function startMockTelegram(port = 8799) {
  const calls = [];
  let nextId = 100;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const method = req.url.split("/").pop();
      const payload = body ? JSON.parse(body) : {};
      calls.push({ method, payload });
      let result = true;
      if (method === "getMe") result = { id: 1, is_bot: true, username: "test_lifehelper_bot" };
      if (method === "sendMessage") result = { message_id: nextId++, chat: { id: payload.chat_id }, text: payload.text };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ calls, close: () => server.close() })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = await startMockTelegram();
  setInterval(() => {
    while (m.calls.length) console.log(JSON.stringify(m.calls.shift()));
  }, 200);
  console.log("mock telegram on :8799");
}
