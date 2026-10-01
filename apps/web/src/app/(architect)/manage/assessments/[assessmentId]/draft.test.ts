import { describe, expect, it } from "vitest";
import type { AssessmentArchitectView, TestCaseView } from "@ambatucode/shared";
import { diffAssessment, draftFrom, rebaseDraft, sampleCasesFrom, takeSaved } from "./draft";

const saved: AssessmentArchitectView = {
  id: "assessment-1",
  sectionId: "section-1",
  moduleId: "module-1",
  title: "Binary search",
  orderIndex: 0,
  isPublished: false,
  isOpenAccess: false,
  openAccessSessionId: null,
  exitPolicy: "RESUME",
  problemStatement: "Find the index.",
  allowedLanguages: ["python", "javascript"],
  starterCode: { python: "def solve():\n    pass\n" },
  timeMode: "TIMED",
  durationMinutes: 30,
  executionMode: "LIVE",
  timeLimitMs: 5_000,
  memoryLimitMb: 256,
  gradingStrategy: "WEIGHTED_AVERAGE",
  antiCheat: {
    blockClipboard: true,
    blockContextMenu: false,
    detectFocusLoss: true,
    focusLossAction: "WARN",
    focusLossThreshold: 2,
    hideLeaderboard: false,
  },
  testCases: [],
  testScripts: [],
  referenceSolutions: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("diffAssessment", () => {
  it("sends nothing when nothing changed", () => {
    expect(diffAssessment(saved, draftFrom(saved))).toEqual({});
  });

  it("sends only the fields that changed", () => {
    const draft = { ...draftFrom(saved), title: "Binary search II", memoryLimitMb: 512 };
    expect(diffAssessment(saved, draft)).toEqual({
      title: "Binary search II",
      memoryLimitMb: 512,
    });
  });

  it("treats the allowed languages as a set, not a list", () => {
    const draft = { ...draftFrom(saved), allowedLanguages: ["javascript", "python"] as const };
    expect(
      diffAssessment(saved, { ...draft, allowedLanguages: [...draft.allowedLanguages] }),
    ).toEqual({});
  });

  it("notices a language being added", () => {
    const draft = draftFrom(saved);
    draft.allowedLanguages = [...draft.allowedLanguages, "java"];
    expect(diffAssessment(saved, draft).allowedLanguages).toEqual(["python", "javascript", "java"]);
  });

  it("notices starter code being edited and being removed", () => {
    const edited = draftFrom(saved);
    edited.starterCode = { python: "# new" };
    expect(diffAssessment(saved, edited).starterCode).toEqual({ python: "# new" });

    const removed = draftFrom(saved);
    removed.starterCode = {};
    expect(diffAssessment(saved, removed).starterCode).toEqual({});
  });

  it("sends the whole anti-cheat config when any part of it changes", () => {
    const draft = draftFrom(saved);
    draft.antiCheat = { ...draft.antiCheat, focusLossThreshold: 5 };
    expect(diffAssessment(saved, draft).antiCheat).toEqual({
      ...saved.antiCheat,
      focusLossThreshold: 5,
    });
  });

  it("carries the whole timing change together when switching to untimed", () => {
    const draft = draftFrom(saved);
    draft.timeMode = "UNTIMED";
    draft.durationMinutes = null;
    draft.executionMode = null;

    // All three have to travel in one request: the server checks them against
    // each other, and sending them apart would be rejected on the way through.
    expect(diffAssessment(saved, draft)).toEqual({
      timeMode: "UNTIMED",
      durationMinutes: null,
      executionMode: null,
    });
  });

  it("does not confuse publishing with editing", () => {
    const draft = { ...draftFrom(saved), isPublished: true };
    expect(diffAssessment(saved, draft)).toEqual({ isPublished: true });
  });
});

describe("rebaseDraft", () => {
  /** A re-read of the same Assessment, as a reference-solution save produces. */
  const touched = (changes: Partial<AssessmentArchitectView> = {}): AssessmentArchitectView => ({
    ...saved,
    referenceSolutions: { python: "print(1)" },
    updatedAt: "2026-01-01T00:05:00.000Z",
    ...changes,
  });

  it("follows the server when nothing was edited", () => {
    const latest = touched({ memoryLimitMb: 512 });
    const result = rebaseDraft(saved, draftFrom(saved), latest);

    expect(result.draft).toEqual(draftFrom(latest));
    expect(result.conflicts).toEqual([]);
  });

  it("keeps unsaved edits across a re-read that changed none of them", () => {
    const draft = { ...draftFrom(saved), title: "Binary search II" };
    const latest = touched();
    const result = rebaseDraft(saved, draft, latest);

    expect(diffAssessment(latest, result.draft)).toEqual({ title: "Binary search II" });
    expect(result.conflicts).toEqual([]);
  });

  it("takes someone else's change to a field the Architect left alone", () => {
    const draft = { ...draftFrom(saved), title: "Binary search II" };
    const latest = touched({ memoryLimitMb: 512 });
    const result = rebaseDraft(saved, draft, latest);

    expect(result.draft.memoryLimitMb).toBe(512);
    // Saving now must not send the stale 256 back over the other change.
    expect(diffAssessment(latest, result.draft)).toEqual({ title: "Binary search II" });
  });

  it("reports a field both sides changed to different values, keeping the edit", () => {
    const draft = { ...draftFrom(saved), title: "Mine" };
    const result = rebaseDraft(saved, draft, touched({ title: "Theirs" }));

    expect(result.draft.title).toBe("Mine");
    expect(result.conflicts).toEqual(["title"]);
  });

  it("does not call agreement a conflict", () => {
    const draft = { ...draftFrom(saved), title: "Same" };
    const latest = touched({ title: "Same" });
    const result = rebaseDraft(saved, draft, latest);

    expect(result.conflicts).toEqual([]);
    expect(diffAssessment(latest, result.draft)).toEqual({});
  });

  it("lands clean after the draft's own save comes back", () => {
    const draft = { ...draftFrom(saved), isPublished: true, timeLimitMs: 2_000 };
    const latest = touched({ isPublished: true, timeLimitMs: 2_000 });
    const result = rebaseDraft(saved, draft, latest);

    expect(diffAssessment(latest, result.draft)).toEqual({});
    expect(result.conflicts).toEqual([]);
  });
});

describe("takeSaved", () => {
  it("replaces only the named fields", () => {
    const draft = { ...draftFrom(saved), title: "Mine", memoryLimitMb: 512 };
    const latest = { ...saved, title: "Theirs" };

    const next = takeSaved(draft, latest, ["title"]);
    expect(next.title).toBe("Theirs");
    expect(next.memoryLimitMb).toBe(512);
  });
});

describe("sampleCasesFrom", () => {
  const testCase = (overrides: Partial<TestCaseView>): TestCaseView => ({
    id: "case",
    assessmentId: saved.id,
    name: "Case",
    orderIndex: 0,
    kind: "PUBLIC",
    input: "1\n",
    expectedOutput: "1\n",
    weight: 3,
    comparison: "TRIMMED",
    timeLimitMs: null,
    memoryLimitMb: null,
    ...overrides,
  });

  it("keeps the public cases in order and drops the hidden ones", () => {
    const cases = [
      testCase({ id: "a", name: "First" }),
      testCase({ id: "b", name: "Secret", kind: "HIDDEN", expectedOutput: "never shown" }),
      testCase({ id: "c", name: "Second" }),
    ];

    expect(sampleCasesFrom(cases).map((sample) => sample.name)).toEqual(["First", "Second"]);
  });

  it("carries nothing but what a Coder is shown", () => {
    const [sample] = sampleCasesFrom([testCase({})]);
    expect(sample).toEqual({ name: "Case", input: "1\n", expectedOutput: "1\n" });
  });
});
