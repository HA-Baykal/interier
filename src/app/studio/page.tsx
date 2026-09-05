import { redirect } from "next/navigation";
import Studio from "@/components/Studio";
import { resolvePageUser } from "@/lib/auth";
import { activeStyles, isUnlimitedMode } from "@/lib/config";
import { referralCount, grantedRewards } from "@/lib/billing";
import { ClientStyle } from "@/components/types";
import { getGenerationSettings } from "@/lib/generation/settings";

export default async function StudioPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const query = typeof searchParams.ses === "string" ? searchParams.ses : null;
  const user = await resolvePageUser(query);
  if (!user) redirect("/login");

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
  const rewards = await grantedRewards(user.id);
  const generation = await getGenerationSettings();

  return (
    <Studio
      user={{
        id: user.id,
        email: user.email,
        name: user.name,
        credits: user.credits,
        trialUsed: user.trialUsed,
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        telegramId: user.telegramId,
        vkId: user.vkId,
        telegramGranted: rewards.telegram,
        vkGranted: rewards.vk,
        isAdmin: user.isAdmin,
        referralCount: await referralCount(user.id),
      }}
      styles={styles}
      aiConfigured={generation.aiConfigured}
      isDemo={generation.mode === "demo"}
      initialUnlimited={await isUnlimitedMode()}
    />
  );
}
