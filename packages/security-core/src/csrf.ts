import { randomBytes, timingSafeEqual } from "crypto";

// Tokens are 32 random bytes encoded as 64 lowercase hex characters.
const TOKEN_HEX_LENGTH = 64;
const HEX_RE = /^[0-9a-f]+$/;

export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

export function validateCsrfToken(
  sessionToken: string,
  requestToken: string
): boolean {
  if (!sessionToken || !requestToken) return false;
  // Reject anything that is not exactly 64 lowercase hex characters.
  // Buffer.from(str, "hex") silently truncates / ignores invalid bytes, so we
  // must validate the format ourselves before comparing.
  if (
    sessionToken.length !== TOKEN_HEX_LENGTH ||
    requestToken.length !== TOKEN_HEX_LENGTH
  )
    return false;
  if (!HEX_RE.test(sessionToken) || !HEX_RE.test(requestToken)) return false;

  const a = Buffer.from(sessionToken, "hex");
  const b = Buffer.from(requestToken, "hex");
  // Both are exactly 32 bytes at this point; timingSafeEqual requires equal lengths.
  return timingSafeEqual(a, b);
}
