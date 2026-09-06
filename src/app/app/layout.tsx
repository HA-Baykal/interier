import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Interier — приложение",
  description: "Дизайн интерьера по фото, список деталей и ссылки на магазины — прямо в мессенджере.",
};

/**
 * Messenger mini app shell.
 *
 * Loads the official Telegram WebApp SDK (defines `window.Telegram.WebApp`,
 * which the app uses for signed login, haptics and the back button). If the
 * script cannot load (offline preview, MAX/VK container) the app keeps working:
 * the bot simply hands over a one-time link token instead.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script src="https://telegram.org/js/telegram-web-app.js" data-tg-sdk />
      {children}
    </>
  );
}
