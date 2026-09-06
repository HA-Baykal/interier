import { z } from "zod";
import { db, mutate } from "./db";
import { cleanConnectionValue, cleanConfigValue } from "./env";
import { RequestError } from "./errors";
import { resolveGenerationSettings, validateCompatibleConfig } from "./generation/settings";
import { assertDurableDatabase } from "./storage-config";
import type { DbShape } from "./types";
import { activeProfileForConfig, getTestProfile } from "./generation/model-catalog";

const schema = z.object({
  generation_mode: z.enum(["demo", "compatible", "replicate"]).optional(),
  free_credits: z.string().regex(/^\d{1,6}$/).optional(),
  daily_free_image_limit: z.string().regex(/^\d{1,5}$/).optional(),
  reward_telegram: z.string().regex(/^\d{1,6}$/).optional(),
  reward_vk: z.string().regex(/^\d{1,6}$/).optional(),
  reward_referral: z.string().regex(/^\d{1,6}$/).optional(),
  test_unlimited: z.enum(["0", "1"]).optional(),
  compatible_provider: z.enum(["genapi", "openai-compatible"]).optional(),
  compatible_base_url: z.string().max(500).optional(),
  compatible_api_key: z.string().max(1000).optional(),
  compatible_model: z.string().max(200).optional(),
  compatible_quality: z.enum(["", "low", "medium", "high"]).optional(),
  compatible_resolution: z.enum(["", "1K", "2K", "4K"]).optional(),
  // Shopping list of interior details (website + messenger bots read the same
  // settings, so a change here is immediately true everywhere).
  shopping_enabled: z.enum(["0", "1"]).optional(),
  shopping_auto: z.enum(["0", "1"]).optional(),
  shopping_public_links: z.enum(["0", "1"]).optional(),
  shopping_max_items: z.string().regex(/^[3-9]$|^1[0-6]$/).optional(),
  shopping_default_mode: z.enum(["hotspots", "list"]).optional(),
  shopping_marketplaces: z.string().max(300).optional(),
  shopping_extra_params: z.string().max(300).optional(),
  // Messenger-app switches that are safe to expose in the general settings
  // (tokens and webhook secrets stay in the dedicated bots endpoint).
  bots_enabled: z.enum(["0", "1"]).optional(),
  bots_simulator: z.enum(["0", "1"]).optional(),
  bots_inline_generation: z.enum(["0", "1"]).optional(),
  // Vision model that finds the details and their coordinates.
  vision_enabled: z.enum(["0", "1"]).optional(),
  vision_provider: z.enum(["", "inherit", "custom"]).optional(),
  vision_base_url: z.string().max(500).optional(),
  vision_api_key: z.string().max(1000).optional(),
  vision_model: z.string().max(200).optional(),
});

export function adminSettingsView(d: DbShape) {
  const values = Object.fromEntries(d.settings.map((s) => [s.key, s.value]));
  const config = resolveGenerationSettings(d.settings);
  return {
    generation_mode: config.mode,
    free_credits: values.free_credits || "0",
    daily_free_image_limit: values.daily_free_image_limit ?? "10",
    reward_telegram: values.reward_telegram || "1",
    reward_vk: values.reward_vk || "1",
    reward_referral: values.reward_referral || "1",
    test_unlimited: values.test_unlimited || "1",
    compatible_provider: config.compatible.provider,
    compatible_base_url: config.compatible.baseUrl,
    // Write-only field. A saved key is never sent to a browser, even an admin's.
    compatible_api_key: "",
    compatible_model: config.compatible.model,
    compatible_quality: config.compatible.quality || "",
    compatible_resolution: config.compatible.resolution || "",
    active_profile: activeProfileForConfig(config.compatible)?.id || null,
    compatible_configured: !!config.compatible.apiKey,
    compatible_key_source: config.keySource,
    bots_enabled: values.bots_enabled ?? "1",
    bots_simulator: values.bots_simulator ?? "0",
    bots_inline_generation: values.bots_inline_generation ?? "0",
    shopping_enabled: values.shopping_enabled ?? "1",
    shopping_auto: values.shopping_auto ?? "1",
    shopping_public_links: values.shopping_public_links ?? "0",
    shopping_max_items: values.shopping_max_items ?? "8",
    shopping_default_mode: values.shopping_default_mode ?? "hotspots",
    shopping_marketplaces: values.shopping_marketplaces ?? "",
    shopping_extra_params: values.shopping_extra_params ?? "",
    vision_enabled: values.vision_enabled ?? "1",
    vision_provider: values.vision_provider ?? "inherit",
    vision_base_url: values.vision_base_url ?? "",
    // Write-only, like the generation key: a saved vision key is never shipped
    // to a browser.
    vision_api_key: "",
    vision_model: values.vision_model ?? "",
  };
}

