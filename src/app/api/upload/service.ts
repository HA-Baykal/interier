import fs from "fs";
import path from "path";
import { uid } from "@/lib/db";
import { assertDurableUploads, blobPrefix, blobAuthentication, blobAuthOptions } from "@/lib/storage-config";

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");
const MIME_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
let inlineFallback = false;

export function imageMime(buffer: Buffer): string | null {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export function isBlobStorage(): boolean {
  return blobAuthentication() !== "unconfigured";
}

export function uploadStorageMode(): "blob" | "file" | "inline" {
  return isBlobStorage() ? "blob" : inlineFallback ? "inline" : "file";
}

/** Originals AND provider results must use the same durable storage. */
export async function saveUpload(buffer: Buffer, mime: string): Promise<{ id: string; ext: string; url: string }> {
  assertDurableUploads();
  const ext = MIME_MAP[mime];
  if (!ext || imageMime(buffer) !== mime) throw new Error("Unsupported image: use a valid JPEG, PNG or WebP");
  const id = uid("up");

  if (isBlobStorage()) {
    const { put } = await import("@vercel/blob");
    // A configured-but-broken Blob must NOT silently fall back to ephemeral data.
    const { url } = await put(`${blobPrefix()}/${id}.${ext}`, buffer, {
      access: "public",
      addRandomSuffix: false,
      contentType: mime,
      ...blobAuthOptions(),
      abortSignal: AbortSignal.timeout(25_000),
    });
    return { id, ext, url };
  }

  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, `${id}.${ext}`), buffer);
    return { id, ext, url: `/api/uploads/${id}.${ext}` };
  } catch (e) {
    if (!["EROFS", "EACCES", "EPERM"].includes((e as NodeJS.ErrnoException).code || "")) throw e;
    if (!inlineFallback) console.warn("[interier/uploads] Read-only filesystem. Inline preview only; configure Vercel Blob for persistent photos.");
    inlineFallback = true;
    // A process-local Map cannot serve a later request on another Vercel instance.
    // An inline preview at least survives the current response. Not a Blob substitute.
    return { id, ext, url: `data:${mime};base64,${buffer.toString("base64")}` };
  }
}

export function resolveImageUrl(ref: string): string {
  if (/^https?:\/\//.test(ref) || ref.startsWith("/api/uploads/") || ref.startsWith("data:")) return ref;
  return `/api/uploads/${ref}`;
}

/** Accept both old extensionless IDs and current filenames. Never create on read. */
export function findUpload(file: string): string | null {
  if (!/^up_[a-zA-Z0-9_-]+(?:\.(?:jpg|jpeg|png|webp))?$/.test(file)) return null;
  if (!fs.existsSync(UPLOAD_DIR)) return null;
  const candidates = file.includes(".") ? [file] : ["jpg", "jpeg", "png", "webp"].map((ext) => `${file}.${ext}`);
  for (const name of candidates) {
    const full = path.join(UPLOAD_DIR, name);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}

export function maxOriginalBytes(): number {
  const mb = Number(process.env.MAX_UPLOAD_MB || "20");
  return (Number.isFinite(mb) && mb > 0 ? Math.min(mb, 20) : 20) * 1024 * 1024;
}
