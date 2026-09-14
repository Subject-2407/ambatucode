import "server-only";
import { randomUUID } from "node:crypto";
import { type Prisma, prisma } from "@ambatucode/db";
import {
  AppError,
  DEFAULT_EXECUTION_LIMITS,
  EXECUTABLE_LANGUAGES,
  MAX_TEST_SCRIPTS_PER_LANGUAGE,
  isExecutableLanguage,
  type AuthenticatedUser,
  type CreatePracticeRequest,
  type ExecutionTestCase,
  type ExecutionTestScript,
  type Language,
  type PracticeActivityView,
  type PracticeTestCase,
  type PracticeTestCaseInput,
  type PracticeTestScriptView,
  type PracticeTestScriptsView,
  type RunPracticeRequest,
  type RunPracticeResponse,
  type SaveReferenceSolutionRequest,
  type StarterCodeMap,
  type UpdatePracticeRequest,
  type UploadPracticeTestScriptRequest,
  type ValidateTestScriptsRequest,
  type ValidateTestScriptsResponse,
} from "@ambatucode/shared";
import { consumeRateLimit } from "../auth/rate-limit";
import { enqueueExecutionJob, type ExecutionJobInput } from "../queue/producer";
import { readReferenceSolutions } from "../serializers/assessment";
import { toPracticeActivityView, toPracticeTestScriptView } from "../serializers/content";
import { scopeForMaterial, scopeForPractice, scopeForPracticeTestScript } from "./content-scope";
import { assertCanRead, assertCanWrite } from "./modules";
import {
  VALIDATION_SELECT,
  enqueueScriptValidation,
  resetValidation,
  validationLimits,
} from "./script-validation";

/**
 * Practice Activities and the Runs they produce.
 *
 * A Practice Run writes nothing. No Submission row, no attempt consumed, no
 * grade — that separation is the whole reason practice exists, and it is
 * enforced here by there being no write path at all, not by a flag someone
 * could flip.
 */

