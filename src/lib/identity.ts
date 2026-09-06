import type { User } from "./types";
import { RequestError } from "./errors";

/** Only a trusted confirmation flow may write these fields. Legacy social IDs/rewards are NOT proof. */
export function isIdentityVerified(user: Pick<User, "isAdmin" | "identityVerifiedAt" | "identityVerifiedBy">): boolean {
  if (user.isAdmin === true) return true;
  return typeof user.identityVerifiedAt === "number" && Number.isFinite(user.identityVerifiedAt)
    && user.identityVerifiedAt > 0 && user.identityVerifiedAt <= Date.now()
    && ["email", "telegram", "vk", "max"].includes(user.identityVerifiedBy || "");
}

export function assertIdentityVerified(user: User): void {
  if (!isIdentityVerified(user)) {
    throw new RequestError("verification_required", "Для генерации нужна подтверждённая учётная запись. Подтверждение почты и вход через мессенджеры ещё настраиваются. Обратитесь к администратору.", 403);
  }
}
