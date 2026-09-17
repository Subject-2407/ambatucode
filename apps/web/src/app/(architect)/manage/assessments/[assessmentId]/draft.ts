import type {
  AntiCheatConfig,
  AssessmentArchitectView,
  ExecutionMode,
  GradingStrategy,
  Language,
  StarterCodeMap,
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
  antiCheat: AntiCheatConfig;
  isPublished: boolean;
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
    antiCheat: { ...assessment.antiCheat },
    isPublished: assessment.isPublished,
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
  if (!sameAntiCheat(draft.antiCheat, saved.antiCheat)) patch.antiCheat = draft.antiCheat;
  if (draft.isPublished !== saved.isPublished) patch.isPublished = draft.isPublished;

  return patch;
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
