import { z } from "zod";
import { ACHIEVEMENT_CATEGORIES } from "../achievements";
import { cuidSchema } from "./common";

/**
 * Leaderboards and achievements.
 *
 * Both are grading data wearing a friendlier name: a rank is a score, and a
 * title earned for scoring 100 says what a Coder scored. Root is refused from
 * every read here in the data access layer, for the same reason Root is
 * refused submissions.
 */

// --- Leaderboards -------------------------------------------------------------

export const LEADERBOARD_SCOPES = ["MODULE", "SECTION", "ASSESSMENT"] as const;
export type LeaderboardScope = (typeof LEADERBOARD_SCOPES)[number];

/**
 * One row, already ranked.
 *
 * `score` is the sum of a Coder's official scores across the assessments this
 * board counts, so an assessment nobody has taken costs nothing and a module
 * board rewards breadth. The two tiebreaks are the "submission speed" the SRS
 * allows: whoever reached their total first, and then whoever's code ran
 * faster. Both are stable, which matters — a board that reshuffles equal rows
 * on every refresh reads as broken.
 */
export const leaderboardRowSchema = z.object({
  rank: z.number().int().min(1),
  userId: cuidSchema,
  username: z.string(),
  displayName: z.string(),
  score: z.number().int().min(0),
  /** How many counted assessments this Coder has an official score on. */
  assessmentsCounted: z.number().int().min(0),
  /** Epoch ms of the last submission that contributed. Null when none has. */
  submittedAt: z.number().nullable(),
  totalExecutionTimeMs: z.number().int().min(0).nullable(),
});
export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;

export const leaderboardUpdatePayloadSchema = z.object({
  scope: z.enum(LEADERBOARD_SCOPES),
  scopeId: cuidSchema,
  rows: z.array(leaderboardRowSchema),
});
export type LeaderboardUpdatePayload = z.infer<typeof leaderboardUpdatePayloadSchema>;

export type LeaderboardView = {
  scope: LeaderboardScope;
  scopeId: string;
  title: string;
  /** Assessments the board counts. Zero means every one of them was hidden. */
  assessmentCount: number;
  /**
   * Assessments left out because their Architect set `hideLeaderboard`. Shown
   * as a count so the board can say why a total looks low, without naming the
   * assessments a Coder is not meant to be ranked on.
   */
  hiddenAssessmentCount: number;
  rows: LeaderboardRow[];
  /** The viewer's own rank, even when they fall outside the returned page. */
  viewerRank: number | null;
  generatedAtMs: number;
};

export const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

// --- Achievements -------------------------------------------------------------

export const achievementViewSchema = z.object({
  code: z.string().min(1),
  name: z.string(),
  description: z.string(),
  iconKey: z.string(),
  category: z.enum(ACHIEVEMENT_CATEGORIES),
});
export type AchievementView = z.infer<typeof achievementViewSchema>;

/**
 * `context` carries the small facts that make an award readable — the
 * assessment it came from, the score. Never source code, never another
 * Coder's data.
 */
export const userAchievementViewSchema = achievementViewSchema.extend({
  awardedAt: z.string(),
  context: z.record(z.string(), z.unknown()),
});
export type UserAchievementView = z.infer<typeof userAchievementViewSchema>;

export type AchievementShowcaseView = {
  userId: string;
  displayName: string;
  earned: UserAchievementView[];
  /** Still available, so the showcase can show what there is to aim for. */
  locked: AchievementView[];
};

/** Pushed to the Coder who just earned it, for the award toast. */
export const achievementAwardedPayloadSchema = achievementViewSchema.extend({
  awardedAtMs: z.number(),
});
export type AchievementAwardedPayload = z.infer<typeof achievementAwardedPayloadSchema>;
