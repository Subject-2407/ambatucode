import type {
  AntiCheatConfig,
  AssessmentArchitectView,
  ExecutionMode,
  ExitPolicy,
  GradingStrategy,
  Language,
  SampleCaseView,
  StarterCodeMap,
  TestCaseView,
  TimeMode,
  UpdateAssessmentRequest,
} from "@ambatucode/shared";

/**
 * The Assessment definition as the editor holds it, and how it becomes a PATCH.
 *
 * The diff matters for more than bandwidth. `updateAssessmentRequestSchema` is
 * a partial with no defaults precisely so an untouched field is left alone, and
 * sending the whole object back would make every save a full overwrite — which
 * would quietly clobber a change another Architect made to a field this editor
 * never touched.
 */

export type AssessmentDraft = {
  title: string;
  problemStatement: string;
  allowedLanguages: Language[];
  starterCode: StarterCodeMap;
  timeMode: TimeMode;
  durationMinutes: number | null;
  executionMode: ExecutionMode | null;
  timeLimitMs: number;
  memoryLimitMb: number;
  gradingStrategy: GradingStrategy;
  exitPolicy: ExitPolicy;
  antiCheat: AntiCheatConfig;
  isPublished: boolean;
  isOpenAccess: boolean;
};

export function draftFrom(assessment: AssessmentArchitectView): AssessmentDraft {
  return {
    title: assessment.title,
    problemStatement: assessment.problemStatement,
    allowedLanguages: [...assessment.allowedLanguages],
    starterCode: { ...assessment.starterCode },
    timeMode: assessment.timeMode,
    durationMinutes: assessment.durationMinutes,
    executionMode: assessment.executionMode,
    timeLimitMs: assessment.timeLimitMs,
    memoryLimitMb: assessment.memoryLimitMb,
    gradingStrategy: assessment.gradingStrategy,
    exitPolicy: assessment.exitPolicy,
    antiCheat: { ...assessment.antiCheat },
    isPublished: assessment.isPublished,
    isOpenAccess: assessment.isOpenAccess,
  };
}

export function diffAssessment(
  saved: AssessmentArchitectView,
  draft: AssessmentDraft,
): UpdateAssessmentRequest {
  const patch: UpdateAssessmentRequest = {};

  if (draft.title !== saved.title) patch.title = draft.title;
  if (draft.problemStatement !== saved.problemStatement) {
    patch.problemStatement = draft.problemStatement;
  }
  if (!sameLanguages(draft.allowedLanguages, saved.allowedLanguages)) {
    patch.allowedLanguages = draft.allowedLanguages;
  }
  if (!sameStarterCode(draft.starterCode, saved.starterCode)) {
    patch.starterCode = draft.starterCode;
  }
  if (draft.timeMode !== saved.timeMode) patch.timeMode = draft.timeMode;
  if (draft.durationMinutes !== saved.durationMinutes) {
    patch.durationMinutes = draft.durationMinutes;
  }
  if (draft.executionMode !== saved.executionMode) patch.executionMode = draft.executionMode;
  if (draft.timeLimitMs !== saved.timeLimitMs) patch.timeLimitMs = draft.timeLimitMs;
  if (draft.memoryLimitMb !== saved.memoryLimitMb) patch.memoryLimitMb = draft.memoryLimitMb;
  if (draft.gradingStrategy !== saved.gradingStrategy) {
    patch.gradingStrategy = draft.gradingStrategy;
  }
  if (draft.exitPolicy !== saved.exitPolicy) patch.exitPolicy = draft.exitPolicy;
  if (!sameAntiCheat(draft.antiCheat, saved.antiCheat)) patch.antiCheat = draft.antiCheat;
  if (draft.isPublished !== saved.isPublished) patch.isPublished = draft.isPublished;
  if (draft.isOpenAccess !== saved.isOpenAccess) patch.isOpenAccess = draft.isOpenAccess;

  return patch;
}

export type DraftField = keyof AssessmentDraft;

