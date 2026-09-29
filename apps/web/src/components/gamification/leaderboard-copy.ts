import type { LeaderboardScope } from "@ambatucode/shared";

/**
 * What a leaderboard says about itself, so nobody has to guess.
 *
 * A bare table of names and numbers left three questions open: is this
 * everyone or only the top, what is a point, and why do two people share a
 * rank. Each answer is one short line here.
 */

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

export function ordinal(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${String(rank)}th`;
  switch (rank % 10) {
    case 1:
      return `${String(rank)}st`;
    case 2:
      return `${String(rank)}nd`;
    case 3:
      return `${String(rank)}rd`;
    default:
      return `${String(rank)}th`;
  }
}

/** "Top 25 of 40 Coders", or "All 12 Coders" when the page is the whole board. */
export function boardExtent(shown: number, rankedCount: number): string {
  if (shown >= rankedCount) {
    return rankedCount === 1 ? "1 Coder ranked" : `All ${String(rankedCount)} Coders`;
  }
  return `Top ${String(shown)} of ${String(rankedCount)} Coders`;
}

const SCOPE_NOUN: Readonly<Record<LeaderboardScope, string>> = {
  MODULE: "module",
  SECTION: "section",
  ASSESSMENT: "assessment",
};

/** What a point is, and how equal totals are ordered. */
export function scoringNote(scope: LeaderboardScope, assessmentCount: number): string {
  const counted =
    scope === "ASSESSMENT"
      ? "Points are the official score on this assessment, out of 100."
      : `Points are the sum of official scores on the ${plural(assessmentCount, "assessment", "assessments")} in this ${SCOPE_NOUN[scope]}, up to 100 each.`;
  return `${counted} Equal points share a rank, listed by who got there first.`;
}

/** Where the viewer stands, or null when their row is already on the page. */
export function viewerNote(
  viewerRank: number | null,
  rankedCount: number,
  viewerShown: boolean,
): string | null {
  if (viewerRank === null)
    return "You are not on this board yet. An official score puts you on it.";
  if (viewerShown) return null;
  return `You are ${ordinal(viewerRank)} of ${String(rankedCount)}.`;
}
