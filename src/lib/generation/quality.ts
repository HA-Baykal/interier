/** Shared by the server and Studio. Contains no credentials or server-only imports. */
export const IMAGE_QUALITIES = ["low", "medium", "high"] as const;
export type ImageQuality = typeof IMAGE_QUALITIES[number];

// Existing callers keep high quality. Only the administrator's picker starts at medium.
export const DEFAULT_IMAGE_QUALITY: ImageQuality = "high";
export const ADMIN_TEST_IMAGE_QUALITY: ImageQuality = "medium";
export const GPT_IMAGE_2_SIZE = "1024x1024";

/** Display-only estimates, NOT billing rules or a guarantee of sufficient funds. */
export const GPT_IMAGE_2_PRICE_ESTIMATES: Record<ImageQuality, number> = { low: 2.5, medium: 15, high: 55 };
export const GPT_IMAGE_2_PRICE_DATE = "2026-09-06";
export const GPT_IMAGE_2_PRICE_SOURCE = "https://gen-api.ru/model/gpt-image-2";

export function isImageQuality(value: unknown): value is ImageQuality {
  return value === "low" || value === "medium" || value === "high";
}

export function supportsImageQuality(mode: string, provider: string, model: string): boolean {
  return mode === "compatible" && provider === "genapi" && model === "gpt-image-2";
}
