import { z } from "zod";
import {
  DEFAULT_GRADE_SORT,
  DEFAULT_GRADE_SORT_ORDER,
  GRADE_SORTS,
  GRADE_SORT_ORDERS,
  SUBMISSION_STATUSES,
  cuidSchema,
  type AssessmentSummary,
  type GradeRecordQuery,
  type GradeSort,
  type GradeSortOrder,
  type ModuleSectionView,
  type ModuleSessionOption,
  type SubmissionStatus,
} from "@ambatucode/shared";
import type { SelectOption, SelectOptionGroup } from "@/components/ui/select";

/**
 * The grading records' filters, as plain data.
 *
 * They cascade — Module, then Section, then Assessment, then Session — and each
 * level narrows the choices below it. That rule lives here rather than in the
 * screen so it can be tested without rendering one: a Section chosen together
 * with a session from another Section filtered the table down to nothing, and
 * the cure is that the session list never offers that session in the first
 * place, and a stale choice is dropped the moment it stops fitting.
 *
 * The same shape is what the URL carries, so a filtered view can be linked.
 */

export type GradeFilters = {
  /** Empty until chosen; the screen then falls back to the first owned module. */
  moduleId: string;
  /** Empty means every section — and likewise below. */
  sectionId: string;
  assessmentId: string;
  sessionId: string;
  status: SubmissionStatus | "";
  resetOnly: boolean;
  search: string;
  sort: GradeSort;
  order: GradeSortOrder;
  page: number;
};

export const DEFAULT_GRADE_FILTERS: GradeFilters = {
  moduleId: "",
  sectionId: "",
  assessmentId: "",
  sessionId: "",
  status: "",
  resetOnly: false,
  search: "",
  sort: DEFAULT_GRADE_SORT,
  order: DEFAULT_GRADE_SORT_ORDER[DEFAULT_GRADE_SORT],
  page: 1,
};

// --- The URL -----------------------------------------------------------------------

/**
 * Every field falls back on its own. A link is typed, pasted, and bookmarked
 * across releases, so a value that no longer parses costs that one filter,
 * never the page.
 */
const idParam = cuidSchema.catch("");

const filterParamsSchema = z.object({
  moduleId: idParam,
  sectionId: idParam,
  assessmentId: idParam,
  sessionId: idParam,
  status: z.union([z.enum(SUBMISSION_STATUSES), z.literal("")]).catch(""),
  resetOnly: z
    .string()
    .transform((value) => value === "true")
    .catch(false),
  search: z.string().trim().max(120).catch(""),
  sort: z.enum(GRADE_SORTS).catch(DEFAULT_GRADE_SORT),
  order: z.enum(GRADE_SORT_ORDERS).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

/** What Next hands a page as `searchParams`. A repeated key arrives as an array. */
export type SearchParamsRecord = Readonly<Record<string, string | string[] | undefined>>;

export function parseGradeFilters(params: SearchParamsRecord): GradeFilters {
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params)) {
    flat[key] = Array.isArray(value) ? value[0] : value;
  }
  const parsed = filterParamsSchema.safeParse(flat);
  if (!parsed.success) return DEFAULT_GRADE_FILTERS;
  return { ...parsed.data, order: parsed.data.order ?? DEFAULT_GRADE_SORT_ORDER[parsed.data.sort] };
}

/** The query string for a set of filters, leaving out whatever is already the default. */
export function gradeFiltersToSearch(filters: GradeFilters): string {
  const params = new URLSearchParams();
  if (filters.moduleId) params.set("moduleId", filters.moduleId);
  if (filters.sectionId) params.set("sectionId", filters.sectionId);
  if (filters.assessmentId) params.set("assessmentId", filters.assessmentId);
  if (filters.sessionId) params.set("sessionId", filters.sessionId);
  if (filters.status) params.set("status", filters.status);
  if (filters.resetOnly) params.set("resetOnly", "true");
  if (filters.search) params.set("search", filters.search);
  if (filters.sort !== DEFAULT_GRADE_SORT) params.set("sort", filters.sort);
  if (filters.order !== DEFAULT_GRADE_SORT_ORDER[filters.sort]) params.set("order", filters.order);
  if (filters.page > 1) params.set("page", String(filters.page));
  return params.toString();
}

