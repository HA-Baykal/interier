import fs from "fs";
import path from "path";
import { uid } from "@/lib/db";

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

const MIME_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function saveUpload(buffer: Buffer, mime: string): { id: string; ext: string; path: string } {
  ensureUploadDir();
  const ext = MIME_MAP[mime] ?? "jpg";
  const id = uid("up");
  const filePath = path.join(UPLOAD_DIR, `${id}.${ext}`);
  fs.writeFileSync(filePath, buffer);
  return { id, ext, path: filePath };
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

export { UPLOAD_DIR };