/** How a field is named when the editor has to talk about it. */
export const DRAFT_FIELD_LABEL: Readonly<Record<DraftField, string>> = {
  title: "Title",
  problemStatement: "Problem statement",
  allowedLanguages: "Allowed languages",
  starterCode: "Starter code",
  timeMode: "Time constraint",
  durationMinutes: "Duration",
  executionMode: "Execution mode",
  timeLimitMs: "Time limit",
  memoryLimitMb: "Memory limit",
  gradingStrategy: "Grading",
  exitPolicy: "Leaving the workspace",
  antiCheat: "Anti-cheat",
  isPublished: "Published",
  isOpenAccess: "Open access",
};

/** The fields where `draft` says something other than `saved`. */
export function changedFields(
  saved: AssessmentArchitectView,
  draft: AssessmentDraft,
): DraftField[] {
  // The patch already holds exactly one key per differing field, and its keys
  // are the draft's own; computing equality twice would let the two drift.
  return Object.keys(diffAssessment(saved, draft)) as DraftField[];
}

/**
 * Carries an in-progress draft across a change to the saved Assessment.
 *
 * The saved Assessment changes under the editor more often than it looks:
 * saving a reference solution, adding a test case, or a validation finishing
 * all re-read it. Reseeding the draft from each new read threw away whatever
 * the Architect had not saved yet, and keeping the old draft unchanged would
 * quietly revert, on the next save, any field someone else had changed since.
 *
 * So this is a three-way merge against the read the draft started from. Fields
 * the Architect edited keep their edit; every other field takes the new saved
 * value. A field both sides changed, to different values, keeps the
 * Architect's edit and is reported, because saving will overwrite the other
 * change and they should know that before they do.
 */
export function rebaseDraft(
  base: AssessmentArchitectView,
  draft: AssessmentDraft,
  latest: AssessmentArchitectView,
): { draft: AssessmentDraft; conflicts: DraftField[] } {
  const mine = changedFields(base, draft);
  const theirs = new Set(changedFields(base, draftFrom(latest)));

  const next = draftFrom(latest);
  for (const field of mine) copyField(next, draft, field);

  const stillDiffers = new Set(changedFields(latest, next));
  const conflicts = mine.filter((field) => theirs.has(field) && stillDiffers.has(field));

  return { draft: next, conflicts };
}

/** Replaces the named fields of `draft` with their saved values. */
export function takeSaved(
  draft: AssessmentDraft,
  saved: AssessmentArchitectView,
  fields: readonly DraftField[],
): AssessmentDraft {
  const next = { ...draft };
  const source = draftFrom(saved);
  for (const field of fields) copyField(next, source, field);
  return next;
}

function copyField<K extends DraftField>(
  target: AssessmentDraft,
  source: AssessmentDraft,
  field: K,
): void {
  target[field] = source[field];
}

/**
 * The sample cases a Coder is shown: the public test cases, in order, with
 * nothing but their name, input, and expected output.
 *
 * Mirrors the server's workspace serializer, so the editor's preview can show
 * exactly what an attempt will. The fields are copied out one by one rather
 * than spread, so a weight or a comparison mode never rides along into a
 * component built for the Coder's view.
 */
export function sampleCasesFrom(testCases: readonly TestCaseView[]): SampleCaseView[] {
  return testCases
    .filter((testCase) => testCase.kind === "PUBLIC")
    .map((testCase) => ({
      name: testCase.name,
      input: testCase.input,
      expectedOutput: testCase.expectedOutput,
    }));
}

/**
 * Order is not meaning: the allowed languages are a set, and a reordering
 * caused by a checkbox being toggled off and back on is not an edit.
 */
function sameLanguages(a: readonly Language[], b: readonly Language[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

function sameStarterCode(a: StarterCodeMap, b: StarterCodeMap): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key as Language] !== b[key as Language]) return false;
  }
  return true;
}

function sameAntiCheat(a: AntiCheatConfig, b: AntiCheatConfig): boolean {
  return (
    a.blockClipboard === b.blockClipboard &&
    a.blockContextMenu === b.blockContextMenu &&
    a.detectFocusLoss === b.detectFocusLoss &&
    a.focusLossAction === b.focusLossAction &&
    a.focusLossThreshold === b.focusLossThreshold &&
    a.hideLeaderboard === b.hideLeaderboard
  );
}
