/**
 * Structured logging.
 *
 * One line of JSON per event, on stdout for info and stderr for warnings and
 * errors. A lab deployment has no log aggregator and an operator reading
 * `docker logs` needs to be able to grep it; a line with a level, a service, a
 * stable event name and a flat bag of fields is greppable by every one of
 * those, which a sentence interpolated into a template string is not.
 *
 * Deliberately tiny and dependency-free. It ships in a package that also
 * reaches the browser, so it uses nothing but `console` — which is also why
 * there is no file handle, no transport, and no buffering to flush on the way
 * down.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const SEVERITY: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogFields = Record<string, unknown>;

export type Logger = {
  debug: (event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields) => void;
  /** A logger with fields every line inherits — a request id, a session id. */
  child: (fields: LogFields) => Logger;
};

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

export function resolveLogLevel(raw: string | undefined, fallback: LogLevel = "info"): LogLevel {
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  return isLogLevel(normalized) ? normalized : fallback;
}

/**
 * Flattens an unknown thrown value into fields.
 *
 * The message is kept because these logs are read by whoever runs the
 * platform, not by a Coder — the "never leak internals" rule applies to
 * responses, and this is the other side of it: the response says nothing and
 * the log says everything.
 */
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
      // `cause` is unknown by type and usually another Error. Flattened to a
      // message rather than stringified, so a cause object does not arrive in
      // the log as "[object Object]".
      ...(error.cause === undefined
        ? {}
        : { cause: error.cause instanceof Error ? error.cause.message : JSON.stringify(error.cause) }),
    };
  }
  return { errorMessage: String(error) };
}

/** Values a JSON line cannot carry as-is. */
function serializable(value: unknown): unknown {
  if (value instanceof Error) return errorFields(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  return value;
}

export type LoggerOptions = {
  service: string;
  level?: LogLevel;
  /** Injected by tests; defaults to the real console. */
  sink?: (level: LogLevel, line: string) => void;
};

function defaultSink(level: LogLevel, line: string): void {
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export function createLogger(options: LoggerOptions): Logger {
  const minimum = SEVERITY[options.level ?? "info"];
  const sink = options.sink ?? defaultSink;

  function emit(level: LogLevel, bound: LogFields, event: string, fields?: LogFields): void {
    if (SEVERITY[level] < minimum) return;

    const envelope: LogFields = {
      ts: new Date().toISOString(),
      level,
      service: options.service,
      event,
    };

    const payload: LogFields = { ...envelope };
    for (const [key, value] of Object.entries({ ...bound, ...fields })) {
      // Never let a field overwrite the envelope; a caller passing `level`
      // should not be able to disguise an error as an info line.
      if (key in envelope) continue;
      payload[key] = serializable(value);
    }

    let line: string;
    try {
      line = JSON.stringify(payload);
    } catch {
      // A circular field must not take the log line with it — and the fallback
      // has to drop the fields entirely, because the offending value is one of
      // them and would fail exactly the same way a second time.
      line = JSON.stringify({ ...envelope, fieldsError: "not serializable" });
    }
    sink(level, line);
  }

  function build(bound: LogFields): Logger {
    return {
      debug: (event, fields) => emit("debug", bound, event, fields),
      info: (event, fields) => emit("info", bound, event, fields),
      warn: (event, fields) => emit("warn", bound, event, fields),
      error: (event, fields) => emit("error", bound, event, fields),
      child: (fields) => build({ ...bound, ...fields }),
    };
  }

  return build({});
}
