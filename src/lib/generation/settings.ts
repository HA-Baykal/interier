import { db } from "../db";
import { cleanConnectionValue } from "../env";
import type { Setting } from "../types";
import { DEFAULT_IMAGE_QUALITY, isImageQuality, supportsImageQuality, type ImageQuality } from "./quality";
import { isGenApiModel, isNanoResolution, type NanoResolution } from "./model-catalog";

export type GenerationMode = "demo" | "compatible" | "replicate";
export type CompatibleProvider = "genapi" | "openai-compatible";
export type CompatibleConfig = {
  provider: CompatibleProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Effective site quality; an isolated admin test may override it for one request. */
  quality?: ImageQuality;
  resolution?: NanoResolution;
};

/** One resolver for the API, studio, admin form and diagnostics. */
export function resolveGenerationSettings(settings: Setting[], env: Record<string, string | undefined> = process.env) {
  const stored = Object.fromEntries(settings.map((s) => [s.key, cleanConnectionValue(s.value)]));
  // Old databases contain seeded defaults that used to hide hosting env vars.
  const value = (key: string, envKey: string, legacyDefault = "") => {
    const saved = stored[key] || "";
    const fromEnv = cleanConnectionValue(env[envKey]);
    if (!stored.compatible_settings_saved && saved === legacyDefault && fromEnv) return fromEnv;
    return saved || fromEnv;
  };
  const provider: CompatibleProvider = value("compatible_provider", "COMPATIBLE_PROVIDER", "genapi") === "openai-compatible"
    ? "openai-compatible" : "genapi";
  const baseUrl = (value("compatible_base_url", "COMPATIBLE_BASE_URL", "https://api.gen-api.ru") ||
    (provider === "genapi" ? "https://api.gen-api.ru" : "https://api.provod.ai/v1")).replace(/\/+$/, "");
  const apiKey = value("compatible_api_key", "COMPATIBLE_API_KEY");
  let model = value("compatible_model", "COMPATIBLE_MODEL", "gpt-image-2") || "gpt-image-2";
  if (provider === "genapi") model = model.slice(model.lastIndexOf("/") + 1);

  let mode = stored.generation_mode || cleanConnectionValue(env.GENERATION_MODE) || "demo";
  if (stored.generation_mode_explicit !== "1") {
    if (mode === "demo") mode = cleanConnectionValue(env.GENERATION_MODE) || mode;
    // Repair the legacy state: a saved key + a seeded demo mode.
    if (mode === "demo" && apiKey) mode = "compatible";
  }
  const effectiveMode: GenerationMode = mode === "compatible" || mode === "replicate" ? mode : "demo";
  const compatible: CompatibleConfig = {
    provider, baseUrl, apiKey, model,
    ...(provider === "genapi" && model === "gpt-image-2" ? { quality: (value("compatible_quality", "COMPATIBLE_QUALITY") || DEFAULT_IMAGE_QUALITY) as ImageQuality } : {}),
    ...(provider === "genapi" && model === "nano-banana-pro" ? { resolution: (value("compatible_resolution", "COMPATIBLE_RESOLUTION") || "2K") as NanoResolution } : {}),
  };
  return {
    mode: effectiveMode,
    compatible,
    keySource: stored.compatible_api_key ? "database" : apiKey ? "environment" : "missing",
    aiConfigured: effectiveMode === "compatible" ? !!(apiKey && baseUrl && model)
      : effectiveMode === "replicate" ? !!cleanConnectionValue(env.REPLICATE_API_TOKEN) : false,
  };
}

export async function getGenerationSettings() {
  return resolveGenerationSettings((await db()).settings);
}

export async function getCompatibleConfig(): Promise<CompatibleConfig | null> {
  const { compatible: cfg } = await getGenerationSettings();
  return cfg.apiKey && cfg.baseUrl && cfg.model ? cfg : null;
}

export function validateCompatibleConfig(cfg: CompatibleConfig): void {
  let url: URL;
  try { url = new URL(cfg.baseUrl); } catch { throw new Error("Invalid AI Base URL: use an https:// URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Invalid AI Base URL: use HTTPS without credentials, query or fragment");
  }
  if (!/^[\x21-\x7e]+$/.test(cfg.apiKey)) throw new Error("Invalid API key: use the provider's API token without quotes or whitespace");
  if (!/^[a-zA-Z0-9_.\/-]+$/.test(cfg.model) || cfg.model.includes("..")) throw new Error("Invalid AI model ID");
  if (cfg.provider === "genapi" && !isGenApiModel(cfg.model)) throw new Error("Unsupported GenAPI image model: choose a model from the tested catalog");
  if (cfg.resolution !== undefined && (cfg.provider !== "genapi" || cfg.model !== "nano-banana-pro" || !isNanoResolution(cfg.resolution))) throw new Error("Invalid image resolution override for this model");
  if (cfg.quality !== undefined && (!isImageQuality(cfg.quality) || !supportsImageQuality("compatible", cfg.provider, cfg.model))) {
    throw new Error("Invalid AI quality override: low/medium/high is supported only for GenAPI GPT Image 2");
  }
}
