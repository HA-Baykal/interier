/**
 * Marketplace catalog: interior-detail detection vocabulary + "where to buy"
 * deep links.
 *
 * Everything here is deliberately offline and deterministic: the module knows
 * how a Russian shopper actually formulates a query ("бежевые льняные шторы для
 * гостиной") and how to turn that query into a link on Ozon / Яндекс Маркет /
 * Лемана ПРО (бывш. «Леруа Мерлен») / Wildberries / Hoff / Петрович. We link to
 * *search* pages instead of scraping prices: it is fast, legal, never breaks and
 * always shows live availability and price to the user.
 *
 * A generated design therefore gets a `DesignItem[]` — a list of details. If the
 * AI detector also produced coordinates, the site shows hover hotspots on the
 * photo; otherwise (or if the photo is crowded) the same data renders as a list.
 */

import { DesignItem, OfferLink } from "./types";
import { uid } from "./db";

/* ------------------------------------------------------------------ */
/* Marketplaces                                                        */
/* ------------------------------------------------------------------ */

export type MarketplaceDef = {
  id: string;
  label: string;
  /** Short label for narrow messenger buttons. */
  short: string;
  emoji: string;
  /** Where this store is genuinely useful — used to avoid silly links. */
  strengths: ("furniture" | "textile" | "decor" | "lighting" | "build")[];
  /** `{q}` is replaced by the encoded query. */
  template: string;
  docs: string;
};

export const MARKETPLACES: MarketplaceDef[] = [
  {
    id: "ozon",
    label: "Ozon",
    short: "Ozon",
    emoji: "🛒",
    strengths: ["furniture", "textile", "decor", "lighting", "build"],
    template: "https://www.ozon.ru/search/?text={q}&from_global=true",
    docs: "https://www.ozon.ru",
  },
  {
    id: "yandex_market",
    label: "Яндекс Маркет",
    short: "Маркет",
    emoji: "🟡",
    strengths: ["furniture", "textile", "decor", "lighting", "build"],
    template: "https://market.yandex.ru/search?text={q}&on_websearch=1",
    docs: "https://market.yandex.ru",
  },
  {
    id: "leroy_merlin",
    // Leroy Merlin Russia was rebranded to «Лемана ПРО» (lemanapro.ru).
    // The old domain still serves shoppers, and the id stays for compatibility.
    label: "Лемана ПРО (Леруа Мерлен)",
    short: "Лемана ПРО",
    emoji: "🔧",
    strengths: ["build", "lighting", "textile", "furniture"],
    template: "https://www.lemanapro.ru/search/?q={q}",
    docs: "https://www.lemanapro.ru",
  },
  {
    id: "wildberries",
    label: "Wildberries",
    short: "WB",
    emoji: "🟣",
    strengths: ["textile", "decor", "lighting"],
    template: "https://www.wildberries.ru/catalog/0/search.aspx?search={q}",
    docs: "https://www.wildberries.ru",
  },
  {
    id: "hoff",
    label: "Hoff",
    short: "Hoff",
    emoji: "🛋️",
    strengths: ["furniture", "lighting", "textile"],
    template: "https://www.hoff.ru/search/?text={q}",
    docs: "https://www.hoff.ru",
  },
  {
    id: "petrovich",
    label: "Петрович (отделка)",
    short: "Петрович",
    emoji: "🧱",
    strengths: ["build"],
    template: "https://petrovich.ru/search/?query={q}",
    docs: "https://petrovich.ru",
  },
];

export const DEFAULT_MARKETPLACES = ["ozon", "yandex_market", "leroy_merlin"];

export function marketplaceById(id: string): MarketplaceDef | null {
  return MARKETPLACES.find((m) => m.id === id) || null;
}

/** Build a search URL for one marketplace. */
export function buildSearchUrl(def: MarketplaceDef, query: string, extraParams?: string): string {
  const q = encodeURIComponent(query.trim().slice(0, 180));
  let url = def.template.replace("{q}", q);
  const extra = (extraParams || "").trim();
  if (extra) {
    const clean = extra.replace(/^[?&]+/, "");
    if (clean) url += (url.includes("?") ? "&" : "?") + clean;
  }
  return url;
}

