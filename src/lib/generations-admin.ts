import type { Generation } from "./types";

export type GenReason = "off" | "auto0" | "vision" | "old" | "empty" | null;

/**
 * Why a generation has no (or an empty) shopping list. null = details exist.
 *
 * Lives in `lib` because Next.js route modules may only export handlers and
 * route config — exporting a helper from a route breaks the production build.
 */
export function reasonFor(gen: Generation, enabled: boolean, auto: boolean): GenReason {
  const s = gen.shopping;
  const hasItems = !!s && s.items.length > 0;
  if (hasItems) return null;
  if (!enabled) return "off";
  if (s && s.detector === "off") return "off";
  if (s && s.detector === "heuristic") return "vision";
  if (!s && !auto) return "auto0";
  if (!s) return "old";
  return "empty";
}