export async function updateAdminSettings(body: unknown) {
  assertDurableDatabase();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError("bad_request", "Settings must be an object");
  const cleaned = Object.fromEntries(Object.entries(body).map(([key, value]) => [key,
    typeof value === "string" ? (key.startsWith("compatible_") ? cleanConnectionValue(value) : cleanConfigValue(value)) : value,
  ]));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) throw new RequestError("bad_request", `Invalid setting: ${parsed.error.issues[0].path.join(".")}`);
  const updates: Record<string, string> = { ...parsed.data } as Record<string, string>;
  // Empty password input means "keep current key / use env", not "erase".
  if (!updates.compatible_api_key) delete updates.compatible_api_key;
  if (!updates.vision_api_key) delete updates.vision_api_key;
  if (updates.vision_api_key) updates.vision_provider = "custom";
  if (updates.compatible_api_key) updates.generation_mode = "compatible";
  if (updates.generation_mode) updates.generation_mode_explicit = "1";
  if (Object.keys(updates).some((k) => k.startsWith("compatible_"))) updates.compatible_settings_saved = "1";

  // All fields, including the automatic mode switch, are saved in one mutation.
  await mutate((draft) => {
    for (const [key, value] of Object.entries(updates)) {
      const existing = draft.settings.find((s) => s.key === key);
      if (existing) existing.value = value;
      else draft.settings.push({ key, value });
    }
    const cfg = resolveGenerationSettings(draft.settings).compatible;
    try { validateCompatibleConfig({ ...cfg, apiKey: cfg.apiKey || "not-configured" }); }
    catch (e) { throw new RequestError("invalid_ai_config", e instanceof Error ? e.message : "Invalid AI configuration"); }
  });
  return adminSettingsView(await db());
}


/** Explicitly change the live site's profile, atomically, without copying/exposing an environment key. */
export async function activateGenApiProfile(profileId: string) {
  assertDurableDatabase();
  const profile = getTestProfile(profileId);
  if (!profile) throw new RequestError("unknown_profile", "Выберите модель из списка.");
  await mutate(draft => {
    const current = resolveGenerationSettings(draft.settings).compatible;
    if (current.provider !== "genapi") throw new RequestError("provider_mismatch", "Сначала настройте провайдер GenAPI; ключ другого провайдера использовать нельзя.");
    if (!current.apiKey) throw new RequestError("ai_not_configured", "Сначала сохраните ключ GenAPI.", 503);
    const changes: Record<string, string> = {
      generation_mode: "compatible", generation_mode_explicit: "1", compatible_settings_saved: "1",
      compatible_provider: current.provider, compatible_base_url: current.baseUrl,
      compatible_model: profile.model, compatible_quality: profile.quality || "", compatible_resolution: profile.resolution || "",
    };
    for (const [key, value] of Object.entries(changes)) {
      const item = draft.settings.find(setting => setting.key === key);
      if (item) item.value = value; else draft.settings.push({ key, value });
    }
    validateCompatibleConfig(resolveGenerationSettings(draft.settings).compatible);
  });
  return adminSettingsView(await db());
}
