import "server-only";
import { randomUUID } from "node:crypto";
import {
  PRISMA_FOREIGN_KEY_VIOLATION,
  isPrismaErrorCode,
  prisma,
  toJsonInput,
  type Prisma,
} from "@ambatucode/db";
import {
  AppError,
  EXECUTABLE_LANGUAGES,
  MAX_TEST_CASES_PER_ASSESSMENT,
  MAX_TEST_SCRIPTS_PER_LANGUAGE,
  isExecutableLanguage,
  openAccessProblem,
  timingProblem,
  type AssessmentArchitectView,
  type AssessmentCoderView,
  type AssessmentDetailResponse,
  type AssessmentSummary,
  type AuthenticatedUser,
  type CoderSessionEntry,
  type CreateAssessmentRequest,
  type CreateTestCaseRequest,
  type Language,
  type SaveReferenceSolutionRequest,
  type StarterCodeMap,
  type TestCaseView,
  type TestScriptView,
  type UpdateAssessmentRequest,
  type UpdateTestCaseRequest,
  type UploadTestScriptRequest,
  type ValidateTestScriptsRequest,
  type ValidateTestScriptsResponse,
} from "@ambatucode/shared";
import {
  readReferenceSolutions,
  readScriptContent,
  toAssessmentArchitectView,
  toAssessmentSummary,
  toAssessmentWorkspaceView,
  toTestCaseView,
  toTestScriptView,
} from "../serializers/assessment";
import { scopeForAssessment, scopeForTestCase, scopeForTestScript } from "./assessment-scope";
import { ASSESSMENT_SELECT } from "./assessment-select";
import { moduleIdForSection } from "./content-scope";
import { assertCanRead, assertCanWrite } from "./modules";
import { sessionEligibility } from "./participation";
import { closeOpenAccessSessions, ensureOpenAccessSession } from "./sessions";
import {
  VALIDATION_SELECT,
  enqueueScriptValidation,
  resetValidation,
  validationLimits,
} from "./script-validation";

/**
 * Assessment definitions: the problem, its limits, its test cases, and its
 * custom test scripts.
 *
 * An Assessment is reusable across sessions, and its results live in
 * Submission rows that copy nothing from it but ids. Editing a definition
 * therefore never rewrites history — but editing one while a session is
 * running would change the rules under Coders mid-attempt, so that is refused.
 */


const TEST_CASE_SELECT = {
  id: true,
  assessmentId: true,
  name: true,
  orderIndex: true,
  kind: true,
  input: true,
  expectedOutput: true,
  weight: true,
  comparison: true,
  timeLimitMs: true,
  memoryLimitMb: true,
} satisfies Prisma.AssessmentTestCaseSelect;

const TEST_SCRIPT_SELECT = {
  id: true,
  assessmentId: true,
  language: true,
  framework: true,
  entrypoint: true,
  filesJson: true,
  weight: true,
  showTestNames: true,
  ...VALIDATION_SELECT,
  updatedAt: true,
} satisfies Prisma.AssessmentTestScriptSelect;

function assertRunnableLanguages(languages: Language[]): void {
  const unrunnable = languages.filter((language) => !isExecutableLanguage(language));
  if (unrunnable.length > 0) {
    throw new AppError(
      "LANGUAGE_NOT_ALLOWED",
      `No execution environment is available for ${unrunnable.join(", ")}. Available: ${EXECUTABLE_LANGUAGES.join(", ")}`,
    );
  }
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
      `Starter code was provided for a language this assessment does not allow: ${stray.join(", ")}`,
    );
  }
}

async function assertNoRunningSession(assessmentId: string): Promise<void> {
  // The implicit open-access session is excluded: it is running from the
  // moment open access is switched on and has no End button, so counting it
  // here would make an open assessment permanently uneditable. What actually
  // has to be protected is a Coder mid-attempt, which is the guard below.
  const running = await prisma.assessmentSession.count({
    where: { assessmentId, status: "RUNNING", isOpenAccess: false },
  });
  if (running > 0) {
    throw new AppError(
      "CONFLICT",
      "This assessment has a running session; end it before changing the assessment",
    );
  }
}

