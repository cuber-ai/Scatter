import { hash, verify } from "argon2";
import { z } from "zod";

const PasswordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128)
  .regex(/[A-Z]/, "Must contain uppercase letter")
  .regex(/[a-z]/, "Must contain lowercase letter")
  .regex(/[0-9]/, "Must contain a digit")
  .regex(/[^A-Za-z0-9]/, "Must contain a special character");

export function validatePassword(password: string): {
  valid: boolean;
  errors: string[];
} {
  const result = PasswordSchema.safeParse(password);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.errors.map((e) => e.message),
  };
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    memoryCost: 65536, // 64MB
    timeCost: 3,
    parallelism: 4,
  });
}

export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  return verify(hash, password);
}
