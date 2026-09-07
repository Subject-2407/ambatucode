"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type {
  AdminUser,
  CreateUserRequest,
  Paginated,
  UpdateUserRequest,
  UserRole,
} from "@ambatucode/shared";
import { apiClient } from "@/lib/api-client";

const BASE = "/api/admin/users";

export type AdminUsersQuery = {
  page: number;
  pageSize: number;
  role?: UserRole;
  search?: string;
};

export const adminUsersKeys = {
  all: ["admin", "users"] as const,
  list: (query: AdminUsersQuery) => ["admin", "users", "list", query] as const,
};

export function useAdminUsers(query: AdminUsersQuery) {
  return useQuery({
    queryKey: adminUsersKeys.list(query),
    queryFn: ({ signal }) =>
      apiClient.get<Paginated<AdminUser>>(BASE, {
        signal,
        query: {
          page: query.page,
          pageSize: query.pageSize,
          role: query.role,
          search: query.search,
        },
      }),
    // Root edits accounts from one screen; a stale list after a write would be
    // confusing, so every mutation invalidates rather than patching the cache.
    placeholderData: (previous) => previous,
  });
}

/** Every write invalidates the whole list so pagination and filters stay honest. */
function useInvalidateAdminUsers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: adminUsersKeys.all });
}

export function useCreateUser(): UseMutationResult<AdminUser, unknown, CreateUserRequest> {
  const invalidate = useInvalidateAdminUsers();
  return useMutation({
    mutationFn: (input: CreateUserRequest) => apiClient.post<AdminUser>(BASE, input),
    onSuccess: invalidate,
  });
}

export function useUpdateUser(): UseMutationResult<
  AdminUser,
  unknown,
  { id: string; changes: UpdateUserRequest }
> {
  const invalidate = useInvalidateAdminUsers();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: UpdateUserRequest }) =>
      apiClient.patch<AdminUser>(`${BASE}/${id}`, changes),
    onSuccess: invalidate,
  });
}

export function useResetUserPassword(): UseMutationResult<
  { reset: boolean },
  unknown,
  { id: string; password: string }
> {
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      apiClient.post<{ reset: boolean }>(`${BASE}/${id}/reset-password`, { password }),
  });
}

export function useDeleteUser(): UseMutationResult<{ deleted: boolean }, unknown, string> {
  const invalidate = useInvalidateAdminUsers();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<{ deleted: boolean }>(`${BASE}/${id}`),
    onSuccess: invalidate,
  });
}
