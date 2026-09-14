import { z } from "zod";
import {
  LANGUAGES,
  TEST_SCRIPT_FRAMEWORKS,
  type Language,
  type TestScriptFramework,
} from "../enums";
import { utf8ByteLength } from "./content";

/**
 * Custom test scripts: unit and structural tests an Architect writes for the
 * Coder's code, as opposed to stdin/stdout cases.
 *
 * A script is exactly one file. A language may hold several, and the worker
 * runs each in a container of its own. Every byte of one is Architect-only —
 * at most a Coder learns a test's name and whether it passed.
 */

export const MAX_TEST_SCRIPT_BYTES = 512 * 1024;

/**
 * Per language. Every script costs a container and a framework start-up, so
 * this is what bounds how long one Coder's job can run.
 */
export const MAX_TEST_SCRIPTS_PER_LANGUAGE = 10;

/**
 * A relative path of ordinary segments, and nothing else.
 *
 * Script files are written into the sandbox workspace, so a path names a place
 * on a filesystem. No leading slash, no drive letter, no backslash, and no
 * segment that starts with a dot — which rules out `.` and `..` along with
 * hidden files. The worker checks again before it writes; this is the first
 * gate, not the only one.
 */
export const TEST_SCRIPT_PATH_PATTERN =
  /^[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;

export const testScriptPathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(TEST_SCRIPT_PATH_PATTERN, "Paths must be relative and made of plain segments");

/** Which language each packaged framework runs in. CUSTOM runs in any. */
export const FRAMEWORK_LANGUAGE: Readonly<Record<TestScriptFramework, Language | null>> = {
  JUNIT: "java",
  JEST: "javascript",
  PYTEST: "python",
  CUSTOM: null,
};

/**
 * The extensions a script file may carry, by the language that runs it. The
 * worker compiles or runs the file as what its name says it is, so a mismatch
 * would fail every Coder's run rather than the upload.
 */
export const TEST_SCRIPT_EXTENSIONS: Readonly<Record<Language, readonly string[]>> = {
  python: [".py"],
  javascript: [".js"],
  java: [".java"],
  cpp: [".cpp", ".cc", ".cxx"],
};

/**
 * Where the worker puts the submission and its build output. A script at one
 * of these paths would overwrite what it is meant to grade. Java names its
 * source after the Coder's class, which is unknown here; the worker refuses
 * that collision itself.
 */
const SUBMISSION_PATHS: Readonly<Record<Language, readonly string[]>> = {
  python: ["main.py"],
  javascript: ["main.js"],
  java: [],
  cpp: ["main.cpp", "program"],
};

export const testScriptFileShape = {
  language: z.enum(LANGUAGES),
  framework: z.enum(TEST_SCRIPT_FRAMEWORKS),
  path: testScriptPathSchema,
  content: z.string(),
};

type TestScriptFile = {
  language: Language;
  framework: TestScriptFramework;
  path: string;
  content: string;
};

/** The rules every uploaded script file follows, wherever it is attached. */
export function checkTestScriptFile(value: TestScriptFile, context: z.RefinementCtx): void {
  const expected = FRAMEWORK_LANGUAGE[value.framework];
  if (expected !== null && expected !== value.language) {
    context.addIssue({
      code: "custom",
      message: `${value.framework} scripts run in ${expected}`,
      path: ["framework"],
    });
  }

  const extensions = TEST_SCRIPT_EXTENSIONS[value.language];
  if (!extensions.some((extension) => value.path.endsWith(extension))) {
    context.addIssue({
      code: "custom",
      message: `A ${value.language} script file must end in ${extensions.join(", ")}`,
      path: ["path"],
    });
  }

  if (SUBMISSION_PATHS[value.language].includes(value.path)) {
    context.addIssue({
      code: "custom",
      message: `${value.path} is where the Coder's submission goes; choose another file name`,
      path: ["path"],
    });
  }

  if (value.content.trim() === "") {
    context.addIssue({ code: "custom", message: "The script file is empty", path: ["content"] });
  }
  if (utf8ByteLength(value.content) > MAX_TEST_SCRIPT_BYTES) {
    context.addIssue({
      code: "custom",
      message: `A script file must be at most ${MAX_TEST_SCRIPT_BYTES / 1024} KiB`,
      path: ["content"],
    });
  }
}

export const uploadTestScriptRequestSchema = z
  .object({
    ...testScriptFileShape,
    weight: z.number().int().min(0).max(1_000).default(1),
  })
  .superRefine(checkTestScriptFile);
export type UploadTestScriptRequest = z.infer<typeof uploadTestScriptRequestSchema>;

export type TestScriptView = {
  id: string;
  assessmentId: string;
  language: Language;
  framework: TestScriptFramework;
  path: string;
  content: string;
  weight: number;
  updatedAt: string;
};

/** Practice produces no grade, so a practice script has no weight to set. */
export const uploadPracticeTestScriptRequestSchema = z
  .object(testScriptFileShape)
  .superRefine(checkTestScriptFile);
export type UploadPracticeTestScriptRequest = z.infer<typeof uploadPracticeTestScriptRequestSchema>;

/**
 * For the owning Architect only. The Coder-facing Practice Activity view never
 * carries scripts; a Run reports each test's name and verdict and nothing else.
 */
export type PracticeTestScriptView = {
  id: string;
  practiceId: string;
  language: Language;
  framework: TestScriptFramework;
  path: string;
  content: string;
  updatedAt: string;
};
