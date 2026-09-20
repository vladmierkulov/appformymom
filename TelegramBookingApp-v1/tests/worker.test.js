import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/worker.js";

const TOKEN = "123456789:fixture-token-not-a-real-bot-token";
const ORIGIN = "https://booking.example.test";
const validBooking = { date: "2026-09-15", time: "09:00", name: "Мария", phone: "+370 600 12345", price: 35.5 };

function signedData(userId = 1001, overrides = {}) {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "fixture-query",
    user: JSON.stringify({ id: userId, first_name: "Мама" }),
    ...overrides
  };
  const entries = Object.entries(fields).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = createHmac("sha256", secret).update(entries.map(([key, value]) => `${key}=${value}`).join("\n")).digest("hex");
  return new URLSearchParams([...entries, ["hash", hash]]).toString();
}

function fixture(t, overrides = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  t.after(() => database.close());
  // Exercise actual SQLite SQL/uniqueness with the same public methods as D1.
  const DB = {
    prepare(sql) {
      let parameters = [];
      const query = {
        bind(...values) { parameters = values; return query; },
        async all() { return { results: database.prepare(sql).all(...parameters).map(row => ({ ...row })) }; },
        async first() { const row = database.prepare(sql).get(...parameters); return row ? { ...row } : null; },
        async run() { const result = database.prepare(sql).run(...parameters); return { meta: { changes: Number(result.changes) } }; }
      };
      return query;
    }
  };
  return { database, env: { DB, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: "fixture-webhook-secret", APP_URL: ORIGIN, ASSETS: { fetch: () => new Response("asset") }, ...overrides } };
}

