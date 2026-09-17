import { describe, expect, it } from "vitest";
import { createLogger, errorFields, resolveLogLevel, type LogLevel } from "./logger";

function capture(level?: LogLevel) {
  const lines: Array<{ level: LogLevel; record: Record<string, unknown> }> = [];
  const logger = createLogger({
    service: "test",
    ...(level === undefined ? {} : { level }),
    sink: (emitted, line) => {
      lines.push({ level: emitted, record: JSON.parse(line) as Record<string, unknown> });
    },
  });
  return { logger, lines };
}

describe("createLogger", () => {
  it("emits one JSON object per call with the envelope fields", () => {
    const { logger, lines } = capture();
    logger.info("server.listening", { port: 3000 });

    expect(lines).toHaveLength(1);
    expect(lines[0]!.record).toMatchObject({
      level: "info",
      service: "test",
      event: "server.listening",
      port: 3000,
    });
    expect(typeof lines[0]!.record.ts).toBe("string");
  });

  it("drops anything below the configured level", () => {
    const { logger, lines } = capture("warn");
    logger.debug("a");
    logger.info("b");
    logger.warn("c");
    logger.error("d");
    expect(lines.map((line) => line.record.event)).toEqual(["c", "d"]);
  });

  it("sends warnings and errors to the error stream", () => {
    const { logger, lines } = capture("debug");
    logger.info("i");
    logger.warn("w");
    expect(lines.map((line) => line.level)).toEqual(["info", "warn"]);
  });

  it("carries a child's bound fields onto every line", () => {
    const { logger, lines } = capture();
    logger.child({ sessionId: "s1" }).info("attempt.joined", { attemptId: "a1" });
    expect(lines[0]!.record).toMatchObject({ sessionId: "s1", attemptId: "a1" });
  });

  it("refuses to let a field overwrite the envelope", () => {
    // A caller passing `level: "info"` on an error must not be able to
    // disguise it as one.
    const { logger, lines } = capture();
    logger.error("boom", { level: "info", service: "other", event: "nope" });
    expect(lines[0]!.record).toMatchObject({ level: "error", service: "test", event: "boom" });
  });

  it("survives a circular field rather than throwing inside the logger", () => {
    const { logger, lines } = capture();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => logger.error("cycle", { circular })).not.toThrow();
    expect(lines[0]!.record).toMatchObject({ event: "cycle", fieldsError: "not serializable" });
  });

  it("renders a Date and a bigint as text rather than losing them", () => {
    const { logger, lines } = capture();
    logger.info("stamped", { at: new Date("2026-09-14T00:00:00Z"), total: 12n });
    expect(lines[0]!.record).toMatchObject({ at: "2026-09-14T00:00:00.000Z", total: "12" });
  });
});

describe("errorFields", () => {
  it("flattens an Error into name, message, and stack", () => {
    const fields = errorFields(new TypeError("bad input"));
    expect(fields).toMatchObject({ errorName: "TypeError", errorMessage: "bad input" });
    expect(typeof fields.stack).toBe("string");
  });

  it("flattens a cause to its message instead of [object Object]", () => {
    const error = new Error("outer", { cause: new Error("inner") });
    expect(errorFields(error).cause).toBe("inner");
  });

  it("handles a thrown value that is not an Error at all", () => {
    expect(errorFields("just a string")).toEqual({ errorMessage: "just a string" });
    expect(errorFields(undefined)).toEqual({ errorMessage: "undefined" });
  });
});

describe("resolveLogLevel", () => {
  it("accepts a level in any casing", () => {
    expect(resolveLogLevel("WARN")).toBe("warn");
    expect(resolveLogLevel(" debug ")).toBe("debug");
  });

  it("falls back rather than failing on an unset or nonsense value", () => {
    expect(resolveLogLevel(undefined)).toBe("info");
    expect(resolveLogLevel("verbose")).toBe("info");
    expect(resolveLogLevel("verbose", "debug")).toBe("debug");
  });
});
