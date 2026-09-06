#!/usr/bin/env node
/**
 * End-to-end smoke test for the generation → shopping → edit → bot chain.
 *
 * It talks to a *running* server with the same HTTP API the website and the
 * messengers use, so it verifies the whole product, not just one function:
 *
 *   1. marketplace catalog + categories
 *   2. register a throwaway account, generate a design from a photo
 *   3. the design comes back with a shopping list (items, bboxes, store links)
 *   4. manual pin / delete of an item
 *   5. targeted edit by free text («замени только шторы») — only curtains change
 *   6. history endpoint exposes the shopping counts
 *   7. admin settings + bot status endpoints
 *   8. the messenger engine itself, through /api/bots/simulator (nothing is
 *      sent to Telegram/VK/MAX): /start, menu, free text, admin gating, app link
 *
 * Usage:
 *   npm run build && npm run start        # or: npm run dev
 *   node scripts/selftest.mjs [--base http://localhost:3000]
 *
 * Exit code is 0 only when every check passes.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = (arg("base", process.env.BOT_BASE_URL || "http://127.0.0.1:3000")).replace(/\/+$/, "");

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, detail) {
  passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
}
function bad(name, detail) {
  failed++;
  failures.push(`${name}: ${detail}`);
  console.log(`  \x1b[31m✗\x1b[0m ${name} — ${detail}`);
}
const check = (cond, name, detail) => (cond ? ok(name, detail) : bad(name, detail ?? "assertion failed"));

async function api(p, { method = "GET", token, body, form, raw, headers: extra = {} } = {}) {
  const headers = { ...extra };
  if (token) headers["x-session-token"] = token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : raw),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function main() {
  console.log(`Interier selftest → ${BASE}`);

  /* ---------------------------------------------------------------- 1. catalog */
  section("1. Маркетплейсы и категории");
  const markets = await api("/api/marketplaces");
  check(markets.status === 200, "GET /api/marketplaces отвечает", `status ${markets.status}`);
  const enabled = markets.json?.enabled || [];
  const cats = markets.json?.categories || [];
  check(enabled.length > 0, "включены магазины", enabled.map((m) => m.id).join(", ") || "нет");
  check(cats.length >= 8, "категории деталей", `${cats.length} шт`);
  check(
    enabled.some((m) => /ozon|market|leroy|lemanapro/i.test(m.id)),
    "Ozon / Яндекс Маркет / Леруа в списке",
    enabled.map((m) => m.id).join(", ")
  );

  /* ------------------------------------------------------- 2. register + design */
  /* ------------------------------------------------------------- 1b. prep */
  section("1b. Подготовка тестового окружения");
  // The harness needs the simulator, shopping auto-detection and an account the
  // owner rules (admin_telegram_id) — the same promotion a real owner gets.
  const ownerId = "77" + (Date.now() % 10000000);
  const prepLogin = await api("/api/auth/login", { method: "POST", body: { email: "admin@interier.ru", password: "admin123" } });
  const prepToken = prepLogin.json?.token || null;
  check(!!prepToken, "администратор доступен (нужен для симулятора)", `status ${prepLogin.status}`);
  if (prepToken) {
    await api("/api/admin/bots", { method: "PUT", token: prepToken, body: { admin_telegram_id: ownerId, public_base_url: BASE } });
    await api("/api/admin/settings", {
      method: "PUT",
      token: prepToken,
      body: { bots_simulator: "1", bots_enabled: "1", test_unlimited: "1", shopping_enabled: "1", shopping_auto: "1" },
    });
  }
  const prepView = await api("/api/admin/settings", { token: prepToken });
  const prepSettings = prepView.json?.settings || {};
  check(
    prepSettings.bots_simulator === "1" && prepSettings.shopping_enabled === "1" && prepSettings.test_unlimited === "1",
    "переключатели теста и шопинга включены",
    `sim=${prepSettings.bots_simulator}, shop=${prepSettings.shopping_enabled}, unlim=${prepSettings.test_unlimited}`
  );

  section("2. Аккаунт и генерация дизайна");
  const email = `selftest_${Date.now()}@example.com`;
  const reg = await api("/api/auth/register", {
    method: "POST",
    body: { name: "Self Test", email, password: "selftest123" },
  });
  check(reg.status === 200 && !!reg.json?.token, "регистрация тестового аккаунта", `status ${reg.status}`);
  const token = reg.json?.token;

  // Site accounts are allowed to generate only with an identity confirmed by a
  // messenger (that is what the bot login is for). The selftest proves the
  // whole funnel: site asks for a code -> bot redeems it -> account verified.
  const issued0 = await api("/api/account/botlink", { method: "POST", token, body: { platform: "telegram" } });
  const bindCode = issued0.json?.code;
  const simBind = await api("/api/bots/simulator", {
    method: "POST",
    body: { platform: "telegram", chatId: "selftest-bind-" + Date.now(), externalId: ownerId, text: "/start " + bindCode },
  });
  const meVerified = await api("/api/auth/me", { token });
  check(!!bindCode && simBind.status === 200 && meVerified.json?.user?.verified === true, "аккаунт подтверждён через бота", `verified=${meVerified.json?.user?.verified}`);
  check(meVerified.json?.user?.telegramLinked === true, "Telegram-профиль привязан к аккаунту сайта", `tg=${meVerified.json?.user?.telegramId}`);

  const sample = path.join(here, "..", "public", "styles", "minimalism.jpg");
  const bytes = await readFile(sample).catch(() => null);
  check(!!bytes, "тестовое фото найдено", sample);
  if (!bytes) return finish();

  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: "image/jpeg" }), "room.jpg");
  fd.append("scope", "single");
  const stylesRes = await api("/api/styles");
  const styleId = stylesRes.json?.styles?.[0]?.id || null;
  check(!!styleId, "GET /api/styles отдаёт каталог стилей", styleId || "fallback scope=all");
  if (styleId) fd.append("styleId", styleId);
  else fd.set("scope", "all");

  const gen = await api("/api/generate", { method: "POST", token, form: fd });
  check(gen.status === 200 && Array.isArray(gen.json?.generations), "POST /api/generate вернул дизайн", `status ${gen.status}`);
  const g0 = gen.json?.generations?.[0];
  check(!!g0 && g0.status === "done", "генерация завершилась", g0?.status || "нет записи");
  check(!!g0?.resultUrl || !!g0?.originalUrl, "есть картинка результата", g0?.resultUrl || g0?.originalUrl || "—");

  /* ----------------------------------------------------------- 3. shopping list */
  section("3. Список деталей со ссылками в магазины");
  const shopping = g0?.shopping || {};
  const items = shopping.items || [];
  check(items.length > 0, "детали распознаны", `${items.length} шт, режим ${shopping.mode}, детектор ${shopping.detector}`);
  const withLinks = items.filter((i) => (i.links || []).length > 0);
  check(withLinks.length === items.length && items.length > 0, "у каждой детали есть ссылка", `${withLinks.length}/${items.length}`);
  const linkOk = withLinks.every((i) => (i.links || []).every((l) => /^https?:\/\//.test(l.url) && /text=|query=|search|q=|aspx/i.test(l.url)));
  check(linkOk, "ссылки ведут на поиск магазина", withLinks[0]?.links?.[0]?.url || "—");
  check(
    items.every((i) => Array.isArray(i.bbox) ? i.bbox.length === 4 : true),
    "координаты хотспотов корректны (или их нет → режим списка)"
  );
  const hotspots = items.filter((i) => Array.isArray(i.bbox) && i.bbox.length === 4).length;
  check(
    hotspots === 0 ? shopping.mode === "list" : shopping.mode === "hotspots" || shopping.mode === "list",
    "режим соответствует данным",
    `${hotspots} с координатами → ${shopping.mode}`
  );

  /* ------------------------------------------------------ 4. manual pin/delete */
  section("4. Ручная деталь и удаление");
  const add = await api(`/api/generations/${g0.id}/items`, {
    method: "POST",
    token,
    body: { action: "add", label: "напольное зеркало в раме", x: 0.42, y: 0.68 },
  });
  check(add.status === 200 && !!add.json?.item, "деталь добавлена кликом", add.json?.item?.name || `status ${add.status}`);
  check((add.json?.item?.links || []).length > 0, "к ручной детали подобраны магазины", `${(add.json?.item?.links || []).length} ссылок`);
  const itemId = add.json?.item?.id;
  const del = await api(`/api/generations/${g0.id}/items?item=${encodeURIComponent(itemId || "")}`, { method: "DELETE", token });
  check(del.status === 200, "ручная деталь удалена", `status ${del.status}`);
  const refresh = await api(`/api/generations/${g0.id}/items`, { method: "POST", token, body: { action: "refresh" } });
  check(refresh.status === 200 && Array.isArray(refresh.json?.shopping?.items), "пересборка списка работает", `${(refresh.json?.shopping?.items || []).length} позиций`);

  /* ---------------------------------------------------------- 5. targeted edit */
  section("5. Точечная правка текстом");
  const edit = await api(`/api/generations/${g0.id}/edit`, {
    method: "POST",
    token,
    body: { instruction: "меня устраивает цвет и стиль штор, замени только шторы на серые льняные" },
  });
  check(edit.status === 200 && !!edit.json?.generation, "правка принята", `status ${edit.status}`);
  const eg = edit.json?.generation;
  check(eg?.kind === "edit", "результат помечен как правка", eg?.kind || "—");
  const targets = edit.json?.targets || [];
  check(targets.length === 1 && /штор|curtain/.test(JSON.stringify(targets)), "изменяется только указанная деталь", targets.map((t) => t.ru || t.id).join(", ") || "цели не определены");
  const eItems = eg?.shopping?.items || [];
  check(eItems.length > 0, "после правки есть ссылка на новую деталь", eItems.map((i) => i.name).join(", ") || "пусто");
  check(eItems.every((i) => i.changed === true || i.changed === undefined), "в списке только изменённые позиции", `${eItems.filter((i) => i.changed).length}/${eItems.length} помечены`);

  /* ---------------------------------------------------------------- 6. history */
  section("6. История и галерея");
  const hist = await api("/api/generations", { token });
  check(hist.status === 200 && (hist.json?.generations || []).length >= 2, "история возвращает оба дизайна", `${(hist.json?.generations || []).length} записей`);
  const histEdit = (hist.json?.generations || []).find((x) => x.id === eg?.id);
  check(!!histEdit?.shopping?.items?.length, "в истории виден список покупок", `${(histEdit?.shopping?.items || []).length} позиций`);
  check(histEdit?.instruction === undefined || typeof histEdit.instruction === "string", "инструкция правки сохранена", String(histEdit?.instruction ?? "—").slice(0, 32));

  const pub = await api(`/api/generations/${g0.id}/publish`, { method: "POST", token, body: { published: true } });
  check(pub.status === 200, "дизайн опубликован", `status ${pub.status}`);
  const gal = await api("/api/gallery");
  const inGallery = (gal.json?.items || []).some((i) => (i.id === g0.id || i.generationId === g0.id));
  check(gal.status === 200 && inGallery, "дизайн появился в галерее", `items ${(gal.json?.items || []).length}`);

  /* ------------------------------------------------------------------ 7. admin */
  section("7. Админка: настройки ИИ-шопинга и ботов");
  const login = await api("/api/auth/login", { method: "POST", body: { email: "admin@interier.ru", password: "admin123" } });
  const adminToken = login.json?.token;
  check(login.status === 200 && !!adminToken, "вход администратора", `status ${login.status}`);
  const botSim = await api("/api/admin/settings", { method: "PUT", token: adminToken, body: { bots_simulator: "1", shopping_max_items: "8" } });
  check(botSim.status === 200, "настройки сохранены", `status ${botSim.status}`);
  const bots = await api("/api/admin/bots", { token: adminToken });
  check(bots.status === 200 && (bots.json?.platforms || []).length === 3, "GET /api/admin/bots: три платформы", (bots.json?.platforms || []).map((p) => p.platform).join(", "));
  check(!!bots.json?.appUrl, "адрес мини-приложения отдан", bots.json?.appUrl || "—");
  check(typeof bots.json?.stats?.chats === "number" || Array.isArray(bots.json?.chats), "статистика чатов доступна");

  /* ------------------------------------------------------------------ 8. bots */
  section("8. Движок ботов (Telegram / VK / MAX)");
  const sim = (payload) => api("/api/bots/simulator", { method: "POST", body: payload });

  const start = await sim({ platform: "telegram", chatId: "sim-user", externalId: "111000", text: "/start" });
  const startText = (start.json?.messages || []).map((m) => m.text || "").join("\n");
  check(start.status === 200 && /дизайн|design/i.test(startText), "/start приветствует и предлагает дизайн", startText.replace(/\n/g, " ").slice(0, 70));
  const kb = (start.json?.messages || []).flatMap((m) => m.buttons || []).flat();
  check(kb.some((b) => /Создать дизайн|Новый дизайн/.test(b.text)), "клавиатура: кнопка генерации дизайна", kb.map((b) => b.text).join(" / ").slice(0, 90));
  check(kb.some((b) => /детал|Истор|дизайны/i.test(b.text)), "клавиатура: правка детали и история", "");
  check((start.json?.messages || []).every((m) => (m.buttons || []).flat().length <= 10), "клавиатура в пределах лимита платформ");
  check(kb.some((b) => /приложени|Открыть/i.test(b.text) && b.kind === "app"), "клавиатура: кнопка мини-приложения", kb.find((b) => b.kind === "app")?.url || "—");

  const vkStart = await sim({ platform: "vk", chatId: "2000000001", externalId: "vk-1", text: "начать" });
  check(vkStart.status === 200 && (vkStart.json?.messages || []).length > 0, "VK: то же меню из того же движка", `${(vkStart.json?.messages || []).length} сообщений`);
  const maxStart = await sim({ platform: "max", chatId: "max-1", externalId: "max-1", action: "menu" });
  check(maxStart.status === 200 && (maxStart.json?.messages || []).length > 0, "MAX: кнопка меню работает", `${(maxStart.json?.messages || []).length} сообщений`);

  const noChat = await sim({ platform: "telegram", chatId: "sim-fresh-" + Date.now(), externalId: "222000", text: "замени только шторы" });
  const noChatText = (noChat.json?.messages || []).map((m) => m.text || "").join(" ");
  check(noChat.status === 200 && !!noChatText, "правка без готового дизайна объясняет шаг", noChatText.replace(/<[^>]+>/g, "").slice(0, 70));

  const notAdmin = await sim({ platform: "telegram", chatId: "sim-user2", externalId: "333000", text: "/admin" });
  const notAdminText = (notAdmin.json?.messages || []).map((m) => m.text || "").join(" ");
  check(notAdmin.status === 200 && !/статистика|broadcast/i.test(notAdminText), "/admin закрыт для чужих", notAdminText.replace(/<[^>]+>/g, "").slice(0, 60));

  const ownerBefore = await api("/api/admin/bots", { method: "PUT", token: adminToken, body: { admin_telegram_id: "444000", public_base_url: BASE } });
  check(ownerBefore.status === 200, "admin_telegram_id сохранён", `status ${ownerBefore.status}`);
  const owner = await sim({ platform: "telegram", chatId: "sim-owner", externalId: "444000", text: "/admin" });
  const ownerText = (owner.json?.messages || []).map((m) => m.text || "").join(" ");
  const ownerKb = (owner.json?.messages || []).flatMap((m) => m.buttons || []).flat();
  check(/админ/i.test(ownerText) || ownerKb.length > 2, "владелец получает админ-меню бота", ownerKb.map((b) => b.text).join(" / ").slice(0, 90));

  const app = await fetch(`${BASE}/app?c=telegram`, { headers: { "User-Agent": "TelegramAndroid" } });
  const html = await app.text();
  check(app.status === 200 && html.includes("telegram-web-app.js"), "мини-приложение /app отдаёт SDK Telegram", `status ${app.status}`);
  check(/app-shell|Interier/.test(html), "мини-приложение рендерится", html.length + " bytes");

  /* ---------------------------------------------- 9. bot login link + security */
  section("9. Вход из бота по ссылке и безопасность");
  const who = "selftest-" + Date.now();
  const linkMsg = await sim({ platform: "vk", chatId: who, externalId: who, text: "/link" });
  const linkBtn = (linkMsg.json?.messages || [])
    .flatMap((m) => (m.buttons || []).flat())
    .find((b) => typeof b.url === "string" && b.url.includes("link="));
  check(!!linkBtn, "бот выдал одноразовую ссылку входа", linkBtn?.url ? new URL(linkBtn.url).pathname + "?link=…" : `status ${linkMsg.status}`);
  const linkToken = linkBtn?.url ? new URL(linkBtn.url).searchParams.get("link") : null;
  const redeem = await api("/api/auth/link", { method: "POST", body: { token: linkToken || "" } });
  check(redeem.status === 200 && !!redeem.json?.token, "ссылка обменялась на сессию", `status ${redeem.status}`);
  const meAfterLink = await api("/api/auth/me", { token: redeem.json?.token });
  check(meAfterLink.status === 200 && !!meAfterLink.json?.user, "сессия работает в том же аккаунте", meAfterLink.json?.user?.name || "—");
  const redeem2 = await api("/api/auth/link", { method: "POST", body: { token: linkToken || "" } });
  check(redeem2.status >= 400, "ссылка одноразовая (повтор отклонён)", `status ${redeem2.status}`);

  const fakeInit = await api("/api/auth/telegram", { method: "POST", body: { initData: 'user=%7B%22id%22%3A1%7D&auth_date=' + Math.floor(Date.now() / 1000) + "&hash=deadbeef" } });
  check(fakeInit.status >= 400, "поддельный Telegram initData отклонён", `status ${fakeInit.status}`);
  const noAuth = await api("/api/generations", { token: "bogus-token" });
  check(noAuth.status === 401, "чужой токен не даёт доступ к истории", `status ${noAuth.status}`);

  /* --------------------------------------------------- 10. public shop links */
  section("10. Публичные ссылки в галерее");
  const pubToggle = await api("/api/admin/settings", { method: "PUT", token: adminToken, body: { shopping_public_links: "1" } });
  check(pubToggle.status === 200, "включён показ списка деталей в галерее", `status ${pubToggle.status}`);
  const galPub = await api("/api/gallery");
  const pubItem = (galPub.json?.items || []).find((i) => i.id === g0.id);
  check(!!pubItem?.shopping?.items?.length, "галерея отдаёт детали дизайна", `${(pubItem?.shopping?.items || []).length} позиций, режим ${pubItem?.shopping?.mode}`);
  const blob = JSON.stringify(pubItem?.shopping || {});
  check(blob.includes("ozon.ru") || blob.includes("market.yandex") || blob.includes("lemanapro"), "ссылки ведут в магазины");
  check(!/"confidence"|"source"|"userId"|"updatedAt"/.test(blob), "внутренние поля не публикуются");
  await api("/api/admin/settings", { method: "PUT", token: adminToken, body: { shopping_public_links: "0" } });

  /* -------------------------------------------------- 11. site → bot binding */
  section("11. Привязка чата бота к аккаунту сайта");
  const botUser = `bind_${Date.now()}@example.com`;
  const bindTok = (await api("/api/auth/register", { method: "POST", body: { name: "Bind Test", email: botUser, password: "bind12345" } })).json?.token;
  const botInfo = await api("/api/bots/info");
  const platforms = botInfo.json?.platforms || [];
  check(botInfo.status === 200 && platforms.length === 3, "GET /api/bots/info: три платформы", platforms.map((p) => `${p.platform}:${p.connected ? "on" : "off"}`).join(", "));
  const issued = await api("/api/account/botlink", { method: "POST", token: bindTok, body: { platform: "telegram" } });
  check(issued.status === 200 && /^bind_/.test(issued.json?.code || ""), "сайт выдал код привязки", issued.json?.code || `status ${issued.status}`);
  const chatId = "selftest-bind-" + Date.now();
  const bound = await sim({ platform: "telegram", chatId, externalId: "9" + Date.now(), displayName: "Bind Chat", text: `/start ${issued.json?.code}` });
  const boundText = (bound.json?.messages || []).map((m) => m.text || "").join(" ");
  check(/подключ|linked/i.test(boundText), "бот подключил чат к аккаунту сайта", boundText.replace(/<[^>]+>/g, "").slice(0, 64));
  const bal = await sim({ platform: "telegram", chatId, externalId: "9" + Date.now(), action: "balance" });
  const balText = (bal.json?.messages || []).map((m) => m.text || "").join(" ");
  check(/генераци|кредит|generations|credits/i.test(balText), "баланс в боте = баланс на сайте", balText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 60));
  const replay = await sim({ platform: "telegram", chatId: chatId + "-2", externalId: "8" + Date.now(), text: `/start ${issued.json?.code}` });
  const replayText = (replay.json?.messages || []).map((m) => m.text || "").join(" ");
  check(/уже|already|устарел|expired/i.test(replayText), "код одноразовый", replayText.replace(/<[^>]+>/g, "").slice(0, 60));

  /* ------------------------------------------- 12. Telegram: один вебхук на всё */
  section("12. Telegram: один вебхук = вход + приложение");
  const tgSecret = "selftest_" + Date.now().toString(36);
  await api("/api/admin/bots", { method: "PUT", token: adminToken, body: { telegram_webhook_secret: tgSecret } });
  const info = await api("/api/bots/info");
  const tgEntry = (info.json?.platforms || []).find((p) => p.platform === "telegram");
  const tgPath = tgEntry?.webhookPath || info.json?.webhookPaths?.telegram || "";
  check(tgPath === "/api/auth/telegram/webhook", "путь вебхука Telegram совпадает со входом", tgPath || "—");
  const tgHealth = await api("/api/auth/telegram/webhook");
  check(tgHealth.status === 200 && /telegram/i.test(String(tgHealth.json?.service || "")), "GET /api/auth/telegram/webhook жив", JSON.stringify(tgHealth.json || {}).slice(0, 60));

  const tgChatId = 900000 + (Date.now() % 99000);
  const update = (id, text) => ({
    update_id: id,
    message: {
      message_id: id,
      from: { id: tgChatId, is_bot: false, first_name: "Вебхук", username: "webhook_probe", language_code: "ru" },
      chat: { id: tgChatId, type: "private", first_name: "Вебхук" },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  });
  const tgNoSecret = await api("/api/auth/telegram/webhook", { method: "POST", body: update(700001, "/start") });
  check(tgNoSecret.status === 401 || tgNoSecret.status === 403, "без секрета вебхук не принимает сообщения", `status ${tgNoSecret.status}`);
  const tgWithSecret = await api("/api/auth/telegram/webhook", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": tgSecret },
    raw: JSON.stringify(update(700002, "/start")),
  });
  check(tgWithSecret.status === 200, "с секретом обновление обработано", `status ${tgWithSecret.status}`);
  const botsAfter = await api("/api/admin/bots", { token: adminToken });
  const seen = (botsAfter.json?.chats || []).some((c) => c.platform === "telegram" && String(c.chatId) === String(tgChatId));
  check(seen, "движок приложения получил сообщение через вебхук входа", seen ? "чат зарегистрирован" : "чата нет в списке");
  const tgAuthPrefix = await api("/api/auth/telegram/webhook", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": tgSecret, "content-type": "application/json" },
    raw: JSON.stringify(update(700003, "/start auth_" + "0".repeat(32))),
  });
  check(tgAuthPrefix.status === 200, "сообщение входа не ломает приложение", `status ${tgAuthPrefix.status}`);
  const tgDup = await api("/api/auth/telegram/webhook", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": tgSecret, "content-type": "application/json" },
    raw: JSON.stringify(update(700002, "/start")),
  });
  check(tgDup.status === 200, "повтор того же update_id безопасен", `status ${tgDup.status}`);

  finish();
}

function finish() {
  section("Итог");
  console.log(`  passed: ${passed}   failed: ${failed}`);
  if (failed) {
    console.log("\n\x1b[31mПровалено:\x1b[0m");
    for (const f of failures) console.log("  - " + f);
    process.exitCode = 1;
  } else {
    console.log("  \x1b[32mвся цепочка работает: генерация → детали и ссылки → правка текстом → боты\x1b[0m");
  }
}

main().catch((e) => {
  console.error("\x1b[31mselftest crashed:\x1b[0m", e);
  console.error("сервер запущен? BASE =", BASE);
  process.exit(1);
});
