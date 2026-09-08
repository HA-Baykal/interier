/**
 * Webhook diagnostics — why does the bot answer the way it does?
 *
 * A Telegram bot has exactly one webhook, and whichever deployment registered
 * it last is the deployment that answers the chat. When a Preview (or an older
 * version of the site) still owns the webhook, the production panel happily
 * reports «подключено» while users keep receiving the old replies — most often
 * the login-only bot («этот бот подтверждает вход»). This module reads
 * `getWebhookInfo` and turns it into a plain explanation for the admin panel.
 *
 * The URL may contain the Vercel automation bypass secret, so it is stripped
 * before anything leaves the server.
 */

import { RequestError, safeErrorMessage } from "../errors";

export const BYPASS_PARAM = "x-vercel-protection-bypass";

/** Remove the automation bypass secret from a webhook URL (Telegram stores it). */
export function stripAutomationSecret(url: string | null | undefined): { url: string | null; hadBypass: boolean } {
  if (!url) return { url: null, hadBypass: false };
  try {
    const parsed = new URL(url);
    const hadBypass = parsed.searchParams.has(BYPASS_PARAM);
    parsed.searchParams.delete(BYPASS_PARAM);
    return { url: parsed.href, hadBypass };
  } catch {
    return { url: null, hadBypass: false };
  }
}

function sameTarget(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname && x.search === y.search;
  } catch {
    return false;
  }
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function pathOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function epochMs(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n * 1000 : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function strArray(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : null;
}

export type WebhookReportCode =
  | "ok"
  | "check_failed"
  | "not_registered"
  | "other_deployment"
  | "foreign_webhook"
  | "delivery_errors"
  | "pending_updates";

export type TelegramWebhookReport = {
  ok: boolean;
  code: WebhookReportCode;
  /** Webhook URL without the automation secret. */
  url: string | null;
  /** What this deployment would register. */
  expectedUrl: string | null;
  host: string | null;
  expectedHost: string | null;
  hadBypass: boolean;
  matches: boolean;
  /** `false` when the webhook belongs to another host (e.g. a Preview). */
  sameDeployment: boolean | null;
  pendingUpdates: number;
  lastError: string | null;
  lastErrorAt: number | null;
  lastSyncErrorAt: number | null;
  maxConnections: number | null;
  allowedUpdates: string[] | null;
  /** Which setting produced the public address of this deployment. */
  originSource: string | null;
  /** Ready-to-show Russian explanation. */
  message: string;
};

export type WebhookReportInput = {
  info: Record<string, unknown> | null;
  expectedUrl: string | null;
  requestOrigin?: string | null;
  originSource?: string | null;
  /** Set when `getWebhookInfo` itself failed (already scrubbed of secrets). */
  failure?: string | null;
};

/** Pure part of the diagnostics — unit-testable without network. */
export function webhookReport(input: WebhookReportInput): TelegramWebhookReport {
  const info = input.info || {};
  const expected = stripAutomationSecret(input.expectedUrl).url;
  const current = stripAutomationSecret(str(info.url));
  const url = current.url;
  const matches = sameTarget(url, expected);
  const requestHost = hostOf(input.requestOrigin || null);
  const sameDeployment = url && requestHost ? hostOf(url) === requestHost : null;
  const lastError = str(info.last_error_message);
  const pending = Number(info.pending_update_count);
  const pendingUpdates = Number.isSafeInteger(pending) && pending > 0 ? pending : 0;
  const maxConnections = Number(info.max_connections);

  let code: WebhookReportCode = "ok";
  if (input.failure) code = "check_failed";
  else if (!url) code = "not_registered";
  else if (expected && !matches) code = sameDeployment === false ? "other_deployment" : "foreign_webhook";
  else if (lastError) code = "delivery_errors";
  else if (pendingUpdates) code = "pending_updates";

  const lines: string[] = [];
  switch (code) {
    case "check_failed":
      lines.push(`Не удалось прочитать webhook_info: ${input.failure}. Проверьте токен и доступ к api.telegram.org.`);
      break;
    case "not_registered":
      lines.push("Webhook не зарегистрирован: бот не получает сообщения и молчит. Нажмите «Подключить бота к этой версии».");
      break;
    case "other_deployment":
    case "foreign_webhook":
      lines.push(
        `Webhook сейчас на ${url} — а эта версия ждёт ${expected}. Сообщения бота обрабатывает другой адрес, поэтому в чате остаются старые ответы (например, только подтверждение входа).`
      );
      lines.push("Поставьте флажок «переключить бота на эту версию» и нажмите «Подключить».");
      break;
    case "delivery_errors":
      lines.push(`Telegram сообщает об ошибке доставки: ${lastError}${input.expectedUrl ? "" : ""}.`);
      break;
    case "pending_updates":
      lines.push(`В очереди Telegram ${pendingUpdates} недоставленных сообщений — они придут, как только адрес снова станет доступным.`);
      break;
    default:
      lines.push("Webhook указывает на эту версию, ошибок доставки нет — сообщения доходят.");
  }

  // An unstable public address is the usual reason a webhook ends up on a
  // Preview: VERCEL_BRANCH_URL is different for every deployment.
  if (code !== "check_failed" && input.originSource === "VERCEL_BRANCH_URL") {
    lines.push(
      "Адрес сайта берётся из VERCEL_BRANCH_URL и меняется от деплоя к деплою. Задайте AUTH_PUBLIC_URL (https://… вашего прода), иначе webhook снова уедет на Preview."
    );
  }

  return {
    ok: code === "ok",
    code,
    url,
    expectedUrl: expected,
    host: hostOf(url),
    expectedHost: hostOf(expected),
    hadBypass: current.hadBypass,
    matches,
    sameDeployment,
    pendingUpdates,
    lastError,
    lastErrorAt: epochMs(info.last_error_date),
    lastSyncErrorAt: epochMs(info.last_synchronization_error_date),
    maxConnections: Number.isSafeInteger(maxConnections) && maxConnections > 0 ? maxConnections : null,
    allowedUpdates: strArray(info.allowed_updates),
    originSource: input.originSource || null,
    message: lines.join("\n"),
  };
}

export type WebhookReportOptions = {
  token: string;
  expectedUrl: string | null;
  requestOrigin?: string | null;
  originSource?: string | null;
};

/** Live `getWebhookInfo` → report. Never throws: a failed probe is itself a result. */
export async function fetchTelegramWebhookReport(options: WebhookReportOptions): Promise<TelegramWebhookReport> {
  const base: WebhookReportInput = {
    info: null,
    expectedUrl: options.expectedUrl,
    requestOrigin: options.requestOrigin,
    originSource: options.originSource,
  };
  let info: Record<string, unknown>;
  try {
    const response = await fetch(`https://api.telegram.org/bot${options.token}/getWebhookInfo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      const detail = typeof data?.description === "string" ? data.description : `HTTP ${response.status}`;
      throw new RequestError("telegram_api_failed", detail, 502);
    }
    info = (data.result || {}) as Record<string, unknown>;
  } catch (e) {
    return webhookReport({ ...base, failure: safeErrorMessage(e, [options.token]) });
  }
  return webhookReport({ ...base, info });
}
