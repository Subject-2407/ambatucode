import { describe, expect, it } from "vitest";
import type { AssessmentArchitectView } from "@ambatucode/shared";
import { diffAssessment, draftFrom } from "./draft";

const saved: AssessmentArchitectView = {
  id: "assessment-1",
  sectionId: "section-1",
  moduleId: "module-1",
  title: "Binary search",
  orderIndex: 0,
  isPublished: false,
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
