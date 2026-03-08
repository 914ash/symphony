import type { Logger } from "./types.js";

function format(message: string, fields?: Record<string, unknown>): string {
  if (!fields || Object.keys(fields).length === 0) {
    return message;
  }

  const kv = Object.entries(fields)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  return `${message} ${kv}`;
}

export function createLogger(level: "debug" | "info" | "warn" | "error" = "info"): Logger {
  const priorities = { debug: 10, info: 20, warn: 30, error: 40 };
  const min = priorities[level];

  const write = (name: keyof typeof priorities, message: string, fields?: Record<string, unknown>) => {
    if (priorities[name] < min) {
      return;
    }

    const line = `${new Date().toISOString()} level=${name} ${format(message, fields)}`;
    if (name === "error") {
      console.error(line);
      return;
    }
    if (name === "warn") {
      console.warn(line);
      return;
    }
    console.log(line);
  };

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields)
  };
}

