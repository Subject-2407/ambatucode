import { z } from "zod";
import { USER_ROLES } from "../enums";

/**
 * Username and password bounds are validated here so a malformed credential
 * never reaches argon2. The rules are deliberately loose on password content —
 * strength policy belongs to the Root user-creation flow, not to login.
 */
export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(48)
  .regex(/^[a-zA-Z0-9._-]+$/, "Username may only contain letters, digits, dot, underscore, hyphen");

export const passwordSchema = z.string().min(8).max(200);

export const loginRequestSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authenticatedUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: z.enum(USER_ROLES),
});
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;

export type LoginResponse = { user: AuthenticatedUser; expiresAt: string };
export type MeResponse = {
  user: AuthenticatedUser;
  sessionExpiresAt: string;
  serverTimeMs: number;
};
