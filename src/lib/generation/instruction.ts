/**
 * Free-text design instructions.
 *
 * "замени только шторы на бежевые льняные" must NOT become "redesign the room".
 * We parse the user's own words into a target set + attributes, then build a
 * prompt that explicitly freezes everything outside those targets. The same
 * parsed result drives the shopping list: the changed details are the ones we
 * need links for, and their attributes (color/material) go into the query.
 */

import { CATEGORIES, ItemAttributes, buildQuery, detectAttributes, matchCategories, normalizeText } from "../marketplaces";

const CATEGORY_LABEL_EN = new Map(CATEGORIES.map((c) => [c.id, c.en]));
const CATEGORY_LABEL_RU = new Map(CATEGORIES.map((c) => [c.id, c.ru.toLowerCase()]));

export type ParsedInstruction = {
  raw: string;
  /** English labels of the targeted details, for the image-edit model. */
  targets: string[];
  /** Catalog ids of the targeted details. */
  targetCategories: string[];
  /** "только X" / "ничего больше не меняй" → hard freeze of the rest. */
  exclusive: boolean;
  /** Categories the user asked to keep untouched. */
  keepCategories: string[];
  /**
   * Things the user explicitly *likes* («меня устраивает цвет и стиль штор») —
   * they must survive the edit, so the model keeps those exact qualities.
   */
  liked: string[];
  attributes: ItemAttributes;
  /** Extra free-form wishes, minus the category words (for the prompt). */
  intent: "replace" | "restyle" | "remove" | "add" | "unknown";
  summary: string;
};

const EXCLUSIVE_MARKERS = [
  "только",
  "лишь",
  "исключительн",
  "больше ничего",
  "ничего больше",
  "остальн",
  "не трогай",
  "не меняй остальн",
  "only ",
  "just ",
];

const KEEP_MARKERS = ["не меняй", "не трогай", "оставь", "сохрани", "без изменен", "keep ", "don't change", "do not change"];
/** «всё нравится / устраивает» — not a request to keep the object, but to keep its qualities. */
const LIKE_MARKERS = ["устраивает", "нравится", " нравятся", "отлично", "прекрасно", "хорош", "устраив", "like ", "works for me"];
const REMOVE_MARKERS = ["убери", "убрать", "удали", "избав", "убер", "remove", "delete"];
const ADD_MARKERS = ["добав", "доавб", "поставь", "положи", "повесь", "повес", "хочу", "добавить", "add ", "put a"];
const REPLACE_MARKERS = ["замени", "замен", "поменяй", "поменя", "переделай", "перекрас", "покра", "replace", "change ", "swap"];
const RESTYLE_MARKERS = ["стиль", "палитр", "цветов", "оттен", "настрой", "сделай ", "оформи", "стилистик"];

function hasAny(hay: string, needles: string[]): boolean {
  return needles.some((n) => hay.includes(normalizeText(n)));
}

