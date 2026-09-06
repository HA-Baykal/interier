"use client";

/**
 * Interier as a messenger application.
 *
 * This is the screen a user sees when they tap «📱 Открыть приложение» in the
 * Telegram bot (Mini App), in VK or in MAX. It is authenticated by the
 * messenger itself — Telegram via signed `initData`, VK/MAX via a one-time link
 * token the bot sends — so there is no second account, no password and no
 * email prompt. Everything the website can do is here: photo → style → design,
 * the shopping list of details with marketplace links, targeted edits by
 * words, history, bonuses, referrals, and the admin section for the owner.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { authHeaders, saveToken, getToken, clearToken } from "@/lib/client-auth";
import { useLocale } from "./locale-context";
import DesignItems from "./DesignItems";
import ImageComparison from "./ImageComparison";
import { downscaleImage } from "@/lib/client-image";
import { ClientStyle, ClientUser } from "./types";
import type { DesignItem, ShoppingList } from "@/lib/types";

type Gen = {
  id: string;
  styleId: string;
  styleSlug: string;
  styleName?: { ru: string; en: string };
  originalUrl: string;
  resultUrl: string | null;
  status: "processing" | "done" | "failed";
  provider: string;
  mode: "trial" | "credit" | "unlimited";
  published?: boolean;
  kind?: "design" | "edit";
  instruction?: string | null;
  createdAt?: number;
  shopping?: ShoppingList | null;
  demoConfig?: { filter: string; tint: string; vignette: number } | null;
  note?: string | null;
};

type Tab = "create" | "history" | "shop" | "account";

type TgWebApp = {
  ready?: () => void;
  expand?: () => void;
  initData?: string;
  initDataUnsafe?: { user?: { id: number; username?: string; first_name?: string; language_code?: string } };
  BackButton?: { show?: () => void; hide?: () => void; onClick?: (cb: () => void) => void; offClick?: (cb: () => void) => void };
  HapticFeedback?: { notification?: (t: "error" | "success" | "warning") => void; impactOccurred?: (s: "light" | "medium" | "heavy") => void };
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  openLink?: (url: string, opts?: { try_instant_view?: boolean }) => void;
  disableVerticalSwipes?: () => void;
};

function tg(): TgWebApp | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp || null;
}

export default function MiniApp({
  initialUser,
  styles,
  container,
}: {
  initialUser: ClientUser | null;
  styles: ClientStyle[];
  container: "telegram" | "vk" | "max" | "web";
}) {
  const { t, locale, setLocale } = useLocale();
  const [user, setUser] = useState<ClientUser | null>(initialUser);
  const [tab, setTab] = useState<Tab>("create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [styleId, setStyleId] = useState(styles[0]?.id ?? "");
  const [instruction, setInstruction] = useState("");

  const [current, setCurrent] = useState<Gen | null>(null);
  const [history, setHistory] = useState<Gen[]>([]);
  /** Before/after slider for the current design. */
  const [compare, setCompare] = useState(false);
  /** Full referral link (built on the client: SSR has no window). */
  const [refLink, setRefLink] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && user?.referralCode) {
      setRefLink(`${window.location.origin}/register?ref=${user.referralCode}`);
    }
  }, [user?.referralCode]);

  const refreshMe = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/me", { headers: authHeaders() });
      const d = await r.json();
      if (d?.user) setUser(d.user);
      else setUser(null);
    } catch {
      /* offline */
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const r = await fetch("/api/generations", { headers: authHeaders() });
      const d = await r.json();
      setHistory(d.generations || []);
    } catch {
      /* ignore */
    }
  }, []);

  /* --- container login -------------------------------------------------- */
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      // The SDK <script> may still be loading; give it a moment so initData
      // login works even on slow messenger webviews.
      for (let i = 0; i < 12 && !tg(); i++) await new Promise((r) => setTimeout(r, 100));
      const app = tg();
      try {
        app?.ready?.();
        app?.expand?.();
        app?.setHeaderColor?.("#0b0d12");
        app?.setBackgroundColor?.("#0b0d12");
        app?.disableVerticalSwipes?.();
      } catch {
        /* older clients */
      }

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
            window.history.replaceState({}, "", "/app");
          }
        } catch {
          /* fall through to the login form */
        }
      }

      // Telegram: signed initData is the strongest login, redeem it if present.
      const initData = tg()?.initData;
      if (initData) {
        try {
          const res = await fetch("/api/auth/telegram", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initData }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.token) saveToken(data.token);
        } catch {
          /* the link token flow still works */
        }
      }

      if (!cancelled) {
        await refreshMe();
        await refreshHistory();
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [refreshMe, refreshHistory]);

  /* --- back button: from a design back to the list ---------------------- */
  useEffect(() => {
    const app = tg();
    if (!app?.BackButton) return;
    const handler = () => {
      if (current) setCurrent(null);
      else if (tab !== "create") setTab("create");
      app.BackButton?.hide?.();
    };
    if (current || tab !== "create") app.BackButton.show?.();
    else app.BackButton.hide?.();
    app.BackButton.onClick?.(handler);
    return () => app.BackButton?.offClick?.(handler);
  }, [current, tab]);

  async function pick(f: File | null) {
    if (!f) return;
    setError(null);
    const processed = await downscaleImage(f);
    if (!processed) {
      setError(t("studio_upload_hint"));
      return;
    }
    setFile(processed);
    setPreview(URL.createObjectURL(processed));
    setCurrent(null);
  }

  async function generate() {
    if (!file) {
      setError(t("studio_upload"));
      return;
    }
    if (!styleId) {
      setError(t("studio_choose_style"));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("scope", "single");
      fd.append("styleId", styleId);
      if (instruction.trim()) fd.append("instruction", instruction.trim());
      const res = await fetch("/api/generate", { method: "POST", headers: authHeaders(), body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error === "no_credits" || data.error === "no_trial" ? t("studio_no_credits") : t("common_error"));
        return;
      }
      setCurrent((data.generations || [])[0] || null);
      setTab("create");
      tg()?.HapticFeedback?.notification?.("success");
      await refreshHistory();
      await refreshMe();
      setFile(null);
      setPreview(null);
    } catch {
      setError(t("common_error"));
    } finally {
      setBusy(false);
    }
  }

  async function applyEdit() {
    if (!current || instruction.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/generations/${current.id}/edit`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: instruction.trim(), styleId: styleId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error === "nothing_detected" ? t("edit_none") : t("common_error"));
        return;
      }
      setCurrent(data.generation);
      setInstruction("");
      tg()?.HapticFeedback?.notification?.("success");
      await refreshHistory();
      await refreshMe();
    } catch {
      setError(t("common_error"));
    } finally {
      setBusy(false);
    }
  }

  async function refreshShopping() {
    if (!current) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/generations/${current.id}/items`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.shopping) {
        setCurrent({ ...current, shopping: data.shopping });
        setNotice(t("shop_refreshed"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function addManual(label: string, x: number, y: number) {
    if (!current) return;
    const res = await fetch(`/api/generations/${current.id}/items`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", label, x, y }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.item) {
      setCurrent({
        ...current,
        shopping: { ...(current.shopping || { items: [], mode: "list", detector: "heuristic", updatedAt: Date.now() }), items: [...(current.shopping?.items || []), data.item] } as ShoppingList,
      });
    }
  }

  async function removeManual(item: DesignItem) {
    if (!current) return;
    await fetch(`/api/generations/${current.id}/items?item=${encodeURIComponent(item.id)}`, { method: "DELETE", headers: authHeaders() });
    setCurrent({ ...current, shopping: { ...(current.shopping as ShoppingList), items: (current.shopping?.items || []).filter((i) => i.id !== item.id) } });
  }

  async function togglePublish() {
    if (!current) return;
    const next = !current.published;
    await fetch(`/api/generations/${current.id}/publish`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ published: next }),
    });
    setCurrent({ ...current, published: next });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", headers: authHeaders() });
    clearToken();
    window.location.href = "/";
  }

  const items = current?.shopping?.items || [];

  /* ---------------- login screen ---------------- */
  if (!user) {
    return (
      <div className="app-shell">
        <div className="app-body" style={{ paddingTop: 40, maxWidth: 460 }}>
          <div className="app-card">
            <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("app_login_title")}</h1>
            <p className="small muted" style={{ marginTop: 8 }}>
              {t("app_login_hint")}
            </p>
            <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <a className="btn btn-primary btn-sm" href="/login">
                {t("nav_login")}
              </a>
              <a className="btn btn-ghost btn-sm" href="/register">
                {t("nav_register")}
              </a>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  if (tg()?.initData) window.location.reload();
                  else refreshMe();
                }}
              >
                🔄 {t("common_loading")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- tabs ---------------- */
  return (
    <div className="app-shell">
      <div className="app-head">
        <div style={{ fontWeight: 800 }}>🏠 Interier</div>
        <div className="row" style={{ gap: 8 }}>
          <span className="chip">✦ {user.credits}</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              const next = locale === "ru" ? "en" : "ru";
              fetch("/api/lang", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ locale: next }) }).then(
                () => window.location.reload()
              );
              setLocale?.(next as "ru" | "en");
            }}
          >
            {locale === "ru" ? "EN" : "RU"}
          </button>
        </div>
      </div>

      <div className="app-body">
        {tab === "create" && (
          <>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />

            {!preview ? (
              <div className="app-card center" style={{ padding: 26 }} onClick={() => fileRef.current?.click()}>
                <div style={{ fontSize: 34 }}>📷</div>
                <div style={{ fontWeight: 700, marginTop: 6 }}>{t("studio_upload")}</div>
                <div className="small muted">{t("studio_upload_hint")}</div>
                <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: "center" }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileRef.current?.click();
                    }}
                  >
                    {t("studio_upload")}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      camRef.current?.click();
                    }}
                  >
                    📸 {t("studio_take_photo")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="app-card">
                <img src={preview} alt="room" style={{ width: "100%", borderRadius: 10, display: "block" }} />
                <div className="row" style={{ gap: 8, marginTop: 10 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
                    {t("studio_reupload")}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setFile(null);
                      setPreview(null);
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            <div className="app-card">
              <div style={{ fontWeight: 700, marginBottom: 10 }}>{t("studio_choose_style")}</div>
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                {styles.map((s) => (
                  <button
                    key={s.id}
                    className="btn btn-sm"
                    style={styleId === s.id ? { borderColor: s.accent, background: s.accent + "22", color: "#fff" } : {}}
                    onClick={() => setStyleId(s.id)}
                  >
                    {locale === "ru" ? s.nameRu : s.nameEn}
                  </button>
                ))}
              </div>
            </div>

            <div className="app-card">
              <div style={{ fontWeight: 700 }}>✏️ {t("edit_title")}</div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {t("edit_hint")}
              </div>
              <textarea
                className="input"
                rows={2}
                style={{ width: "100%", marginTop: 10 }}
                placeholder={t("edit_placeholder")}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
              />
            </div>

            {error && <div className="err">{error}</div>}
            {notice && <div className="small muted">{notice}</div>}

            <button className="btn btn-primary" disabled={busy || !file} onClick={generate}>
              {busy ? t("studio_processing") : t("studio_gen_single")}
            </button>

            {current && (
              <div className="app-card">
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                  <strong>{current.kind === "edit" ? "✏️ " : "🎨 "}{current.styleName?.[locale === "ru" ? "ru" : "en"]}</strong>
                  <span className="chip">{current.provider}</span>
                </div>
                {compare && current.originalUrl && current.resultUrl && current.resultUrl !== current.originalUrl ? (
                  <ImageComparison
                    before={current.originalUrl}
                    after={current.resultUrl}
                    title={current.styleName?.[locale === "ru" ? "ru" : "en"]}
                  />
                ) : items.length ? (
                  <DesignItems
                    items={items}
                    imageUrl={current.resultUrl || current.originalUrl}
                    mode={current.shopping?.mode || "list"}
                    detector={current.shopping?.detector}
                    note={current.shopping?.note}
                    busy={busy}
                    onRefresh={refreshShopping}
                    onManualAdd={addManual}
                    onRemoveItem={removeManual}
                    onEditItem={(it) =>
                      setInstruction(
                        locale === "ru"
                          ? `замени только ${it.name.toLowerCase()} — ${it.query}; остальное не меняй`
                          : `replace only the ${it.nameEn || it.name} — ${it.queryEn || it.query}; keep everything else`
                      )
                    }
                  />
                ) : (
                  <img src={current.resultUrl || current.originalUrl} alt="design" style={{ width: "100%", borderRadius: 10, display: "block" }} />
                )}
                {current.instruction && <div className="small muted" style={{ marginTop: 8 }}>«{current.instruction}»</div>}
                <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={!current.originalUrl || !current.resultUrl || current.resultUrl === current.originalUrl}
                    onClick={() => setCompare((v) => !v)}
                  >
                    {compare ? t("studio_hide_compare") : t("studio_show_compare")}
                  </button>
                  <button className="btn btn-primary btn-sm" disabled={busy || instruction.trim().length < 2} onClick={applyEdit}>
                    {t("edit_run")}
                  </button>
                  <a className="btn btn-ghost btn-sm" href={current.resultUrl || current.originalUrl} download>
                    ⬇ {t("studio_download")}
                  </a>
                  <button className="btn btn-ghost btn-sm" onClick={togglePublish}>
                    {current.published ? t("gallery_unpublish") : t("gallery_publish")}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {tab === "history" && (
          <>
            <div style={{ fontWeight: 700 }}>{t("studio_history")}</div>
            {!history.length ? (
              <div className="app-card center muted">{t("bot_history_empty")}</div>
            ) : (
              <div className="app-grid">
                {history.map((h) => (
                  <button
                    className="app-tile"
                    key={h.id}
                    onClick={() => {
                      setCurrent(h);
                      setTab("create");
                    }}
                  >
                    <img src={h.resultUrl || h.originalUrl} alt="" loading="lazy" />
                    <div className="cap">
                      {h.kind === "edit" ? "✏️ " : "🎨 "}
                      {h.styleName?.[locale === "ru" ? "ru" : "en"]}
                      {!!h.shopping?.items.length && ` · 🛒 ${h.shopping.items.length}`}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "shop" && (
          <>
            <div style={{ fontWeight: 700 }}>🛒 {t("shop_title")}</div>
            {!items.length ? (
              <div className="app-card center muted">
                <div>{t("bot_items_none")}</div>
                {/* The detector's own reason (shopping switched off, image unreadable…) */}
                {current?.shopping?.note && <div className="small muted" style={{ marginTop: 6 }}>ℹ️ {current.shopping.note}</div>}
                <div className="small muted" style={{ marginTop: 6 }}>{t("shop_empty_action")}</div>
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} disabled={busy || !current} onClick={refreshShopping}>
                  🔄 {t("shop_refresh")}
                </button>
              </div>
            ) : (
              <div className="app-card">
                <DesignItems items={items} imageUrl="" mode="list" detector={current?.shopping?.detector} busy={busy} hideToggle onRefresh={refreshShopping} onRemoveItem={removeManual} />
              </div>
            )}
          </>
        )}

        {tab === "account" && (
          <>
            <div className="app-card">
              <div style={{ fontWeight: 700 }}>{user.name || user.email}</div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {t("account_credits")}: <b>{user.credits}</b>
              </div>
              <div className="small muted">{t("app_opened_from", { platform: container === "web" ? "web" : container })}</div>
            </div>

            <div className="app-card">
              <div style={{ fontWeight: 700 }}>{t("account_referral_title")}</div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {t("account_referral_desc")}
              </div>
              <div className="small muted" style={{ marginTop: 10 }}>
                {t("account_referral_full")}
              </div>
              {/* The whole link is visible and selectable: a truncated input in a
                  narrow webview showed only the code, so nobody could send it. */}
              <div className="ref-box" style={{ marginTop: 6, wordBreak: "break-all" }}>
                <span className="ref-link">{refLink || user.referralCode}</span>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(refLink || user.referralCode);
                    setNotice(t("account_copied"));
                    setTimeout(() => setNotice(null), 2000);
                  }}
                >
                  {t("account_copy")}
                </button>
                {refLink && (
                  <a className="btn btn-ghost btn-sm" href={refLink} target="_blank" rel="noreferrer">
                    {t("account_referral_open")}
                  </a>
                )}
              </div>
              <div className="small muted" style={{ marginTop: 6 }}>
                {t("account_invited", { n: user.referralCount })}
              </div>
            </div>

            {(user.telegramGranted === false || user.vkGranted === false) && (
              <div className="app-card">
                <div style={{ fontWeight: 700 }}>{t("rewards_title")}</div>
                <div className="small muted" style={{ marginTop: 4 }}>
                  {t("rewards_demo_note")}
                </div>
                <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  {!user.telegramGranted && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        const r = await fetch("/api/rewards/verify", {
                          method: "POST",
                          headers: { ...authHeaders(), "Content-Type": "application/json" },
                          body: JSON.stringify({ channel: "telegram", externalId: user.telegramId ?? undefined }),
                        });
                        const d = await r.json().catch(() => ({}));
                        setNotice(d?.granted ? t("rewards_connected") : t("rewards_connected"));
                        await refreshMe();
                      }}
                    >
                      ✈️ {t("rewards_connect")}
                    </button>
                  )}
                  {!user.vkGranted && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        const r = await fetch("/api/rewards/verify", {
                          method: "POST",
                          headers: { ...authHeaders(), "Content-Type": "application/json" },
                          body: JSON.stringify({ channel: "vk", externalId: user.vkId ?? undefined }),
                        });
                        await r.json().catch(() => ({}));
                        await refreshMe();
                      }}
                    >
                      💬 {t("rewards_connect")}
                    </button>
                  )}
                </div>
              </div>
            )}

            {user.isAdmin && (
              <a className="btn btn-ghost" href={withTokenSafe("/admin")}>
                🛠 {t("nav_admin")}
              </a>
            )}

            <a className="btn btn-ghost" href={withTokenSafe("/")}>
              🖥 {t("nav_landing")}
            </a>
            <button className="btn btn-ghost" onClick={logout}>
              {t("nav_logout")}
            </button>
          </>
        )}
      </div>

      <nav className="app-tabs">
        {(
          [
            ["create", "🎨", t("app_tab_create")],
            ["history", "🖼", t("app_tab_history")],
            ["shop", "🛒", t("app_tab_shop")],
            ["account", "👤", t("app_tab_account")],
          ] as [Tab, string, string][]
        ).map(([id, ico, label]) => (
          <button key={id} className={"app-tab" + (tab === id ? " on" : "")} onClick={() => setTab(id)}>
            <span className="ico">{ico}</span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Keep the session token in the URL for pages opened outside the app. */
function withTokenSafe(path: string): string {
  const token = getToken();
  if (!token) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}ses=${encodeURIComponent(token)}`;
}
