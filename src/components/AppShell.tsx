"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LocaleContext } from "./locale-context";
import { ClientUser } from "./types";
import { Locale } from "@/lib/types";
import { t } from "@/lib/i18n";
import { clearToken, authHeaders, withToken, saveToken } from "@/lib/client-auth";

function Logo({ locale }: { locale: Locale }) {
  return (
    <Link href="/" className="logo">
      <span className="logo-mark">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M3 21V9l9-6 9 6v12" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 21v-8h6v8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      Interier
    </Link>
  );
}

export default function AppShell({
  children,
  initialUser,
  initialLocale,
}: {
  children: React.ReactNode;
  initialUser: ClientUser | null;
  initialLocale: Locale;
}) {
  const pathname = usePathname();
  const [user, setUser] = useState<ClientUser | null>(initialUser);
  const [locale, setLocale] = useState<Locale>(initialLocale);

  // Telegram WebApp initialization and auto-auth
  useEffect(() => {
    let cancelled = false;

    async function initTelegramAndAuth() {
      if (typeof window === "undefined") return;

      // Initialize Telegram WebApp if present
      const tg = (window as unknown as { Telegram?: { WebApp?: any } })?.Telegram?.WebApp;
      if (tg) {
        try {
          tg.ready?.();
          tg.expand?.();
          tg.setHeaderColor?.("#0b0d12");
          tg.setBackgroundColor?.("#0b0d12");
        } catch {
          /* ignore */
        }
      }

      // Check URL query parameters: ?link=... or ?ses=...
      const params = new URLSearchParams(window.location.search);
      const link = params.get("link");
      if (link) {
        try {
          const res = await fetch("/api/auth/link", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: link }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.token) {
            saveToken(data.token);
            const cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.delete("link");
            window.history.replaceState({}, "", cleanUrl.toString());
          }
        } catch {
          /* ignore */
        }
      }

      const ses = params.get("ses");
      if (ses) {
        saveToken(ses);
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("ses");
        window.history.replaceState({}, "", cleanUrl.toString());
      }

      // If Telegram initData is present, authenticate with it
      const initData = tg?.initData;
      if (initData) {
        try {
          const res = await fetch("/api/auth/telegram", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initData }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.token) {
            saveToken(data.token);
          }
        } catch {
          /* ignore */
        }
      }

      // Refresh /api/auth/me to populate user state
      try {
        const r = await fetch("/api/auth/me", { headers: authHeaders() });
        const d = await r.json();
        if (!cancelled && d?.user) {
          setUser(d.user);
        }
      } catch {
        /* ignore */
      }
    }

    void initTelegramAndAuth();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  function toggleLang(loc: Locale) {
    if (loc === locale) return;
    setLocale(loc);
    fetch("/api/lang", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ locale: loc }),
    }).then(() => window.location.reload());
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", headers: authHeaders() });
    clearToken();
    // Full navigation so the expired cookie is definitely dropped.
    window.location.href = "/";
  }

  const navItems = [
    { href: "/", label: t(locale, "nav_landing"), show: true },
    { href: "/studio", label: t(locale, "nav_studio"), show: true },
    { href: "/gallery", label: t(locale, "nav_gallery"), show: true },
    { href: "/#pricing", label: t(locale, "nav_pricing"), show: true },
    { href: "/account", label: t(locale, "nav_account"), show: true },
    { href: "/admin", label: t(locale, "nav_admin"), show: !!user && user.isAdmin },
  ];

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href.includes("#")) return false;
    return pathname.startsWith(href);
  };

  return (
    <LocaleContext.Provider value={{ locale, t: (k, v) => t(locale, k, v), setLocale }}>
      <header className="header">
        <div className="container header-inner">
          <Logo locale={locale} />
          <nav className="nav">
            {navItems
              .filter((n) => n.show)
              .map((n) => (
                <Link key={n.href} href={withToken(n.href)} className={isActive(n.href) ? "active" : ""}>
                  {n.label}
                </Link>
              ))}
          </nav>
          <div className="header-right">
            {user && (
              <span className="chip">
                {t(locale, "studio_credits", { n: user.credits })}
              </span>
            )}
            <div className="lang-switch">
              <button className={locale === "ru" ? "on" : ""} onClick={() => toggleLang("ru")}>
                RU
              </button>
              <button className={locale === "en" ? "on" : ""} onClick={() => toggleLang("en")}>
                EN
              </button>
            </div>
            {user ? (
              <button onClick={logout} className="btn btn-ghost btn-sm">
                {t(locale, "nav_logout")}
              </button>
            ) : (
              <>
                <Link href="/login" className="btn btn-ghost btn-sm">
                  {t(locale, "nav_login")}
                </Link>
                <Link href="/register" className="btn btn-primary btn-sm">
                  {t(locale, "nav_register")}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="footer">
        <div className="container footer-inner">
          <span>© {new Date().getFullYear()} Interier. {t(locale, "footer_rights")}</span>
          <span>{t(locale, "footer_made")}</span>
        </div>
      </footer>
    </LocaleContext.Provider>
  );
}
