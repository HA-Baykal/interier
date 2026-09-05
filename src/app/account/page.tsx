import { redirect } from "next/navigation";
import Account from "@/components/Account";
import { resolvePageUser } from "@/lib/auth";
import { referralCount, grantedRewards } from "@/lib/billing";

export default function AccountPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const query = typeof searchParams.ses === "string" ? searchParams.ses : null;
  const user = resolvePageUser(query);
  if (!user) redirect("/login");
  return (
    <Account
      initialUser={{
        id: user.id,
        email: user.email,
        name: user.name,
        credits: user.credits,
        trialUsed: user.trialUsed,
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        telegramId: user.telegramId,
        vkId: user.vkId,
        telegramGranted: grantedRewards(user.id).telegram,
        vkGranted: grantedRewards(user.id).vk,
        isAdmin: user.isAdmin,
        referralCount: referralCount(user.id),
      }}
    />
  );
}
