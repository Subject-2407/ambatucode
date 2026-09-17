import { describe, expect, it } from "vitest";
import type { GradeRecordView } from "@ambatucode/shared";
import { csvField, csvRow, csvRowsFor, gradeExportFilename } from "./grades-export";

/**
 * The export is the one place grades leave the platform, and the values in it
 * are names people chose. These cover the two ways that goes wrong: a
 * delimiter inside a field, and a field a spreadsheet decides is a formula.
 */

function record(overrides: Partial<GradeRecordView> = {}): GradeRecordView {
  return {
    userId: "u1",
    username: "coder01",
    displayName: "Coder One",
    moduleId: "m1",
    moduleTitle: "Data Structures",
    sectionId: "s1",
    sectionTitle: "Trees",
    assessmentId: "a1",
    assessmentTitle: "Binary Search",
    sessionId: "ses1",
    sessionName: "Class A",
    officialScore: 90,
    officialAttemptId: "at2",
    attempts: [],
    ...overrides,
  };
}

function attempt(overrides: Partial<GradeRecordView["attempts"][number]> = {}) {
  return {
    id: "at1",
    attemptNumber: 1,
    status: "SUBMITTED" as const,
    isOfficial: false,
    startedAt: "2026-09-01T10:00:00.000Z",
    consumedMs: 600_000,
    resetAt: null,
    resetReason: null,
    resetByDisplayName: null,
    submission: {
      id: "sub1",
      status: "GRADED" as const,
      score: 70,
      language: "python" as const,
      isAutoSubmitted: false,
      submittedAt: "2026-09-01T10:10:00.000Z",
      gradedAt: "2026-09-01T10:10:05.000Z",
      executionTimeMs: 120,
      memoryUsedKb: 4_096,
    },
    ...overrides,
  };
}

describe("csvField", () => {
  it("quotes every field so a comma or a newline cannot split a row", () => {
    expect(csvField("Ali, Budi")).toBe('"Ali, Budi"');
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
    expect(csvField("plain")).toBe('"plain"');
  });

  it("doubles an embedded quote rather than ending the field", () => {
    expect(csvField('He said "hi"')).toBe('"He said ""hi"""');
  });

  it("defuses a value a spreadsheet would run as a formula", () => {
    // A display name is chosen by a person, and this file is opened by staff.
    expect(csvField("=1+1")).toBe('"\'=1+1"');
    expect(csvField("+cmd|calc")).toBe('"\'+cmd|calc"');
    expect(csvField("-2")).toBe('"\'-2"');
    expect(csvField("@SUM(A1)")).toBe('"\'@SUM(A1)"');
  });

  it("leaves a number alone — it is not a formula", () => {
    expect(csvField(95)).toBe('"95"');
    expect(csvField(true)).toBe('"true"');
    expect(csvField(null)).toBe('""');
  });
});

describe("csvRow", () => {
  it("ends every row with CRLF, which is what Excel expects", () => {
    expect(csvRow(["a", "b"])).toBe('"a","b"\r\n');
  });
});

describe("csvRowsFor", () => {
  it("writes one row per attempt so a reset keeps its history", () => {
    const rows = csvRowsFor(
      record({
        attempts: [
          attempt({
            id: "at1",
            attemptNumber: 1,
            status: "RESET",
            resetAt: "2026-09-01T11:00:00.000Z",
            resetReason: "Power cut in lab 3",
            resetByDisplayName: "Architect One",
          }),
          attempt({ id: "at2", attemptNumber: 2, isOfficial: true }),
        ],
      }),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('"RESET"');
    expect(rows[0]).toContain('"Power cut in lab 3"');
    expect(rows[0]).toContain('"false"');
    expect(rows[1]).toContain('"true"');
  });

  it("records a Coder with no attempt rather than dropping them from the file", () => {
    const rows = csvRowsFor(record({ attempts: [] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('"coder01"');
    expect(rows[0]).toContain('"NOT_STARTED"');
  });

  it("writes an empty score rather than a zero when nothing was submitted", () => {
    // A blank grade and a grade of zero are different facts about a Coder.
    const rows = csvRowsFor(record({ attempts: [attempt({ submission: null })] }));
    expect(rows[0]).not.toContain('"0"');
    expect(rows[0]!.endsWith('"","",""\r\n')).toBe(true);
  });
});

describe("gradeExportFilename", () => {
  it("names the file after the module and the day", () => {
    expect(gradeExportFilename("data-structures", new Date("2026-09-14T08:00:00Z"))).toBe(
      "grades-data-structures-2026-09-14.csv",
    );
  });

  it("strips anything that would break the Content-Disposition header", () => {
    const name = gradeExportFilename('bad"; name="x', new Date("2026-09-14T08:00:00Z"));
    expect(name).not.toContain('"');
    expect(name).not.toContain(";");
  });
});
