import type { Language, TestScriptFramework } from "@ambatucode/shared";

/**
 * What an Architect needs to know to write a script that runs.
 *
 * The worker places the submission under fixed names and reads results in a
 * fixed way. None of that is discoverable from inside the editor, and a script
 * written against the wrong name fails every Coder's submission, so the rules
 * are stated where the script is written.
 */

/** The file name a submission is written to, by language. */
const SUBMISSION_FILE: Readonly<Record<Language, string>> = {
  python: "main.py",
  javascript: "main.js",
  java: "the class named in the starter code",
  cpp: "main.cpp",
};

const CUSTOM_REPORT =
  'Write the results as JSON to the file named by the AMBATUCODE_REPORT environment variable: {"tests": [{"name": "…", "passed": true}]}.';

export type ScriptGuidance = {
  /** How the script reaches the Coder's code. */
  submission: string;
  /** How the worker learns the results. */
  results: string;
};

export function describeScriptContract(
  framework: TestScriptFramework,
  language: Language,
): ScriptGuidance {
  switch (framework) {
    case "PYTEST":
      return {
        submission:
          "The submission is main.py. Import it with `from main import …`, from any folder.",
        results: "pytest 9.1 runs the entrypoint file; its results are read directly.",
      };
    case "JEST":
      return {
        submission:
          'The submission is main.js. Require it relative to the script, e.g. `require("./main")`.',
        results: "Jest 30.5 runs the entrypoint file; its results are read directly.",
      };
    case "JUNIT":
      return {
        submission:
          "The submission's classes are compiled into the default package. Keep the test class there too — no package line — in a file named after the class, e.g. SolutionTest.java.",
        results:
          "JUnit Jupiter (JUnit 6.1) runs the entrypoint class; its results are read directly.",
      };
    case "CUSTOM":
      return { submission: customSubmission(language), results: CUSTOM_REPORT };
  }
}

function customSubmission(language: Language): string {
  switch (language) {
    case "python":
    case "javascript":
      return `The entrypoint runs with the language runtime and can load the submission, ${SUBMISSION_FILE[language]}.`;
    case "java":
      return "The entrypoint is compiled with the submission's classes and its main method is run. Its path names its class, so a file at the root stays in the default package.";
    case "cpp":
      return "The entrypoint is compiled on its own, since the submission has its own main. The submission's compiled program is at the path in AMBATUCODE_PROGRAM — run it and check what it prints.";
  }
}
