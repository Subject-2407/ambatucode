import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRADE_FILTERS,
  assessmentChoices,
  clearGradeFilters,
  gradeFiltersToSearch,
  hasActiveGradeFilters,
  nextGradeSort,
  pageToRecover,
  parseGradeFilters,
  reconcileGradeFilters,
  rowNumber,
  sessionChoices,
  toGradeQuery,
  type FilterSection,
  type FilterSession,
  type GradeFilters,
} from "./grade-filters";

/**
 * A module of two sections. "Quiz" appears in both on purpose: the headings in
 * the assessment list exist because modules really do that.
 */
const SECTIONS: FilterSection[] = [
  {
    id: "secA",
    title: "Basics",
    assessments: [
      { id: "asmA1", title: "Quiz", sectionId: "secA" },
      { id: "asmA2", title: "Loops", sectionId: "secA" },
    ],
  },
  {
    id: "secB",
    title: "Trees",
    assessments: [{ id: "asmB1", title: "Quiz", sectionId: "secB" }],
  },
  { id: "secC", title: "Reading only", assessments: [] },
];

function session(overrides: Partial<FilterSession> & Pick<FilterSession, "id">): FilterSession {
  return {
    name: overrides.id,
    status: "ENDED",
    isOpenAccess: false,
    assessmentId: "asmA1",
    assessmentTitle: "Quiz",
    createdAt: "2026-09-01T08:00:00.000Z",
    ...overrides,
  };
}

const SESSIONS: FilterSession[] = [
  session({ id: "b1-old", assessmentId: "asmB1", createdAt: "2026-09-02T08:00:00.000Z" }),
  session({ id: "a1-old", assessmentId: "asmA1", createdAt: "2026-09-01T08:00:00.000Z" }),
  session({
    id: "a1-new",
    assessmentId: "asmA1",
    createdAt: "2026-09-08T08:00:00.000Z",
    status: "RUNNING",
  }),
  session({
    id: "a2-open",
    assessmentId: "asmA2",
    assessmentTitle: "Loops",
    isOpenAccess: true,
  }),
];

function filters(overrides: Partial<GradeFilters> = {}): GradeFilters {
  return { ...DEFAULT_GRADE_FILTERS, moduleId: "m1", ...overrides };
}

function values(choices: ReturnType<typeof sessionChoices>): string[] {
  return choices.flatMap((choice) =>
    "options" in choice ? choice.options.map((option) => option.value) : [choice.value],
  );
}

describe("assessmentChoices", () => {
  it("groups every assessment under its section, skipping sections with none", () => {
    expect(assessmentChoices(SECTIONS, "")).toEqual([
      { value: "", label: "All assessments" },
      {
        label: "Basics",
        options: [
          { value: "asmA1", label: "Quiz" },
          { value: "asmA2", label: "Loops" },
        ],
      },
      { label: "Trees", options: [{ value: "asmB1", label: "Quiz" }] },
    ]);
  });

  it("lists only the chosen section's assessments", () => {
    expect(assessmentChoices(SECTIONS, "secB")).toEqual([
      { value: "", label: "All assessments" },
      { value: "asmB1", label: "Quiz" },
    ]);
  });

  it("offers only the catch-all while the tree is loading", () => {
    expect(assessmentChoices(null, "")).toEqual([{ value: "", label: "All assessments" }]);
  });
});

describe("sessionChoices", () => {
  it("groups by assessment in module order, newest session first", () => {
    const choices = sessionChoices(SESSIONS, SECTIONS, { sectionId: "", assessmentId: "" });
    expect(choices).toEqual([
      { value: "", label: "All sessions" },
      {
        label: "Quiz",
        options: [
          { value: "a1-new", label: "a1-new · running" },
          { value: "a1-old", label: "a1-old" },
        ],
      },
      { label: "Loops", options: [{ value: "a2-open", label: "Open access" }] },
      { label: "Quiz", options: [{ value: "b1-old", label: "b1-old" }] },
    ]);
  });

  it("narrows by section through each session's assessment", () => {
    expect(
      values(sessionChoices(SESSIONS, SECTIONS, { sectionId: "secB", assessmentId: "" })),
    ).toEqual(["", "b1-old"]);
  });

  it("narrows by assessment into a flat list, the heading being the filter above", () => {
    expect(sessionChoices(SESSIONS, SECTIONS, { sectionId: "", assessmentId: "asmA1" })).toEqual([
      { value: "", label: "All sessions" },
      { value: "a1-new", label: "a1-new · running" },
      { value: "a1-old", label: "a1-old" },
    ]);
  });

  it("keeps every session while the tree that would place them is loading", () => {
    expect(
      values(sessionChoices(SESSIONS, null, { sectionId: "secA", assessmentId: "" })),
    ).toHaveLength(SESSIONS.length + 1);
  });
});