/**
 * The open-access counterpart of the guard above.
 *
 * An open-access Assessment can be sat at any moment, so "no running session"
 * is not the question — "is anyone answering it right now" is.
 */
async function assertNoOpenAccessAttemptInProgress(assessmentId: string): Promise<void> {
  const live = await prisma.assessmentAttempt.count({
    where: { status: "IN_PROGRESS", session: { assessmentId, isOpenAccess: true } },
  });
  if (live > 0) {
    throw new AppError(
      "CONFLICT",
      "A Coder is part-way through this open-access assessment; close open access first",
    );
  }
}

async function loadArchitectView(assessmentId: string): Promise<AssessmentArchitectView> {
  const row = await prisma.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    select: {
      ...ASSESSMENT_SELECT,
      referenceSolutionsJson: true,
      testCases: { select: TEST_CASE_SELECT, orderBy: { orderIndex: "asc" } },
      testScripts: {
        select: TEST_SCRIPT_SELECT,
        orderBy: [{ language: "asc" }, { entrypoint: "asc" }],
      },
      // At most one is running at a time; older closed ones are history.
      sessions: {
        where: { isOpenAccess: true, status: "RUNNING" },
        select: { id: true },
        take: 1,
      },
    },
  });
  return toAssessmentArchitectView(row);
}

// --- Assessment ---------------------------------------------------------------

export async function listSectionAssessments(
  actor: AuthenticatedUser,
  sectionId: string,
): Promise<AssessmentSummary[]> {
  const moduleId = await moduleIdForSection(sectionId);
  const { isOwner } = await assertCanRead(actor, moduleId);

  const rows = await prisma.assessment.findMany({
    where: { sectionId, ...(isOwner ? {} : { isPublished: true }) },
    select: {
      id: true,
      sectionId: true,
      title: true,
      orderIndex: true,
      isPublished: true,
      isOpenAccess: true,
      timeMode: true,
      durationMinutes: true,
      executionMode: true,
    },
    orderBy: { orderIndex: "asc" },
  });
  return rows.map(toAssessmentSummary);
}

export async function createAssessment(
  actor: AuthenticatedUser,
  sectionId: string,
  input: CreateAssessmentRequest,
): Promise<AssessmentArchitectView> {
  const moduleId = await moduleIdForSection(sectionId);
  await assertCanWrite(actor, moduleId);

  assertRunnableLanguages(input.allowedLanguages);
  assertStarterCodeMatchesLanguages(input.starterCode, input.allowedLanguages);

  const created = await prisma.$transaction(async (tx) => {
    const count = await tx.assessment.count({ where: { sectionId } });
    return tx.assessment.create({
      data: {
        sectionId,
        title: input.title,
        orderIndex: count,
        problemStatement: input.problemStatement,
        allowedLanguages: input.allowedLanguages,
        starterCodeJson: toJsonInput(input.starterCode),
        timeMode: input.timeMode,
        durationMinutes: input.durationMinutes,
        executionMode: input.executionMode,
        timeLimitMs: input.timeLimitMs,
        memoryLimitMb: input.memoryLimitMb,
        gradingStrategy: input.gradingStrategy,
        exitPolicy: input.exitPolicy,
        antiCheatConfigJson: toJsonInput(input.antiCheat),
        isPublished: input.isPublished,
        isOpenAccess: input.isOpenAccess,
      },
      select: { id: true },
    });
  });

  // The session an open-access Assessment is sat in exists from the moment the
  // switch is on, not from the moment the first Coder arrives — so a Coder's
  // read stays a read.
  if (input.isOpenAccess) await ensureOpenAccessSession(created.id);

  return loadArchitectView(created.id);
}

/**
 * The owning Architect gets the definition. Any other reader who may open the
 * Module gets the Coder view, and only once the Assessment is published — a
 * draft's existence is not something a Coder is entitled to infer.
 */
