import { redirect } from "next/navigation";
import Admin from "@/components/Admin";
import { resolvePageUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSetting, activeStyles, activePackages } from "@/lib/config";
import { ClientPackage, ClientStyle } from "@/components/types";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const query = typeof searchParams.ses === "string" ? searchParams.ses : null;
  const user = await resolvePageUser(query);
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/");

  const d = await db();
  const styles: ClientStyle[] = (await activeStyles()).map((s) => ({
    id: s.id,
    slug: s.slug,
    nameRu: s.name.ru,
    nameEn: s.name.en,
    descRu: s.description.ru,
    descEn: s.description.en,
    preview: s.preview,
    accent: s.config.accent,
    filter: s.config.filter,
    tint: s.config.tint,
    vignette: s.config.vignette,
    active: s.active,
  }));
  const packages: ClientPackage[] = (await activePackages()).map((p) => ({
    id: p.id,
    slug: p.slug,
    nameRu: p.name.ru,
    nameEn: p.name.en,
    descRu: p.description.ru,
    descEn: p.description.en,
    credits: p.credits,
    price: p.price,
    badge: p.badge ? (p.badge.ru || p.badge.en) : null,
  }));

  const [
    generation_mode,
    free_credits,
    reward_telegram,
    reward_vk,
    reward_referral,
    test_unlimited,
    compatible_provider,
    compatible_base_url,
    compatible_api_key,
    compatible_model,
  ] = await Promise.all([
    getSetting("generation_mode"),
    getSetting("free_credits"),
    getSetting("reward_telegram"),
    getSetting("reward_vk"),
    getSetting("reward_referral"),
    getSetting("test_unlimited"),
    getSetting("compatible_provider"),
    getSetting("compatible_base_url"),
    getSetting("compatible_api_key"),
    getSetting("compatible_model"),
  ]);

  const base = compatible_base_url || process.env.COMPATIBLE_BASE_URL || "https://api.gen-api.ru";
  const key = compatible_api_key || process.env.COMPATIBLE_API_KEY || "";
  const model = compatible_model || process.env.COMPATIBLE_MODEL || "gpt-image-2";

  return (
    <Admin
      stats={{
        users: d.users.length,
        generations: d.generations.length,
        credits: d.users.reduce((a, u) => a + u.credits, 0),
        referrals: d.referrals.filter((r) => r.rewarded).length,
      }}
      settings={{
        generation_mode: generation_mode || "demo",
        free_credits: free_credits || "0",
        reward_telegram: reward_telegram || "1",
        reward_vk: reward_vk || "1",
        reward_referral: reward_referral || "1",
        test_unlimited: test_unlimited || "1",
        compatible_provider: compatible_provider || "genapi",
        compatible_base_url: base,
        compatible_api_key: key,
        compatible_model: model,
        compatible_configured: !!(base && key && model),
      }}
      styles={styles}
      packages={packages}
      env={{
        hasReplicate: !!process.env.REPLICATE_API_TOKEN,
        hasOpenAI: !!process.env.OPENAI_API_KEY,
        hasTogether: !!process.env.TOGETHER_API_KEY || !!process.env.FAL_API_KEY,
      }}
    />
  );
}