/* ------------------------------------------------------------------ */
/* Categories (what an interior is made of)                            */
/* ------------------------------------------------------------------ */

export type Category = {
  id: string;
  ru: string;
  en: string;
  /** Lowercase stems matched in free text (RU and EN). */
  stems: string[];
  /** Emoji used in messenger lists. */
  emoji: string;
  /** Natural tail appended to a query so results are room-aware. */
  tail?: string;
  kind: "furniture" | "textile" | "decor" | "lighting" | "build";
  /** Where users usually buy it (empty = everywhere). */
  shops?: string[];
};

export const CATEGORIES: Category[] = [
  { id: "sofa", ru: "Диван", en: "Sofa", stems: ["диван", "sofa", "couch"], emoji: "🛋️", tail: "для гостиной", kind: "furniture" },
  { id: "sofa_corner", ru: "Угловой диван", en: "Corner sofa", stems: ["угловой диван", "уголковый", "corner sofa"], emoji: "🛋️", tail: "угловой в гостиную", kind: "furniture", shops: ["ozon", "hoff", "yandex_market"] },
  { id: "armchair", ru: "Кресло", en: "Armchair", stems: ["кресл", "armchair"], emoji: "💺", tail: "для гостиной", kind: "furniture" },
  { id: "pouf", ru: "Пуф", en: "Pouf", stems: ["пуф", "осман", "pouf"], emoji: "🟠", kind: "furniture" },
  { id: "table_coffee", ru: "Журнальный столик", en: "Coffee table", stems: ["журнал", "кофейн", "coffee table"], emoji: "☕", tail: "журнальный", kind: "furniture" },
  { id: "table_dining", ru: "Обеденный стол", en: "Dining table", stems: ["обеден", "стол", "dining table"], emoji: "🍽️", tail: "обеденный", kind: "furniture" },
  { id: "table_side", ru: "Приставной столик", en: "Side table", stems: ["приставн", "side table"], emoji: "🪑", kind: "furniture" },
  { id: "desk", ru: "Рабочий стол", en: "Desk", stems: ["рабоч", "письменн", "desk"], emoji: "💻", tail: "компьютерный", kind: "furniture" },
  { id: "chair", ru: "Стул", en: "Chair", stems: ["стул", "chair"], emoji: "🪑", tail: "обеденный", kind: "furniture" },
  { id: "bed", ru: "Кровать", en: "Bed", stems: ["кровать", "кроват", "кроватью", "bed"], emoji: "🛏️", tail: "двуспальная", kind: "furniture" },
  { id: "nightstand", ru: "Прикроватная тумба", en: "Nightstand", stems: ["тумб", "nightstand"], emoji: "🌙", tail: "прикроватная", kind: "furniture" },
  { id: "wardrobe", ru: "Шкаф", en: "Wardrobe", stems: ["шкаф", "гардероб", "wardrobe"], emoji: "🚪", tail: "для одежды", kind: "furniture" },
  { id: "dresser", ru: "Комод", en: "Dresser", stems: ["комод", "dresser"], emoji: "🗄️", kind: "furniture" },
  { id: "tv_zone", ru: "Тумба под ТВ", en: "TV unit", stems: ["тв", "телевиз", "tv stand", "tv unit"], emoji: "📺", tail: "под телевизор", kind: "furniture" },
  { id: "shelf", ru: "Стеллаж", en: "Shelf", stems: ["стеллаж", "полк", "shelf", "shelving"], emoji: "📚", tail: "для книг", kind: "furniture" },
  { id: "curtains", ru: "Шторы", en: "Curtains", stems: ["штор", "гардин", "порьер", "curtain", "drape"], emoji: "🪟", tail: "в гостиную", kind: "textile" },
  { id: "tulle", ru: "Тюль", en: "Tulle", stems: ["тюль", "тюл", "voile", "tulle"], emoji: "🤍", kind: "textile", shops: ["ozon", "wildberries", "yandex_market"] },
  { id: "blinds", ru: "Жалюзи / рулонные шторы", en: "Blinds", stems: ["жалюз", "рулонн", "блэкаут", "blackout", "blinds"], emoji: "🎚️", kind: "textile", shops: ["ozon", "yandex_market", "leroy_merlin"] },
  { id: "pillows", ru: "Декоративные подушки", en: "Cushions", stems: ["подуш", "cushion", "pillow"], emoji: "🟡", tail: "декоративные", kind: "textile" },
  { id: "blanket", ru: "Плед", en: "Throw blanket", stems: ["плед", "покрывал", "blanket", "throw"], emoji: "🧣", kind: "textile" },
  { id: "rug", ru: "Ковер", en: "Rug", stems: ["ковер", "ковёр", "ковр", "rug", "carpet"], emoji: "🟫", tail: "для гостиной", kind: "textile" },
  { id: "bed_textile", ru: "Постельное бельё", en: "Bed linen", stems: ["постельн", "бель", "bedding", "linen set"], emoji: "🛏️", kind: "textile" },
  { id: "lighting_ceiling", ru: "Люстра", en: "Chandelier", stems: ["люстр", "потолочн", "chandelier", "ceiling light"], emoji: "💡", tail: "подвесная", kind: "lighting" },
  { id: "lamp_floor", ru: "Торшер", en: "Floor lamp", stems: ["торшер", "floor lamp"], emoji: "🕯️", kind: "lighting" },
  { id: "lamp_table", ru: "Настольная лампа", en: "Table lamp", stems: ["настольн", "table lamp", "ночник"], emoji: "🔅", kind: "lighting" },
  { id: "sconce", ru: "Бра", en: "Wall sconce", stems: ["бра", "sconce", "wall light"], emoji: "🔆", kind: "lighting" },
  { id: "track_light", ru: "Трековые светильники", en: "Track lights", stems: ["треков", "шинн", "track light"], emoji: "🎛️", kind: "lighting" },
  { id: "decor", ru: "Декор и постеры", en: "Decor & posters", stems: ["декор", "постер", "картин", "панно", "ваз", "frame", "decor", "poster"], emoji: "🖼️", tail: "для интерьера", kind: "decor" },
  // «цвет» без «ы/ок» — это цвет стены, а не цветы: голого «цвет» в стемах нет.
  { id: "plants", ru: "Растения и кашпо", en: "Plants & pots", stems: ["растен", "кашпо", "цветок", "цветы", "цветочн", "комнатн растен", "горш", "plant", "potted"], emoji: "🪴", kind: "decor" },
  { id: "mirror", ru: "Зеркало", en: "Mirror", stems: ["зеркал", "mirror"], emoji: "🪞", tail: "настенное", kind: "decor" },
  { id: "kitchen", ru: "Кухонный гарнитур", en: "Kitchen set", stems: ["кухн", "гарнитур", "kitchen"], emoji: "🍳", tail: "кухонный", kind: "furniture" },
  { id: "kitchen_appliances", ru: "Техника для кухни", en: "Kitchen appliances", stems: ["холодильник", "варочн", "вытяжк", "духов", "посудомой", "microwave"], emoji: "🔌", kind: "furniture" },
  { id: "tiles", ru: "Плитка и керамогранит", en: "Tiles", stems: ["плитк", "керамогранит", "мозаик", "tile"], emoji: "⬜", tail: "для ванной", kind: "build", shops: ["leroy_merlin", "petrovich", "yandex_market"] },
  { id: "flooring", ru: "Напольное покрытие", en: "Flooring", stems: ["ламинат", "паркет", "кварцвинил", "линолеум", "доск", "flooring", "laminate"], emoji: "🟨", tail: "кварцвиниловая плитка", kind: "build", shops: ["leroy_merlin", "petrovich", "yandex_market"] },
  { id: "paint", ru: "Краска для стен", en: "Wall paint", stems: ["краск", "эмаль", "штукатурк", "обои", "покрас", "paint", "plaster", "wallpaper"], emoji: "🎨", tail: "интерьерная", kind: "build", shops: ["leroy_merlin", "petrovich"] },
  { id: "door", ru: "Межкомнатная дверь", en: "Interior door", stems: ["двер", "door"], emoji: "🚪", tail: "межкомнатная", kind: "build" },
  { id: "bathroom", ru: "Сантехника", en: "Bathroom fixtures", stems: ["ванн", "унитаз", "раковин", "смесит", "душ", "bathtub", "faucet", "sink"], emoji: "🚿", kind: "build", shops: ["leroy_merlin", "petrovich", "yandex_market"] },
  { id: "ceiling", ru: "Потолок", en: "Ceiling", stems: ["потолк", "карниз", "лепнин", "ceiling", "moulding"], emoji: "⬆️", tail: "для потолка", kind: "build" },
  { id: "balcony", ru: "Балкон / лоджия", en: "Balcony", stems: ["балкон", "лоджи", "balcony"], emoji: "🌤️", tail: "для балкона", kind: "furniture" },
  { id: "hallway", ru: "Прихожая", en: "Hallway", stems: ["прихож", "вешал", "обувниц", "hallway", "coat rack"], emoji: "🧥", tail: "в прихожую", kind: "furniture" },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

export function categoryById(id: string | null | undefined): Category | null {
  if (!id) return null;
  return CATEGORIES.find((c) => c.id === id) || null;
}

export function normalizeText(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`.,;:!?()\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Which categories are mentioned in a piece of free text. */
/**
 * Stem matching anchored at a word start.
 *
 * Plain `includes()` made "тв" hit "декоративный" and "стол" hit "подстолье":
 * every category then claimed items it had nothing to do with, and the shopping
 * list filled with nonsense. A stem still matches prefixes of its own word
 * ("стул" → "стульев"), but only where a word begins.
 */
function stemHit(norm: string, stem: string): boolean {
  const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9a-zа-яё])${esc}`).test(norm);
}

