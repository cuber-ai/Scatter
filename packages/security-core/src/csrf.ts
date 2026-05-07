import { randomBytes } from "crypto";

export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

export function validateCsrfToken(
  sessionToken: string,
  requestToken: string
): boolean {
  if (!sessionToken || !requestToken) return false;
  // Constant-time comparison to prevent timing attacks
  if (sessionToken.length !== requestToken.length) return false;
  const a = Buffer.from(sessionToken, "hex");
  const b = Buffer.from(requestToken, "hex");
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
