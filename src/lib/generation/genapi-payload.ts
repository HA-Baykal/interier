import { RequestError } from "../errors";
import type { CompatibleConfig } from "./settings";
import { DEFAULT_IMAGE_QUALITY, GPT_IMAGE_2_SIZE } from "./quality";
import { GENAPI_MODELS, isGenApiModel } from "./model-catalog";

export function assertGenApiImageType(model: string, mime: string): void {
  if (!isGenApiModel(model)) throw new RequestError("unsupported_image_model", "Для этой модели ещё нет проверенного шаблона запроса. Выберите модель из списка.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new RequestError("model_image_type", "Нужен JPEG, PNG или WebP.");
  if (mime === "image/webp" && !GENAPI_MODELS[model].acceptsWebp) {
    throw new RequestError("model_image_type", "Для Nano Banana нужен JPEG или PNG. Загрузите фото в этом формате.");
  }
}

/** Each model has its own documented payload; never send GPT-only options to Nano. */
export function buildGenApiImagePayload(cfg: CompatibleConfig, imageUrl: string, prompt: string, mime: string) {
  assertGenApiImageType(cfg.model, mime);
  const common = { prompt, image_urls: [imageUrl], num_images: 1, output_format: "png" };
  // No callback_url for polling, no automatic translation or extra paid requests.
  if (cfg.model === "gpt-image-2") {
    return { ...common, quality: cfg.quality ?? DEFAULT_IMAGE_QUALITY, image_size: GPT_IMAGE_2_SIZE };
  }
  if (cfg.model === "nano-banana") {
    return { ...common, translate_input: false, aspect_ratio: "default" };
  }
  return { ...common, translate_input: false, aspect_ratio: "1:1", resolution: cfg.resolution ?? "2K" };
}
