import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { findUpload } from "@/app/api/upload/service";

export async function GET(
  _req: NextRequest,
  { params }: { params: { file: string } }
) {
  const file = params.file;
  const resolved = findUpload(file);
  if (!resolved) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const buf = fs.readFileSync(resolved);
  const ext = resolved.split(".").pop() || "jpg";
  const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
