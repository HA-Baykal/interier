import { z } from "zod";
import type { Package } from "./types";

/**
 * Validation for the price list the owner edits by hand.
 *
 * Lives in `lib` (not in the route file) because Next.js route modules may only
 * export handlers and route config — a helper exported from there breaks the
 * production build.
 */
export const packageSchema = z.object({
  slug: z.string().trim().min(2).max(60).regex(/^[a-z0-9_-]+$/i).optional(),
  nameRu: z.string().trim().min(1).max(60),
  nameEn: z.string().trim().min(1).max(60),
  descRu: z.string().trim().max(300).default(""),
  descEn: z.string().trim().max(300).default(""),
  credits: z.number().int().min(1).max(100000),
  /** RUB. 0 is allowed: a package can be a free/trial bundle. */
  price: z.number().min(0).max(10_000_000),
  badgeRu: z.string().trim().max(40).nullable().optional(),
  badgeEn: z.string().trim().max(40).nullable().optional(),
  active: z.boolean().optional(),
});

/** Every field optional: the panel saves a single changed input (usually the price). */
export const packagePatchSchema = packageSchema.omit({ slug: true }).partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: "empty" }
);

export type PackageInput = z.infer<typeof packageSchema>;

/** Prices are money: keep two decimals, never floating-point noise. */
export function normalizePrice(value: number): number {
  return Math.round(value * 100) / 100;
}

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/**
 * Stable slug from a name, so the owner never has to think about slugs.
 *
 * Package names are Russian, so a plain "drop non-ascii" rule would leave an
 * empty slug and fall back to a timestamp — «Мебель» becomes `mebel` instead.
 */
export function slugFromName(name: string): string {
  const latin = name
    .toLowerCase()
    .split("")
    .map((c) => (c in TRANSLIT ? TRANSLIT[c] : c))
    .join("");
  return latin.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}

export function packageView(p: Package) {
  return {
    id: p.id,
    slug: p.slug,
    nameRu: p.name.ru,
    nameEn: p.name.en,
    descRu: p.description.ru,
    descEn: p.description.en,
    credits: p.credits,
    price: p.price,
    badgeRu: p.badge?.ru ?? null,
    badgeEn: p.badge?.en ?? null,
    active: p.active,
  };
}

export type PackageView = ReturnType<typeof packageView>;
