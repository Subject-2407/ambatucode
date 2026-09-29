/**
 * The achievement catalogue: every title the platform can award, as data.
 *
 * Definitions live here rather than in the database because three consumers
 * need them and only one of them can read a table. The seed inserts these
 * rows, the backend's rule engine registers a predicate per `code`, and the
 * browser renders the locked ones so a Coder can see what is still out there.
 * A code with no entry here is not an achievement; a code here with no rule
 * registered is a startup error, checked in the engine.
 *
 * Awards are permanent, so the wording of a rule is a promise. Changing what
 * an existing code means would silently rewrite what somebody already earned —
 * retire a code and add a new one instead.
 */

export const ACHIEVEMENT_CATEGORIES = [
  "PRECISION",
  "TIMING",
  "EFFICIENCY",
  "CRAFT",
  "BREADTH",
  "GRIT",
  "PROGRESS",
  "LIVE",
  "PRACTICE",
] as const;
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

export const ACHIEVEMENT_CATEGORY_LABEL: Readonly<Record<AchievementCategory, string>> = {
  PRECISION: "Precision",
  TIMING: "Timing",
  EFFICIENCY: "Efficiency",
  CRAFT: "Craft",
  BREADTH: "Breadth",
  GRIT: "Grit",
  PROGRESS: "Progress",
  LIVE: "Live sessions",
  PRACTICE: "Practice",
};

export type AchievementDefinition = {
  code: string;
  name: string;
  description: string;
  /** Names a lucide icon the frontend maps; never a file path. */
  iconKey: string;
  category: AchievementCategory;
};

