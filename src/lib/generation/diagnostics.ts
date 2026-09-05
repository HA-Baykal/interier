import { safeErrorMessage } from "../errors";
import { validateCompatibleConfig, type CompatibleConfig } from "./settings";

/** Read-only probe. Never creates a prediction or returns provider account details. */
export type ProbeResult = { ok: boolean; httpStatus?: number; keyAccepted: boolean; hasBalance?: boolean; message: string };

export async function probeCompatible(cfg: CompatibleConfig): Promise<ProbeResult> {
  try {
    validateCompatibleConfig(cfg);
    const endpoint = cfg.provider === "genapi" ? "/api/v1/user" : "/models";
    const res = await fetch(`${cfg.baseUrl}${endpoint}`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Do not echo the upstream body: it may contain a token or personal data.
      return { ok: false, httpStatus: res.status, keyAccepted: false,
        message: res.status === 401 || res.status === 403 ? "Провайдер отклонил ключ или доступ (401/403)."
          : `Проверка провайдера завершилась с HTTP ${res.status}.` };
    }
    const data = await res.json().catch(() => null);
    const valid = cfg.provider === "genapi"
      ? data && typeof data.balance !== "undefined" && Number.isFinite(Number(data.balance))
      : data && Array.isArray(data.data);
    if (!valid) return { ok: false, httpStatus: res.status, keyAccepted: false, message: "Неожиданный ответ провайдера. Проверьте Base URL." };
    return { ok: true, httpStatus: res.status, keyAccepted: true,
      ...(cfg.provider === "genapi" ? { hasBalance: Number(data.balance) > 0 } : {}),
      message: "Ключ принят. Это проверка доступа, не проверка генерации или доступности выбранной модели." };
  } catch (e) {
    return { ok: false, keyAccepted: false, message: safeErrorMessage(e, [cfg.apiKey]) };
  }
}
