import { setTimeout as delay } from "node:timers/promises";
import { safeErrorMessage } from "../errors";
import { validateCompatibleConfig, type CompatibleConfig } from "./settings";

// One budget shared by both attempts, including reading the body and retry delay.
// The route has a 60s budget; storage probes run concurrently, not after this one.
export const PROVIDER_PROBE_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 300;

type ProbeCode = "accepted" | "access_denied" | "key_missing" | "configuration_error"
  | "timeout" | "network_error" | "http_error" | "unexpected_response";
type ProbeOutcome = {
  ok: boolean;
  code: ProbeCode;
  /** null means NOT verified, not that the provider rejected the key. */
  keyAccepted: boolean | null;
  httpStatus?: number;
  networkCode?: string;
  hasBalance?: boolean;
  message: string;
};
/** Read-only probe. Never creates a prediction or returns provider account details. */
export type ProbeResult = ProbeOutcome & { attempts: number; elapsedMs: number; timeoutMs: number };

const TIMEOUT_CODES = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
const TLS_CODES = new Set([
  "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_SSL_WRONG_VERSION_NUMBER", "EPROTO",
]);
const NETWORK_CODES = new Set([
  ...TIMEOUT_CODES, ...TLS_CODES, "ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ENOTFOUND", "EAI_AGAIN",
  "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN", "UND_ERR_SOCKET",
]);

/** Return only a known errno, never arbitrary cause/message/address/account data. */
function networkCode(error: unknown): string | undefined {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  for (let count = 0; pending.length && count < 16; count++) {
    const value = pending.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const item = value as { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof item.code === "string" && NETWORK_CODES.has(item.code)) return item.code;
    if (item.cause) pending.push(item.cause);
    if (Array.isArray(item.errors)) pending.push(...item.errors.slice(0, 5));
  }
  return undefined;
}

function transportFailure(error: unknown, signal: AbortSignal, httpStatus?: number): ProbeOutcome {
  const code = networkCode(error);
  const timeout = signal.aborted || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))
    || (code !== undefined && TIMEOUT_CODES.has(code));
  const message = timeout
    ? "Проверка API не завершилась вовремя. Ключ не проверен; это не означает, что он неверный."
    : code && TLS_CODES.has(code)
      ? "Не удалось установить защищённое соединение с API. Проверка ключа не выполнена; проверку TLS-сертификатов отключать не нужно."
      : "Не удалось связаться с API. Ключ не проверен; это ошибка соединения, а не подтверждение неверного ключа.";
  return {
    ok: false, keyAccepted: null, code: timeout ? "timeout" : "network_error", message,
    ...(code ? { networkCode: code } : {}), ...(httpStatus !== undefined ? { httpStatus } : {}),
  };
}

function unexpectedResponse(httpStatus: number): ProbeOutcome {
  return { ok: false, code: "unexpected_response", keyAccepted: null, httpStatus,
    message: "Ответ API не похож на ожидаемый JSON. Ключ не проверен. Проверьте Base URL и доступность API." };
}

function verifyResponse(data: unknown, cfg: CompatibleConfig, httpStatus: number): ProbeOutcome {
  if (!data || typeof data !== "object" || Array.isArray(data)) return unexpectedResponse(httpStatus);
  const body = data as Record<string, unknown>;
  const balance = body.balance;
  const validBalance = (typeof balance === "number" || (typeof balance === "string" && balance.trim() !== ""))
    && Number.isFinite(Number(balance));
  const valid = cfg.provider === "genapi" ? validBalance : Array.isArray(body.data);
  if (!valid) return unexpectedResponse(httpStatus);
  return { ok: true, code: "accepted", keyAccepted: true, httpStatus,
    ...(cfg.provider === "genapi" ? { hasBalance: Number(balance) > 0 } : {}),
    message: "Ключ принят. Это проверка доступа, не проверка генерации или доступности выбранной модели." };
}

export async function probeCompatible(cfg: CompatibleConfig): Promise<ProbeResult> {
  const started = performance.now();
  let attempts = 0;
  const finish = (outcome: ProbeOutcome): ProbeResult => ({
    ...outcome, attempts, elapsedMs: Math.round(performance.now() - started), timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
  });
  if (!cfg.apiKey) return finish({ ok: false, code: "key_missing", keyAccepted: null, message: "API-ключ не задан." });
  try { validateCompatibleConfig(cfg); }
  catch (e) {
    return finish({ ok: false, code: "configuration_error", keyAccepted: null, message: safeErrorMessage(e, [cfg.apiKey]) });
  }

  const endpoint = cfg.provider === "genapi" ? "/api/v1/user" : "/models";
  const signal = AbortSignal.timeout(PROVIDER_PROBE_TIMEOUT_MS);
  let outcome: ProbeOutcome;
  while (true) {
    attempts++;
    let response: Response | undefined;
    let retryable = false;
    try {
      response = await fetch(`${cfg.baseUrl}${endpoint}`, {
        method: "GET", // Only this read-only request may be retried, NEVER generation POSTs.
        headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: "application/json" },
        cache: "no-store", redirect: "error", signal,
      });
      if (response.status === 401 || response.status === 403) {
        return finish({ ok: false, code: "access_denied", keyAccepted: false, httpStatus: response.status,
          message: `Провайдер отклонил ключ или доступ (HTTP ${response.status}).` });
      }
      if (!response.ok) {
        // Never echo or wait for an upstream error body: it may contain private data.
        outcome = { ok: false, code: "http_error", keyAccepted: null, httpStatus: response.status,
          message: `API ответил HTTP ${response.status}. Проверка ключа не завершена; это не подтверждение неверного ключа.` };
        retryable = response.status >= 500 && response.status <= 599;
      } else {
        let data: unknown;
        try { data = await response.json(); }
        catch (e) {
          // An aborted body is NOT malformed JSON. Keep it as an unverified timeout.
          if (e instanceof SyntaxError && !signal.aborted) return finish(unexpectedResponse(response.status));
          throw e;
        }
        return finish(verifyResponse(data, cfg, response.status));
      }
    } catch (e) {
      outcome = transportFailure(e, signal, response?.status);
      retryable = !outcome.networkCode || !TLS_CODES.has(outcome.networkCode);
    } finally {
      // Cancel ignored bodies (including 401/5xx) so retries don't leak connections.
      // Do not let a stalled/corrupt body delay a status-only diagnostic.
      if (response?.body && !response.bodyUsed) void response.body.cancel().catch(() => {});
    }
    if (!retryable || attempts >= MAX_ATTEMPTS || signal.aborted) return finish(outcome);
    try { await delay(RETRY_DELAY_MS, undefined, { signal }); }
    catch {
      return finish({ ...outcome, code: "timeout",
        message: "Проверка API не завершилась вовремя. Ключ не проверен; это не означает, что он неверный." });
    }
  }
}