export function matchCategories(text: string): Category[] {
  const norm = normalizeText(text);
  if (!norm) return [];
  const hits: { cat: Category; score: number }[] = [];
  for (const cat of CATEGORIES) {
    let score = 0;
    for (const stem of cat.stems) {
      const s = normalizeText(stem);
      if (!s) continue;
      if (stemHit(norm, s)) score += s.includes(" ") ? 3 : 2;
    }
    if (score > 0) hits.push({ cat, score });
  }
  // Drop generic hits that are contained in a stronger, more specific one
  // ("стул" inside "кресло-стул", "стол" inside "журнальный столик").
  const sorted = hits.sort((a, b) => b.score - a.score);
  const kept: Category[] = [];
  for (const h of sorted) {
    const covered = kept.some((k) => k.stems.some((s) => h.cat.stems.includes(s)));
    if (covered) continue;
    kept.push(h.cat);
  }
  return kept.slice(0, 8);
}

/* ------------------------------------------------------------------ */
/* Attributes (colors / materials / style) → better search queries     */
/* ------------------------------------------------------------------ */

type AttrDict = { words: string[]; canonical: string }[];

const COLORS: AttrDict = [
  { canonical: "белые", words: ["белый", "белые", "белая", "белое", "white"] },
  { canonical: "бежевые", words: ["бежевый", "бежевые", "бежевая", "беже", "beige", "cream", "кремов"] },
  { canonical: "серые", words: ["серый", "серые", "серая", "gray", "grey"] },
  { canonical: "графитовые", words: ["графит", "тёмно-сер", "темно-сер", "charcoal"] },
  { canonical: "чёрные", words: ["чёрн", "черн", "black"] },
  { canonical: "коричневые", words: ["коричнев", "brown", "кофейн"] },
  { canonical: "синие", words: ["синий", "синие", "navy", " navy", "темно-син"] },
  { canonical: "голубые", words: ["голуб", "light blue", "sky"] },
  { canonical: "зелёные", words: ["зелен", "olive", "оливк", "sage", "шалфей"] },
  { canonical: "жёлтые", words: ["жёлт", "желт", "mustard", "горчич", "yellow"] },
  { canonical: "оранжевые", words: ["оранжев", "terracotta", "терракот", "peach", "персик"] },
  { canonical: "розовые", words: ["розов", "pink", "пыльн", "dusty rose"] },
  { canonical: "бордовые", words: ["бордов", "марсал", "burgundy", "wine", "винный"] },
  { canonical: "фиолетовые", words: ["фиолет", "lilac", "сиренев", "purple", "violet"] },
  { canonical: "пастельные", words: ["пастельн", "pastel", "пудров"] },
  { canonical: "монохромные", words: ["монохром", "чб", "black and white"] },
];

