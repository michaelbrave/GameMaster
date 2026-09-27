export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

/** Minimal structured JSON logger (one line per record, level-filtered). */
export function createLogger(
  level: LogLevel,
  base: Record<string, unknown> = {},
): Logger {
  const write = (
    lvl: LogLevel,
    msg: string,
    fields?: Record<string, unknown>,
  ) => {
    if (ORDER[lvl] < ORDER[level]) return;
    const record = {
      time: new Date().toISOString(),
      level: lvl,
      msg,
      ...base,
      ...(fields ?? {}),
    };
    const line = JSON.stringify(record);
    if (lvl === "error") process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (fields) => createLogger(level, { ...base, ...fields }),
  };
}