export function parseInstruction(text: string | null | undefined): ParsedInstruction | null {
  const raw = (text || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;

  const norm = normalizeText(raw);
  const mentioned = matchCategories(raw);

  // Clauses, not just sentences: «меня устраивает цвет штор, замени только
  // шторы» is two different intents, and they have to be read separately.
  const clauses = raw
    .split(/[.!?,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const keepSet = new Set<string>();
  const liked: string[] = [];
  const targetSet = new Set<string>();
  /** Categories named inside a «только X» clause — they win over everything else. */
  const exclusiveSet = new Set<string>();
  for (const clause of clauses) {
    const n = normalizeText(clause);
    const cats = matchCategories(clause);
    const exclusiveHere = hasAny(n, EXCLUSIVE_MARKERS);
    const replaceHere = hasAny(n, REPLACE_MARKERS);
    const likeHere = hasAny(n, LIKE_MARKERS);
    if (cats.length && likeHere && !replaceHere && !exclusiveHere) {
      // The user likes these objects: keep them, and remember their qualities.
      for (const c of cats) keepSet.add(c.id);
      liked.push(clause);
      continue;
    }
    if (!cats.length) continue;
    if (hasAny(n, KEEP_MARKERS) && !replaceHere && !exclusiveHere) {
      for (const c of cats) keepSet.add(c.id);
    } else {
      for (const c of cats) targetSet.add(c.id);
      if (exclusiveHere) for (const c of cats) exclusiveSet.add(c.id);
    }
  }
  // «замени **только** шторы» — even if the room mentions five other things, the
  // exclusive clause defines the whole target set. This is what makes an edit
  // surgical instead of a re-design.
  if (exclusiveSet.size > 0) {
    targetSet.clear();
    for (const id of exclusiveSet) targetSet.add(id);
  }
  // Clause-level parsing may find nothing (e.g. the single word "шторы") — fall back.
  if (targetSet.size === 0) for (const c of mentioned) targetSet.add(c.id);
  // Protected categories drop out of the targets — unless the user asked to
  // change them in the same breath («устраивает цвет штор, замени только шторы»).
  for (const k of [...keepSet]) if (!exclusiveSet.has(k)) targetSet.delete(k);

  const targets = [...targetSet];
  const exclusive = exclusiveSet.size > 0 || hasAny(norm, EXCLUSIVE_MARKERS) || keepSet.size > 0;

  let intent: ParsedInstruction["intent"] = "unknown";
  if (hasAny(norm, REMOVE_MARKERS)) intent = "remove";
  else if (hasAny(norm, ADD_MARKERS)) intent = "add";
  else if (hasAny(norm, REPLACE_MARKERS)) intent = "replace";
  else if (hasAny(norm, RESTYLE_MARKERS)) intent = "restyle";

  const attributes = detectAttributes(raw);

  return {
    raw,
    targets: targets.map((id) => CATEGORY_LABEL_EN.get(id) || id),
    targetCategories: targets,
    exclusive,
    keepCategories: [...keepSet],
    liked,
    attributes,
    intent,
    summary:
      buildQuery([
        attributes.color,
        attributes.material,
        targets.length
          ? targets.map((id) => CATEGORY_LABEL_RU.get(id) || id).join(", ")
          : null,
        intent === "remove" ? "убрать" : intent === "add" ? "добавить" : null,
      ]) || raw.slice(0, 80),
  };
}

/**
 * Image-edit prompt for a targeted change. Keeps the structure-freeze rules of
 * a full restyle, but narrows the "may change" area to the requested objects.
 */
export function buildInstructionPrompt(opts: {
  styleNameEn: string;
  instruction: ParsedInstruction;
  referenceUrlNote?: string;
}): string {
  const { instruction, styleNameEn } = opts;
  const targets = instruction.targets.length ? instruction.targets.join(", ") : "the elements described below";
  const keep = instruction.keepCategories.length
    ? instruction.keepCategories.map((id) => CATEGORY_LABEL_EN.get(id) || id).join(", ")
    : "";

  const changeVerb =
    instruction.intent === "remove"
      ? `REMOVE ${targets} completely and neatly close the gap (restore the wall/floor behind them).`
      : instruction.intent === "add"
      ? `ADD ${targets} that fit this room and its style.`
      : `REPLACE / RESTYLE ${targets} only.`;

  const attrLine = [
    instruction.attributes.color ? `color: ${instruction.attributes.color}` : null,
    instruction.attributes.material ? `material: ${instruction.attributes.material}` : null,
    instruction.attributes.feature ? `feature: ${instruction.attributes.feature}` : null,
    instruction.attributes.style ? `style: ${instruction.attributes.style}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return [
    `Targeted interior edit. The user's request (in their own words): "${instruction.raw}".`,
    changeVerb,
    attrLine ? `Requested attributes — ${attrLine}.` : "",
    `The rest of the room belongs to a "${styleNameEn}" interior and must stay EXACTLY as it is now.`,
    `CRITICAL — FREEZE EVERYTHING ELSE:`,
    `- Keep the same walls, partitions, floor plan, ceiling, floor finish, skirting and baseboards.`,
    `- Keep the same windows, window frames, doors and the view outside, pixel-plausible and unmodified.`,
    `- Keep the same camera angle, perspective, framing, aspect ratio and overall lighting.`,
    keep ? `- Also keep untouched: ${keep}.` : `- Keep every other furniture piece, textile, decor and fixture identical in shape, material, position and color.`,
    instruction.liked.length
      ? `The user explicitly likes these qualities of the current design — preserve them exactly while editing: ${instruction.liked.join("; ")}.`
      : `Keep every attribute the user did not mention exactly as it is.`,
    `- Do not add text, watermarks, labels, people or animals.`,
    `Blend the edited elements naturally: matching light, shadows, reflections and scale.`,
    `Photorealistic professional interior photography, sharp details.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Marketplace queries for the details this instruction touched. */
export function instructionQueries(instruction: ParsedInstruction, opts?: { styleTail?: string }) {
  const tail = [instruction.attributes.style, opts?.styleTail].filter(Boolean).join(" ");
  return instruction.targetCategories.map((id) => ({
    category: id,
    label: CATEGORY_LABEL_RU.get(id) || id,
    query: buildQuery([
      instruction.attributes.color,
      instruction.attributes.material,
      CATEGORY_LABEL_RU.get(id) || id,
      instruction.attributes.feature,
      tail,
    ]),
  }));
}
