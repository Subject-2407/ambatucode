import {
  ACHIEVEMENTS,
  LANGUAGES,
  type AchievementCode,
  type Language,
  type SubmissionStatus,
} from "@ambatucode/shared";

/**
 * Achievement rules.
 *
 * Every rule is a pure predicate over a context the caller has already
 * assembled. That is deliberate: an award is permanent, so a rule that is
 * wrong once is wrong forever, and a predicate with no database underneath it
 * can be tested exhaustively against the boundary cases that actually matter —
 * the submission one second inside the deadline, the second attempt after a
 * reset, the assessment with four submissions where a "top tenth" means
 * nothing.
 *
 * Rules never read a clock or a connection. Anything derived lives in the
 * context, computed once by `achievements.ts`.
 */

/** Below this many graded submissions, "fastest tenth" is not a real claim. */
export const PERCENTILE_MIN_SAMPLE = 5;

/** How close to the deadline The Blood Hunter has to cut it. */
export const FINAL_STRETCH_MS = 60_000;

export type SubmissionFacts = {
  score: number;
  status: SubmissionStatus;
  language: Language;
  submittedAtMs: number;
  executionTimeMs: number | null;
  memoryUsedKb: number | null;
};

export type AttemptFacts = {
  attemptNumber: number;
  /** Runs the Coder spent before submitting. Counted, never graded. */
  runCount: number;
  /** Server-side consumed time. Null for an untimed assessment. */
  consumedMs: number | null;
  /** The attempt's own deadline, individual or global. Null when untimed. */
  deadlineMs: number | null;
  /** How long the attempt had in total. Null when untimed. */
  durationMs: number | null;
};

export type AssessmentFacts = {
  isTimed: boolean;
  isLive: boolean;
  /** Set when the Architect turned focus monitoring on. */
  detectsFocusLoss: boolean;
  caseCount: number;
  hiddenCaseCount: number;
};

export type DerivedFacts = {
  /**
   * Where this submission's execution time falls among graded submissions for
   * the same assessment, 0 being the fastest. Null when too few exist to say.
   */
  executionTimeQuantile: number | null;
  memoryQuantile: number | null;
  /** Script tests that ran on this submission, and how many passed. */
  scriptTestCount: number;
  scriptTestsPassed: number;
  /** Cases that ran on this submission, and how many passed. */
  caseResultCount: number;
  caseResultsPassed: number;
  /** Graded submissions at 100 in a row within this module, this one included. */
  perfectStreak: number;
  /** Distinct languages this Coder has a graded submission in. */
  languagesGraded: number;
  /** True when this is the Coder's first graded formal submission anywhere. */
  isFirstGraded: boolean;
  /** True when nobody else in this session reached 100 first. */
  isFirstPerfectInSession: boolean;
  /** The best and worst scores of this Coder's earlier attempts at this session. */
  bestEarlierAttemptScore: number | null;
  worstEarlierAttemptScore: number | null;
  /** Whether this attempt logged a reconnect after losing its connection. */
  reconnected: boolean;
  focusLostCount: number;
  /** Participants listed on this session. Zero for an open session. */
  sessionParticipantCount: number;
  /** Every assessment in the section carries an official 100. */
  sectionSwept: boolean;
  /** Every published assessment in the module carries an official score. */
  moduleCleared: boolean;
};

export type SubmissionContext = {
  submission: SubmissionFacts;
  attempt: AttemptFacts;
  assessment: AssessmentFacts;
  derived: DerivedFacts;
};

export type PracticeContext = {
  /** Practice runs this Coder has made, across every activity. */
  runCount: number;
  /** Activities where every case and script test has passed together. */
  masteredCount: number;
};

const TOP_TENTH = 0.1;

function isPerfect(context: SubmissionContext): boolean {
  return context.submission.status === "GRADED" && context.submission.score === 100;
}

function inTopTenth(quantile: number | null): boolean {
  return quantile !== null && quantile <= TOP_TENTH;
}

/** Milliseconds left on the clock when this submission landed. */
function remainingAtSubmitMs(context: SubmissionContext): number | null {
  const { deadlineMs } = context.attempt;
  if (deadlineMs === null) return null;
  return deadlineMs - context.submission.submittedAtMs;
}

