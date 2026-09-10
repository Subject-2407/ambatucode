"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateModuleRequest,
  ListModulesQuery,
  ModuleDetail,
  ModuleSummary,
  Paginated,
  UpdateModuleRequest,
} from "@ambatucode/shared";
import { apiClient } from "@/lib/api-client";

const BASE = "/api/modules";

export const moduleKeys = {
  all: ["modules"] as const,
  list: (query: ListModulesQuery) => ["modules", "list", query] as const,
  detail: (moduleId: string) => ["modules", "detail", moduleId] as const,
};

export function useModules(query: ListModulesQuery) {
  return useQuery({
    queryKey: moduleKeys.list(query),
    queryFn: ({ signal }) =>
      apiClient.get<Paginated<ModuleSummary>>(BASE, {
        signal,
        query: {
          page: query.page,
          pageSize: query.pageSize,
          scope: query.scope,
          search: query.search,
        },
      }),
    // Keeps the previous page on screen while the next one loads, so paging
    // and typing in the search box do not blank the list.
    placeholderData: (previous) => previous,
  });
}

/** The module with its section tree. Sections come back empty until the viewer may read them. */
export function useModule(moduleId: string) {
  return useQuery({
    queryKey: moduleKeys.detail(moduleId),
    queryFn: ({ signal }) => apiClient.get<ModuleDetail>(`${BASE}/${moduleId}`, { signal }),
  });
}

function useInvalidateModules() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: moduleKeys.all });
}

export function useCreateModule() {
  const invalidate = useInvalidateModules();
  return useMutation({
    mutationFn: (input: CreateModuleRequest) => apiClient.post<ModuleSummary>(BASE, input),
    onSuccess: invalidate,
  });
}

export function useUpdateModule() {
  const invalidate = useInvalidateModules();
  return useMutation({
    mutationFn: ({ moduleId, changes }: { moduleId: string; changes: UpdateModuleRequest }) =>
      apiClient.patch<ModuleSummary>(`${BASE}/${moduleId}`, changes),
    onSuccess: invalidate,
  });
}

export function useDeleteModule() {
  const invalidate = useInvalidateModules();
  return useMutation({
    mutationFn: (moduleId: string) => apiClient.delete<{ deleted: boolean }>(`${BASE}/${moduleId}`),
    onSuccess: invalidate,
  });
}