export async function getAssessment(
  actor: AuthenticatedUser,
  assessmentId: string,
): Promise<AssessmentDetailResponse> {
  const scope = await scopeForAssessment(assessmentId);
  const { isOwner } = await assertCanRead(actor, scope.moduleId);

  if (isOwner) {
    return { view: "ARCHITECT", assessment: await loadArchitectView(assessmentId) };
  }
  if (!scope.isPublished) {
    throw new AppError("NOT_FOUND", "Assessment not found");
  }
  // Normally a no-op: the session is created when open access is switched on.
  // It is here so an Assessment whose flag was set any other way still answers
  // with somewhere for the Coder to sit, rather than an empty Sessions list.
  if (scope.isOpenAccess) await ensureOpenAccessSession(assessmentId);
  return { view: "CODER", assessment: await loadCoderView(actor, assessmentId) };
}

async function loadCoderView(
  actor: AuthenticatedUser,
  assessmentId: string,
): Promise<AssessmentCoderView> {
  const row = await prisma.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    select: {
      ...ASSESSMENT_SELECT,
      // Hidden cases never leave the database for this view: filtered here in
      // the query, and filtered again by kind in the serializer, so neither
      // gate alone is what stands between a hidden case and a Coder.
      testCases: {
        select: { kind: true, name: true, input: true, expectedOutput: true },
        where: { kind: "PUBLIC" },
        orderBy: { orderIndex: "asc" },
      },
      sessions: {
        where: { status: { in: ["READY", "RUNNING", "ENDED"] } },
        // The open-access session first, whatever its age: it is the one a
        // Coder can always walk into, so it should not sit below a scheduled
        // session they are only waiting for.
        orderBy: [{ isOpenAccess: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          name: true,
          status: true,
          executionMode: true,
          durationMinutes: true,
          endsAt: true,
          access: true,
          isOpenAccess: true,
          attempts: {
            where: { userId: actor.id },
            orderBy: { attemptNumber: "desc" },
            take: 1,
            select: { id: true, attemptNumber: true, status: true },
          },
        },
      },
    },
  });

  const sessions: CoderSessionEntry[] = [];
  for (const session of row.sessions) {
    const attempt = session.attempts[0] ?? null;
    const eligibility = await sessionEligibility(
      session.id,
      actor.id,
      session.executionMode,
      session.access,
    );
    // A Coder sees a session they can take part in, or one they already did.
    if (!eligibility.eligible && attempt === null) continue;
    // A finished session nobody here took part in is noise, not history.
    if (session.status === "ENDED" && attempt === null) continue;

    sessions.push({
      id: session.id,
      name: session.name,
      status: session.status,
      executionMode: session.executionMode,
      durationMinutes: session.durationMinutes,
      endsAt: session.endsAt?.toISOString() ?? null,
      attempt,
      canStart:
        session.status === "RUNNING" &&
        eligibility.eligible &&
        (attempt === null || attempt.status === "IN_PROGRESS" || attempt.status === "NOT_STARTED"),
      isOpenAccess: session.isOpenAccess,
      openToModule: session.access === "MODULE",
    });
  }

  return {
    ...toAssessmentWorkspaceView(row),
    timeMode: row.timeMode,
    durationMinutes: row.durationMinutes,
    executionMode: row.executionMode,
    sessions,
  };
}