export const SUBMISSION_RULES: Readonly<Record<string, (context: SubmissionContext) => boolean>> = {
  // --- Precision -------------------------------------------------------------
  STRATEGIC_SNIPER: (context) =>
    isPerfect(context) &&
    context.attempt.attemptNumber === 1 &&
    inTopTenth(context.derived.executionTimeQuantile),

  FLAWLESS_RUN: (context) =>
    isPerfect(context) &&
    context.assessment.hiddenCaseCount > 0 &&
    context.derived.caseResultCount === context.derived.caseResultsPassed,

  PERFECT_STREAK: (context) => isPerfect(context) && context.derived.perfectStreak >= 3,

  // The attempt number is the tell: attempt 1 is never granted by a reset.
  SECOND_WIND: (context) => isPerfect(context) && context.attempt.attemptNumber > 1,

  COLD_START: (context) => isPerfect(context) && context.attempt.runCount === 0,

  // --- Timing ----------------------------------------------------------------
  BLOOD_HUNTER: (context) => {
    if (context.submission.status !== "GRADED" || context.submission.score < 100) return false;
    // "Multi-case" is the point: scraping a single-case task in the last
    // minute is not the same feat.
    if (context.assessment.caseCount < 2) return false;
    const remaining = remainingAtSubmitMs(context);
    return remaining !== null && remaining >= 0 && remaining <= FINAL_STRETCH_MS;
  },

  SPEED_DEMON: (context) => {
    if (!isPerfect(context) || !context.assessment.isTimed) return false;
    const { consumedMs, durationMs } = context.attempt;
    if (consumedMs === null || durationMs === null || durationMs <= 0) return false;
    return consumedMs <= durationMs * 0.25;
  },

  EARLY_BIRD: (context) => isPerfect(context) && context.derived.isFirstPerfectInSession,

  MARATHONER: (context) => {
    if (context.submission.status !== "GRADED" || context.submission.score < 80) return false;
    if (!context.assessment.isTimed) return false;
    const { consumedMs, durationMs } = context.attempt;
    if (consumedMs === null || durationMs === null || durationMs <= 0) return false;
    return consumedMs >= durationMs * 0.95;
  },

  // --- Efficiency ------------------------------------------------------------
  OPTIMIZER: (context) =>
    context.submission.status === "GRADED" && inTopTenth(context.derived.executionTimeQuantile),

  LIGHT_FOOTPRINT: (context) =>
    context.submission.status === "GRADED" && inTopTenth(context.derived.memoryQuantile),

  // --- Craft -----------------------------------------------------------------
  THE_ARCHITECT: (context) =>
    context.derived.scriptTestCount > 0 &&
    context.derived.scriptTestsPassed === context.derived.scriptTestCount,

  TEST_WHISPERER: (context) =>
    context.attempt.attemptNumber === 1 &&
    context.derived.scriptTestCount > 0 &&
    context.derived.scriptTestsPassed === context.derived.scriptTestCount,

  // --- Breadth ---------------------------------------------------------------
  POLYGLOT: (context) => context.derived.languagesGraded >= 3,
  FULL_SPECTRUM: (context) => context.derived.languagesGraded >= LANGUAGES.length,

  // --- Grit ------------------------------------------------------------------
  COMEBACK_KID: (context) => {
    const earlier = context.derived.bestEarlierAttemptScore;
    return (
      context.submission.status === "GRADED" &&
      earlier !== null &&
      context.submission.score - earlier >= 40
    );
  },

  UNSHAKEN: (context) =>
    context.submission.status === "GRADED" &&
    context.submission.score >= 80 &&
    context.derived.reconnected,

  IRON_WILL: (context) => {
    const worst = context.derived.worstEarlierAttemptScore;
    return isPerfect(context) && worst !== null && worst < 50;
  },

  // --- Progress --------------------------------------------------------------
  FIRST_LIGHT: (context) => context.submission.status === "GRADED" && context.derived.isFirstGraded,

  SECTION_SWEEP: (context) => context.derived.sectionSwept,
  MODULE_CLEARED: (context) => context.derived.moduleCleared,

  // --- Live sessions ---------------------------------------------------------
  UNDER_PRESSURE: (context) =>
    context.submission.status === "GRADED" &&
    context.submission.score >= 90 &&
    context.assessment.isLive &&
    context.derived.sessionParticipantCount >= 10,

  EYES_FORWARD: (context) =>
    context.submission.status === "GRADED" &&
    context.submission.score >= 80 &&
    context.assessment.detectsFocusLoss &&
    context.derived.focusLostCount === 0,
};

export const PRACTICE_RULES: Readonly<Record<string, (context: PracticeContext) => boolean>> = {
  DRILL_SERGEANT: (context) => context.runCount >= 50,
  STUDENT_OF_THE_GAME: (context) => context.masteredCount >= 10,
};

/**
 * Every catalogue entry must have exactly one rule, and no rule may exist for
 * a code the catalogue does not define.
 *
 * Checked rather than assumed because both halves fail silently otherwise: a
 * catalogue entry with no rule is a title nobody can ever earn, and a rule
 * with no entry awards a row the browser cannot name. Called once at module
 * load below, so a mismatch is a startup failure rather than a support
 * ticket six weeks later.
 */
export function assertRuleCoverage(): void {
  const rules = new Set([...Object.keys(SUBMISSION_RULES), ...Object.keys(PRACTICE_RULES)]);
  const catalogue = new Set<string>(ACHIEVEMENTS.map((achievement) => achievement.code));

  const unruled = [...catalogue].filter((code) => !rules.has(code));
  if (unruled.length > 0) {
    throw new Error(`Achievements with no rule: ${unruled.join(", ")}`);
  }

  const orphaned = [...rules].filter((code) => !catalogue.has(code));
  if (orphaned.length > 0) {
    throw new Error(`Rules with no achievement: ${orphaned.join(", ")}`);
  }

  const both = [...Object.keys(SUBMISSION_RULES)].filter((code) => code in PRACTICE_RULES);
  if (both.length > 0) {
    throw new Error(`Achievements registered against two triggers: ${both.join(", ")}`);
  }
}

assertRuleCoverage();

export function submissionRuleCodes(): AchievementCode[] {
  return Object.keys(SUBMISSION_RULES) as AchievementCode[];
}

export function practiceRuleCodes(): AchievementCode[] {
  return Object.keys(PRACTICE_RULES) as AchievementCode[];
}
