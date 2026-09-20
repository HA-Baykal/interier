# CLAUDE.md — правила работы с репозиторием `interier`

Этот файл Claude Code (в т.ч. через Free Claude Code + DeepSeek) читает автоматически.
Локальная настройка окружения: `docs/LOCAL-SETUP-DEEPSEEK.md`.

## Что это за проект

Interier — сервис «дизайн интерьера по фото»: пользователь загружает фото комнаты,
получает реалистичный дизайн-проект в выбранном стиле, список деталей интерьера со
ссылками на магазины. Есть сайт, PWA, мини-приложения и боты Telegram / VK / MAX,
админ-панель. Продукт для российского рынка: интерфейс и документация — на русском
(английский — вторая локаль).

## Стек

- Next.js 14 (App Router) + React 18 + TypeScript `strict`. Алиас `@/*` → `src/*`.
- Хранилище двухрежимное (`src/lib/db.ts`, `src/lib/storage-config.ts`):
  локально — файл `data/app.json` + `data/uploads/`; в облаке (Vercel) — Upstash Redis
  (вся БД одним JSON-документом) + Vercel Blob. Настроенное облако **никогда** не
  должно молча падать в локальный режим.
- Генерация (`src/lib/generation/`): режимы `demo` (без API, стилизация на клиенте),
  `compatible` (gen-api.ru, оплата в рублях — основной для РФ), `replicate`.
- Настройки живут в БД (`DEFAULT_SETTINGS` в `src/lib/config.ts`), env — только запасной
  источник. Секреты никогда не называть `NEXT_PUBLIC_*`.

## Команды

```bash
npm ci                 # зависимости (Node.js 22)
npm run dev            # dev-сервер http://localhost:3000
npm run typecheck      # tsc --noEmit
npm test               # node:test через tsx, tests/*.test.ts, последовательно
npm run build          # продакшен-сборка (обязательна перед крупными PR)
npm run selftest       # сквозная самопроверка запущенного сервера (scripts/selftest.mjs)
npm run doctor         # чек-лист внешней конфигурации (scripts/doctor.mjs)
npm run test:browser   # браузерный smoke, см. docs/TESTING.md
```

Перед завершением задачи: `npm run typecheck && npm test`; при изменениях в сборке/роутах —
ещё `npm run build`.

## Структура

- `src/app/` — страницы: `/` (лендинг), `/studio`, `/gallery`, `/account`, `/admin`,
  `/login`, `/register`, `/app` (мини-приложение для мессенджеров).
- `src/app/api/` — route handlers: `auth`, `account`, `admin`, `bots`, `generate`,
  `generations`, `gallery`, `styles`, `rewards`, `marketplaces`, `upload`, `uploads`, `lang`.
- `src/components/` — клиентские компоненты (`Studio`, `Admin*`, `MiniApp`, `DesignItems`,
  `ModelLab`, `locale-context` и др.).
- `src/lib/` — доменная логика: `auth`, `db`, `config`, `bootstrap` (сидит админа),
  `billing`, `i18n`/`locale`, `marketplaces` + `shopping` (ссылки на магазины),
  `bots/` (Telegram/VK/MAX: engine, dispatch, setup, poller), `telegram/` (вход через
  Telegram), `generation/` (pipeline, provider, vision, items).
- `tests/` — тесты; `tests/helpers.ts` → `isolateStorage()` изолирует env и БД.
- `docs/` — PLATFORMS.md (боты и мини-приложения), TELEGRAM-LOGIN.md, VERCEL-SETUP.md,
  TESTING.md, HOSTING-CAPACITY.md, LOCAL-SETUP-DEEPSEEK.md.
- `.claude-session-memory.md` — заметки предыдущих сессий (боты, ссылки на магазины,
  ручное редактирование деталей). Читать при работе над этими областями.

## Правила

1. Тесты и сборка **не должны** обращаться к реальным провайдерам ИИ, Redis, Blob,
   Telegram/VK/MAX. Используй `isolateStorage()` и синтетические ответы, как в
   существующих тестах.
2. Новый API-роут или доменная логика → тест в `tests/`. Существующие тесты не удалять
   и не ослаблять ради «зелёного» прогона.
3. Все пользовательские строки — через словари `src/lib/i18n.ts` (RU обязательно, EN —
   по возможности). Не хардкодить русский текст в JSX, если у экрана уже есть локализация.
4. Не коммитить `.env.local`, `data/`, ключи и токены. `.env.example` — единственное место
   для описания новых переменных окружения (с комментарием на русском).
5. Изменил поведение, которое видит владелец сервиса (запуск, деплой, админка, боты) —
   обнови `README.md` и соответствующий файл в `docs/`.
6. Не переписывать архитектуру хранилища, генерации или ботов без явной просьбы;
   предпочитать точечные правки в существующих модулях.
7. Ветки/PR: работать в текущей рабочей ветке, не сливать в `main` без разрешения владельца.
