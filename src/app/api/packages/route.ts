import { NextResponse } from "next/server";
import { activePackages } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public catalogue of purchasable packages (id, name, credits, price, badge). */
export async function GET() {
  const packs = await activePackages();
  return NextResponse.json({
    packages: packs.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      credits: p.credits,
      price: p.price,
      badge: p.badge,
    })),
  });
}
