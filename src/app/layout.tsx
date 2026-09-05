import "./globals.css";
import type { Metadata, Viewport } from "next";
import AppShell from "@/components/AppShell";
import { getSessionUser } from "@/lib/auth";
import { getLocale } from "@/lib/locale";
import { ensureSeeded } from "@/lib/config";
import { referralCount, grantedRewards } from "@/lib/billing";
import { ensureAdmin, ensureGalleryExamples } from "@/lib/bootstrap";

ensureSeeded();
ensureAdmin();
ensureGalleryExamples();

export const metadata: Metadata = {
  title: "Interier — Ремонт без дизайнера",
  description:
    "Загрузите фото комнаты и получите реалистичный дизайн-проект в любом стиле. Первая генерация бесплатно.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Interier",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0d12",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const user = getSessionUser();
  const locale = getLocale();
  return (
    <html lang={locale}>
      <body>
        <AppShell
          initialLocale={locale}
          initialUser={
            user
              ? {
                  id: user.id,
                  email: user.email,
                  name: user.name,
                  credits: user.credits,
                  trialUsed: user.trialUsed,
                  referralCode: user.referralCode,
                  referredBy: user.referredBy,
                  telegramId: user.telegramId,
                  vkId: user.vkId,
                  telegramGranted: grantedRewards(user.id).telegram,
                  vkGranted: grantedRewards(user.id).vk,
                  isAdmin: user.isAdmin,
                  referralCount: referralCount(user.id),
                }
              : null
          }
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
