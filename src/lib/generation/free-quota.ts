import type { DbShape, User } from "../types";
import { RequestError } from "../errors";

export const DEFAULT_FREE_IMAGE_LIMIT = 10;
export const FREE_WINDOW_MS = 24 * 60 * 60_000;

/** Rolling image-start budget. Failed starts still count: an upstream charge may already have happened. */
export function assertFreeImageBudget(data: DbShape, user: User, imageCount: number, now = Date.now()): void {
  if (user.isAdmin || user.trialUsed) return;
  const raw = data.settings.find(setting => setting.key === "daily_free_image_limit")?.value;
  const limit = raw === undefined ? DEFAULT_FREE_IMAGE_LIMIT : Number(raw);
  const safeLimit = Number.isInteger(limit) && limit >= 0 && limit <= 100000 ? limit : 0;
  const used = data.generations.filter(generation => generation.freeBudgeted === true && generation.createdAt > now - FREE_WINDOW_MS).length;
  if (!Number.isInteger(imageCount) || imageCount < 1 || used + imageCount > safeLimit) {
    throw new RequestError("free_budget_exhausted", "Общий лимит бесплатных изображений за последние 24 часа исчерпан. Попробуйте позже или выберите меньше стилей.", 429);
  }
}