export async function updateAssessment(
  actor: AuthenticatedUser,
  assessmentId: string,
  input: UpdateAssessmentRequest,
): Promise<AssessmentArchitectView> {
  const scope = await scopeForAssessment(assessmentId);
  await assertCanWrite(actor, scope.moduleId);
  await assertNoRunningSession(assessmentId);

  // Closing open access is a lifecycle action, not a rule change: it is the
  // open-access equivalent of pressing End, and End is allowed to finish
  // attempts that are still open. Every other patch has to wait for them.
  const onlyClosingOpenAccess =
    input.isOpenAccess === false && Object.keys(input).length === 1;
  if (!onlyClosingOpenAccess) await assertNoOpenAccessAttemptInProgress(assessmentId);

  const current = await loadArchitectView(assessmentId);

  // Checked as the Assessment will be after the patch, so a request that
  // switches to TIMED and supplies the duration agrees with itself.
  const next = {
    timeMode: input.timeMode ?? current.timeMode,
    durationMinutes:
      input.durationMinutes !== undefined ? input.durationMinutes : current.durationMinutes,
    executionMode: input.executionMode !== undefined ? input.executionMode : current.executionMode,
  };
  const problem = timingProblem(next);
  if (problem) throw new AppError("VALIDATION_FAILED", problem);

  // Checked against the patched shape for the same reason: switching to Live
  // while open access is already on has to be caught here, not only when the
  // two arrive in one request.
  const openAccess = openAccessProblem({
    isOpenAccess: input.isOpenAccess ?? current.isOpenAccess,
    executionMode: next.executionMode,
  });
  if (openAccess) throw new AppError("VALIDATION_FAILED", openAccess);

  const allowedLanguages = input.allowedLanguages ?? current.allowedLanguages;
  const starterCode = input.starterCode ?? current.starterCode;
  assertRunnableLanguages(allowedLanguages);
  assertStarterCodeMatchesLanguages(starterCode, allowedLanguages);

  // A script for a language the assessment no longer allows would never run,
  // and would silently stop contributing to grades. Refuse the narrowing.
  const orphaned = current.testScripts.filter(
    (script) => !allowedLanguages.includes(script.language),
  );
  if (orphaned.length > 0) {
    const languages = [...new Set(orphaned.map((script) => script.language))];
    throw new AppError(
      "VALIDATION_FAILED",
      `Remove the ${languages.join(", ")} test scripts before disallowing that language`,
    );
  }

  await prisma.assessment.update({
    where: { id: assessmentId },
    data: {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.problemStatement === undefined ? {} : { problemStatement: input.problemStatement }),
      ...(input.allowedLanguages === undefined ? {} : { allowedLanguages }),
      ...(input.starterCode === undefined ? {} : { starterCodeJson: toJsonInput(starterCode) }),
      timeMode: next.timeMode,
      durationMinutes: next.durationMinutes,
      executionMode: next.executionMode,
      ...(input.timeLimitMs === undefined ? {} : { timeLimitMs: input.timeLimitMs }),
      ...(input.memoryLimitMb === undefined ? {} : { memoryLimitMb: input.memoryLimitMb }),
      ...(input.gradingStrategy === undefined ? {} : { gradingStrategy: input.gradingStrategy }),
      ...(input.exitPolicy === undefined ? {} : { exitPolicy: input.exitPolicy }),
      ...(input.antiCheat === undefined
        ? {}
        : { antiCheatConfigJson: toJsonInput(input.antiCheat) }),
      ...(input.isPublished === undefined ? {} : { isPublished: input.isPublished }),
      ...(input.isOpenAccess === undefined ? {} : { isOpenAccess: input.isOpenAccess }),
    },
  });

  // Switching open access on brings its session up; switching it off ends that
  // session the same way an Architect's End would, so any attempt still open in
  // it is auto-submitted and graded rather than stranded.
  if (input.isOpenAccess === true) await ensureOpenAccessSession(assessmentId);
  if (input.isOpenAccess === false) await closeOpenAccessSessions(assessmentId);

  return loadArchitectView(assessmentId);
}

export async function deleteAssessment(
  actor: AuthenticatedUser,
  assessmentId: string,
): Promise<void> {
  const scope = await scopeForAssessment(assessmentId);
  await assertCanWrite(actor, scope.moduleId);
  await assertNoRunningSession(assessmentId);
  await assertNoOpenAccessAttemptInProgress(assessmentId);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.assessment.delete({ where: { id: assessmentId } });
      const remaining = await tx.assessment.findMany({
        where: { sectionId: scope.sectionId },
        select: { id: true },
        orderBy: { orderIndex: "asc" },
      });
      await Promise.all(
        remaining.map((assessment, index) =>
          tx.assessment.update({ where: { id: assessment.id }, data: { orderIndex: index } }),
        ),
      );
    });
  } catch (error) {
    // Sessions and attempts cascade; Submissions do not. An Assessment that has
    // been answered keeps its history, so it cannot be deleted.
    if (isPrismaErrorCode(error, PRISMA_FOREIGN_KEY_VIOLATION)) {
      throw new AppError(
        "CONFLICT",
        "This assessment has graded history and cannot be deleted; unpublish it instead",
      );
    }
    throw error;
  }
}

// --- Test cases ---------------------------------------------------------------

