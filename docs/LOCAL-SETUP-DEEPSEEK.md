# Локальная разработка: Claude Code + DeepSeek через Free Claude Code

Инструкция, как поднять проект `interier` у себя на компьютере и работать над ним
в Claude Code, где вместо моделей Anthropic отвечает **DeepSeek**. Прокси между
Claude Code и DeepSeek — [Free Claude Code (FCC)](https://github.com/Alishahryar1/free-claude-code).

Схема:

```
Claude Code (терминал / VS Code)  →  FCC (локальный прокси на вашем ПК)  →  api.deepseek.com
```

FCC даёт: каталог моделей от 50+ провайдеров, переключение модели через `/model`
прямо в Claude Code, резервные модели при сбое провайдера, Admin UI в браузере.
Если FCC вам не нужен — в конце есть **План Б**: официальный способ DeepSeek без прокси.

---

## 0. Что понадобится

| Что | Зачем | Проверка |
| --- | --- | --- |
| **Node.js 22 LTS** — <https://nodejs.org/en/download> | проект `interier` и Claude Code (через npm) | `node -v` → `v22.x` |
| **Git** — <https://git-scm.com/download/win> (Windows: Git for Windows обязателен, Claude Code использует Git Bash) | клонирование, работа Claude Code | `git --version` |
| **Ключ DeepSeek API** — <https://platform.deepseek.com/api_keys> | модель | баланс > 0 на platform.deepseek.com |
| Windows: PowerShell 5.1+ (есть в системе) или PowerShell 7 | установщик FCC | `$PSVersionTable.PSVersion` |

> **Про Россию.** Сайты `claude.ai` / `anthropic.com` могут быть недоступны из РФ,
> поэтому Claude Code ставим **через npm до запуска установщика FCC** (шаг 2).
> Установщик FCC увидит уже установленный `claude` в PATH и не будет ходить на `claude.ai`.
> `api.deepseek.com`, `github.com`, `astral.sh` (uv) и реестр npm из РФ доступны.

---

## 1. Ключ DeepSeek и выбор модели

1. Зарегистрируйтесь на <https://platform.deepseek.com>, пополните баланс (**Top up**),
   создайте ключ в **API keys**. Ключ показывается один раз — сохраните.
2. Актуальные модели DeepSeek API (официальная документация, сентябрь 2026):

| Имя в API | Что это | Цена off-peak / peak за 1M токенов (вход без кэша · выход) | Когда брать |
| --- | --- | --- | --- |
| `deepseek-flash` | DeepSeek-V4.1-Flash, контекст 1M, есть vision и tool calls | $0.15 / $0.30 · $0.60 / $1.20 | **по умолчанию** — быстро и дёшево |
| `deepseek-v4-pro` | DeepSeek-V4-Pro, контекст 1M, tool calls | $0.66 / $1.32 · $1.98 / $3.96 | сложный рефакторинг, архитектурные задачи |

Старые имена `deepseek-chat` / `deepseek-reasoner` в документации больше не значатся —
используйте новые. Оба режима поддерживают «thinking» (включён по умолчанию).

> **Лайфхак для Иркутска (UTC+8).** Peak-часы DeepSeek: 01:00–04:00 и 06:00–10:00 UTC
> по будням, то есть **09:00–12:00 и 14:00–18:00 по Иркутску**. В остальное время
> (вечер, ночь, выходные) цены **вдвое ниже**.

Если оплатить DeepSeek напрямую российской картой не получится (DeepSeek принимает
международные карты, PayPal, Alipay, WeChat Pay), те же модели DeepSeek есть у других
провайдеров из каталога FCC — например `zenmux/deepseek/deepseek-v4-flash-free` (ZenMux),
`nvidia_nim/…` (NVIDIA NIM, бесплатный тариф), `open_router/…` (OpenRouter). Настраиваются
в том же Admin UI, только другой ключ и другой префикс модели.

---

## 2. Установить Claude Code (через npm — до FCC)

Windows (PowerShell) / macOS / Linux:

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

Если `claude` не находится после установки — перезапустите терминал; если и после
этого нет, добавьте в PATH каталог из `npm config get prefix` (Windows — сам каталог,
macOS/Linux — `<prefix>/bin`).

`claude` **не запускайте и не логиньтесь** — запускать будем через `fcc-claude`.

---

## 3. Установить Free Claude Code

**Windows — PowerShell (обычный, не от администратора):**

```powershell
& ([scriptblock]::Create((irm "https://raw.githubusercontent.com/Alishahryar1/free-claude-code/main/scripts/install.ps1")))
```

**macOS / Linux:**

```bash
curl -fsSL "https://raw.githubusercontent.com/Alishahryar1/free-claude-code/main/scripts/install.sh" | sh
```

Установщик сам ставит `uv` и Python 3.14 (в свою папку, систему не трогает) и задаёт
вопросы. Отвечайте так:

| Вопрос | Ответ |
| --- | --- |
| Install or verify **Claude Code** for fcc-claude? | **Y** (найдёт уже установленный) |
| Codex / Pi / OpenCode / Cline / Hermes / Grok Build / Muse Code / Aider | **N** |
| **DeepSeek Harness** for fcc-dsh? | **N** (можно Y — это собственный агент DeepSeek, отдельный от Claude Code; требует Node 22.19+) |
| Enable **RTK** token optimization? | **N** для начала (Y — режет вывод команд в терминале до 90 % токенов; можно включить позже, повторив установку с `-Rtk` / `--rtk`) |

Повторный запуск той же команды = обновление FCC.

> Windows: если PowerShell ругается на политику выполнения, один раз выполните
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` и повторите команду.

---

## 4. Запустить FCC и подключить DeepSeek

1. Запустите FCC:
   - **Windows** — ярлык **Free Claude Code** на рабочем столе / в меню «Пуск» (появится иконка в трее: Open Admin / Restart / Quit).
   - **macOS** — **Free Claude Code** в Applications (иконка в строке меню).
   - **Linux** — в терминале `fcc-server`; терминал держите открытым, адрес Admin UI будет в логе.
2. Откроется **Admin UI** в браузере (только с этого компьютера).
3. **Providers** → найдите **DeepSeek** → вставьте ключ в `DEEPSEEK_API_KEY`.
4. **Model Config** → `MODEL` → в выпадающем списке наберите `deepseek` → выберите
   **`deepseek/deepseek-flash`**. Если списка нет — введите вручную `deepseek/deepseek-flash`.
5. Нажмите **Apply**.

Рекомендуемая раскладка по «уровням» Claude Code (необязательно, там же в Model Config):

| Настройка | Значение | Эффект |
| --- | --- | --- |
| `MODEL` | `deepseek/deepseek-flash` | всё по умолчанию |
| `MODEL_OPUS` | `deepseek/deepseek-v4-pro` | `/model opus` в Claude Code = сильная модель для сложных задач |
| `MODEL_SONNET` | `None` (наследует `MODEL`) | |
| `MODEL_HAIKU` | `None` (наследует `MODEL`) | |
| **Reasoning** | `From client` (по умолчанию) | глубина размышлений управляется из Claude Code; можно жёстко задать `Medium` / `High` |
| **Fallback Models** | пусто, либо запасной провайдер | при сбое DeepSeek FCC сам переключится (расходует баланс запасного провайдера) |

Опция **Proxy Authentication** (bearer-токен на локальный прокси) нужна только если
на компьютере работают другие люди/сервисы.

---

## 5. Склонировать и запустить проект `interier`

```bash
git clone https://github.com/HA-Baykal/interier.git
cd interier
npm ci
```

Файл настроек:

```powershell
# Windows PowerShell
Copy-Item .env.example .env.local
```

```bash
# macOS / Linux
cp .env.example .env.local
```

`.env.local` в git не попадает. Для локальной работы менять в нём ничего не обязательно:
`GENERATION_MODE=demo` — генерация идёт без платных API, база — файл `data/app.json`,
загрузки — `data/uploads/` (создаются сами).

Запуск и проверки:

```bash
npm run dev          # http://localhost:3000 (dev-сервер с горячей перезагрузкой)
npm run typecheck    # tsc --noEmit
npm test             # ~155 тестов, ключи и платные API не нужны
npm run build && npm start   # продакшен-сборка
```

Тестовая админка: `admin@interier.ru` / `admin123` (задаётся `ADMIN_EMAIL` / `ADMIN_PASSWORD`
в `.env.local`; перед публичным запуском смените). Реальная генерация через gen-api.ru:
см. README → «Подключение реальной ИИ-генерации (оплата из России)».

---

## 6. Работа: Claude Code на DeepSeek в папке проекта

FCC должен быть запущен (иконка в трее / `fcc-server`). Затем:

```bash
cd interier
fcc-claude
```

Открывается обычный Claude Code, но запросы идут в DeepSeek. Полезное:

- `/model` — выбрать любую модель из каталога FCC прямо в сессии.
- `/status` — убедиться, что подключение идёт через FCC (локальный адрес), а не в Anthropic.
- В корне репозитория лежит `CLAUDE.md` — Claude Code читает его автоматически; там
  команды, структура и правила проекта. Историю прошлых сессий см. `.claude-session-memory.md`.
- Первая проверка: `Прочитай CLAUDE.md и объясни, как устроена генерация дизайна в этом проекте.`

**VS Code.** Установите расширение
[Claude Code](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code),
затем в Admin UI FCC → **Integrations** → карточка Claude Code → **Connect**, перезагрузите
VS Code. Расширение начнёт работать через FCC/DeepSeek. **Disconnect** там же откатывает.

Если Claude Code вдруг просит войти в аккаунт Anthropic — вы запустили `claude`, а не
`fcc-claude`, либо FCC не запущен.

---

## 7. План Б: DeepSeek напрямую, без FCC

DeepSeek официально поддерживает формат Anthropic API, поэтому Claude Code можно
направить на DeepSeek одними переменными окружения (документация:
<https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code>).

Самый удобный способ — прописать их в `~/.claude/settings.json`
(Windows: `C:\Users\<вы>\.claude\settings.json`), тогда они действуют для каждой сессии:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "sk-ваш-ключ-deepseek",
    "ANTHROPIC_MODEL": "deepseek-flash[1m]",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-v4-pro[1m]",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-flash[1m]",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-flash",
    "CLAUDE_CODE_SUBAGENT_MODEL": "deepseek-flash",
    "CLAUDE_CODE_EFFORT_LEVEL": "max",
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "786432"
  }
}
```

(Официальный пример DeepSeek ставит `deepseek-flash[1m]` и для Opus; `deepseek-v4-pro[1m]`
здесь — чтобы `/model opus` давал сильную модель. Суффикс `[1m]` включает контекст 1M.)

Или на одну сессию терминала:

```powershell
# Windows PowerShell
$env:ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"
$env:ANTHROPIC_AUTH_TOKEN="sk-ваш-ключ-deepseek"
$env:ANTHROPIC_MODEL="deepseek-flash[1m]"
cd interier; claude
```

```bash
# macOS / Linux
export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
export ANTHROPIC_AUTH_TOKEN=sk-ваш-ключ-deepseek
export ANTHROPIC_MODEL="deepseek-flash[1m]"
cd interier && claude
```

Плюс плана Б: минимум движущихся частей, DeepSeek сам маппит имена `claude-opus*` →
`deepseek-v4-pro`, `claude-sonnet*/haiku*` → `deepseek-flash`. Минус: нет каталога других
провайдеров и авто-фолбэков. FCC и план Б не конфликтуют, если не задавать
`ANTHROPIC_BASE_URL` глобально при работе через `fcc-claude`.

---

## 8. Обновление и удаление FCC

- **Обновить** — повторить команду установки из шага 3.
- **Версия** — `fcc-server --version`.
- **Удалить** (остаются uv, Python, Claude Code):

```powershell
& ([scriptblock]::Create((irm "https://raw.githubusercontent.com/Alishahryar1/free-claude-code/main/scripts/uninstall.ps1")))
```

```bash
curl -fsSL "https://raw.githubusercontent.com/Alishahryar1/free-claude-code/main/scripts/uninstall.sh" | sh
```

---

## 9. Типичные проблемы

| Симптом | Причина / решение |
| --- | --- |
| Установщик FCC падает на «Claude Code» / не открывается `claude.ai` | Поставьте Claude Code через npm (шаг 2) и запустите установщик снова — он только проверит уже установленный `claude`. |
| `claude` / `fcc-claude` — «команда не найдена» | Перезапустите терминал (PATH обновляется при новом запуске). Windows: проверьте `%USERPROFILE%\.local\bin` и каталог `npm config get prefix` в PATH. |
| Windows: `running scripts is disabled` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, затем повторить. |
| Claude Code просит логин Anthropic | Запущен `claude` вместо `fcc-claude`, или FCC не запущен. |
| Ошибка `402` / `Insufficient Balance` | Закончился баланс DeepSeek → Top up на platform.deepseek.com. |
| Модели `deepseek/...` нет в списке Admin UI | Введите `deepseek/deepseek-flash` вручную и нажмите Apply. Проверьте, что ключ сохранён. |
| Медленные/обрывающиеся ответы | Peak-часы DeepSeek (см. п. 1) или сеть; добавьте Fallback Models или переключитесь через `/model`. |
| `npm run dev`: порт 3000 занят | `npm run dev -- -p 3001`. FCC использует свой порт, с проектом не пересекается. |
| Windows: Claude Code жалуется на отсутствие Git Bash | Установите Git for Windows (со стандартными настройками) и перезапустите терминал. |