export function toGradeQuery(filters: GradeFilters, pageSize: number): GradeRecordQuery {
  return {
    page: filters.page,
    pageSize,
    search: filters.search || undefined,
    sectionId: filters.sectionId || undefined,
    assessmentId: filters.assessmentId || undefined,
    sessionId: filters.sessionId || undefined,
    status: filters.status || undefined,
    resetOnly: filters.resetOnly ? true : undefined,
    sort: filters.sort,
    order: filters.order,
  };
}

/** Whether anything narrows the records beyond the module itself. */
export function hasActiveGradeFilters(filters: GradeFilters): boolean {
  return (
    filters.sectionId !== "" ||
    filters.assessmentId !== "" ||
    filters.sessionId !== "" ||
    filters.status !== "" ||
    filters.resetOnly ||
    filters.search !== ""
  );
}

/** Back to the whole module. The module and the chosen order are kept: neither is a filter. */
export function clearGradeFilters(filters: GradeFilters): GradeFilters {
  return {
    ...DEFAULT_GRADE_FILTERS,
    moduleId: filters.moduleId,
    sort: filters.sort,
    order: filters.order,
  };
}

// --- The cascade -------------------------------------------------------------------

/** As much of the module tree as the cascade reads. Null while it is still loading. */
export type FilterSection = Pick<ModuleSectionView, "id" | "title"> & {
  assessments: readonly Pick<AssessmentSummary, "id" | "title" | "sectionId">[];
};

export type FilterSession = Pick<
  ModuleSessionOption,
  "id" | "name" | "status" | "isOpenAccess" | "assessmentId" | "assessmentTitle" | "createdAt"
>;

type Choice = SelectOption | SelectOptionGroup;

/** Where each assessment sits in the module: its section, and its position overall. */
function placements(
  sections: readonly FilterSection[] | null,
): Map<string, { sectionId: string; index: number }> {
  const placed = new Map<string, { sectionId: string; index: number }>();
  for (const section of sections ?? []) {
    for (const assessment of section.assessments) {
      placed.set(assessment.id, { sectionId: section.id, index: placed.size });
    }
  }
  return placed;
}

/**
 * Whether a session belongs under the chosen section and assessment.
 *
 * A session whose assessment is not in the tree cannot be placed in a section,
 * and is kept only while the tree is still loading. Clearing a choice the
 * screen merely cannot check yet would throw away a filter from a link.
 */
function sessionFits(
  session: FilterSession,
  sections: readonly FilterSection[] | null,
  placed: ReadonlyMap<string, { sectionId: string }>,
  filters: Pick<GradeFilters, "sectionId" | "assessmentId">,
): boolean {
  if (filters.assessmentId !== "" && session.assessmentId !== filters.assessmentId) return false;
  if (filters.sectionId === "") return true;
  const place = placed.get(session.assessmentId);
  return place === undefined ? sections === null : place.sectionId === filters.sectionId;
}

/**
 * The assessment list: one section's, or every section's under its heading.
 * The headings are not decoration — modules reuse titles like "Quiz" from one
 * section to the next.
 */
export function assessmentChoices(
  sections: readonly FilterSection[] | null,
  sectionId: string,
): Choice[] {
  const all: SelectOption = { value: "", label: "All assessments" };
  const toOption = (assessment: { id: string; title: string }): SelectOption => ({
    value: assessment.id,
    label: assessment.title,
  });

  if (sectionId !== "") {
    const section = sections?.find((candidate) => candidate.id === sectionId);
    return [all, ...(section?.assessments ?? []).map(toOption)];
  }
  return [
    all,
    ...(sections ?? [])
      .filter((section) => section.assessments.length > 0)
      .map((section) => ({ label: section.title, options: section.assessments.map(toOption) })),
  ];
}

/** A session's own name, or what an open-access one stands for, and whether it is live. */
function sessionLabel(session: FilterSession): string {
  const name = session.isOpenAccess ? "Open access" : session.name;
  return session.status === "RUNNING" ? `${name} · running` : name;
}

/**
 * The session list, narrowed by the section and assessment above it.
 *
 * Grouped under the assessment's title in module order, newest session first
 * within each — "Tuesday lab" identifies nothing across a module that holds a
 * dozen assessments, and the session most often wanted is the latest one. Once
 * an assessment is chosen the heading would only repeat it, so the list is
 * flat.
 */
