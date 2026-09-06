import { NextResponse } from "next/server";
import { activeStyles } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public style catalog.
 *
 * The website gets styles through server props, but external clients — the
 * messenger bots, a future mobile app, the smoke test — need a small read-only
 * endpoint to enumerate what can be generated.
 */
export async function GET() {
  const styles = await activeStyles();
  return NextResponse.json({
    styles: styles.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      description: s.description,
      preview: s.preview,
      accent: s.config.accent,
    })),
  });
}
