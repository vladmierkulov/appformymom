const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/telegram/webhook") return telegramWebhook(request, env);
    if (url.pathname.startsWith("/api/")) return api(request, env);
    return env.ASSETS.fetch(request);
  },
  async scheduled(_, env) { await sendDailyReminders(env); }
};

async function api(request, env) {
  const userId = await authenticate(request, env);
  if (!userId) return json({ error: "Откройте приложение из Telegram." }, 401);
  const url = new URL(request.url);
  if (url.pathname === "/api/bookings" && request.method === "GET") {
    const date = url.searchParams.get("date");
    const query = date
      ? env.DB.prepare("SELECT * FROM bookings WHERE owner_id=? AND date=? ORDER BY time").bind(userId, date)
      : env.DB.prepare("SELECT * FROM bookings WHERE owner_id=? ORDER BY date,time").bind(userId);
    return json((await query.all()).results);
  }
  if (url.pathname === "/api/bookings" && request.method === "POST") {
    const body = await request.json();
    if (!validBooking(body)) return json({ error: "Заполните дату, время и имя." }, 400);
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO bookings (id,owner_id,date,time,name,phone,price) VALUES (?,?,?,?,?,?,?)")
      .bind(id, userId, body.date, body.time, body.name.trim(), (body.phone || "").trim(), Number(body.price || 0)).run();
    return json({ id }, 201);
  }
  const match = url.pathname.match(/^\/api\/bookings\/([\w-]+)$/);
  if (match && request.method === "PUT") {
    const body = await request.json();
    if (!validBooking(body)) return json({ error: "Заполните дату, время и имя." }, 400);
    const result = await env.DB.prepare("UPDATE bookings SET date=?,time=?,name=?,phone=?,price=? WHERE id=? AND owner_id=?")
      .bind(body.date, body.time, body.name.trim(), (body.phone || "").trim(), Number(body.price || 0), match[1], userId).run();
    return result.meta.changes ? json({ ok: true }) : json({ error: "Не найдено" }, 404);
  }
  if (match && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM bookings WHERE id=? AND owner_id=?").bind(match[1], userId).run();
    return json({ ok: true });
  }
  if (url.pathname === "/api/settings" && request.method === "GET") {
    const row = await env.DB.prepare("SELECT reminders_enabled,reminder_template FROM users WHERE telegram_id=?").bind(userId).first();
    return json(row || { reminders_enabled: 1, reminder_template: defaultTemplate });
  }
  if (url.pathname === "/api/settings" && request.method === "PUT") {
    const body = await request.json();
    await env.DB.prepare("INSERT INTO users (telegram_id,reminders_enabled,reminder_template) VALUES (?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET reminders_enabled=excluded.reminders_enabled, reminder_template=excluded.reminder_template")
      .bind(userId, body.reminders_enabled ? 1 : 0, body.reminder_template || defaultTemplate).run();
    return json({ ok: true });
  }
  return json({ error: "Не найдено" }, 404);
}

async function authenticate(request, env) {
  const initData = request.headers.get("X-Telegram-Init-Data");
  if (!initData || !env.TELEGRAM_BOT_TOKEN || !(await isValidInitData(initData, env.TELEGRAM_BOT_TOKEN))) return null;
  const params = new URLSearchParams(initData);
  const user = JSON.parse(params.get("user") || "{}");
  if (!user.id) return null;
  await env.DB.prepare("INSERT INTO users (telegram_id) VALUES (?) ON CONFLICT(telegram_id) DO NOTHING").bind(String(user.id)).run();
  return String(user.id);
}

async function isValidInitData(initData, token) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  if (!hash || !authDate || Date.now() / 1000 - authDate > 86400) return false;
  params.delete("hash");
  const checkString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await crypto.subtle.importKey("raw", encoder.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const keyBytes = await crypto.subtle.sign("HMAC", secret, encoder.encode(token));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(checkString));
  return hex(signature) === hash;
}

async function telegramWebhook(request, env) {
  if (env.TELEGRAM_WEBHOOK_SECRET && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
  const update = await request.json();
  const message = update.message;
  if (message?.text === "/start") {
    const chatId = String(message.chat.id);
    await env.DB.prepare("INSERT INTO users (telegram_id,chat_id) VALUES (?,?) ON CONFLICT(telegram_id) DO UPDATE SET chat_id=excluded.chat_id").bind(chatId, chatId).run();
    await telegram(env, "sendMessage", { chat_id: chatId, text: "Откройте календарь записей:", reply_markup: { keyboard: [[{ text: "Открыть BookingApp", web_app: { url: env.APP_URL } }]], resize_keyboard: true } });
  }
  return new Response("ok");
}

async function sendDailyReminders(env) {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const users = (await env.DB.prepare("SELECT telegram_id,chat_id,reminder_template FROM users WHERE reminders_enabled=1 AND chat_id IS NOT NULL").all()).results;
  for (const user of users) {
    const bookings = (await env.DB.prepare("SELECT time,name,phone FROM bookings WHERE owner_id=? AND date=? ORDER BY time").bind(user.telegram_id, tomorrow).all()).results;
    if (!bookings.length) continue;
    const list = bookings.map(b => `• ${b.time} — ${b.name}${b.phone ? ` (${b.phone})` : ""}`).join("\n");
    await telegram(env, "sendMessage", { chat_id: user.chat_id, text: `Завтра (${tomorrow}) записей: ${bookings.length}\n${list}` });
  }
}

async function telegram(env, method, body) { return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
function validBooking(b) { return /^\d{4}-\d{2}-\d{2}$/.test(b?.date || "") && /^\d{2}:\d{2}$/.test(b?.time || "") && typeof b?.name === "string" && b.name.trim().length > 0; }
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } }); }
function hex(buffer) { return [...new Uint8Array(buffer)].map(x => x.toString(16).padStart(2, "0")).join(""); }
const defaultTemplate = "Здравствуйте, {name}! Напоминаем о вашей записи {date} в {time}.";
