# Windows: Claude Code на модели DeepSeek через Free Claude Code

Как пользоваться Claude Code, когда вместо моделей Anthropic отвечает **DeepSeek**.
Прокси между Claude Code и DeepSeek — [Free Claude Code (FCC)](https://github.com/Alishahryar1/free-claude-code).

```
Claude Code (в окне терминала или VS Code)  →  FCC (иконка в трее, Admin UI)  →  api.deepseek.com
```

Ключевой момент: **Claude Code — консольная программа.** У неё нет своего окна и ярлыка.
Окно Free Claude Code / Admin UI — это только настройки прокси. Сам чат с моделью
запускается **из терминала** командой `fcc-claude` (или внутри VS Code).

---

## 1. Настройка в Admin UI (один раз)

1. Запустите **Free Claude Code** (ярлык на рабочем столе или в меню «Пуск»). В трее
   появится иконка; из неё — **Open Admin**. Пока иконка в трее, прокси работает.
2. **Providers → DeepSeek** → вставьте ключ в `DEEPSEEK_API_KEY`.
3. **Model Config → `MODEL`** → в выпадающем списке наберите `deepseek` и выберите
   **`deepseek/deepseek-flash`**. Если списка нет — введите вручную `deepseek/deepseek-flash`.
   Это обязательно: по умолчанию стоит `nvidia_nim/...`, для которого нужен ключ NVIDIA,
   и без смены модели запросы будут падать.
4. Нажмите **Apply**.

Необязательно, но удобно:

| Настройка | Значение | Эффект |
| --- | --- | --- |
| `MODEL_OPUS` | `deepseek/deepseek-v4-pro` | команда `/model opus` в Claude Code даст сильную (и более дорогую) модель |
| `MODEL_SONNET`, `MODEL_HAIKU` | `None` | наследуют `MODEL` |
| **Reasoning** | `From client` (по умолчанию) | можно жёстко поставить `Medium` / `High` |
| **Fallback Models** | пусто | запасные модели при сбое провайдера |

Модели DeepSeek API на сентябрь 2026 (официальная документация): `deepseek-flash`
(DeepSeek-V4.1-Flash, контекст 1M, vision, дёшево) и `deepseek-v4-pro` (сильнее, ~4× дороже).
Старые имена `deepseek-chat` / `deepseek-reasoner` в документации больше не значатся.

> Peak-часы DeepSeek: 01:00–04:00 и 06:00–10:00 UTC по будням — это **09:00–12:00 и
> 14:00–18:00 по Иркутску**. В остальное время (вечер, ночь, выходные) цены вдвое ниже.

---

## 2. Проверить, что Claude Code установлен

Откройте новый терминал: **Win + X → «Терминал»** (или найдите в «Пуске» *PowerShell*).
Введите:

```powershell
claude --version
fcc-claude --help
```

- Обе команды отвечают → переходите к шагу 3.
- `claude` **не распознаётся** → установите Claude Code через npm (сайт `claude.ai`
  из России может не открываться, npm-путь работает):
  1. Установите [Node.js LTS](https://nodejs.org/en/download) и
     [Git for Windows](https://git-scm.com/download/win) (со стандартными настройками —
     Claude Code использует Git Bash).
  2. В **новом** терминале:
     ```powershell
     npm install -g @anthropic-ai/claude-code
     claude --version
     ```
- `fcc-claude` **не распознаётся**, хотя FCC установлен → закройте и откройте терминал
  заново (PATH обновляется только в новом окне). Команды FCC лежат в
  `%USERPROFILE%\.local\bin`; если и так не видно — добавьте этот каталог в PATH или
  повторите установку FCC.

---

## 3. Запуск Claude Code

1. Убедитесь, что FCC запущен (иконка в трее).
2. В терминале перейдите в папку, с файлами которой хотите работать — Claude Code видит
   и правит файлы **только текущей папки**:
   ```powershell
   cd C:\путь\к\вашему\проекту
   ```
   Просто попробовать — создайте пустую папку:
   ```powershell
   mkdir C:\Projects\test; cd C:\Projects\test
   ```
3. Запустите:
   ```powershell
   fcc-claude
   ```
   `fcc-claude` — это обычный Claude Code, которому FCC подставил адрес локального прокси.
   Логин в аккаунт Anthropic не нужен и не должен спрашиваться.
4. При первом запуске Claude Code спросит цветовую тему и «доверяете ли вы файлам в этой
   папке» — ответьте и пишите задачу по-русски в строке ввода. Например:
   `Посмотри файлы в этой папке и расскажи, что здесь лежит.`

Полезные команды внутри Claude Code:

| Команда | Что делает |
| --- | --- |
| `/status` | показывает, куда идут запросы — должен быть локальный адрес FCC, не api.anthropic.com |
| `/model` | выбрать любую модель из каталога FCC прямо в сессии (в том числе `deepseek/deepseek-v4-pro`) |
| `/help` | список команд |
| `Ctrl + C` дважды или `/exit` | выйти |

Каждый следующий раз: FCC в трее → терминал → `cd` в папку → `fcc-claude`.

---

## 4. Вариант в VS Code (вместо терминала)

1. Установите расширение
   [Claude Code](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code).
2. В Admin UI FCC → **Integrations** → карточка **Claude Code** → **Connect**.
3. Перезагрузите VS Code (`Ctrl + Shift + P` → *Reload Window*). Иконка Claude в боковой
   панели теперь общается с DeepSeek через FCC. **Disconnect** на той же карточке всё откатывает.

FCC должен быть запущен и в этом случае.

**Про список моделей в VS Code.** Расширение показывает родные названия Claude
(Default / Opus / Sonnet / Haiku) — DeepSeek там искать не нужно. FCC подменяет их сам:
запрос «Sonnet» (и «Default», «Haiku») → модель из поля `MODEL` в Admin UI, «Opus» →
`MODEL_OPUS`, если задан, иначе тоже `MODEL`. То есть в VS Code выбираете **Sonnet**,
а DeepSeek настроен в админке — этого достаточно.

Дополнительно FCC добавляет в этот список свои модели (пункты с подписью *Custom model* /
*From gateway*) — но только те, что есть в его каталоге: заданные в `MODEL` / `MODEL_*` /
Fallback Models и найденные у провайдеров с рабочим ключом. Если там висит чужая модель
(например `sambanova/Meta-Llama-3.3-70B-Instruct` — пример из документации FCC), значит
она прописана в `MODEL` вместо DeepSeek: исправьте поле, нажмите **Apply**, перезагрузите
VS Code и не выбирайте этот пункт — без ключа SambaNova запросы к нему упадут.

Проверка, что отвечает DeepSeek: Admin UI → **Providers** → карточка DeepSeek показывает
число моделей (а не «Could not load models»); в чате спросите «Какая ты модель и кто тебя
разработал?» — DeepSeek обычно называет себя.

---

## 5. Типичные проблемы

| Симптом | Причина / решение |
| --- | --- |
| Claude Code просит войти в аккаунт Anthropic | Запущен `claude` вместо `fcc-claude`, или FCC не запущен (нет иконки в трее). |
| Ошибка про `nvidia_nim` / отсутствующий ключ NVIDIA | В Admin UI не сменили `MODEL` на `deepseek/deepseek-flash` или не нажали **Apply**. |
| `402` / `Insufficient Balance` | Закончился баланс DeepSeek → **Top up** на platform.deepseek.com. |
| `401` / `Authentication Fails` | Ключ вставлен с пробелом/не полностью; создайте новый на platform.deepseek.com и снова **Apply**. |
| `claude` / `fcc-claude` не распознаётся | Новый терминал; см. шаг 2. |
| «running scripts is disabled» при установке | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, повторить. |
| Claude Code жалуется на Git Bash | Установите Git for Windows, перезапустите терминал. |
| Медленно / обрывы | Peak-часы DeepSeek (см. п. 1) или сеть; переключите модель через `/model` или добавьте Fallback Models. |
| Сайт DeepSeek не открывается без VPN, FCC пишет ошибку соединения с DeepSeek, а status.deepseek.com «зелёный» | Российский сетевой сбой/фильтрация (так было 24.05.2026 и 20.09.2026: без VPN не работает, РКН блокировку отрицает, доступ возвращается в течение суток). Ключ при этом исправен. Временно включите VPN **на весь компьютер** (или режим TUN / «для всех приложений» в VPN-клиенте) — отдельного поля прокси для DeepSeek в FCC нет. На будущее добавьте в Model Config → Fallback Models запасную модель у провайдера, доступного без VPN. Проверка ключа: с VPN → Providers → DeepSeek → Refresh models. |

---

## 6. План Б: DeepSeek напрямую, без FCC

DeepSeek официально поддерживает формат Anthropic API, поэтому Claude Code можно
направить на DeepSeek без прокси (документация:
<https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code>).
Пропишите переменные в `C:\Users\<вы>\.claude\settings.json` — они будут действовать
для каждой сессии обычной команды `claude`:

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

Или на одну сессию терминала:

```powershell
$env:ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"
$env:ANTHROPIC_AUTH_TOKEN="sk-ваш-ключ-deepseek"
$env:ANTHROPIC_MODEL="deepseek-flash[1m]"
cd C:\путь\к\проекту; claude
```

Плюс: минимум движущихся частей. Минус: нет каталога других провайдеров и авто-фолбэков.
Не задавайте `ANTHROPIC_BASE_URL` глобально, если параллельно пользуетесь `fcc-claude`.

---

## 7. Обновление и удаление FCC

Обновить — повторить команду установки:

```powershell
& ([scriptblock]::Create((irm "https://raw.githubusercontent.com/Alishahryar1/free-claude-code/main/scripts/install.ps1")))
```

Версия — `fcc-server --version`. Удалить (Claude Code, Node.js и uv остаются):

```powershell
& ([scriptblock]::Create((irm "https://raw.githubusercontent.com/Alishahryar1/free-claude-code/main/scripts/uninstall.ps1")))
```

Если оплатить DeepSeek напрямую российской картой не получится (принимаются международные
карты, PayPal, Alipay, WeChat Pay), те же модели DeepSeek есть у других провайдеров из
каталога FCC — например `zenmux/deepseek/deepseek-v4-flash-free` (ZenMux),
`nvidia_nim/…` (NVIDIA NIM, бесплатный тариф), `open_router/…` (OpenRouter). Настройка
та же: ключ провайдера в Admin UI и модель с его префиксом в `MODEL`.
