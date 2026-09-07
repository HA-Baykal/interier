import { db, mutate } from "./db";
import { Package, Style, type User } from "./types";
import { getGenerationSettings } from "./generation/settings";

/** Default subscriptions shown while payments are not yet attached. */
export const DEFAULT_PACKAGES: Package[] = [
  {
    id: "pack_solo",
    slug: "start",
    name: { ru: "Старт", en: "Start" },
    description: {
      ru: "5 генераций одного стиля. Идеально попробовать сервис.",
      en: "5 single-style generations. Perfect to try the service.",
    },
    credits: 5,
    price: 490,
    badge: null,
    active: true,
  },
  {
    id: "pack_plus",
    slug: "plus",
    name: { ru: "Плюс", en: "Plus" },
    description: {
      ru: "15 генераций. Хватит обновить несколько комнат.",
      en: "15 generations. Enough to refresh several rooms.",
    },
    credits: 15,
    price: 1290,
    badge: { ru: "Популярный", en: "Popular" },
    active: true,
  },
  {
    id: "pack_pro",
    slug: "pro",
    name: { ru: "Про", en: "Pro" },
    description: {
      ru: "40 генераций и приоритетная очередь.",
      en: "40 generations with a priority queue.",
    },
    credits: 40,
    price: 2990,
    badge: { ru: "Выгодно", en: "Best value" },
    active: true,
  },
];

export const DEFAULT_STYLES: Style[] = [
  {
    id: "style_modern",
    slug: "modern",
    name: { ru: "Современный", en: "Modern" },
    description: {
      ru: "Чистые линии, контраст, фокус на геометрии и свете.",
      en: "Clean lines, contrast, a focus on geometry and light.",
    },
    preview: "/styles/modern.jpg",
    config: {
      filter: "brightness(1.06) contrast(1.12) saturate(1.18) hue-rotate(-2deg)",
      tint: "rgba(120,140,190,0.10)",
      vignette: 0.25,
      accent: "#5b6ee1",
    },
    active: true,
  },
  {
    id: "style_minimal",
    slug: "minimalism",
    name: { ru: "Минимализм", en: "Minimalism" },
    description: {
      ru: "Много воздуха, сдержанная палитра, ничего лишнего.",
      en: "Lots of air, a restrained palette, nothing extra.",
    },
    preview: "/styles/minimalism.jpg",
    config: {
      filter: "brightness(1.1) contrast(0.94) saturate(0.86) grayscale(0.06)",
      tint: "rgba(230,235,245,0.12)",
      vignette: 0.15,
      accent: "#a9b3c4",
    },
    active: true,
  },
  {
    id: "style_loft",
    slug: "loft",
    name: { ru: "Лофт", en: "Loft" },
    description: {
      ru: "Кирпич, бетон, тёплый свет, индустриальный характер.",
      en: "Brick, concrete, warm light, an industrial character.",
    },
    preview: "/styles/loft.jpg",
    config: {
      filter: "brightness(1.02) contrast(1.1) saturate(1.02) sepia(0.18) hue-rotate(-6deg)",
      tint: "rgba(190,120,60,0.14)",
      vignette: 0.38,
      accent: "#c07a3e",
    },
    active: true,
  },
  {
    id: "style_scandi",
    slug: "scandinavian",
    name: { ru: "Скандинавский", en: "Scandinavian" },
    description: {
      ru: "Светлые тона, дерево, уют и функциональность.",
      en: "Light tones, wood, cosiness and functionality.",
    },
    preview: "/styles/scandinavian.jpg",
    config: {
      filter: "brightness(1.12) contrast(0.96) saturate(1.06) hue-rotate(2deg)",
      tint: "rgba(235,225,210,0.13)",
      vignette: 0.12,
      accent: "#c9a57a",
    },
    active: true,
  },
  {
    id: "style_classic",
    slug: "classic",
    name: { ru: "Классика", en: "Classic" },
    description: {
      ru: "Благородная симметрия, лепнина, тёплый люксовый оттенок.",
      en: "Noble symmetry, mouldings, a warm luxurious shade.",
    },
    preview: "/styles/classic.jpg",
    config: {
      filter: "brightness(1.04) contrast(1.02) saturate(1.05) sepia(0.12)",
      tint: "rgba(200,170,130,0.14)",
      vignette: 0.3,
      accent: "#9c7b4f",
    },
    active: true,
  },
  {
    id: "style_provence",
    slug: "provence",
    name: { ru: "Прованс", en: "Provence" },
    description: {
      ru: "Пастель, лён, лёгкость и южный шарм.",
      en: "Pastels, linen, lightness and southern charm.",
    },
    preview: "/styles/provence.jpg",
    config: {
      filter: "brightness(1.1) contrast(0.92) saturate(0.94) hue-rotate(4deg)",
      tint: "rgba(235,210,205,0.15)",
      vignette: 0.18,
      accent: "#d9a4a0",
    },
    active: true,
  },
];

