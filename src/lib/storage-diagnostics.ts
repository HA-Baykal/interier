import { put, del } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { probeDatabase, storageMode } from "./db";
import { safeErrorMessage } from "./errors";
import { blobPrefix, isVercel, missingStorageEnvironment, redisConnection, redisDbKey, blobAuthentication, blobAuthOptions } from "./storage-config";
import { uploadStorageMode } from "@/app/api/upload/service";

export function storageStatus() {
  const authentication = blobAuthentication();
  const blobConfigured = authentication !== "unconfigured";
  const database = storageMode();
  return {
    database,
    uploads: blobConfigured ? "blob" : isVercel() ? "unconfigured" : uploadStorageMode(),
    redisConfigured: redisConnection().configured,
    blobConfigured,
    blobAuthentication: authentication,
    databaseKey: redisDbKey(),
    ephemeralStorage: database === "memory" || (isVercel() && !blobConfigured),
    missingEnvironment: missingStorageEnvironment(),
  };
}

/** Tiny write/read/delete probe in a dedicated prefix, never a user's photo. */
export async function probeBlob(): Promise<{ ok: boolean; message: string; cleanup?: boolean }> {
  if (blobAuthentication() === "unconfigured") return { ok: !isVercel(), message: "Vercel Blob не подключён; фото сохраняются только локально." };
  const authOptions = blobAuthOptions();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2Z8AAAAASUVORK5CYII=", "base64");
  let url: string | null = null;
  let result = { ok: false, message: "Blob: проверка не завершена.", cleanup: true };
  try {
    const blob = await put(`${blobPrefix()}/_health/${randomUUID()}.png`, png, {
      access: "public", contentType: "image/png", addRandomSuffix: false,
      ...authOptions, abortSignal: AbortSignal.timeout(10_000),
    });
    url = blob.url;
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6_000) });
    const bytes = response.ok ? Buffer.from(await response.arrayBuffer()) : null;
    result = { ok: !!bytes?.equals(png), message: bytes?.equals(png)
      ? "Blob: запись и чтение фото работают."
      : `Blob: фото после записи недоступно или повреждено (HTTP ${response.status}).`, cleanup: true };
  } catch (e) {
    result.message = safeErrorMessage(e);
  } finally {
    if (url) {
      try { await del(url, { ...authOptions, abortSignal: AbortSignal.timeout(5_000) }); }
      catch { result.cleanup = false; }
    }
  }
  return result;
}

export async function probeStorage() {
  const [database, uploads] = await Promise.all([probeDatabase(), probeBlob()]);
  return { database, uploads };
}
