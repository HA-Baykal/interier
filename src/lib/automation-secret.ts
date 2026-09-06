/** A user-initiated browser utility: 16 cryptographically random bytes = 32 hex characters. */
export function generateAutomationSecret(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