export const ACHIEVEMENTS = [
  // --- Precision ------------------------------------------------------------
  {
    code: "STRATEGIC_SNIPER",
    name: "Strategic Sniper",
    description:
      "Scored 100 on a first attempt, with a run time in the fastest 10% for that assessment.",
    iconKey: "crosshair",
    category: "PRECISION",
  },
  {
    code: "FLAWLESS_RUN",
    name: "Flawless Run",
    description: "Scored 100 on an assessment that has hidden test cases.",
    iconKey: "sparkles",
    category: "PRECISION",
  },
  {
    code: "PERFECT_STREAK",
    name: "Unbroken",
    description: "Scored 100 on three submissions in a row within one module.",
    iconKey: "flame",
    category: "PRECISION",
  },
  {
    code: "SECOND_WIND",
    name: "Second Wind",
    description: "Scored 100 on a new attempt granted after a reset.",
    iconKey: "rotate-ccw",
    category: "PRECISION",
  },
  {
    code: "COLD_START",
    name: "Cold Start",
    description: "Scored 100 without running your code first.",
    iconKey: "snowflake",
    category: "PRECISION",
  },

  // --- Timing ---------------------------------------------------------------
  {
    code: "BLOOD_HUNTER",
    name: "The Blood Hunter",
    description:
      "Scored 100 in the final minute of a timed assessment with more than one test case.",
    iconKey: "hourglass",
    category: "TIMING",
  },
  {
    code: "SPEED_DEMON",
    name: "Speed Demon",
    description: "Scored 100 within the first quarter of a timed assessment.",
    iconKey: "zap",
    category: "TIMING",
  },
  {
    code: "EARLY_BIRD",
    name: "Early Bird",
    description: "The first in a session to score 100.",
    iconKey: "sunrise",
    category: "TIMING",
  },
  {
    code: "MARATHONER",
    name: "Marathoner",
    description: "Scored 80 or more after using at least 95% of a timed assessment's time.",
    iconKey: "footprints",
    category: "TIMING",
  },

  // --- Efficiency -----------------------------------------------------------
  {
    code: "OPTIMIZER",
    name: "Optimizer",
    description: "Your graded submission was among the fastest 10% for that assessment.",
    iconKey: "gauge",
    category: "EFFICIENCY",
  },
  {
    code: "LIGHT_FOOTPRINT",
    name: "Light Footprint",
    description:
      "Your graded submission used less memory than 90% of submissions for that assessment.",
    iconKey: "feather",
    category: "EFFICIENCY",
  },

  // --- Craft ----------------------------------------------------------------
  {
    code: "THE_ARCHITECT",
    name: "The Architect",
    description: "Passed every test script check on a graded submission.",
    iconKey: "compass",
    category: "CRAFT",
  },
  {
    code: "TEST_WHISPERER",
    name: "Test Whisperer",
    description: "Passed every test script check on a first attempt.",
    iconKey: "list-checks",
    category: "CRAFT",
  },

  // --- Breadth --------------------------------------------------------------
  {
    code: "POLYGLOT",
    name: "Polyglot",
    description: "Had submissions graded in three different languages.",
    iconKey: "languages",
    category: "BREADTH",
  },
  {
    code: "FULL_SPECTRUM",
    name: "Full Spectrum",
    description: "Had submissions graded in every language the platform supports.",
    iconKey: "palette",
    category: "BREADTH",
  },

  // --- Grit -----------------------------------------------------------------
  {
    code: "COMEBACK_KID",
    name: "Comeback Kid",
    description: "Improved by 40 points or more on a later attempt in the same session.",
    iconKey: "trending-up",
    category: "GRIT",
  },
  {
    code: "UNSHAKEN",
    name: "Unshaken",
    description: "Scored 80 or more after losing your connection and reconnecting.",
    iconKey: "anchor",
    category: "GRIT",
  },
  {
    code: "IRON_WILL",
    name: "Iron Will",
    description: "Scored 100 in a session where an earlier attempt of yours scored under 50.",
    iconKey: "shield",
    category: "GRIT",
  },

  // --- Progress -------------------------------------------------------------
  {
    code: "FIRST_LIGHT",
    name: "First Light",
    description: "Had your first submission graded.",
    iconKey: "star",
    category: "PROGRESS",
  },
  {
    code: "SECTION_SWEEP",
    name: "Section Sweep",
    description: "Got an official score of 100 on every assessment in a section.",
    iconKey: "layers",
    category: "PROGRESS",
  },
  {
    code: "MODULE_CLEARED",
    name: "Module Cleared",
    description: "Got an official score on every published assessment in a module.",
    iconKey: "graduation-cap",
    category: "PROGRESS",
  },

  // --- Live sessions --------------------------------------------------------
  {
    code: "UNDER_PRESSURE",
    name: "Under Pressure",
    description: "Scored 90 or more in a Live session with at least 10 participants.",
    iconKey: "users",
    category: "LIVE",
  },
  {
    code: "EYES_FORWARD",
    name: "Eyes Forward",
    description: "Scored 80 or more on a focus-monitored assessment without leaving the window.",
    iconKey: "eye",
    category: "LIVE",
  },

  // --- Practice -------------------------------------------------------------
  {
    code: "DRILL_SERGEANT",
    name: "Drill Sergeant",
    description: "Made 50 practice runs.",
    iconKey: "dumbbell",
    category: "PRACTICE",
  },
  {
    code: "STUDENT_OF_THE_GAME",
    name: "Student of the Game",
    description: "Passed every check on 10 different practice activities.",
    iconKey: "book-open-check",
    category: "PRACTICE",
  },
] as const satisfies readonly AchievementDefinition[];

export type AchievementCode = (typeof ACHIEVEMENTS)[number]["code"];

export const ACHIEVEMENT_CODES = ACHIEVEMENTS.map(
  (achievement) => achievement.code,
) as readonly AchievementCode[];

const BY_CODE = new Map<string, AchievementDefinition>(
  ACHIEVEMENTS.map((achievement) => [achievement.code, achievement]),
);

export function achievementByCode(code: string): AchievementDefinition | undefined {
  return BY_CODE.get(code);
}

export function isAchievementCode(value: string): value is AchievementCode {
  return BY_CODE.has(value);
}