const MATERIALS: AttrDict = [
  { canonical: "льняные", words: ["лён", "лен", "льнян", "linen"] },
  { canonical: "хлопковые", words: ["хлопок", "хлопков", "cotton"] },
  { canonical: "бархатные", words: ["бархат", "velvet", "вельвет"] },
  { canonical: "bouclé", words: ["букле", "boucle"] },
  { canonical: "кожаные", words: ["кожа", "кожан", "leather"] },
  { canonical: "экокожа", words: ["экокож", "faux leather", "искуственн"] },
  { canonical: "деревянные", words: ["дерево", "деревян", "массив", "wood", "oak", "дуб", "ясен", "ash"] },
  { canonical: "шпон", words: ["шпон", "veneer"] },
  { canonical: "ротанговые", words: ["ротанг", "бамбук", "rattan", "cane"] },
  { canonical: "металлические", words: ["металл", "steel", "сталь", "чугун"] },
  { canonical: "латунные", words: ["латунь", "brass", "медь", "copper"] },
  { canonical: "хромированные", words: ["хром", "chrome", "нержаве"] },
  { canonical: "стеклянные", words: ["стекло", "стеклян", "glass"] },
  { canonical: "зеркальные", words: ["зеркал", "mirror"] },
  { canonical: "мраморные", words: ["мрамор", "гранит", "marble", "каменн"] },
  { canonical: "керамогранит", words: ["керамогранит", "porcelain"] },
  { canonical: "бетонные", words: ["бетон", "microcement", "микроцемент"] },
  { canonical: "жаккардовые", words: ["жаккард", "рогожка", "рогожк", "вуаль", "вуал"] },
  { canonical: "трикотажные", words: ["трикот", "вязан", "knit"] },
];