async function api(env, path = "/api/bookings", { method = "GET", body, raw, userId = 1001, initData = signedData(userId), headers = {} } = {}) {
  const request = new Request(ORIGIN + path, {
    method,
    headers: { "X-Telegram-Init-Data": initData, ...(body !== undefined || raw !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    ...(body !== undefined || raw !== undefined ? { body: raw !== undefined ? raw : JSON.stringify(body) } : {})
  });
  return worker.fetch(request, env);
}

async function create(env, body = validBooking, userId = 1001) {
  const response = await api(env, "/api/bookings", { method: "POST", body, userId });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).id;
}

test("real signed Telegram initData authenticates; responses cannot be cached", async t => {
  const { env } = fixture(t);
  const response = await api(env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("missing, forged, expired, future, duplicate and malformed identities are rejected before database use", async t => {
  const now = Math.floor(Date.now() / 1000);
  const signed = signedData();
  const tampered = new URLSearchParams(signed);
  tampered.set("user", JSON.stringify({ id: 9999 }));
  const badHash = new URLSearchParams(signed);
  badHash.set("hash", "z".repeat(64));
  const cases = [
    "", "user=%7B%22id%22%3A1001%7D", tampered.toString(), badHash.toString(),
    signedData(1001, { auth_date: String(now - 86401) }),
    signedData(1001, { auth_date: String(now + 120) }),
    signedData(1001, { auth_date: "0" }),
    signedData(1001, { auth_date: "1e10" }),
    signed + "&user=" + encodeURIComponent(JSON.stringify({ id: 1001 })),
    signed + "&hash=" + new URLSearchParams(signed).get("hash"),
    signedData(1001, { user: "{bad json" }),
    signedData(1001, { user: "null" }),
    signedData(1001, { user: '{"id":"1001"}' }),
    signedData(-1), signedData(0), signedData(1.5), signedData(Number.MAX_SAFE_INTEGER + 1),
    "x".repeat(16385)
  ];
  for (const initData of cases) {
    const response = await api({ TELEGRAM_BOT_TOKEN: TOKEN }, "/api/bookings", { initData });
    assert.equal(response.status, 401, initData.slice(0, 100));
  }
  const { env } = fixture(t, { TELEGRAM_BOT_TOKEN: "wrong-token" });
  assert.equal((await api(env)).status, 401);
});

test("phone and tablet sessions share one Telegram account, including edits, settings and deletion", async t => {
  const { env } = fixture(t);
  const phone = signedData(1001, { query_id: "phone-session" });
  const tablet = signedData(1001, { query_id: "tablet-session", user: JSON.stringify({ id: 1001, first_name: "Новое имя" }) });
  const response = await api(env, "/api/bookings", { method: "POST", body: validBooking, initData: phone });
  assert.equal(response.status, 201);
  const { id } = await response.json();
  assert.equal((await (await api(env, "/api/bookings", { initData: tablet })).json())[0].id, id);
  assert.equal((await api(env, "/api/bookings/" + id, { method: "PUT", body: { ...validBooking, time: "11:30" }, initData: tablet })).status, 200);
  assert.equal((await (await api(env, "/api/bookings", { initData: phone })).json())[0].time, "11:30");
  const settings = { reminders_enabled: 0, reminder_template: "До встречи, {name}!" };
  assert.equal((await api(env, "/api/settings", { method: "PUT", body: settings, initData: tablet })).status, 200);
  assert.deepEqual(await (await api(env, "/api/settings", { initData: phone })).json(), settings);
  assert.deepEqual(await (await api(env, "/api/bookings", { userId: 2002 })).json(), []);
  assert.notDeepEqual(await (await api(env, "/api/settings", { userId: 2002 })).json(), settings);
  assert.equal((await api(env, "/api/bookings/" + id, { method: "DELETE", initData: phone })).status, 200);
  assert.deepEqual(await (await api(env, "/api/bookings", { initData: tablet })).json(), []);
});

test("small clock skew and supplementary signed Telegram fields are accepted", async t => {
  const { env } = fixture(t);
  const response = await api(env, "/api/bookings", { initData: signedData(1001, { auth_date: String(Math.floor(Date.now() / 1000) + 30), signature: "fixture-extra-signature", start_param: "calendar" }) });
  assert.equal(response.status, 200);
});

test("CRUD is owner-scoped and preserves names, phones and money", async t => {
  const { env } = fixture(t);
  const id = await create(env, { ...validBooking, name: "  Мария  ", phone: " +370 600 12345 ", price: "35.50" });
  await create(env, { ...validBooking, name: "Другой владелец" }, 2002);
  const own = await (await api(env)).json();
  assert.equal(own.length, 1);
  assert.equal(own[0].owner_id, "1001");
  assert.equal(own[0].name, "Мария");
  assert.equal(own[0].phone, "+370 600 12345");
  assert.equal(own[0].price, 35.5);
  assert.equal((await api(env, `/api/bookings/${id}`, { method: "PUT", body: validBooking, userId: 2002 })).status, 404);
  assert.equal((await api(env, `/api/bookings/${id}`, { method: "DELETE", userId: 2002 })).status, 404);
  assert.equal((await api(env, `/api/bookings/${id}`, { method: "PUT", body: { ...validBooking, time: "23:45", name: "Мария новая" } })).status, 200);
  assert.equal((await (await api(env)).json())[0].time, "23:45");
  assert.deepEqual(await (await api(env, "/api/bookings?date=2026-09-16")).json(), []);
  assert.equal((await api(env, `/api/bookings/${id}`, { method: "DELETE" })).status, 200);
  assert.deepEqual(await (await api(env)).json(), []);
  assert.equal((await (await api(env, "/api/bookings", { userId: 2002 })).json()).length, 1);
  assert.equal((await api(env, `/api/bookings/${id}`, { method: "DELETE" })).status, 404);
});

test("unique time slots return readable 409 for insert and update without data loss", async t => {
  const { env } = fixture(t);
  await create(env);
  const id = await create(env, { ...validBooking, time: "10:00" });
  const duplicate = await api(env, "/api/bookings", { method: "POST", body: validBooking });
  assert.equal(duplicate.status, 409);
  assert.match((await duplicate.json()).error, /уже есть запись/);
  assert.equal((await api(env, `/api/bookings/${id}`, { method: "PUT", body: validBooking })).status, 409);
  assert.deepEqual((await (await api(env)).json()).map(b => b.time), ["09:00", "10:00"]);
});

test("calendar and booking validation reject impossible dates, unsafe types and invalid money", async t => {
  const { env } = fixture(t);
  const cases = [
    { date: "2026-02-29" }, { date: "2026-04-31" }, { date: "2026-13-01" }, { date: "0000-01-01" }, { date: 20260915 },
    { time: "24:00" }, { time: "10:60" }, { time: "9:00" }, { time: 900 },
    { name: " " }, { name: "x".repeat(121) }, { name: "a\nb" }, { name: {} },
    { phone: "x".repeat(41) }, { phone: 1234 }, { phone: "123\n456" },
    { price: -1 }, { price: "Infinity" }, { price: true }, { price: [] }, { price: null },
    { price: "1e3" }, { price: 0.001 }, { price: 1000000000 }
  ];
  for (const changes of cases) {
    const response = await api(env, "/api/bookings", { method: "POST", body: { ...validBooking, ...changes } });
    assert.equal(response.status, 400, JSON.stringify(changes));
  }
  assert.equal((await api(env, "/api/bookings?date=2026-02-29")).status, 400);
  assert.equal((await api(env, "/api/bookings?date=")).status, 400);
  await create(env, { ...validBooking, date: "2028-02-29", price: 0.29 });
  await create(env, { date: "2028-02-29", time: "00:00", name: "Без телефона" });
});

test("JSON must be an object, well-formed and within the body size limit", async t => {
  const { env } = fixture(t);
  for (const raw of ["{oops", "null", "[]", '"text"', ""]) {
    assert.equal((await api(env, "/api/bookings", { method: "POST", raw })).status, 400);
  }
  assert.equal((await api(env, "/api/bookings", { method: "POST", body: validBooking, headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await api(env, "/api/bookings", { method: "POST", raw: JSON.stringify({ extra: "x".repeat(17000) }) })).status, 413);
  assert.equal((await api(env, "/api/bookings", { method: "POST", raw: "{}", headers: { "content-length": "17000" } })).status, 413);
});

test("settings are validated, partial updates preserve other fields, and remain owner-scoped", async t => {
  const { env } = fixture(t);
  const initial = await (await api(env, "/api/settings")).json();
  assert.equal(initial.reminders_enabled, 1);
  assert.equal((await api(env, "/api/settings", { method: "PUT", body: { reminders_enabled: false, reminder_template: "Привет, {name}! {date}, {time}." } })).status, 200);
  assert.equal((await api(env, "/api/settings", { method: "PUT", body: { reminders_enabled: true } })).status, 200);
  const saved = await (await api(env, "/api/settings")).json();
  assert.equal(saved.reminders_enabled, 1);
  assert.equal(saved.reminder_template, "Привет, {name}! {date}, {time}.");
  assert.equal((await (await api(env, "/api/settings", { userId: 2002 })).json()).reminder_template, initial.reminder_template);
  for (const body of [{}, { reminders_enabled: "false" }, { reminders_enabled: null }, { reminder_template: null }, { reminder_template: " " }, { reminder_template: 123 }, { reminder_template: "x".repeat(2001) }]) {
    assert.equal((await api(env, "/api/settings", { method: "PUT", body })).status, 400);
  }
});

test("webhook fails closed without a secret, allows only POST, ignores non-private starts", async t => {
  const { env, database } = fixture(t);
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => { requests.push(JSON.parse(options.body)); return Response.json({ ok: true }); });
  const webhook = (body, secret = env.TELEGRAM_WEBHOOK_SECRET, method = "POST") => worker.fetch(new Request(ORIGIN + "/telegram/webhook", { method, headers: { "content-type": "application/json", ...(secret ? { "X-Telegram-Bot-Api-Secret-Token": secret } : {}) }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) }), env);
  const message = { chat: { id: 1001, type: "private" }, from: { id: 1001 }, text: "/start" };
  assert.equal((await webhook({ message }, "wrong")).status, 403);
  assert.equal((await webhook({ message }, null)).status, 403);
  assert.equal((await webhook({}, undefined, "GET")).status, 405);
  const savedSecret = env.TELEGRAM_WEBHOOK_SECRET;
  delete env.TELEGRAM_WEBHOOK_SECRET;
  assert.equal((await webhook({ message }, savedSecret)).status, 403);
  env.TELEGRAM_WEBHOOK_SECRET = savedSecret;
  assert.equal((await webhook({ message: { ...message, chat: { id: -100, type: "group" } } })).status, 200);
  assert.equal((await webhook({ message: { ...message, from: { id: 2002 } } })).status, 200);
  assert.equal((await webhook({ message: { ...message, text: "/starting" } })).status, 200);
  assert.equal(requests.length, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0);
  assert.equal((await webhook({ message: { ...message, text: "/start calendar" } })).status, 200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].chat_id, "1001");
  assert.equal(requests[0].reply_markup.inline_keyboard[0][0].web_app.url, ORIGIN + "/");
  assert.equal(database.prepare("SELECT chat_id FROM users WHERE telegram_id='1001'").get().chat_id, "1001");
});

test("daily reminders split long schedules and continue past blocked recipients", async t => {
  const { env, database } = fixture(t);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  database.exec("INSERT INTO users(telegram_id,chat_id) VALUES ('1001','1001'),('2002','2002'); INSERT INTO users(telegram_id,chat_id,reminders_enabled) VALUES ('3003','3003',0)");
  const insert = database.prepare("INSERT INTO bookings(id,owner_id,date,time,name,phone) VALUES (?,?,?,?,?,?)");
  for (const owner of ["1001", "2002", "3003"]) {
    for (let i = 0; i < 40; i++) insert.run(owner + "-" + i, owner, tomorrow, `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`, "Имя " + owner + " " + "Я".repeat(100), "+37000000000");
  }
  const messages = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    messages.push(body);
    return Response.json({ ok: body.chat_id !== "1001" }, { status: body.chat_id === "1001" ? 403 : 200 });
  });
  await worker.scheduled({}, env);
  assert.equal(messages.filter(m => m.chat_id === "1001").length, 1);
  const delivered = messages.filter(m => m.chat_id === "2002");
  assert.ok(delivered.length > 1);
  assert.ok(messages.every(m => m.text.length <= 3500));
  assert.equal(messages.filter(m => m.chat_id === "3003").length, 0);
  assert.equal(delivered.map(m => m.text).join("").match(/Имя 2002/g).length, 40);
  assert.ok(delivered.every(m => !m.text.includes("Имя 1001")));
});

test("internal failures return generic errors without leaking database details", async t => {
  const { env } = fixture(t);
  env.DB = { prepare() { throw new Error("database SQL secret detail"); } };
  const response = await api(env);
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /SQL|secret|database/);
});
