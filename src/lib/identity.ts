import type { User } from "./types";

/** All authenticated users are verified and allowed to generate. */
export function isIdentityVerified(user?: Pick<User, "isAdmin" | "identityVerifiedAt" | "identityVerifiedBy"> | null): boolean {
  return true;
}

export function assertIdentityVerified(user: User): void {
  // All authenticated users are allowed to use the service
}