const FEATURES: AttrDict = [
  { canonical: "на люверсах", words: ["люверс", "eyelet"] },
  { canonical: "на шторной ленте", words: ["лент", "крючк", "hook"] },
  { canonical: "раздвижные", words: ["раздвиж", "шторная лента", "двухстор"] },
  { canonical: "блэкаут", words: ["блэкаут", "blackout", "затемнен", "dimout"] },
  { canonical: "раскладные", words: ["расклад", "книжк", "дельфин", "аккордеон"] },
  { canonical: "угловые", words: ["углов", "corner"] },
  { canonical: "подвесные", words: ["подвес", "на подвесе", "wall mounted"] },
  { canonical: "напольные", words: ["напольн", "floor standing"] },
  { canonical: "компактные", words: ["компакт", "маленьк", "small", "узк"] },
  { canonical: "с ящиками", words: ["ящик", "с полками", "storage"] },
  { canonical: "теплый свет", words: ["тёпл", "тепл", "warm light", "2700"] },
  { canonical: "диммируемые", words: ["димм", "dimmable", "регулируем"] },
];

const STYLES: AttrDict = [
  { canonical: "в стиле минимализм", words: ["минимализ", "minimal"] },
  { canonical: "в стиле лофт", words: ["лофт", "loft", "индустриальн", "brutal"] },
  { canonical: "в скандинавском стиле", words: ["сканди", "скандинав", "nordic", "scandi"] },
  { canonical: "в стиле джапанди", words: ["джапанди", "japandi", "ваби"] },
  { canonical: "в стиле прованс", words: ["прованс", "provence", "кантри", "farmhouse"] },
  { canonical: "в классическом стиле", words: ["классик", "classic", "неоклассик", "ампир", "барокко"] },
  { canonical: "в стиле модерн", words: ["модерн", "art nouveau", "ar-deco", "ар-деко"] },
  { canonical: "в стиле бохо", words: ["бохо", "boho", "этно"] },
  { canonical: "в стиле мид-сенчури", words: ["мид-сенчури", "mid century", "mid-century", "50-х"] },
  { canonical: "в стиле хай-тек", words: ["хай-тек", "hi-tech", "техно", "футурист"] },
  { canonical: "в эко-стиле", words: ["эко-стиль", "эко ст", "eco ", "природ"] },
];