export async function listTestCases(
  actor: AuthenticatedUser,
  assessmentId: string,
): Promise<TestCaseView[]> {
  const scope = await scopeForAssessment(assessmentId);
  await assertCanWrite(actor, scope.moduleId);

  const rows = await prisma.assessmentTestCase.findMany({
    where: { assessmentId },
    select: TEST_CASE_SELECT,
    orderBy: { orderIndex: "asc" },
  });
  return rows.map(toTestCaseView);
}

export async function createTestCase(
  actor: AuthenticatedUser,
  assessmentId: string,
  input: CreateTestCaseRequest,
): Promise<TestCaseView> {
  const scope = await scopeForAssessment(assessmentId);
  await assertCanWrite(actor, scope.moduleId);
  await assertNoRunningSession(assessmentId);

  const created = await prisma.$transaction(async (tx) => {
    const count = await tx.assessmentTestCase.count({ where: { assessmentId } });
    if (count >= MAX_TEST_CASES_PER_ASSESSMENT) {
      throw new AppError(
        "VALIDATION_FAILED",
        `An assessment holds at most ${MAX_TEST_CASES_PER_ASSESSMENT} test cases`,
      );
    }
    return tx.assessmentTestCase.create({
      data: { assessmentId, orderIndex: count, ...input },
      select: TEST_CASE_SELECT,
    });
  });
  return toTestCaseView(created);
}

export async function updateTestCase(
  actor: AuthenticatedUser,
  testCaseId: string,
  input: UpdateTestCaseRequest,
): Promise<TestCaseView> {
  const scope = await scopeForTestCase(testCaseId);
  await assertCanWrite(actor, scope.moduleId);
  await assertNoRunningSession(scope.assessmentId);

  const updated = await prisma.assessmentTestCase.update({
    where: { id: testCaseId },
    data: input,
    select: TEST_CASE_SELECT,
  });
  return toTestCaseView(updated);
}

/**
 * Graded results keep their row when a case is deleted — the link is set null
 * and the case name stays on the result — so history survives the edit.
 */
export async function deleteTestCase(actor: AuthenticatedUser, testCaseId: string): Promise<void> {
  const scope = await scopeForTestCase(testCaseId);
  await assertCanWrite(actor, scope.moduleId);
  await assertNoRunningSession(scope.assessmentId);

  await prisma.$transaction(async (tx) => {
    await tx.assessmentTestCase.delete({ where: { id: testCaseId } });
    const remaining = await tx.assessmentTestCase.findMany({
      where: { assessmentId: scope.assessmentId },
      select: { id: true },
      orderBy: { orderIndex: "asc" },
    });
    await Promise.all(
      remaining.map((testCase, index) =>
        tx.assessmentTestCase.update({ where: { id: testCase.id }, data: { orderIndex: index } }),
      ),
    );
  });
}

// --- Test scripts -------------------------------------------------------------

/**
 * Adds one script file. A language may hold several, and a submission job
 * carries all of them; uploading to a path the language already has replaces
 * that script, which is how an Architect edits one.
 */
export async function uploadTestScript(
  actor: AuthenticatedUser,
  assessmentId: string,
  input: UploadTestScriptRequest,
): Promise<TestScriptView> {
  const scope = await scopeForAssessment(assessmentId);
  await assertCanWrite(actor, scope.moduleId);
  await assertNoRunningSession(assessmentId);

  const assessment = await prisma.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    select: { allowedLanguages: true },
  });
  if (!assessment.allowedLanguages.includes(input.language)) {
    throw new AppError(
      "LANGUAGE_NOT_ALLOWED",
      "A test script must target a language the assessment allows",
    );
  }

  const key = { assessmentId, language: input.language, entrypoint: input.path };

  const saved = await prisma.$transaction(async (tx) => {
    const existing = await tx.assessmentTestScript.findUnique({
      where: { assessmentId_language_entrypoint: key },
      select: { framework: true, entrypoint: true, filesJson: true },
    });
    // Only new content needs validating again. A change of weight or of what
    // Coders are shown leaves the script exactly as it was validated.
    const unchanged =
      existing !== null &&
      existing.framework === input.framework &&
      readScriptContent(existing) === input.content;
    const data = {
      framework: input.framework,
      filesJson: toJsonInput([{ path: input.path, content: input.content }]),
      weight: input.weight,
      showTestNames: input.showTestNames,
      ...(unchanged ? {} : resetValidation()),
    };

    if (existing === null) {
      const count = await tx.assessmentTestScript.count({
        where: { assessmentId, language: input.language },
      });
      if (count >= MAX_TEST_SCRIPTS_PER_LANGUAGE) {
        throw new AppError(
          "VALIDATION_FAILED",
          `A language holds at most ${MAX_TEST_SCRIPTS_PER_LANGUAGE} test scripts`,
        );
      }
    }
    return tx.assessmentTestScript.upsert({
      where: { assessmentId_language_entrypoint: key },
      create: { ...key, ...data },
      update: data,
      select: TEST_SCRIPT_SELECT,
    });
  });
  return toTestScriptView(saved);
}

