"use client";

import { useQuery } from "@tanstack/react-query";
import type { EnrollmentView, Paginated } from "@ambatucode/shared";
import { apiClient } from "@/lib/api-client";

/** The enrollment endpoint's own ceiling. */
const PAGE_SIZE = 100;
/** A runaway guard, not a limit anyone should meet: the list caps at 1 000 participants. */
const MAX_PAGES = 20;

/**
 * Every approved Coder in a Module, for choosing a session's participants.
 *
 * The picker used to ask for one page of a hundred. In a larger module the rest
 * simply did not appear, and nothing said so — an Architect could not choose a
 * Coder they could not see, and could not tell that they were missing.
 */
export function useApprovedCoders(moduleId: string, enabled = true) {
  return useQuery({
    queryKey: ["enrollments", moduleId, "approved-all"] as const,
    enabled: enabled && moduleId !== "",
    queryFn: async ({ signal }) => {
      const items: EnrollmentView[] = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const result = await apiClient.get<Paginated<EnrollmentView>>(
          `/api/modules/${moduleId}/enrollments`,
          { signal, query: { page, pageSize: PAGE_SIZE, status: "APPROVED" } },
        );
        items.push(...result.items);
        if (items.length >= result.total || result.items.length < PAGE_SIZE) break;
      }
      return items;
    },
  });
}
