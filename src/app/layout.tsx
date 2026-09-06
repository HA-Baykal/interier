import { isIdentityVerified } from "@/lib/identity";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import AppShell from "@/components/AppShell";
import { getSessionUser } from "@/lib/auth";
import { getLocale } from "@/lib/locale";
import { referralCount, grantedRewards } from "@/lib/billing";
import { ensureBootSafe } from "@/lib/boot";

// Never seed or cache user data during a Vercel build.
export const dynamic = "force-dynamic";

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await ensureBootSafe();
  const user = await getSessionUser();
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
                  telegramGranted: (await grantedRewards(user.id)).telegram,
                  vkGranted: (await grantedRewards(user.id)).vk,
                  isAdmin: user.isAdmin,
        verified: isIdentityVerified(user),
                  referralCount: await referralCount(user.id),
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
