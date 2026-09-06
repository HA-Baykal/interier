import { RequestError } from "../errors";
import { getTestProfile } from "./model-catalog";
import { supportsImageQuality, type ImageQuality } from "./quality";
import type { getGenerationSettings } from "./settings";

type Settings = Awaited<ReturnType<typeof getGenerationSettings>>;

/** Resolve one request, never save a test profile as the public site's provider. */
export function generationRequestSettings(base: Settings, isAdmin: boolean, input: {
  quality?: ImageQuality; testProfile?: string; scope: "single" | "all";
}): Settings {
  if (input.testProfile !== undefined) {
    if (!isAdmin) throw new RequestError("test_profile_forbidden", "Тестирование моделей доступно только администратору.", 403);
    if (input.scope !== "single") throw new RequestError("test_single_only", "Тестируйте одну модель и один стиль за один запрос.");
    if (input.quality !== undefined) throw new RequestError("conflicting_options", "Выберите тестовый профиль без отдельного параметра качества.");
    const profile = getTestProfile(input.testProfile);
    if (!profile) throw new RequestError("unknown_test_profile", "Неизвестный тестовый профиль модели.");
    if (base.compatible.provider !== "genapi") throw new RequestError("test_provider_mismatch", "Для этой тестовой панели нужен настроенный провайдер GenAPI. Ключ другого провайдера использовать нельзя.");
    if (!base.compatible.apiKey) throw new RequestError("ai_not_configured", "Сначала настройте ключ GenAPI.", 503);
    // An explicitly requested admin test is real even when the public site is in demo.
    return { ...base, mode: "compatible", aiConfigured: true, compatible: {
      ...base.compatible, model: profile.model, quality: profile.quality, resolution: profile.resolution,
    } };
  }
  if (input.quality === undefined) return base;
  if (!isAdmin) throw new RequestError("quality_forbidden", "Тестовый выбор качества доступен администратору.", 403);
  if (!supportsImageQuality(base.mode, base.compatible.provider, base.compatible.model)) {
    throw new RequestError("quality_not_supported", "Выбор качества доступен только для GenAPI GPT Image 2. Обновите страницу.");
  }
  return { ...base, compatible: { ...base.compatible, quality: input.quality } };
}