const PRACTICE_SELECT = {
  id: true,
  materialId: true,
  title: true,
  orderIndex: true,
  prompt: true,
  allowedLanguages: true,
  starterCodeJson: true,
  timeLimitMs: true,
  memoryLimitMb: true,
  testCasesJson: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PracticeActivitySelect;

/** Runs per Coder per activity. Generous — practice is meant to be repeated —
 * but bounded, because each one costs a container. */
const RUN_RATE_LIMIT = { max: 30, windowSeconds: 60 } as const;

/**
 * Refuses a language nothing can execute.
 *
 * The product vocabulary knows four languages; only those with a built sandbox
 * image can actually run. Catching that here — while the Architect is authoring
 * — turns it into a sentence they can act on, instead of a SYSTEM_ERROR a
 * Coder meets halfway through an exercise.
 */
function assertRunnableLanguages(languages: Language[]): void {
  const unrunnable = languages.filter((language) => !isExecutableLanguage(language));
  if (unrunnable.length > 0) {
    throw new AppError(
      "LANGUAGE_NOT_ALLOWED",
      `No execution environment is available for ${unrunnable.join(", ")}. Available: ${EXECUTABLE_LANGUAGES.join(", ")}`,
    );
  }
}

/**
 * Gives every case a stable id. The editor sends new cases without one; ids
 * that already exist are kept so a rename or reorder does not look like a
 * delete-and-recreate to anything holding onto them.
 */
function withStableIds(cases: PracticeTestCaseInput[]): PracticeTestCase[] {
  const seen = new Set<string>();
  return cases.map((testCase) => {
    const id = testCase.id && !seen.has(testCase.id) ? testCase.id : randomUUID();
    seen.add(id);
    return { ...testCase, id };
  });
}

function assertStarterCodeMatchesLanguages(
  starterCode: Record<string, string | undefined>,
  allowed: Language[],
): void {
  const stray = Object.keys(starterCode).filter(
    (language) => !allowed.includes(language as Language),
  );
  if (stray.length > 0) {
    throw new AppError(
      "VALIDATION_FAILED",
      `Starter code was provided for a language this activity does not allow: ${stray.join(", ")}`,
    );
  }
}

export async function listPracticeActivities(
  actor: AuthenticatedUser,
  materialId: string,
): Promise<PracticeActivityView[]> {
  const scope = await scopeForMaterial(materialId);
  const { isOwner } = await assertCanRead(actor, scope.moduleId);
  if (!scope.isPublished && !isOwner) {
    throw new AppError("NOT_FOUND", "Material not found");
  }

  const rows = await prisma.practiceActivity.findMany({
    where: { materialId },
    select: PRACTICE_SELECT,
    orderBy: { orderIndex: "asc" },
  });
  return rows.map(toPracticeActivityView);
}

export async function getPracticeActivity(
  actor: AuthenticatedUser,
  practiceId: string,
): Promise<PracticeActivityView> {
  const scope = await scopeForPractice(practiceId);
  const { isOwner } = await assertCanRead(actor, scope.moduleId);
  if (!scope.isPublished && !isOwner) {
    throw new AppError("NOT_FOUND", "Practice activity not found");
  }

  const row = await prisma.practiceActivity.findUniqueOrThrow({
    where: { id: practiceId },
    select: PRACTICE_SELECT,
  });
  return toPracticeActivityView(row);
}

export async function createPracticeActivity(
  actor: AuthenticatedUser,
  materialId: string,
  input: CreatePracticeRequest,
): Promise<PracticeActivityView> {
  const scope = await scopeForMaterial(materialId);
  await assertCanWrite(actor, scope.moduleId);

  assertRunnableLanguages(input.allowedLanguages);
  assertStarterCodeMatchesLanguages(input.starterCode, input.allowedLanguages);

  const created = await prisma.$transaction(async (tx) => {
    const count = await tx.practiceActivity.count({ where: { materialId } });
    return tx.practiceActivity.create({
      data: {
        materialId,
        title: input.title,
        orderIndex: count,
        prompt: input.prompt,
        allowedLanguages: input.allowedLanguages,
        starterCodeJson: input.starterCode,
        timeLimitMs: input.timeLimitMs,
        memoryLimitMb: input.memoryLimitMb,
        testCasesJson: withStableIds(input.testCases),
      },
      select: PRACTICE_SELECT,
    });
  });

  return toPracticeActivityView(created);
}

export async function updatePracticeActivity(
  actor: AuthenticatedUser,
  practiceId: string,
  input: UpdatePracticeRequest,
): Promise<PracticeActivityView> {
  const scope = await scopeForPractice(practiceId);
  await assertCanWrite(actor, scope.moduleId);

  const current = await prisma.practiceActivity.findUniqueOrThrow({
    where: { id: practiceId },
    select: PRACTICE_SELECT,
  });
  const view = toPracticeActivityView(current);

  // Languages and starter code are checked against the activity as it will be
  // after the patch, not as it was: narrowing the language list and adding
  // starter code in one request has to agree with itself.
  const allowedLanguages = input.allowedLanguages ?? view.allowedLanguages;
  const starterCode = input.starterCode ?? view.starterCode;
  assertRunnableLanguages(allowedLanguages);
  assertStarterCodeMatchesLanguages(starterCode, allowedLanguages);

  // A script for a language the activity no longer offers would never run,
  // and would quietly stop checking anyone's code. Refuse the narrowing.
  const orphaned = await prisma.practiceTestScript.findMany({
    where: { practiceActivityId: practiceId, language: { notIn: allowedLanguages } },
    select: { language: true },
    distinct: ["language"],
  });
  if (orphaned.length > 0) {
    throw new AppError(
      "VALIDATION_FAILED",
      `Remove the ${orphaned.map((script) => script.language).join(", ")} test scripts before disallowing that language`,
    );
  }

  const updated = await prisma.practiceActivity.update({
    where: { id: practiceId },
    data: {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
      ...(input.allowedLanguages === undefined ? {} : { allowedLanguages }),
      ...(input.starterCode === undefined ? {} : { starterCodeJson: starterCode }),
      ...(input.timeLimitMs === undefined ? {} : { timeLimitMs: input.timeLimitMs }),
      ...(input.memoryLimitMb === undefined ? {} : { memoryLimitMb: input.memoryLimitMb }),
      ...(input.testCases === undefined ? {} : { testCasesJson: withStableIds(input.testCases) }),
    },
    select: PRACTICE_SELECT,
  });

  return toPracticeActivityView(updated);
}

export async function deletePracticeActivity(
  actor: AuthenticatedUser,
  practiceId: string,
): Promise<void> {
  const scope = await scopeForPractice(practiceId);
  await assertCanWrite(actor, scope.moduleId);

  await prisma.$transaction(async (tx) => {
    await tx.practiceActivity.delete({ where: { id: practiceId } });
    const remaining = await tx.practiceActivity.findMany({
      where: { materialId: scope.materialId },
      select: { id: true },
      orderBy: { orderIndex: "asc" },
    });
    await Promise.all(
      remaining.map((activity, index) =>
        tx.practiceActivity.update({ where: { id: activity.id }, data: { orderIndex: index } }),
      ),
    );
  });
}

/**
 * Turns practice cases into execution cases.
 *
 * Every one is marked public, which is a statement of fact rather than a
 * choice: practice has no hidden cases, so there is nothing here for the
 * producer's hidden-case check to catch. Weight is a constant because a Run
 * produces no score for the weights to feed.
 */
function toExecutionTestCases(cases: PracticeTestCase[]): ExecutionTestCase[] {
  return cases.map((testCase) => ({
    id: testCase.id,
    name: testCase.name,
    input: testCase.input,
    expectedOutput: testCase.expectedOutput,
    weight: 1,
    isPublic: true,
    comparison: testCase.comparison,
    // Practice cases have no per-case limits; the activity's own apply.
    timeLimitMs: null,
    memoryLimitMb: null,
  }));
}

/**
 * Executes a Practice Activity against its own cases.
 *
 * The source code comes from the request body and nowhere else — practice has
 * no draft and needs none. Results arrive over `submission:status` as the RUN
 * variant, addressed to the Coder who asked; this call returns only the job id
 * that correlates the two.
 */
export async function runPracticeActivity(
  actor: AuthenticatedUser,
  practiceId: string,
  input: RunPracticeRequest,
): Promise<RunPracticeResponse> {
  const scope = await scopeForPractice(practiceId);
  const { isOwner } = await assertCanRead(actor, scope.moduleId);
  if (!scope.isPublished && !isOwner) {
    throw new AppError("NOT_FOUND", "Practice activity not found");
  }

  const activity = toPracticeActivityView(
    await prisma.practiceActivity.findUniqueOrThrow({
      where: { id: practiceId },
      select: PRACTICE_SELECT,
    }),
  );

  if (!activity.allowedLanguages.includes(input.language)) {
    throw new AppError(
      "LANGUAGE_NOT_ALLOWED",
      "This practice activity does not allow that language",
    );
  }

  // Per Coder and per activity: one runaway exercise must not lock a Coder out
  // of every other one, and the limit is high enough that ordinary practice
  // never meets it.
  const limit = await consumeRateLimit(
    `practice-run:${actor.id}:${practiceId}`,
    RUN_RATE_LIMIT.max,
    RUN_RATE_LIMIT.windowSeconds,
  );
  if (!limit.allowed) {
    throw new AppError(
      "RATE_LIMITED",
      `Too many runs. Try again in ${limit.retryAfterSeconds} seconds`,
    );
  }

  const testCases = toExecutionTestCases(activity.testCases);
  // Every script for the language, in a stable order so repeated runs list
  // their tests the same way.
  const testScripts: ExecutionTestScript[] = (
    await prisma.practiceTestScript.findMany({
      where: { practiceActivityId: practiceId, language: input.language },
      select: { id: true, framework: true, path: true, content: true },
      orderBy: { path: "asc" },
    })
  ).map((script) => ({ ...script, weight: 1 }));

  const job: ExecutionJobInput = {
    jobId: randomUUID(),
    kind: "RUN",
    submissionId: null,
    language: input.language,
    sourceCode: input.sourceCode,
    limits: {
      ...DEFAULT_EXECUTION_LIMITS,
      runTimeoutMs: activity.timeLimitMs,
      memoryLimitMb: activity.memoryLimitMb,
      // The wall clock covers compilation plus every case in sequence, and each
      // script in its own container after them, so it has to grow with the
      // work or a legitimate run gets killed for taking exactly as long as it
      // was configured to take.
      wallTimeoutMs: Math.max(
        DEFAULT_EXECUTION_LIMITS.wallTimeoutMs,
        DEFAULT_EXECUTION_LIMITS.compileTimeoutMs +
          activity.timeLimitMs * testCases.length +
          DEFAULT_EXECUTION_LIMITS.wallTimeoutMs * testScripts.length,
      ),
    },
    testCases,
    testScripts,
  };

  return { jobId: await enqueueExecutionJob(job, { userId: actor.id }) };
}

// --- Test scripts -------------------------------------------------------------

const PRACTICE_TEST_SCRIPT_SELECT = {
  id: true,
  practiceActivityId: true,
  language: true,
  framework: true,
  path: true,
  content: true,
  ...VALIDATION_SELECT,
  updatedAt: true,
} satisfies Prisma.PracticeTestScriptSelect;

/**
 * Owner only, and never folded into the activity view: that view is what a
 * Coder reads, and a script is Architect-only data.
 */
export async function listPracticeTestScripts(
  actor: AuthenticatedUser,
  practiceId: string,
): Promise<PracticeTestScriptsView> {
  const scope = await scopeForPractice(practiceId);
  await assertCanWrite(actor, scope.moduleId);

  const activity = await prisma.practiceActivity.findUniqueOrThrow({
    where: { id: practiceId },
    select: {
      referenceSolutionsJson: true,
      testScripts: {
        select: PRACTICE_TEST_SCRIPT_SELECT,
        orderBy: [{ language: "asc" }, { path: "asc" }],
      },
    },
  });
  return {
    scripts: activity.testScripts.map(toPracticeTestScriptView),
    referenceSolutions: readReferenceSolutions(activity.referenceSolutionsJson, "PracticeActivity"),
  };
}

/** Adds one script file, or replaces the one the language has at that path. */
export async function uploadPracticeTestScript(
  actor: AuthenticatedUser,
  practiceId: string,
  input: UploadPracticeTestScriptRequest,
): Promise<PracticeTestScriptView> {
  const scope = await scopeForPractice(practiceId);
  await assertCanWrite(actor, scope.moduleId);

  const activity = await prisma.practiceActivity.findUniqueOrThrow({
    where: { id: practiceId },
    select: { allowedLanguages: true },
  });
  if (!activity.allowedLanguages.includes(input.language)) {
    throw new AppError(
      "LANGUAGE_NOT_ALLOWED",
      "A test script must target a language the practice activity allows",
    );
  }

  const key = { practiceActivityId: practiceId, language: input.language, path: input.path };
  const saved = await prisma.$transaction(async (tx) => {
    const existing = await tx.practiceTestScript.findUnique({
      where: { practiceActivityId_language_path: key },
      select: { framework: true, content: true },
    });
    if (existing === null) {
      const count = await tx.practiceTestScript.count({
        where: { practiceActivityId: practiceId, language: input.language },
      });
      if (count >= MAX_TEST_SCRIPTS_PER_LANGUAGE) {
        throw new AppError(
          "VALIDATION_FAILED",
          `A language holds at most ${MAX_TEST_SCRIPTS_PER_LANGUAGE} test scripts`,
        );
      }
    }
    // Only new content needs validating again.
    const unchanged =
      existing !== null &&
      existing.framework === input.framework &&
      existing.content === input.content;
    const data = {
      framework: input.framework,
      content: input.content,
      ...(unchanged ? {} : resetValidation()),
    };
    return tx.practiceTestScript.upsert({
      where: { practiceActivityId_language_path: key },
      create: { ...key, ...data },
      update: data,
      select: PRACTICE_TEST_SCRIPT_SELECT,
    });
  });
  return toPracticeTestScriptView(saved);
}

export async function deletePracticeTestScript(
  actor: AuthenticatedUser,
  testScriptId: string,
): Promise<void> {
  const scope = await scopeForPracticeTestScript(testScriptId);
  await assertCanWrite(actor, scope.moduleId);

  await prisma.practiceTestScript.delete({ where: { id: testScriptId } });
}

// --- Reference solutions and validation --------------------------------------

/**
 * Saves, or with an empty source removes, the reference solution for one
 * language, and puts that language's scripts back to unvalidated.
 */
export async function savePracticeReferenceSolution(
  actor: AuthenticatedUser,
  practiceId: string,
  input: SaveReferenceSolutionRequest,
): Promise<StarterCodeMap> {
  const scope = await scopeForPractice(practiceId);
  await assertCanWrite(actor, scope.moduleId);

  return prisma.$transaction(async (tx) => {
    const activity = await tx.practiceActivity.findUniqueOrThrow({
      where: { id: practiceId },
      select: { allowedLanguages: true, referenceSolutionsJson: true },
    });
    if (!activity.allowedLanguages.includes(input.language)) {
      throw new AppError(
        "LANGUAGE_NOT_ALLOWED",
        "A reference solution must be in a language the practice activity allows",
      );
    }

    const { [input.language]: _previous, ...others } = readReferenceSolutions(
      activity.referenceSolutionsJson,
      "PracticeActivity",
    );
    const next: StarterCodeMap =
      input.sourceCode.trim() === "" ? others : { ...others, [input.language]: input.sourceCode };

    await tx.practiceActivity.update({
      where: { id: practiceId },
      data: { referenceSolutionsJson: next },
    });
    await tx.practiceTestScript.updateMany({
      where: { practiceActivityId: practiceId, language: input.language },
      data: resetValidation(),
    });
    return next;
  });
}

/** Runs every script in one language against the reference solution for it. */
export async function validatePracticeTestScripts(
  actor: AuthenticatedUser,
  practiceId: string,
  input: ValidateTestScriptsRequest,
): Promise<ValidateTestScriptsResponse> {
  const scope = await scopeForPractice(practiceId);
  await assertCanWrite(actor, scope.moduleId);

  const activity = await prisma.practiceActivity.findUniqueOrThrow({
    where: { id: practiceId },
    select: {
      timeLimitMs: true,
      memoryLimitMb: true,
      referenceSolutionsJson: true,
      testScripts: {
        where: { language: input.language },
        orderBy: { path: "asc" },
        select: { id: true, framework: true, path: true, content: true },
      },
    },
  });

  const scripts = activity.testScripts.map((script) => ({ ...script, weight: 1 }));
  const solutions = readReferenceSolutions(activity.referenceSolutionsJson, "PracticeActivity");

  const jobId = await enqueueScriptValidation({
    target: "PRACTICE",
    actorId: actor.id,
    jobId: randomUUID(),
    language: input.language,
    referenceSolution: solutions[input.language],
    scripts,
    limits: validationLimits(activity.timeLimitMs, activity.memoryLimitMb, scripts.length),
  });
  return { jobId };
}