describe("reconcileGradeFilters", () => {
  it("returns the same object when every choice still fits", () => {
    const current = filters({ sectionId: "secA", assessmentId: "asmA1", sessionId: "a1-old" });
    expect(reconcileGradeFilters(current, SECTIONS, SESSIONS)).toBe(current);
  });

  it("drops an assessment and session from another section", () => {
    const next = reconcileGradeFilters(
      filters({ sectionId: "secB", assessmentId: "asmA1", sessionId: "a1-old", page: 4 }),
      SECTIONS,
      SESSIONS,
    );
    expect(next).toMatchObject({ sectionId: "secB", assessmentId: "", sessionId: "", page: 1 });
  });

  it("drops a session from another assessment but keeps the section", () => {
    const next = reconcileGradeFilters(
      filters({ sectionId: "secA", assessmentId: "asmA2", sessionId: "a1-old" }),
      SECTIONS,
      SESSIONS,
    );
    expect(next).toMatchObject({ sectionId: "secA", assessmentId: "asmA2", sessionId: "" });
  });

  it("drops ids this module does not hold", () => {
    const next = reconcileGradeFilters(
      filters({ sectionId: "elsewhere", assessmentId: "nope", sessionId: "gone" }),
      SECTIONS,
      SESSIONS,
    );
    expect(next).toMatchObject({ sectionId: "", assessmentId: "", sessionId: "" });
  });

  it("leaves a choice alone while it cannot be checked yet", () => {
    const current = filters({ sectionId: "secB", sessionId: "a1-old" });
    expect(reconcileGradeFilters(current, null, null)).toBe(current);
    expect(reconcileGradeFilters(current, null, SESSIONS)).toBe(current);
  });
});

describe("the URL", () => {
  it("round-trips a filtered, sorted, paged view", () => {
    const view = filters({
      sectionId: "secA",
      assessmentId: "asmA1",
      sessionId: "a1-old",
      status: "GRADED",
      resetOnly: true,
      search: "ani",
      sort: "score",
      order: "asc",
      page: 3,
    });
    const search = new URLSearchParams(gradeFiltersToSearch(view));
    expect(parseGradeFilters(Object.fromEntries(search.entries()))).toEqual(view);
  });

  it("writes nothing for the defaults", () => {
    expect(gradeFiltersToSearch(DEFAULT_GRADE_FILTERS)).toBe("");
  });

  it("leaves out a direction that is the sort's own default", () => {
    expect(gradeFiltersToSearch(filters({ sort: "score", order: "desc" }))).toBe(
      "moduleId=m1&sort=score",
    );
    expect(parseGradeFilters({ sort: "score" }).order).toBe("desc");
  });

  it("drops a value that does not parse, keeping the rest", () => {
    expect(
      parseGradeFilters({
        moduleId: "m1",
        status: "PASSED",
        sort: "password",
        order: "sideways",
        page: "-2",
        resetOnly: "yes",
      }),
    ).toEqual(filters());
  });

  it("reads the first of a repeated key", () => {
    expect(parseGradeFilters({ moduleId: ["m1", "m2"] }).moduleId).toBe("m1");
  });
});

describe("toGradeQuery", () => {
  it("sends only the filters that are set", () => {
    expect(toGradeQuery(filters({ assessmentId: "asmA1", page: 2 }), 25)).toEqual({
      page: 2,
      pageSize: 25,
      search: undefined,
      sectionId: undefined,
      assessmentId: "asmA1",
      sessionId: undefined,
      status: undefined,
      resetOnly: undefined,
      sort: "name",
      order: "asc",
    });
  });
});

describe("clearing", () => {
  it("knows when anything narrows the module", () => {
    expect(hasActiveGradeFilters(filters())).toBe(false);
    expect(hasActiveGradeFilters(filters({ resetOnly: true }))).toBe(true);
    expect(hasActiveGradeFilters(filters({ search: "ani" }))).toBe(true);
  });

  it("keeps the module and the order, and goes back to page one", () => {
    expect(
      clearGradeFilters(
        filters({ sectionId: "secA", status: "GRADED", sort: "score", order: "desc", page: 5 }),
      ),
    ).toEqual(filters({ sort: "score", order: "desc" }));
  });
});

describe("nextGradeSort", () => {
  it("flips the column already sorted", () => {
    expect(nextGradeSort({ sort: "name", order: "asc" }, "name")).toEqual({
      sort: "name",
      order: "desc",
    });
  });

  it("starts a new column in its natural direction", () => {
    expect(nextGradeSort({ sort: "name", order: "asc" }, "score")).toEqual({
      sort: "score",
      order: "desc",
    });
    expect(nextGradeSort({ sort: "score", order: "asc" }, "assessment")).toEqual({
      sort: "assessment",
      order: "asc",
    });
  });
});

describe("paging", () => {
  it("numbers rows across pages", () => {
    expect(rowNumber(1, 25, 0)).toBe(1);
    expect(rowNumber(3, 25, 4)).toBe(55);
  });

  it("moves an empty page past the end back to the last one", () => {
    expect(pageToRecover(9, { items: [], total: 60, pageSize: 25 })).toBe(3);
  });

  it("leaves a page with records, or an empty set, alone", () => {
    expect(pageToRecover(2, { items: [{}], total: 60, pageSize: 25 })).toBeNull();
    expect(pageToRecover(4, { items: [], total: 0, pageSize: 25 })).toBeNull();
  });
});
