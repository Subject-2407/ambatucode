import { z } from "zod";
import { USER_ROLES } from "../enums";
import { passwordSchema, usernameSchema } from "./auth";

export const createUserRequestSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(120),
  role: z.enum(USER_ROLES),
  isActive: z.boolean().default(true),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    role: z.enum(USER_ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  password: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  role: z.enum(USER_ROLES).optional(),
  search: z.string().trim().max(120).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export type AdminUser = {
  id: string;
  username: string;
  displayName: string;
  role: (typeof USER_ROLES)[number];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
