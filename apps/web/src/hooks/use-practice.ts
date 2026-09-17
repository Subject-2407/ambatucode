"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreatePracticeRequest,
  PracticeActivityView,
  UpdatePracticeRequest,
} from "@ambatucode/shared";
import { apiClient } from "@/lib/api-client";
import { materialKeys } from "./use-materials";
import { moduleKeys } from "./use-modules";

/**
 * Practice Activities are authored inside a Material and read as part of it,
 * so every write invalidates that Material rather than a list of its own.
 */
function useInvalidatePractice(moduleId: string, materialId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: materialKeys.detail(materialId) });
    void queryClient.invalidateQueries({ queryKey: moduleKeys.detail(moduleId) });
  };
}

export function useCreatePractice(moduleId: string, materialId: string) {
  const invalidate = useInvalidatePractice(moduleId, materialId);
  return useMutation({
    mutationFn: (input: CreatePracticeRequest) =>
      apiClient.post<PracticeActivityView>(`/api/materials/${materialId}/practice`, input),
    onSuccess: invalidate,
  });
}

export function useUpdatePractice(moduleId: string, materialId: string) {
  const invalidate = useInvalidatePractice(moduleId, materialId);
  return useMutation({
    mutationFn: ({ practiceId, changes }: { practiceId: string; changes: UpdatePracticeRequest }) =>
      apiClient.patch<PracticeActivityView>(`/api/practice/${practiceId}`, changes),
    onSuccess: invalidate,
  });
}

export function useDeletePractice(moduleId: string, materialId: string) {
  const invalidate = useInvalidatePractice(moduleId, materialId);
  return useMutation({
    mutationFn: (practiceId: string) =>
      apiClient.delete<{ deleted: boolean }>(`/api/practice/${practiceId}`),
    onSuccess: invalidate,
  });
}
