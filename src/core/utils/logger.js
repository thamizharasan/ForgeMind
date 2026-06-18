import fs from "node:fs";
import path from "node:path";
import { storagePath } from "./config.js";
import { ensureDir } from "./fsSafe.js";

function format(level, message) {
  return `${new Date().toISOString()} [${level}] ${message}`;
}

export function createLogger(options = {}) {
  const verbose = Boolean(options.verbose);
  const sink = options.sink ?? console;
  const root = options.root ?? process.cwd();
  const logFile = options.logFile ?? storagePath(root, "logs", "latest.log");

  function write(level, message) {
    const line = format(level, message);
    try {
      ensureDir(path.dirname(logFile));
      fs.appendFileSync(logFile, `${line}\n`, "utf8");
    } catch {
      // Logging must never break the command being run.
    }
    return line;
  }

  return {
    verbose,
    logFile,
    info(message) {
      sink.log?.(message);
      write("INFO", message);
    },
    warn(message) {
      if (sink.warn) sink.warn(message);
      else sink.log?.(message);
      write("WARN", message);
    },
    error(error) {
      const message = error instanceof Error ? error.message : String(error);
      const output = verbose && error instanceof Error ? error.stack : message;
      sink.error?.(output);
      write("ERROR", message);
    },
    debug(message) {
      if (verbose) sink.log?.(message);
      write("DEBUG", message);
    }
  };
}