function detect(text: string, dict: AttrDict): string | null {
  const norm = normalizeText(text);
  if (!norm) return null;
  for (const entry of dict) {
    for (const w of entry.words) {
      const n = normalizeText(w);
      if (n && norm.includes(n)) return entry.canonical;
    }
  }
  return null;
}

export type ItemAttributes = { color: string | null; material: string | null; feature: string | null; style: string | null };

export function detectAttributes(text: string): ItemAttributes {
  return {
    color: detect(text, COLORS),
    material: detect(text, MATERIALS),
    feature: detect(text, FEATURES),
    style: detect(text, STYLES),
  };
}

/**
 * Compose a natural-sounding Russian search query for one detail.
 * e.g. "бежевые льняные шторы для гостиной"
 */
export function buildQuery(parts: (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const p = (raw || "").trim().replace(/\s+/g, " ");
    if (!p) continue;
    const key = normalizeText(p);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.join(" ").length > 120) break;
  }
  return out.join(" ");
}

/* ------------------------------------------------------------------ */
/* Item factory                                                        */
/* ------------------------------------------------------------------ */

export type ItemDraft = {
  /** Display name; falls back to the category name. */
  name?: string;
  nameEn?: string;
  category?: string | null;
  query?: string;
  color?: string | null;
  material?: string | null;
  bbox?: [number, number, number, number] | null;
  confidence?: number;
  source?: DesignItem["source"];
  changed?: boolean;
};

export function normalizeBbox(v: unknown): [number, number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const nums = v.map((n) => Number(n));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  // Accept 0..1 or 0..1000 (some models output the latter) or pixels-ish.
  let scale = 1;
  const max = Math.max(...nums);
  if (max > 1.0001 && max <= 1000) scale = 1000;
  let [x, y, w, h] = nums.map((n) => n / scale);
  // Some providers return [x1, y1, x2, y2].
  if (w < x || h < y) {
    const w2 = Math.max(0, w - x);
    const h2 = Math.max(0, h - y);
    w = w2;
    h = h2;
  }
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  x = clamp(x);
  y = clamp(y);
  w = clamp(w);
  h = clamp(h);
  if (w < 0.02 || h < 0.02) return null;
  if (x + w > 1.02) w = Math.max(0.05, 1 - x);
  if (y + h > 1.02) h = Math.max(0.05, 1 - y);
  return [Number(x.toFixed(4)), Number(y.toFixed(4)), Number(w.toFixed(4)), Number(h.toFixed(4))];
}

