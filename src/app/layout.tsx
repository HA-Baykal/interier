import "./globals.css";
import type { Metadata, Viewport } from "next";
import AppShell from "@/components/AppShell";
import { getSessionUser } from "@/lib/auth";
import { getLocale } from "@/lib/locale";
import { ensureSeeded } from "@/lib/config";
import { referralCount, grantedRewards } from "@/lib/billing";
import { ensureAdmin, ensureGalleryExamples } from "@/lib/bootstrap";

// Seed once per server instance (idempotent). Top-level promise ensures the
// store is ready before the first render without duplicating work each request.
let bootPromise: Promise<void> | null = null;
function ensureBoot(): Promise<void> {
  if (!bootPromise) {
    bootPromise = (async () => {
      await ensureSeeded();
      await ensureAdmin();
      await ensureGalleryExamples();
    })();
  }
  return bootPromise;
}

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
  await ensureBoot();
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