export async function deleteTestScript(
  actor: AuthenticatedUser,
  testScriptId: string,
): Promise<void> {
  const scope = await scopeForTestScript(testScriptId);
  await assertCanWrite(actor, scope.moduleId);
  await assertNoRunningSession(scope.assessmentId);

  await prisma.assessmentTestScript.delete({ where: { id: testScriptId } });
}

// --- Reference solutions and validation --------------------------------------

/**
 * Saves, or with an empty source removes, the reference solution for one
 * language. Every script in that language goes back to unvalidated: a pass
 * against the old solution says nothing about this one.
 *
 * Allowed while a session runs. A reference solution grades nobody.
 */
export async function saveReferenceSolution(
  actor: AuthenticatedUser,
  assessmentId: string,
  input: SaveReferenceSolutionRequest,
): Promise<StarterCodeMap> {
  const scope = await scopeForAssessment(assessmentId);
  await assertCanWrite(actor, scope.moduleId);

  return prisma.$transaction(async (tx) => {
    const assessment = await tx.assessment.findUniqueOrThrow({
      where: { id: assessmentId },
      select: { allowedLanguages: true, referenceSolutionsJson: true },
    });
    if (!assessment.allowedLanguages.includes(input.language)) {
      throw new AppError(
        "LANGUAGE_NOT_ALLOWED",
        "A reference solution must be in a language the assessment allows",
      );
    }

    const { [input.language]: _previous, ...others } = readReferenceSolutions(
      assessment.referenceSolutionsJson,
      "Assessment",
    );
    const next: StarterCodeMap =
      input.sourceCode.trim() === "" ? others : { ...others, [input.language]: input.sourceCode };

    await tx.assessment.update({
      where: { id: assessmentId },
      data: { referenceSolutionsJson: toJsonInput(next) },
    });
    await tx.assessmentTestScript.updateMany({
      where: { assessmentId, language: input.language },
      data: resetValidation(),
    });
    return next;
  });
}

/** Runs every script in one language against the reference solution for it. */
export async function validateTestScripts(
  actor: AuthenticatedUser,
  assessmentId: string,
  input: ValidateTestScriptsRequest,
): Promise<ValidateTestScriptsResponse> {
  const scope = await scopeForAssessment(assessmentId);
  await assertCanWrite(actor, scope.moduleId);

  const assessment = await prisma.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    select: {
      timeLimitMs: true,
      memoryLimitMb: true,
      referenceSolutionsJson: true,
      testScripts: {
        where: { language: input.language },
        orderBy: { entrypoint: "asc" },
        select: { id: true, framework: true, entrypoint: true, filesJson: true, weight: true },
      },
    },
  });

  const scripts = assessment.testScripts.map((script) => ({
    id: script.id,
    framework: script.framework,
    path: script.entrypoint,
    content: readScriptContent(script),
    weight: script.weight,
  }));
  const solutions = readReferenceSolutions(assessment.referenceSolutionsJson, "Assessment");

  const jobId = await enqueueScriptValidation({
    target: "ASSESSMENT",
    actorId: actor.id,
    jobId: randomUUID(),
    language: input.language,
    referenceSolution: solutions[input.language],
    scripts,
    limits: validationLimits(assessment.timeLimitMs, assessment.memoryLimitMb, scripts.length),
  });
  return { jobId };
}