const DEFAULT_SETTINGS: Record<string, string> = {
  free_credits: "0",
  daily_free_image_limit: "10",
  free_trial_styles: "all", // trial renders all active styles
  max_original_mb: "20",
  reward_telegram: "1",
  reward_vk: "1",
  reward_referral: "1",
  generation_mode: "demo",
  test_unlimited: "1", // unlimited generations while testing
  compatible_provider: "genapi", // genapi | openai-compatible
  compatible_base_url: "https://api.gen-api.ru",
  compatible_api_key: "",
  compatible_model: "gpt-image-2",

  /* --- Shopping list (where to buy each interior detail) --- */
  shopping_enabled: "1",
  shopping_auto: "1", // attach a list to every generation
  shopping_max_items: "8",
  shopping_marketplaces: "ozon,yandex_market,leroy_merlin",
  shopping_extra_params: "", // appended to every marketplace URL (partner tags)
  shopping_default_mode: "hotspots", // hotspots | list
  shopping_public_links: "0", // show the shopping list in the public gallery

  /* --- AI tagger (bounding boxes for hover links) --- */
  vision_enabled: "1",
  vision_provider: "inherit", // inherit = same aggregator key/base as generation
  vision_base_url: "https://api.gen-api.ru",
  vision_api_key: "",
  vision_model: "gpt-4o-mini",

  /* --- Bots (Telegram / VK / MAX) --- */
  bots_enabled: "1",
  bots_inline_generation: "0", // 1 = run generation inside the webhook (serverless)
  bots_poll_secret: "", // guards the long-polling endpoint for hosts without webhooks
  bots_simulator: "0", // 1 = allow the in-panel bot simulator
  public_base_url: "", // e.g. https://interier.onrender.com (needed by bots & mini apps)
  admin_telegram_id: "",
  telegram_bot_token: "",
  telegram_bot_username: "",
  telegram_name: "", // display name pushed to Telegram via setMyName
  telegram_mini_app_url: "",
  telegram_webhook_secret: "",
  vk_group_id: "",
  vk_access_token: "",
  vk_callback_secret: "",
  vk_confirmation_token: "",
  vk_verify_signature: "1",
  vk_mini_app_id: "",
  vk_app_verify_token: "", // static token accepted from the VK Bridge login flow
  telegram_channel_id: "", // @channel or -100... id, for real "+1 за подписку" checks
  max_bot_token: "",
  max_bot_username: "",
  max_base_url: "https://platform-api2.max.ru",
  max_webhook_secret: "",
  bots_link_ttl_min: "60",

  /* --- Marketing channels linked from the bot menu --- */
  channel_telegram_url: "https://t.me/interier_ai",
  channel_vk_url: "https://vk.com/interier_ai",
  channel_max_url: "https://max.ru/interier_ai",
};

/**
 * Apply defaults once and ensure every known key exists in the store.
 * Idempotent: it seeds styles/packages only when absent, and upserts any
 * missing settings keys (so future defaults are added to existing databases).
 */
export async function ensureSeeded() {
  await mutate((draft) => {
    if (draft.styles.length === 0) draft.styles = structuredClone(DEFAULT_STYLES);
    if (draft.packages.length === 0) draft.packages = structuredClone(DEFAULT_PACKAGES);
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (!draft.settings.some((s) => s.key === key)) draft.settings.push({ key, value });
    }
  });
}

export async function getSetting(key: string): Promise<string | null> {
  return (await db()).settings.find((s) => s.key === key)?.value ?? null;
}

export async function getSettingNumber(key: string, fallback: number): Promise<number> {
  const v = await getSetting(key);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function setSetting(key: string, value: string) {
  await mutate((d) => {
    const existing = d.settings.find((s) => s.key === key);
    if (existing) existing.value = value;
    else d.settings.push({ key, value });
  });
}

/** Boolean-ish setting: "1" | "true" | "on" → true. */
export async function getSettingBool(key: string, fallback = false): Promise<boolean> {
  const v = await getSetting(key);
  if (v === null || v === "") return fallback;
  return ["1", "true", "on", "yes", "да"].includes(v.trim().toLowerCase());
}

/**
 * Read a setting with an environment-variable fallback.
 *
 * Secrets are usually injected by the hosting panel (env), while day-to-day
 * tweaks happen in the admin panel (DB). Both are supported, DB wins when set.
 */
export async function getSettingOrEnv(key: string, envName?: string): Promise<string> {
  const v = await getSetting(key);
  if (v !== null && v.trim() !== "") return v.trim();
  const env = process.env[envName || key.toUpperCase()];
  return (env || "").trim();
}

/** Whether unlimited (test) generation mode is enabled for the current user. */
export async function isUnlimitedMode(user?: Pick<User, "isAdmin">): Promise<boolean> {
  if ((await getSetting("test_unlimited")) !== "1") return false;
  return user ? user.isAdmin === true : true;
}

export async function activeStyles(): Promise<Style[]> {
  return (await db()).styles.filter((s) => s.active);
}

export async function activePackages(): Promise<Package[]> {
  return (await db()).packages.filter((p) => p.active);
}

export async function generationMode(): Promise<string> {
  return (await getGenerationSettings()).mode;
}

/** The single, canonical shorthand used across the app. */
export async function activeGenerationMode(): Promise<"demo" | "compatible" | "replicate"> {
  const m = await generationMode();
  if (m === "compatible" || m === "replicate") return m;
  return "demo";
}

export async function defaultStyle(): Promise<Style> {
  return (await activeStyles())[0] || DEFAULT_STYLES[0];
}
