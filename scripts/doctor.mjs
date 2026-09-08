#!/usr/bin/env node
/**
 * Production readiness doctor for the messenger apps.
 *
 *   node scripts/doctor.mjs --base https://interier-fmbx.onrender.com
 *   node scripts/doctor.mjs --base http://127.0.0.1:3000 --admin admin@interier.ru:admin123
 *
 * It checks the *running deployment* the way Telegram/VK/MAX will see it: is the
 * public URL https, does /app answer and load the WebApp SDK, is the webhook
 * registered on the right host, is it protected by a secret, do getMe calls
 * succeed, are shopping links and the vision model configured, and whether the
 * database will survive a restart. Ends with a numbered punch list.
 */

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BASE = (arg("base", process.env.BOT_BASE_URL || "http://127.0.0.1:3000")).replace(/\/+$/, "");
const ADMIN = arg("admin", process.env.ADMIN_CREDENTIALS || "admin@interier.ru:admin123");

const results = [];
const add = (level, area, text, fix) => results.push({ level, area, text, fix });
const isHttps = /^https:\/\//i.test(BASE);

async function get(path, token) {
  try {
    const res = await fetch(BASE + path, {
      method: "GET",
      headers: token ? { "x-session-token": token } : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* html */
    }
    return { status: res.status, json, text };
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

async function post(path, body, { token, headers } = {}) {
  try {
    const res = await fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "x-session-token": token } : {}), ...(headers || {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* html */
    }
    return { status: res.status, json, text };
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

async function main() {
  console.log(`\nInterier · проверка боевого запуска\n${BASE}\n${"─".repeat(52)}`);

  /* --- 1. the site itself ------------------------------------------------ */
  const root = await get("/");
  if (root.status === 200) add("ok", "сайт", "отвечает 200");
  else add("fail", "сайт", `не отвечает (status ${root.status}${root.error ? ": " + root.error : ""})`, "проверьте, что сервис запущен и домен ведёт на него");

  /* --- 2. https ---------------------------------------------------------- */
  if (isHttps) add("ok", "https", "публичный адрес по HTTPS — вебхуки примут его");
  else
    add(
      "warn",
      "https",
      `адрес ${BASE} без HTTPS`,
      "Telegram, VK и MAX принимают вебхук только на HTTPS: поставьте домен + сертификат (Caddy/nginx или хостинг с авто-сертификатом)"
    );

  /* --- 3. mini app ------------------------------------------------------- */
  const app = await get("/app");
  if (app.status === 200 && app.text.includes("telegram-web-app.js")) add("ok", "мини-апп", "/app отдаёт страницу + Telegram WebApp SDK");
  else add("fail", "мини-апп", `/app → status ${app.status}`, "пересоберите и перезапустите сервис (npm run build && npm start)");

  /* --- 4. storage / persistence ----------------------------------------- */
  const boot = await get("/api/admin/bootstrap");
  const storage = boot.json?.storage;
  if (boot.json?.ephemeralStorage || storage === "memory")
    add("fail", "хранилище", "БД в эфемерной памяти — аккаунты и дизайны исчезнут после рестарта", "Render: подключите Persistent Disk в /opt/render/project/src/data; VPS: DATABASE_PATH на диск; Vercel: Upstash Redis + Blob");
  else if (storage === "redis") add("ok", "хранилище", "Redis/KV — данные переживают рестарт");
  else if (storage === "file") add("ok", "хранилище", "файловая БД (нужен постоянный диск в DATABASE_PATH)");
  else add("warn", "хранилище", `не удалось прочитать режим (${boot.status})`, "откройте /api/admin/bootstrap вручную");

  /* --- 5. admin access --------------------------------------------------- */
  let adminToken = arg("token", "") || null;
  if (!adminToken) {
    const [email, password] = ADMIN.split(":");
    const login = await post("/api/auth/login", { email, password });
    if (login.status === 200 && login.json?.token) {
      adminToken = login.json.token;
      add("ok", "админка", "вход администратора работает");
    } else {
      add("fail", "админка", `не удалось войти (${login.status})`, "ADMIN_EMAIL/ADMIN_PASSWORD не совпадают — задайте их в панели хостинга и перезапустите сервис");
    }
  }

  /* --- 6. bots status (live getMe + webhook) ---------------------------- */
  const bots = adminToken ? await get("/api/admin/bots", adminToken) : { status: 0 };
  const adm = adminToken ? await get("/api/admin/settings", adminToken) : { status: 0 };
  const settings = { ...(adm.json?.settings || {}), ...(bots.json?.raw || {}) };
  const platforms = bots.json?.platforms || [];
  // Telegram is delivered by the login route on purpose: one webhook carries the
  // confirmation of entry and the whole bot application.
  const paths = bots.json?.webhookPaths || {};
  const tgPath = paths.telegram || "/api/auth/telegram/webhook";
  if (bots.status !== 200) {
    add("warn", "боты", "нет данных /api/admin/bots — проверяю только публичные эндпоинты", "нужен токен администратора (--admin email:pass или --token …)");
  }

  for (const p of platforms) {
    const name = p.platform.toUpperCase();
    if (!p.configured) {
      add(
        p.platform === "telegram" ? "fail" : "warn",
        name,
        p.platform === "telegram" ? "токен бота не задан" : "не настроен (подключайте вторым/третьим шагом)",
        p.platform === "telegram"
          ? "@BotFather → /newbot → токен впишите в /admin → «Боты» → telegram_bot_token"
          : `/admin → «Боты» → ${p.platform === "vk" ? "vk_access_token + vk_group_id" : "max_bot_token"}`
      );
      continue;
    }
    if (!p.me) add("warn", name, "токен задан, но getMe не ответил", "проверьте токен и доступность api-хоста из сети сервера");
    else add("ok", name, `подключён: @${p.me.username || p.me.id || "?"}`);

    const expected = `${BASE}${paths[p.platform] || (p.platform === "telegram" ? tgPath : `/api/bots/${p.platform}/webhook`)}`;
    if (p.webhook) {
      const sameHost = (() => {
        try {
          return new URL(p.webhook).host === new URL(BASE).host;
        } catch {
          return false;
        }
      })();
      if (sameHost) add("ok", `${name} вебхук`, p.webhook);
      else add("fail", `${name} вебхук`, `смотрит на ${p.webhook}, а не на ${BASE}`, "исправьте public_base_url и нажмите «Подключить вебхуки» заново");
    } else {
      add("warn", `${name} вебхук`, `не зарегистрирован (ожидается ${expected})`, "нажмите «🔗 Подключить вебхуки» в /admin → Боты");
    }
    if (p.error) add("fail", `${name} доставка`, p.error, `Telegram откладывает доставки при недоступном URL: откройте ${tgPath} в браузере (должен быть JSON с «service»), проверьте сертификат и порт 443`);
  }

  /* --- 6b. who owns the Telegram bot right now -------------------------- */
  // The chat is served by whichever deployment registered the webhook last, so
  // "the bot answers like an old version" is always a webhook-ownership problem.
  const tgProbe = adminToken ? await get("/api/admin/telegram?probe=1", adminToken) : { status: 0 };
  if (tgProbe.status === 200 && tgProbe.json?.webhook) {
    const w = tgProbe.json.webhook;
    const app = tgProbe.json.app || {};
    if (w.ok) add("ok", "telegram webhook", `${w.url} — сообщения доходят на эту версию`);
    else
      add(
        "fail",
        "telegram webhook",
        `[${w.code}] ${String(w.message).split("\n")[0]}`,
        w.code === "not_registered"
          ? "нажмите «Подключить бота к этой версии» в /admin → Telegram"
          : "поставьте флажок переключения и нажмите «Подключить бота к этой версии»"
      );
    if (w.pendingUpdates > 0) add("warn", "telegram очередь", `в Telegram ждут ${w.pendingUpdates} недоставленных сообщений`);
    if (w.originSource === "VERCEL_BRANCH_URL")
      add("warn", "telegram адрес", "публичный адрес берётся из VERCEL_BRANCH_URL и меняется у каждого деплоя", "задайте AUTH_PUBLIC_URL=https://<прод-домен>, затем перезапишите вебхук");
    if (app.appEnabled) add("ok", "telegram приложение", `бот-приложение включено (токен: ${app.tokenSource === "panel" ? "админка" : "env"})`);
    else add("fail", "telegram приложение", "бот-приложение выключено — бот отвечает только на подтверждения входа", "проверьте bots_enabled и telegram_bot_token в /admin → Боты");
    if (app.simulator) add("fail", "telegram симулятор", "bots_simulator=1 — на проде должен быть 0", "выключите в /admin → Боты");
    else add("ok", "telegram симулятор", "bots_simulator=0");
    if (app.name) add("ok", "telegram имя", `setMyName: ${app.name}`);
    else add("warn", "telegram имя", "telegram_name не задан — имя в Telegram осталось от BotFather", "впишите имя в /admin → Боты и нажмите «Применить профиль бота»");
    if (!app.profileAppliedAt) add("warn", "telegram профиль", "профиль бота ещё не отправлялся в Telegram", "«Применить профиль бота» в /admin → Telegram");
  } else if (adminToken) {
    add("warn", "telegram webhook", "диагностика недоступна — нет токена бота", "сохраните telegram_bot_token в /admin → Боты или TELEGRAM_BOT_TOKEN в env");
  }

  /* --- 7. webhook is protected ------------------------------------------ */
  const health = await get(tgPath);
  if (health.status === 200 && health.json?.service) add("ok", "вебхук входа/бота", `${tgPath} отвечает: ${health.json.service}`);
  else add("fail", "вебхук входа/бота", `${tgPath} → ${health.status}`, "на этом адресе Telegram получает и подтверждения входа, и сообщения приложения");
  const probe = await post(tgPath, { update_id: 0, fake: true });
  if (probe.status === 403 || probe.status === 401) add("ok", "безопасность", `вебхук закрыт секретом (${probe.status} без заголовка)`);
  else if (probe.status === 200)
    add(
      "warn",
      "безопасность",
      "telegram_webhook_secret не задан — вебхук принимает любой POST",
      "«Подключить вебхуки» генерирует секрет автоматически: нажмите её и обновите статус"
    );
  else add("warn", "безопасность", `вебхук отвечает ${probe.status}`, `проверьте, что маршрут ${tgPath} доступен и не закрыт защитой Vercel`);

  /* --- 8. mini app url + owner ---------------------------------------- */
  if (settings.telegram_mini_app_url) {
    let same = false;
    try {
      same = new URL(settings.telegram_mini_app_url).host === new URL(BASE).host;
    } catch {
      same = false;
    }
    if (same) add("ok", "мини-апп", `URL бота → ${settings.telegram_mini_app_url}`);
    else add("fail", "мини-апп", `telegram_mini_app_url = ${settings.telegram_mini_app_url} (не тот хост)`, "задайте public_base_url и переподключите вебхуки — кнопка меню обновится сама");
  } else if (platforms.some((p) => p.platform === "telegram" && p.configured)) {
    add("warn", "мини-апп", "адрес приложения не сохранён", "«Подключить вебхуки» ставит его автоматически; либо задайте вручную в /admin");
  }
  if (settings.admin_telegram_id) add("ok", "владелец", `admin_telegram_id = ${settings.admin_telegram_id} (бот выдаст админку автоматически)`);
  else add("fail", "владелец", "admin_telegram_id не задан — админки в боте ни у кого нет", "узнайте id у @userinfobot и впишите в /admin → Боты");

  /* --- 9. simulator must be off in prod -------------------------------- */
  const sim = await post("/api/bots/simulator", { platform: "telegram", text: "/start", chatId: "doctor" });
  if (sim.status === 200) {
    if (isHttps) add("warn", "безопасность", "симулятор бота доступен снаружи (bots_simulator=1)", "выключите в /admin → Боты, когда закончите проверку");
    else add("ok", "симулятор", "доступен на локальном сервере — удобно для проверки");
  } else if (sim.status === 403) add("ok", "симулятор", "в проде закрыт (403) — так и должно быть");

  /* --- 10. shopping + vision ------------------------------------------- */
  const mk = await get("/api/marketplaces");
  const enabled = mk.json?.enabled || [];
  if (!enabled.length) add("fail", "магазины", "не включён ни один магазин", "/admin → «Список деталей и магазины»");
  else add("ok", "магазины", `включены: ${enabled.map((m) => m.id).join(", ")}`);

  const shoppingOn = settings.shopping_enabled !== "0";
  if (!shoppingOn) add("fail", "детали", "подбор деталей выключен (shopping_enabled=0)", "включите в /admin → «Список деталей и магазины»");
  const vision = settings.vision_model || "";
  const visionKey = settings.vision_api_key || settings.compatible_api_key || "";
  if (settings.vision_enabled === "0")
    add("warn", "визор", "ИИ-разметка картинки выключена → список будет без хотспотов", "включите vision_enabled и задайте мультимодальную модель");
  else if (!visionKey) add("warn", "визор", "нет ключа ИИ → детали эвристикой, хотспотов не будет", "задайте compatible_api_key (или vision_api_key) в /admin → Настройки");
  else add("ok", "визор", `модель ${vision || "gpt-4o-mini"}, ключ задан → хотспоты доступны`);

  if (settings.generation_mode === "demo" || !settings.generation_mode)
    add("warn", "генерация", `режим «${settings.generation_mode || "demo"}» — это предпросмотр, не настоящий ИИ`, "GENERATION_MODE=compatible + COMPATIBLE_API_KEY");
  else add("ok", "генерация", `режим ${settings.generation_mode}`);
  if (settings.test_unlimited === "1") add("warn", "биллинг", "безлимитный тестовый режим включён", "выключите перед публичным запуском, иначе кредиты не тратятся");

  /* --- 11. styles -------------------------------------------------------- */
  const styles = await get("/api/styles");
  const n = (styles.json?.styles || []).length;
  if (n > 0) add("ok", "стили", `${n} активных стилей`);
  else add("fail", "стили", "нет ни одного активного стиля — генерация невозможна", "/admin → Стили → включить нужные");
}

function report() {
  const icon = { ok: "\x1b[32m✓\x1b[0m", warn: "\x1b[33m!\x1b[0m", fail: "\x1b[31m✗\x1b[0m" };
  let lastArea = "";
  for (const r of results) {
    if (r.area !== lastArea) {
      console.log(`\n${r.area}`);
      lastArea = r.area;
    }
    console.log(`  ${icon[r.level]} ${r.text}`);
  }
  const todo = results.filter((r) => r.level !== "ok");
  console.log(`\n${"─".repeat(52)}`);
  if (!todo.length) {
    console.log("  \x1b[32mГотово к запуску: ничего не осталось — можно писать боту.\x1b[0m\n");
    return;
  }
  console.log(`  Осталось ${todo.length} шт:\n`);
  todo.forEach((r, i) => console.log(`   ${i + 1}. ${r.fix || r.text}`));
  console.log("");
  if (results.some((r) => r.level === "fail")) process.exitCode = 1;
}

main().then(report).catch((e) => {
  console.error("докер упал:", e.message, "— сервер запущен? BASE =", BASE);
  process.exit(1);
});
