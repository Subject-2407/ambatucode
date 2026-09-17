"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateMaterialRequest,
  MaterialDetail,
  MaterialSummary,
  UpdateMaterialRequest,
} from "@ambatucode/shared";
import { apiClient } from "@/lib/api-client";
import { moduleKeys } from "./use-modules";

export const materialKeys = {
  all: ["materials"] as const,
  detail: (materialId: string) => ["materials", "detail", materialId] as const,
};

export function useMaterial(materialId: string | null) {
  return useQuery({
    queryKey: materialKeys.detail(materialId ?? "none"),
    queryFn: ({ signal }) =>
      apiClient.get<MaterialDetail>(`/api/materials/${materialId ?? ""}`, { signal }),
    enabled: materialId !== null,
  });
}

function useInvalidateMaterial(moduleId: string) {
  const queryClient = useQueryClient();
  return (materialId?: string) => {
    void queryClient.invalidateQueries({ queryKey: moduleKeys.detail(moduleId) });
    void queryClient.invalidateQueries({
      queryKey: materialId ? materialKeys.detail(materialId) : materialKeys.all,
    });
  };
}

export function useCreateMaterial(moduleId: string) {
  const invalidate = useInvalidateMaterial(moduleId);
  return useMutation({
    mutationFn: ({ sectionId, input }: { sectionId: string; input: CreateMaterialRequest }) =>
      apiClient.post<MaterialSummary>(`/api/sections/${sectionId}/materials`, input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateMaterial(moduleId: string) {
  const invalidate = useInvalidateMaterial(moduleId);
  return useMutation({
    mutationFn: ({ materialId, changes }: { materialId: string; changes: UpdateMaterialRequest }) =>
      apiClient.patch<MaterialSummary>(`/api/materials/${materialId}`, changes),
    onSuccess: (_result, variables) => invalidate(variables.materialId),
  });
}

export function useDeleteMaterial(moduleId: string) {
  const invalidate = useInvalidateMaterial(moduleId);
  return useMutation({
    mutationFn: (materialId: string) =>
      apiClient.delete<{ deleted: boolean }>(`/api/materials/${materialId}`),
    onSuccess: () => invalidate(),
  });
}