export function makeItem(
  draft: ItemDraft,
  opts: {
    enabled: MarketplaceDef[];
    extraParams?: string;
    defaultTail?: string;
  }
): DesignItem {
  const cat = categoryById(draft.category || undefined);
  const name = (draft.name || cat?.ru || "Деталь интерьера").trim().slice(0, 64);
  const nameEn = (draft.nameEn || cat?.en || "Interior item").trim().slice(0, 64);
  const color = draft.color ?? null;
  const material = draft.material ?? null;

  const query =
    (draft.query && draft.query.trim()) ||
    buildQuery([color, material, cat ? cat.ru.toLowerCase() : name.toLowerCase(), cat?.tail, opts.defaultTail]);

  const queryEn = buildQuery([material, cat ? cat.en.toLowerCase() : nameEn.toLowerCase()]);

  const links: OfferLink[] = buildLinks(query, {
    enabled: opts.enabled,
    extraParams: opts.extraParams,
    shops: cat?.shops,
    kind: cat?.kind,
  });

  return {
    id: uid("item"),
    name: name.charAt(0).toUpperCase() + name.slice(1),
    nameEn,
    category: cat?.id || "other",
    query,
    queryEn: queryEn || undefined,
    color,
    material,
    bbox: normalizeBbox(draft.bbox ?? null),
    confidence: Math.max(0, Math.min(1, Number(draft.confidence ?? 0.75) || 0.75)),
    source: draft.source || "heuristic",
    changed: draft.changed === true,
    links,
  };
}

export function buildLinks(
  query: string,
  opts: {
    enabled: MarketplaceDef[];
    extraParams?: string;
    /** Category hint: only these shops (if non-empty). */
    shops?: string[];
    kind?: Category["kind"];
  }
): OfferLink[] {
  let list = opts.enabled;
  if (opts.shops && opts.shops.length) {
    const filtered = list.filter((m) => opts.shops!.includes(m.id));
    if (filtered.length) list = filtered;
  }
  // Building-material categories rarely live on WB — filter by strengths.
  if (opts.kind) {
    const relevant = list.filter((m) => m.strengths.includes(opts.kind!));
    if (relevant.length) list = relevant;
  }
  return list.map((m) => ({
    marketplace: m.id,
    label: m.label,
    url: buildSearchUrl(m, query, opts.extraParams),
  }));
}

/** Rebuild every item's links (used when the admin changes marketplaces). */
export function relinkItems(
  items: DesignItem[],
  opts: { enabled: MarketplaceDef[]; extraParams?: string }
): DesignItem[] {
  return items.map((it) => {
    const cat = categoryById(it.category);
    return {
      ...it,
      links: buildLinks(it.query, {
        enabled: opts.enabled,
        extraParams: opts.extraParams,
        shops: cat?.shops,
        kind: cat?.kind,
      }),
    };
  });
}

/**
 * Fallback detector used when no vision model is configured (demo mode) or the
 * AI call failed: derive details from every piece of text we already have —
 * the style, the user's own words and the generation prompt.
 *
 * It never invents coordinates, so such lists render as a plain shopping list.
 */
export function heuristicItems(
  texts: (string | null | undefined)[],
  opts: {
    enabled: MarketplaceDef[];
    extraParams?: string;
    limit: number;
    changedCategories?: string[];
    styleTail?: string;
  }
): DesignItem[] {
  const blob = texts.filter(Boolean).join(" . ");
  const attrs = detectAttributes(blob);
  const matched = matchCategories(blob);
  const changed = new Set(opts.changedCategories || []);

  const chosen: Category[] = [];
  for (const id of changed) {
    const c = categoryById(id);
    if (c && !chosen.includes(c)) chosen.push(c);
  }
  for (const c of matched) if (!chosen.includes(c)) chosen.push(c);
  // Nothing at all — offer a tasteful starter set for a living room.
  if (chosen.length === 0) {
    for (const id of ["sofa", "rug", "curtains", "lighting_ceiling", "table_coffee", "decor"]) {
      const c = categoryById(id);
      if (c) chosen.push(c);
    }
  }

  return chosen.slice(0, Math.max(1, opts.limit)).map((c) =>
    makeItem(
      {
        category: c.id,
        color: attrs.color,
        material: attrs.material,
        source: "heuristic",
        changed: changed.has(c.id),
        confidence: changed.has(c.id) ? 0.95 : 0.55,
      },
      {
        enabled: opts.enabled,
        extraParams: opts.extraParams,
        defaultTail: [attrs.style, opts.styleTail].filter(Boolean).join(" ") || undefined,
      }
    )
  );
}
