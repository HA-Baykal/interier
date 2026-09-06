export interface ClientUser {
  id: string;
  email: string | null;
  name: string;
  credits: number;
  trialUsed: boolean;
  referralCode: string;
  referredBy: string | null;
  telegramId: number | null;
  vkId: number | null;
  telegramGranted: boolean;
  vkGranted: boolean;
  isAdmin: boolean;
  verified?: boolean;
  telegramLinked?: boolean;
  referralCount: number;
}

export type ClientStyle = {
  id: string;
  slug: string;
  nameRu: string;
  nameEn: string;
  descRu: string;
  descEn: string;
  preview: string;
  accent: string;
  filter: string;
  tint: string;
  vignette: number;
  active: boolean;
};

export type ClientPackage = {
  id: string;
  slug: string;
  nameRu: string;
  nameEn: string;
  descRu: string;
  descEn: string;
  credits: number;
  price: number;
  badge: string | null;
};
