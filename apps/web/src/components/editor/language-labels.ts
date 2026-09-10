import type { Language } from "@ambatucode/shared";

/**
 * How each language is named in the UI and what Monaco calls it.
 *
 * Monaco happens to use the same ids today, so the map looks redundant — it is
 * not. The product vocabulary is fixed by the SRS while Monaco's grammar ids
 * belong to Monaco, and writing the identity out here means a future divergence
 * is one edit rather than a hunt through components.
 */
export const LANGUAGE_LABEL: Readonly<Record<Language, string>> = {
  python: "Python 3.12",
  javascript: "JavaScript (Node 22)",
  java: "Java 21",
  cpp: "C++20",
};

export const MONACO_LANGUAGE_ID: Readonly<Record<Language, string>> = {
  python: "python",
  javascript: "javascript",
  java: "java",
  cpp: "cpp",
};

/** Community convention, not a preference: two for JavaScript, four elsewhere. */
export const TAB_SIZE: Readonly<Record<Language, number>> = {
  python: 4,
  javascript: 2,
  java: 4,
  cpp: 4,
};
