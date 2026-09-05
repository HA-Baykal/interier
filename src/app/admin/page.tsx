import { redirect } from "next/navigation";
import Admin from "@/components/Admin";
import { resolvePageUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSetting, activeStyles, activePackages } from "@/lib/config";
import { ClientPackage, ClientStyle } from "@/components/types";

export default function AdminPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const query = typeof searchParams.ses === "string" ? searchParams.ses : null;
  const user = resolvePageUser(query);
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/");

  const d = db();
  const styles: ClientStyle[] = activeStyles().map((s) => ({
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
  const packages: ClientPackage[] = activePackages().map((p) => ({
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

  return (
    <Admin
      stats={{
        users: d.users.length,
        generations: d.generations.length,
        credits: d.users.reduce((a, u) => a + u.credits, 0),
        referrals: d.referrals.filter((r) => r.rewarded).length,
      }}
      settings={{
        generation_mode: getSetting("generation_mode") || "demo",
        free_credits: getSetting("free_credits") || "0",
        reward_telegram: getSetting("reward_telegram") || "1",
        reward_vk: getSetting("reward_vk") || "1",
        reward_referral: getSetting("reward_referral") || "1",
        test_unlimited: getSetting("test_unlimited") || "1",
        compatible_base_url: getSetting("compatible_base_url") || "",
        compatible_api_key: getSetting("compatible_api_key") || "",
        compatible_model: getSetting("compatible_model") || "google/nano-banana",
        compatible_configured: !!(
          getSetting("compatible_base_url") &&
          getSetting("compatible_api_key") &&
          getSetting("compatible_model")
        ),
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
