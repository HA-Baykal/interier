import { NextResponse } from "next/server";
import { telegramPublicStatus } from "@/lib/telegram/connection";
import { privateHeaders } from "@/lib/auth-response";
export const dynamic = "force-dynamic";
export async function GET() {
  const telegram = await telegramPublicStatus();
  return NextResponse.json({ telegram: { available: telegram.connected, username: telegram.username }, emailConfirmation: false, vk: { available: false }, max: { available: false } }, { headers: privateHeaders });
}
