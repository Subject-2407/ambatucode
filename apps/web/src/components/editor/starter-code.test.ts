import { describe, expect, it } from "vitest";
import { switchLanguage } from "./starter-code";

const starterCode = {
  python: "name = input()\n",
  javascript: "const name = readline();\n",
};

describe("switchLanguage", () => {
  it("swaps in the new starter code when the buffer was never touched", () => {
    const result = switchLanguage({
      current: starterCode.python,
      currentLanguage: "python",
      nextLanguage: "javascript",
      starterCode,
    });

    expect(result.source).toBe(starterCode.javascript);
    expect(result.discardsEdits).toBe(false);
  });

  it("flags a switch that would throw away the Coder's own work", () => {
    const result = switchLanguage({
      current: 'name = input()\nprint(f"Hello, {name}!")\n',
      currentLanguage: "python",
      nextLanguage: "javascript",
      starterCode,
    });

    expect(result.discardsEdits).toBe(true);
  });

  it("does not treat a trailing newline as an edit", () => {
    const result = switchLanguage({
      current: "name = input()",
      currentLanguage: "python",
      nextLanguage: "javascript",
      starterCode,
    });

    expect(result.discardsEdits).toBe(false);
  });

  it("gives an empty buffer for a language with no starter code", () => {
    const result = switchLanguage({
      current: starterCode.python,
      currentLanguage: "python",
      nextLanguage: "java",
      starterCode,
    });

    expect(result.source).toBe("");
  });

  it("treats anything typed into an empty starter as work worth keeping", () => {
    const result = switchLanguage({
      current: "int main() {}",
      currentLanguage: "cpp",
      nextLanguage: "python",
      starterCode,
    });

    expect(result.discardsEdits).toBe(true);
  });
});
