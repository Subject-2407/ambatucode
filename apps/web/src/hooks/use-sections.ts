"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateSectionRequest, SectionView, UpdateSectionRequest } from "@ambatucode/shared";
import { apiClient } from "@/lib/api-client";
import { moduleKeys } from "./use-modules";

/**
 * Sections are read as part of the module tree rather than on their own, so
 * these are all writes and every one of them invalidates that tree.
 */
function useInvalidateModule(moduleId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: moduleKeys.detail(moduleId) });
}

export function useCreateSection(moduleId: string) {
  const invalidate = useInvalidateModule(moduleId);
  return useMutation({
    mutationFn: (input: CreateSectionRequest) =>
      apiClient.post<SectionView>(`/api/modules/${moduleId}/sections`, input),
    onSuccess: invalidate,
  });
}

export function useUpdateSection(moduleId: string) {
  const invalidate = useInvalidateModule(moduleId);
  return useMutation({
    mutationFn: ({ sectionId, changes }: { sectionId: string; changes: UpdateSectionRequest }) =>
      apiClient.patch<SectionView>(`/api/sections/${sectionId}`, changes),
    onSuccess: invalidate,
  });
}

export function useDeleteSection(moduleId: string) {
  const invalidate = useInvalidateModule(moduleId);
  return useMutation({
    mutationFn: (sectionId: string) =>
      apiClient.delete<{ deleted: boolean }>(`/api/sections/${sectionId}`),
    onSuccess: invalidate,
  });
}

/**
 * Sends the complete ordered list, which is what the endpoint requires: a
 * partial list would strand whatever it omits. The drag already knows the
 * resulting order, so the caller reorders optimistically and this confirms it.
 */
export function useReorderSections(moduleId: string) {
  const invalidate = useInvalidateModule(moduleId);
  return useMutation({
    mutationFn: (sectionIds: string[]) =>
      apiClient.patch<SectionView[]>(`/api/modules/${moduleId}/sections/reorder`, { sectionIds }),
    // Settled, not success: a rejected reorder has to snap the list back to
    // whatever the server actually holds.
    onSettled: invalidate,
  });
}
