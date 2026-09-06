export type Locale = "ru" | "en";

export type StyleConfig = {
  /** CSS filters applied in demo mode, e.g. "brightness(1.08) contrast(1.05) saturate(1.15)" */
  filter: string;
  /** A subtle color-grade overlay tint inside the demo card */
  tint: string;
  /** Vignette strength 0..1 */
  vignette: number;
  /** Human readable accent color for this style's brand */
  accent: string;
};

export type Style = {
  id: string;
  slug: string;
  name: Record<Locale, string>;
  description: Record<Locale, string>;
  /** marketing preview image (path in /public) */
  preview: string;
  config: StyleConfig;
  active: boolean;
};

export type Package = {
  id: string;
  slug: string;
  name: Record<Locale, string>;
  description: Record<Locale, string>;
  credits: number;
  price: number; // in RUB, shown for future; payments disabled
  badge: Record<Locale, string> | null; // e.g. "Популярный"
  active: boolean;
};

export type User = {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  createdAt: number;
  credits: number;
  trialUsed: boolean;
  telegramId: number | null;
  telegramUsername: string | null;
  vkId: number | null;
  vkUsername: string | null;
  maxId?: number | null;
  maxUsername?: string | null;
  /** Bot that this account was created from (email/password may be absent). */
  origin?: BotPlatform | "web" | null;
  /** Locale preferred inside the messenger app. */
  prefLocale?: Locale | null;
  referralCode: string;
  referredBy: string | null;
  isAdmin: boolean;
};

export type BotPlatform = "telegram" | "vk" | "max";

/**
 * A purchasable interior detail detected on a generated design.
 *
 * `bbox` is `[x, y, w, h]` in **normalized** image coordinates (0..1) so the
 * same data works for hover hotspots on the site and for a plain list inside a
 * messenger, where an interactive image is impossible. `null` = we know *what*
 * is in the design but not *where* — such items are shown in the list only.
 */
export type DesignItem = {
  id: string;
  name: string;
  nameEn: string;
  /** Catalog category id (e.g. "curtains"), or "other". */
  category: string;
  /** Ready-to-use marketplace search query (Russian by default). */
  query: string;
  queryEn?: string;
  color?: string | null;
  material?: string | null;
  bbox: [number, number, number, number] | null;
  confidence: number;
  source: "ai" | "heuristic" | "manual";
  /** True when this detail was the target of the last edit instruction. */
  changed?: boolean;
  links: OfferLink[];
};

export type OfferLink = {
  /** Marketplace id, see src/lib/marketplaces.ts */
  marketplace: string;
  label: string;
  url: string;
};

export type ShoppingList = {
  items: DesignItem[];
  /** How complete the detection is — drives the UI (hotspots vs. plain list). */
  mode: "hotspots" | "list";
  /** Generation note about the detector: "ai" | "heuristic" | "off". */
  detector: "ai" | "heuristic" | "off";
  note?: string | null;
  updatedAt: number;
};

export type Session = {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
};

export type Generation = {
  id: string;
  userId: string;
  styleId: string;
  originalId: string;
  /** Explicit original URL; fallback is `/api/uploads/{originalId}`. */
  originalUrl?: string;
  resultUrl: string | null;
  status: "processing" | "done" | "failed";
  error: string | null;
  mode: "trial" | "credit" | "unlimited";
  provider: string;
  createdAt: number;
  /** Whether the owner opted to showcase this design in the public gallery. */
  published: boolean;
  /**
   * "design"  — a full restyle of the uploaded photo.
   * "edit"    — a targeted rewrite produced from a free-text instruction
   *             ("замени только шторы"), based on `parentGenerationId`.
   */
  kind?: "design" | "edit";
  /** The user's own words describing what to change. */
  instruction?: string | null;
  /** Previous design this edit was derived from. */
  parentGenerationId?: string | null;
  /** Catalog categories the instruction targeted (e.g. ["curtains"]). */
  changedCategories?: string[];
  /** Interior details with marketplace links. */
  shopping?: ShoppingList | null;
  /** Where this generation was launched from. */
  origin?: BotPlatform | "web" | null;
};

/**
 * Conversation state of one messenger chat. All three bots (Telegram, VK, MAX)
 * share this record and one engine, so a chat behaves identically everywhere.
 */
export type BotChat = {
  id: string;
  platform: BotPlatform;
  /** Chat/dialog id used when sending messages on that platform. */
  chatId: string;
  /** Messenger user id (Telegram/VK/MAX numeric id, as string for safety). */
  externalId: string;
  username: string | null;
  displayName: string | null;
  /** Linked Interier account, if any. */
  userId: string | null;
  /** Machine-readable conversation state (see src/lib/bots/engine.ts). */
  step: string;
  styleId: string | null;
  /** Uploaded room photo kept for the pending flow (upload id). */
  pendingPhotoId: string | null;
  pendingPhotoUrl: string | null;
  /** Latest finished design in this chat — target for "change only X". */
  lastGenerationId: string | null;
  /** Free-text wish typed before the style is picked. */
  pendingInstruction: string | null;
  /** Item the user chose to edit (id in the design's shopping list). */
  editItemId: string | null;
  /** Message used to show progress so it can be edited instead of spammed. */
  progressMessageId: string | null;
  locale: Locale;
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
  /** Adapter-specific scratch space (VK label map, MAX message ids, ...). */
  extra?: Record<string, unknown> | null;
};

/** One-time token that links a messenger account to a web/mini-app session. */
export type BotLinkToken = {
  token: string;
  platform: BotPlatform | "web";
  chatId: string;
  externalId: string;
  userId: string | null;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
};

/** Public view model for the gallery (never exposes the owner identity). */
export type GalleryItem = {
  id: string;
  styleSlug: string;
  styleName: Record<Locale, string>;
  originalUrl: string;
  resultUrl: string;
  provider: string;
  createdAt: number;
  /**
   * Public shopping list — only present while `shopping_public_links` is on.
   * A deliberately reduced copy of `DesignItem`: internal ids, confidence and
   * detector provenance never leave the server.
   */
  shopping?: PublicShopping | null;
};

export type PublicShoppingItem = {
  name: string;
  nameEn: string;
  query: string;
  queryEn?: string;
  bbox: [number, number, number, number] | null;
  links: { label: string; url: string }[];
};

export type PublicShopping = {
  items: PublicShoppingItem[];
  mode: "hotspots" | "list";
};

export type Reward = {
  id: string;
  userId: string;
  channel: "telegram" | "vk";
  granted: boolean;
  createdAt: number;
  grantedAt: number | null;
};

export type Referral = {
  id: string;
  referrerId: string;
  referredEmail: string;
  referredUserId: string | null;
  rewarded: boolean;
  createdAt: number;
};

export type Setting = {
  key: string;
  value: string;
};

export type DbShape = {
  users: User[];
  sessions: Session[];
  generations: Generation[];
  rewards: Reward[];
  referrals: Referral[];
  styles: Style[];
  packages: Package[];
  settings: Setting[];
  botChats: BotChat[];
  botLinks: BotLinkToken[];
};
