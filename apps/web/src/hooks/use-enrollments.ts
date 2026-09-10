"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DecideEnrollmentRequest,
  EnrollmentRequestResult,
  EnrollmentView,
  ListEnrollmentsQuery,
  Paginated,
} from "@ambatucode/shared";
import { apiClient } from "@/lib/api-client";
import { moduleKeys } from "./use-modules";

export const enrollmentKeys = {
  all: ["enrollments"] as const,
  list: (moduleId: string, query: ListEnrollmentsQuery) =>
    ["enrollments", moduleId, query] as const,
};

export function useEnrollments(moduleId: string, query: ListEnrollmentsQuery) {
  return useQuery({
    queryKey: enrollmentKeys.list(moduleId, query),
    queryFn: ({ signal }) =>
      apiClient.get<Paginated<EnrollmentView>>(`/api/modules/${moduleId}/enrollments`, {
        signal,
        query: {
          page: query.page,
          pageSize: query.pageSize,
          status: query.status,
          search: query.search,
        },
      }),
    placeholderData: (previous) => previous,
  });
}

/**
 * Asks to join. The result says which of the two paths applied — immediate
 * access on a Public module, or a pending request on a Closed one — because
 * only the server knows that.
 */
export function useRequestEnrollment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (moduleId: string) =>
      apiClient.post<EnrollmentRequestResult>(`/api/modules/${moduleId}/enroll`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: moduleKeys.all }),
  });
}

export function useDecideEnrollment(moduleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ enrollmentId, status }: { enrollmentId: string } & DecideEnrollmentRequest) =>
      apiClient.patch<EnrollmentView>(`/api/modules/${moduleId}/enrollments/${enrollmentId}`, {
        status,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: enrollmentKeys.all }),
  });
}
