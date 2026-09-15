const encoder = new TextEncoder();
const defaultTemplate = "Здравствуйте, {name}! Напоминаем о вашей записи {date} в {time}.";
const MAX_INIT_DATA_BYTES = 16384;
const MAX_API_BODY_BYTES = 16384;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/telegram/webhook") return await telegramWebhook(request, env);
      if (url.pathname.startsWith("/api/")) return await api(request, env);
      return await env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof RequestError) return json({ error: error.message }, error.status);
      // Never expose database details, tokens or customer data in responses/logs.
      return json({ error: "Не удалось выполнить запрос. Попробуйте ещё раз." }, 500);
    }
  },
  async scheduled(_, env) { await sendDailyReminders(env); }
};

async function api(request, env) {
  const userId = await authenticate(request, env);
  if (!userId) return json({ error: "Откройте приложение из Telegram заново." }, 401);
  const url = new URL(request.url);
  if (url.pathname === "/api/bookings" && request.method === "GET") {
    const date = url.searchParams.get("date");
    if (date !== null && !validDate(date)) return json({ error: "Некорректная дата." }, 400);
    const query = date
      ? env.DB.prepare("SELECT * FROM bookings WHERE owner_id=? AND date=? ORDER BY time").bind(userId, date)
      : env.DB.prepare("SELECT * FROM bookings WHERE owner_id=? ORDER BY date,time").bind(userId);
    return json((await query.all()).results);
  }
  if (url.pathname === "/api/bookings" && request.method === "POST") {
    const body = bookingInput(await readJson(request));
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare("INSERT INTO bookings (id,owner_id,date,time,name,phone,price) VALUES (?,?,?,?,?,?,?)")
        .bind(id, userId, body.date, body.time, body.name, body.phone, body.price).run();
    } catch (error) {
      if (isSlotConflict(error)) return slotConflict();
      throw error;
    }
    return json({ id }, 201);
  }
  const match = url.pathname.match(/^\/api\/bookings\/([\w-]{1,128})$/);
  if (match && request.method === "PUT") {
    const body = bookingInput(await readJson(request));
    try {
      const result = await env.DB.prepare("UPDATE bookings SET date=?,time=?,name=?,phone=?,price=? WHERE id=? AND owner_id=?")
        .bind(body.date, body.time, body.name, body.phone, body.price, match[1], userId).run();
      return result.meta.changes ? json({ ok: true }) : json({ error: "Запись не найдена." }, 404);
    } catch (error) {
      if (isSlotConflict(error)) return slotConflict();
      throw error;
    }
  }
  if (match && request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM bookings WHERE id=? AND owner_id=?").bind(match[1], userId).run();
    return result.meta.changes ? json({ ok: true }) : json({ error: "Запись не найдена." }, 404);
  }
  if (url.pathname === "/api/settings" && request.method === "GET") {
    const row = await env.DB.prepare("SELECT reminders_enabled,reminder_template FROM users WHERE telegram_id=?").bind(userId).first();
    return json(row || { reminders_enabled: 1, reminder_template: defaultTemplate });
  }
  if (url.pathname === "/api/settings" && request.method === "PUT") {
    const body = await readJson(request);
    if (!("reminders_enabled" in body) && !("reminder_template" in body)) throw new RequestError("Нет настроек для сохранения.");
    const existing = await env.DB.prepare("SELECT reminders_enabled,reminder_template FROM users WHERE telegram_id=?").bind(userId).first();
    const enabled = body.reminders_enabled ?? existing?.reminders_enabled ?? 1;
    const template = body.reminder_template ?? existing?.reminder_template ?? defaultTemplate;
    if (![true, false, 0, 1].includes(enabled) || ("reminders_enabled" in body && body.reminders_enabled === null)) {
      throw new RequestError("Некорректная настройка напоминаний.");
    }
    if (typeof template !== "string" || !template.trim() || template.length > 2000 || ("reminder_template" in body && body.reminder_template === null)) {
      throw new RequestError("Текст напоминания должен содержать от 1 до 2000 символов.");
    }
    await env.DB.prepare("INSERT INTO users (telegram_id,reminders_enabled,reminder_template) VALUES (?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET reminders_enabled=excluded.reminders_enabled, reminder_template=excluded.reminder_template")
      .bind(userId, enabled ? 1 : 0, template.trim()).run();
    return json({ ok: true });
  }
  return json({ error: "Не найдено." }, 404);
}

async function authenticate(request, env) {
  const initData = request.headers.get("X-Telegram-Init-Data");
  if (!initData || !env.TELEGRAM_BOT_TOKEN) return null;
  const userId = await authenticatedUser(initData, env.TELEGRAM_BOT_TOKEN);
  if (!userId) return null;
  await env.DB.prepare("INSERT INTO users (telegram_id) VALUES (?) ON CONFLICT(telegram_id) DO NOTHING").bind(userId).run();
  return userId;
}

async function authenticatedUser(initData, token) {
  if (encoder.encode(initData).byteLength > MAX_INIT_DATA_BYTES) return null;
  const params = new URLSearchParams(initData);
  const seen = new Set();
  for (const [key] of params) {
    if (seen.has(key)) return null;
    seen.add(key);
  }
  const hash = params.get("hash");
  const dateText = params.get("auth_date");
  const authDate = Number(dateText);
  const now = Math.floor(Date.now() / 1000);
  if (!/^[a-f0-9]{64}$/i.test(hash || "") || !/^\d{1,12}$/.test(dateText || "") || authDate <= 0 || now - authDate > 86400 || authDate - now > 60) return null;
  params.delete("hash");
  const checkString = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => k + "=" + v).join("\n");
  const secret = await crypto.subtle.importKey("raw", encoder.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const keyBytes = await crypto.subtle.sign("HMAC", secret, encoder.encode(token));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signature = Uint8Array.from(hash.match(/../g), pair => parseInt(pair, 16));
  if (!(await crypto.subtle.verify("HMAC", key, signature, encoder.encode(checkString)))) return null;
  try {
    const user = JSON.parse(params.get("user") || "null");
    return user && Number.isSafeInteger(user.id) && user.id > 0 ? String(user.id) : null;
  } catch {
    return null;
  }
}

