import { GPT_IMAGE_2_PRICE_ESTIMATES, type ImageQuality } from "./quality";

/** Public metadata only. Shared by web/mobile clients; never contains API keys. */
export const GENAPI_MODEL_IDS = ["gpt-image-2", "nano-banana", "nano-banana-pro"] as const;
export type GenApiModelId = typeof GENAPI_MODEL_IDS[number];
export type NanoResolution = "1K" | "2K" | "4K";
export const MODEL_PRICES_CHECKED_AT = "2026-09-06";
export const GENAPI_MODELS: Record<GenApiModelId, { name: string; source: string; acceptsWebp: boolean }> = {
  "gpt-image-2": { name: "GPT Image 2", source: "https://gen-api.ru/model/gpt-image-2", acceptsWebp: true },
  "nano-banana": { name: "Nano Banana", source: "https://gen-api.ru/model/nano-banana", acceptsWebp: false },
  "nano-banana-pro": { name: "Nano Banana Pro", source: "https://gen-api.ru/model/nano-banana-pro", acceptsWebp: false },
};
export type TestProfile = {
  id: string; model: GenApiModelId; variant: string; quality?: ImageQuality; resolution?: NanoResolution;
  /** A dated public-tariff estimate, NOT an actual charge. */
  estimatedRub: number;
};
export const MODEL_TEST_PROFILES: readonly TestProfile[] = [
  { id: "gpt-image-2:low", model: "gpt-image-2", variant: "Low", quality: "low", estimatedRub: GPT_IMAGE_2_PRICE_ESTIMATES.low },
  { id: "gpt-image-2:medium", model: "gpt-image-2", variant: "Medium", quality: "medium", estimatedRub: GPT_IMAGE_2_PRICE_ESTIMATES.medium },
  { id: "gpt-image-2:high", model: "gpt-image-2", variant: "High", quality: "high", estimatedRub: GPT_IMAGE_2_PRICE_ESTIMATES.high },
  { id: "nano-banana:standard", model: "nano-banana", variant: "Standard", estimatedRub: 9.75 },
  // The published tariff is the same for 1K/2K; start with the documented 2K default.
  { id: "nano-banana-pro:2k", model: "nano-banana-pro", variant: "2K", resolution: "2K", estimatedRub: 37.5 },
];
export const DEFAULT_TEST_PROFILE = "gpt-image-2:medium";
export function getTestProfile(id: string): TestProfile | undefined {
  return MODEL_TEST_PROFILES.find((profile) => profile.id === id);
}
export function isGenApiModel(model: string): model is GenApiModelId {
  return (GENAPI_MODEL_IDS as readonly string[]).includes(model);
}
export function isNanoResolution(value: unknown): value is NanoResolution {
  return value === "1K" || value === "2K" || value === "4K";
}
export function testProfileName(id: string): string {
  const profile = getTestProfile(id);
  return profile ? `${GENAPI_MODELS[profile.model].name} · ${profile.variant}` : id;
}
