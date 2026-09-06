import type { ImageQuality } from "./generation/quality";

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
  referralCode: string;
  referredBy: string | null;
  isAdmin: boolean;
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
  /** Actual request quality for GPT Image 2; absent on legacy/other-model records. */
  quality?: ImageQuality;
  resolution?: string;
  testProfile?: string;
  /** Public-tariff estimate, never reported as an actual debit. */
  estimatedCostRub?: number;
  durationMs?: number;
  createdAt: number;
  /** Whether the owner opted to showcase this design in the public gallery. */
  published: boolean;
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
};