async function telegramWebhook(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "POST" });
  const suppliedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!env.TELEGRAM_WEBHOOK_SECRET || !suppliedSecret || !(await equalSecret(suppliedSecret, env.TELEGRAM_WEBHOOK_SECRET))) {
    return json({ error: "Forbidden." }, 403);
  }
  const update = await readJson(request, 65536);
  const message = update.message;
  if (message?.chat?.type === "private" && Number.isSafeInteger(message.from?.id) && message.from.id > 0 && message.from.id === message.chat.id && typeof message.text === "string" && /^\/start(?:@[a-zA-Z0-9_]+)?(?:\s|$)/.test(message.text)) {
    let appUrl;
    try { appUrl = new URL(env.APP_URL); } catch { throw new RequestError("Приложение ещё не настроено.", 503); }
    if (appUrl.protocol !== "https:" || !env.TELEGRAM_BOT_TOKEN) throw new RequestError("Приложение ещё не настроено.", 503);
    const chatId = String(message.from.id);
    await env.DB.prepare("INSERT INTO users (telegram_id,chat_id) VALUES (?,?) ON CONFLICT(telegram_id) DO UPDATE SET chat_id=excluded.chat_id").bind(chatId, chatId).run();
    // Inline Mini Apps supply signed initData; reply-keyboard launches do not.
    await telegram(env, "sendMessage", { chat_id: chatId, text: "Ваши записи — всегда под рукой. Откройте ежедневник:", reply_markup: { inline_keyboard: [[{ text: "Открыть ежедневник", web_app: { url: appUrl.href } }]] } });
  }
  return json({ ok: true });
}

async function sendDailyReminders(env) {
  // The existing cron/date boundary use UTC; customer messages remain manual.
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const users = (await env.DB.prepare("SELECT telegram_id,chat_id,reminder_template FROM users WHERE reminders_enabled=1 AND chat_id IS NOT NULL").all()).results;
  for (const user of users) {
    const bookings = (await env.DB.prepare("SELECT time,name,phone FROM bookings WHERE owner_id=? AND date=? ORDER BY time").bind(user.telegram_id, tomorrow).all()).results;
    if (!bookings.length) continue;
    const heading = "Завтра (" + tomorrow + ") записей: " + bookings.length;
    let text = heading;
    try {
      for (const booking of bookings) {
        const line = "\n• " + booking.time + " — " + booking.name + (booking.phone ? " (" + booking.phone + ")" : "");
        if (text.length + line.length > 3500) {
          await telegram(env, "sendMessage", { chat_id: user.chat_id, text });
          text = heading + " (продолжение)";
        }
        text += line;
      }
      await telegram(env, "sendMessage", { chat_id: user.chat_id, text });
    } catch {
      // A blocked bot must not stop other owners' reminders.
    }
  }
}

async function telegram(env, method, body) {
  const response = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error("Telegram request failed.");
  return result;
}

function bookingInput(body) {
  if (!validDate(body.date) || typeof body.time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.time)) {
    throw new RequestError("Выберите корректные дату и время.");
  }
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(body.name)) {
    throw new RequestError("Имя должно содержать от 1 до 120 символов.");
  }
  const phone = body.phone === undefined ? "" : body.phone;
  if (typeof phone !== "string" || phone.trim().length > 40 || /[\u0000-\u001f\u007f]/.test(phone)) throw new RequestError("Телефон должен содержать не больше 40 символов.");
  const rawPrice = body.price === undefined || body.price === "" ? 0 : body.price;
  if (!(typeof rawPrice === "number" || (typeof rawPrice === "string" && /^\d+(?:\.\d{1,2})?$/.test(rawPrice.trim())))) throw new RequestError("Введите корректную стоимость.");
  const price = Number(rawPrice);
  if (!Number.isFinite(price) || price < 0 || price > 999999999.99 || Math.abs(price * 100 - Math.round(price * 100)) > 0.00001) throw new RequestError("Стоимость должна быть от 0 до 999999999,99, не больше двух знаков после запятой.");
  return { date: body.date, time: body.time, name: body.name.trim(), phone: phone.trim(), price };
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function readJson(request, limit = MAX_API_BODY_BYTES) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) throw new RequestError("Ожидается JSON.", 415);
  if (Number(request.headers.get("content-length")) > limit) throw new RequestError("Слишком большой запрос.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("Пустой запрос.");
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel().catch(() => {});
      throw new RequestError("Слишком большой запрос.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new RequestError("Некорректный JSON.");
  }
}

async function equalSecret(first, second) {
  const [a, b] = await Promise.all([first, second].map(value => crypto.subtle.digest("SHA-256", encoder.encode(value))));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

function isSlotConflict(error) { return /UNIQUE constraint failed: bookings\.owner_id, bookings\.date, bookings\.time/i.test(String(error?.message || error)); }
function slotConflict() { return json({ error: "На это время уже есть запись. Выберите другое время." }, 409); }
function json(data, status = 200, headers = {}) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers } }); }
class RequestError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
