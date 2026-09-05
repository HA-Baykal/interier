import fs from "fs";
import path from "path";
import { uid } from "@/lib/db";

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

const MIME_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Whether remote object storage (Vercel Blob) is configured. When set, uploaded
 * images (originals + generated results) are stored on Blob and served via their
 * public URLs, which is required on Vercel's serverless filesystem. In local dev
 * (no token) images fall back to the local `data/uploads/` directory.
 */
const BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;

export function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export async function saveUpload(
  buffer: Buffer,
  mime: string
): Promise<{ id: string; ext: string; url: string }> {
  const ext = MIME_MAP[mime] ?? "jpg";
  const id = uid("up");

  if (BLOB) {
    const { put } = await import("@vercel/blob");
    const { url } = await put(`uploads/${id}.${ext}`, buffer, {
      access: "public",
      addRandomSuffix: false,
    });
    return { id, ext, url };
  }

  ensureUploadDir();
  const filePath = path.join(UPLOAD_DIR, `${id}.${ext}`);
  fs.writeFileSync(filePath, buffer);
  return { id, ext, url: `/api/uploads/${id}.${ext}` };
}

/** Resolve an image reference to a usable URL (local id, /api/uploads path, or a full URL). */
export function resolveImageUrl(ref: string): string {
  if (/^https?:\/\//.test(ref) || /^\/api\/uploads\//.test(ref) || ref.startsWith("data:")) {
    return ref;
  }
  return `/api/uploads/${ref}`;
}

export function uploadPath(id: string, ext = "jpg"): string {
  return path.join(UPLOAD_DIR, `${id}.${ext}`);
}

export function findUpload(id: string): string | null {
  ensureUploadDir();
  const names = fs.readdirSync(UPLOAD_DIR).filter((n) => n.startsWith(id + "."));
  if (names.length === 0) return null;
  return path.join(UPLOAD_DIR, names[0]);
}

export function maxOriginalBytes(): number {
  const raw = process.env.MAX_UPLOAD_MB || "20";
  return Number(raw) * 1024 * 1024;
}

/** Whether remote object storage is enabled. */
export function isBlobStorage(): boolean {
  return BLOB;
}

export { UPLOAD_DIR };
