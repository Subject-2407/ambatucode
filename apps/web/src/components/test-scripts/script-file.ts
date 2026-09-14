import {
  FRAMEWORK_LANGUAGE,
  MAX_TEST_SCRIPT_BYTES,
  TEST_SCRIPT_EXTENSIONS,
  TEST_SCRIPT_FRAMEWORKS,
  TEST_SCRIPT_PATH_PATTERN,
  type Language,
  type TestScriptFramework,
} from "@ambatucode/shared";

/**
 * The small decisions the upload dialog makes for an Architect: which
 * frameworks a language can run, what to call a new file, and whether a file
 * picked from disk is usable as a script.
 */

/** A packaged framework runs in its one language; CUSTOM runs in every one. */
export function frameworksFor(language: Language): TestScriptFramework[] {
  return TEST_SCRIPT_FRAMEWORKS.filter((framework) => {
    const fixed = FRAMEWORK_LANGUAGE[framework];
    return fixed === null || fixed === language;
  });
}

/** The framework a new script starts with: the language's own, when it has one. */
export function defaultFramework(language: Language): TestScriptFramework {
  return frameworksFor(language).find((framework) => framework !== "CUSTOM") ?? "CUSTOM";
}

/**
 * A file name that follows the framework's own conventions. JUnit's matters
 * most: the worker selects the class the path names, so the file has to be
 * named after the class it declares.
 */
export function defaultScriptPath(framework: TestScriptFramework, language: Language): string {
  switch (framework) {
    case "JUNIT":
      return "SolutionTest.java";
    case "JEST":
      return "solution.test.js";
    case "PYTEST":
      return "test_solution.py";
    case "GOOGLETEST":
      return "solution_test.cpp";
    case "CUSTOM":
      return language === "java"
        ? "Check.java"
        : `check${TEST_SCRIPT_EXTENSIONS[language][0] ?? ""}`;
  }
}

export type PickedScriptFile = { path: string; content: string } | { error: string };

/**
 * Reads a file chosen from disk into a script draft.
 *
 * Only its base name is kept: a browser reports no directory for a picked
 * file, and a path is something the Architect can still edit afterwards. A
 * name the sandbox would refuse is reported here, before any upload.
 */
export async function readPickedScriptFile(
  file: { name: string; size: number; text: () => Promise<string> },
  language: Language,
): Promise<PickedScriptFile> {
  if (file.size > MAX_TEST_SCRIPT_BYTES) {
    return { error: `${file.name} is larger than ${MAX_TEST_SCRIPT_BYTES / 1024} KiB` };
  }
  if (!TEST_SCRIPT_PATH_PATTERN.test(file.name)) {
    return { error: `Rename ${file.name}: use letters, digits, dots, dashes and underscores only` };
  }
  const extensions = TEST_SCRIPT_EXTENSIONS[language];
  if (!extensions.some((extension) => file.name.endsWith(extension))) {
    return { error: `A ${language} script must end in ${extensions.join(", ")}` };
  }

  const content = await file.text();
  // A NUL byte means a binary file; saving one would only fail every run.
  if (content.includes("\u0000")) {
    return { error: `${file.name} is not a text file` };
  }
  return { path: file.name, content };
}