export function sessionChoices(
  sessions: readonly FilterSession[] | null,
  sections: readonly FilterSection[] | null,
  filters: Pick<GradeFilters, "sectionId" | "assessmentId">,
): Choice[] {
  const all: SelectOption = { value: "", label: "All sessions" };
  const placed = placements(sections);
  const position = (session: FilterSession) =>
    placed.get(session.assessmentId)?.index ?? Number.POSITIVE_INFINITY;

  const visible = (sessions ?? [])
    .filter((session) => sessionFits(session, sections, placed, filters))
    .sort(
      (left, right) =>
        position(left) - position(right) ||
        left.assessmentTitle.localeCompare(right.assessmentTitle) ||
        left.assessmentId.localeCompare(right.assessmentId) ||
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id),
    );

  const toOption = (session: FilterSession): SelectOption => ({
    value: session.id,
    label: sessionLabel(session),
  });

  if (filters.assessmentId !== "") return [all, ...visible.map(toOption)];

  const groups: Array<{ assessmentId: string; label: string; options: SelectOption[] }> = [];
  for (const session of visible) {
    const last = groups[groups.length - 1];
    if (last?.assessmentId === session.assessmentId) {
      last.options.push(toOption(session));
    } else {
      groups.push({
        assessmentId: session.assessmentId,
        label: session.assessmentTitle,
        options: [toOption(session)],
      });
    }
  }
  return [all, ...groups.map(({ label, options }) => ({ label, options }))];
}

/**
 * Drops any choice that no longer fits the choices above it.
 *
 * Applied when an upstream filter changes, and again on every render so a link
 * naming a mismatched pair settles once the tree arrives. Returns the same
 * object when nothing changed, and goes back to page one when something did:
 * the old page number described a different set.
 */
export function reconcileGradeFilters(
  filters: GradeFilters,
  sections: readonly FilterSection[] | null,
  sessions: readonly FilterSession[] | null,
): GradeFilters {
  let { sectionId, assessmentId, sessionId } = filters;

  if (sections !== null) {
    if (sectionId !== "" && !sections.some((section) => section.id === sectionId)) {
      sectionId = "";
    }
    if (assessmentId !== "") {
      const home = sections.find((section) =>
        section.assessments.some((assessment) => assessment.id === assessmentId),
      );
      if (home === undefined || (sectionId !== "" && home.id !== sectionId)) assessmentId = "";
    }
  }

  if (sessions !== null && sessionId !== "") {
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (
      session === undefined ||
      !sessionFits(session, sections, placements(sections), { sectionId, assessmentId })
    ) {
      sessionId = "";
    }
  }

  if (
    sectionId === filters.sectionId &&
    assessmentId === filters.assessmentId &&
    sessionId === filters.sessionId
  ) {
    return filters;
  }
  return { ...filters, sectionId, assessmentId, sessionId, page: 1 };
}

// --- Order and paging --------------------------------------------------------------

/**
 * A header click: the sorted column flips direction, and any other column
 * starts in its own natural direction — a score is read from the top.
 */
export function nextGradeSort(
  current: { sort: GradeSort; order: GradeSortOrder },
  column: GradeSort,
): { sort: GradeSort; order: GradeSortOrder } {
  if (current.sort === column) {
    return { sort: column, order: current.order === "asc" ? "desc" : "asc" };
  }
  return { sort: column, order: DEFAULT_GRADE_SORT_ORDER[column] };
}

export function lastPageFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The record's position in the whole filtered set, not on the page. */
export function rowNumber(page: number, pageSize: number, index: number): number {
  return (page - 1) * pageSize + index + 1;
}

/**
 * The page to move to when the one asked for came back empty although the set
 * is not — a link to page nine of what is now three pages, or a set that shrank
 * under the reader. Null when the page is fine as it is.
 */
export function pageToRecover(
  requested: number,
  served: { items: readonly unknown[]; total: number; pageSize: number },
): number | null {
  if (served.items.length > 0 || served.total === 0) return null;
  const last = lastPageFor(served.total, served.pageSize);
  return requested > last ? last : null;
}
