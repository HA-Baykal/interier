import { z } from "zod";
import { db, mutate } from "./db";
import { cleanConnectionValue, cleanConfigValue } from "./env";
import { RequestError } from "./errors";
import { resolveGenerationSettings, validateCompatibleConfig } from "./generation/settings";
import { assertDurableDatabase } from "./storage-config";
import type { DbShape } from "./types";

const schema = z.object({
  generation_mode: z.enum(["demo", "compatible", "replicate"]).optional(),
  free_credits: z.string().regex(/^\d{1,6}$/).optional(),
  reward_telegram: z.string().regex(/^\d{1,6}$/).optional(),
  reward_vk: z.string().regex(/^\d{1,6}$/).optional(),
  reward_referral: z.string().regex(/^\d{1,6}$/).optional(),
  test_unlimited: z.enum(["0", "1"]).optional(),
  compatible_provider: z.enum(["genapi", "openai-compatible"]).optional(),
  compatible_base_url: z.string().max(500).optional(),
  compatible_api_key: z.string().max(1000).optional(),
  compatible_model: z.string().max(200).optional(),
});

export function adminSettingsView(d: DbShape) {
  const values = Object.fromEntries(d.settings.map((s) => [s.key, s.value]));
  const config = resolveGenerationSettings(d.settings);
  return {
    generation_mode: config.mode,
    free_credits: values.free_credits || "0",
    reward_telegram: values.reward_telegram || "1",
    reward_vk: values.reward_vk || "1",
    reward_referral: values.reward_referral || "1",
    test_unlimited: values.test_unlimited || "1",
    compatible_provider: config.compatible.provider,
    compatible_base_url: config.compatible.baseUrl,
    // Write-only field. A saved key is never sent to a browser, even an admin's.
    compatible_api_key: "",
    compatible_model: config.compatible.model,
    compatible_configured: !!config.compatible.apiKey,
    compatible_key_source: config.keySource,
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
