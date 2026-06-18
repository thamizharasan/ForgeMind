#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  getWatchDirs,
  isIgnoredWorkspacePath,
  runContextClean,
  runContextDoctor,
  runDebug,
  runContextIndex,
  runContextPack,
  runDoctor,
  runGraphBuild,
  runGraphClean,
  runGraphDoctor,
  runGraphImpact,
  runGraphQuery,
  runMemoryAddDecision,
  runMemoryAddFailure,
  runMemoryCompress,
  runMemoryCompressDoctor,
  runMemoryDoctor,
  runMemoryExport,
  runMemoryExportDoctor,
  runMemorySnapshot,
  runNew,
  runProjectDoctor,
  runProjectUpgrade,
  runQuery,
  runSync,
  trackCommandFailure,
  runUpgrade
} from "../src/core.js";
import { createLogger } from "../src/core/logger.js";

const rawArgs = process.argv.slice(2);
const verbose = rawArgs.includes("--verbose");
const args = rawArgs.filter((arg) => arg !== "--verbose");
const [command, subcommand, ...rest] = args;
const options = { force: rest.includes("--force") };
const logger = createLogger({ verbose });

if (!command || command === "--help" || command === "-h" || command === "help") usage(0);

function usage(code = 0) {
  logger.info(`Usage:
  forgemind init
  forgemind index [--watch]
  forgemind ask "<question>" [--top 10]
  forgemind pack
  forgemind memory <snapshot|decision|failure|compress|doctor>
  forgemind graph [build|doctor|clean|query|impact]
  forgemind export <codex|cursor|claude|copilot|all|doctor>
  forgemind doctor
  forgemind debug

Advanced:
  forgemind new <project-name> [--force]
  forgemind context <doctor|clean|pack>
  forgemind project <upgrade|doctor>
  forgemind sync
  forgemind upgrade`);
  process.exit(code);
}

function optionValue(name) {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
}

function messageArgs() {
  const values = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].startsWith("--")) {
      i += 1;
      continue;
    }
    values.push(rest[i]);
  }
  return values.join(" ").trim();
}

function printIndexResult(result) {
  logger.info(`Indexed ${result.filesIndexed} file(s)`);
  logger.info(`Wrote ${result.written} changed context artifact(s)`);
  logger.info(`Skipped ${result.skippedLarge} large file(s)`);
  logger.info(`Ignored ${result.ignored} file(s) or directories`);
}

function printDoctorSummary(result) {
  const issues = result.results.filter((item) => !item.found).length;
  logger.info(`${issues ? "Issues found" : "Healthy"} (${result.results.length - issues}/${result.results.length} checks passed)`);
}

function runWatch() {
  let timer;
  const root = process.cwd();
  const index = () => printIndexResult(runContextIndex());
  index();
  for (const dir of getWatchDirs()) {
    fs.watch(dir, (_event, filename) => {
      if (filename && isIgnoredWorkspacePath(root, path.join(dir, filename.toString()))) return;
      clearTimeout(timer);
      timer = setTimeout(index, 1000);
    });
  }
  logger.info("Watching for changes. Press Ctrl+C to stop.");
}

try {
  switch (command) {
    case "init": {
      const sync = runSync();
      logger.info(`Created ${sync.created} missing file(s)`);
      const upgrade = runProjectUpgrade();
      logger.info(`${upgrade.action === "created" ? "Created" : "Updated"} .forgemind/instructions.md`);
      const snapshot = runMemorySnapshot(process.cwd(), { validationStatus: "ForgeMind init in progress." });
      logger.info(`Updated ${path.relative(process.cwd(), snapshot.file)}`);
      const index = runContextIndex();
      printIndexResult(index);
      const graph = runGraphBuild();
      logger.info(`Built graph with ${graph.entityCount} entities and ${graph.relationshipCount} relationships`);
      const pack = runContextPack();
      logger.info(`Wrote ${path.relative(process.cwd(), pack.file)}`);
      printDoctorSummary(runDoctor());
      break;
    }
    case "new": {
      const result = runNew(subcommand, options);
      logger.info(`Created ${result.root}`);
      break;
    }
    case "project": {
      if (subcommand === "upgrade") {
        const result = runProjectUpgrade();
        logger.info(`${result.action === "created" ? "Created" : "Updated"} .forgemind/instructions.md`);
        break;
      }
      if (subcommand === "doctor") {
        const result = runProjectDoctor();
        for (const item of result.results) logger.info(item.line);
        process.exit(result.ok ? 0 : 1);
      }
      usage(1);
      break;
    }
    case "index": {
      if (subcommand === "--watch" || rest.includes("--watch")) {
        runWatch();
        break;
      }
      printIndexResult(runContextIndex());
      break;
    }
    case "context": {
      if (subcommand === "doctor") {
        const result = runContextDoctor();
        for (const item of result.results) logger.info(item.line);
        process.exit(result.ok ? 0 : 1);
      }
      if (subcommand === "clean") {
        const result = runContextClean();
        logger.info(`${result.removed ? "Removed" : "No context directory at"} .forgemind/context`);
        break;
      }
      if (subcommand === "pack") {
        const result = runContextPack(process.cwd(), { maxSizeKb: optionValue("--max-size-kb") });
        logger.info(`Wrote ${path.relative(process.cwd(), result.file)}`);
        break;
      }
      usage(1);
      break;
    }
    case "pack": {
      const result = runContextPack(process.cwd(), { maxSizeKb: optionValue("--max-size-kb") || (subcommand === "--max-size-kb" ? rest[0] : undefined) });
      logger.info(`Wrote ${path.relative(process.cwd(), result.file)}`);
      break;
    }
    case "ask":
    case "query": {
      const topIndex = rest.indexOf("--top");
      const top = topIndex >= 0 ? rest[topIndex + 1] : undefined;
      const question = command === "ask" ? [subcommand, ...rest.filter((arg) => arg !== "--top" && arg !== top)].filter(Boolean).join(" ") : subcommand;
      const result = runQuery(process.cwd(), question, { top });
      logger.info(`Wrote ${result.relevantPath}`);
      for (const match of result.matches) logger.info(`${match.score} ${match.path}`);
      break;
    }
    case "graph": {
      if (!subcommand || subcommand === "build") {
        const result = runGraphBuild();
        logger.info(`Built graph with ${result.entityCount} entities and ${result.relationshipCount} relationships`);
        break;
      }
      if (subcommand === "doctor") {
        const result = runGraphDoctor();
        for (const item of result.results) logger.info(item.line);
        process.exit(result.ok ? 0 : 1);
      }
      if (subcommand === "clean") {
        const result = runGraphClean();
        logger.info(`${result.removed ? "Removed" : "No graph directory at"} .forgemind/graph`);
        break;
      }
      if (subcommand === "query") {
        const question = rest.join(" ").trim();
        const result = runGraphQuery(process.cwd(), question);
        logger.info(`Wrote ${result.outputPath}`);
        for (const match of result.matches) logger.info(`${match.score} ${match.entity.type} ${match.entity.name}`);
        break;
      }
      if (subcommand === "impact") {
        const target = rest.join(" ").trim();
        const result = runGraphImpact(process.cwd(), target);
        logger.info(`Wrote ${result.outputPath}`);
        break;
      }
      usage(1);
      break;
    }
    case "memory": {
      if (subcommand === "export") {
        const target = rest[0];
        if (target === "doctor") {
          const result = runMemoryExportDoctor();
          for (const item of result.results) logger.info(item.line);
          process.exit(result.ok ? 0 : 1);
        }
        const result = runMemoryExport(process.cwd(), target || "all");
        const results = result.results || [result];
        for (const item of results) logger.info(`${item.changed ? "Updated" : "Unchanged"} ${item.outputPath}`);
        break;
      }
      if (subcommand === "snapshot") {
        const result = runMemorySnapshot();
        logger.info(`Updated ${path.relative(process.cwd(), result.file)}`);
        break;
      }
      if (subcommand === "decision" || subcommand === "add-decision") {
        const result = runMemoryAddDecision(process.cwd(), messageArgs(), {
          reason: optionValue("--reason"),
          files: optionValue("--files"),
          command: optionValue("--command"),
          query: optionValue("--query")
        });
        logger.info(`Updated ${path.relative(process.cwd(), result.file)}`);
        break;
      }
      if (subcommand === "failure" || subcommand === "add-failure") {
        const result = runMemoryAddFailure(process.cwd(), {
          failure: messageArgs(),
          cause: optionValue("--cause"),
          fix: optionValue("--fix"),
          files: optionValue("--files"),
          command: optionValue("--command"),
          query: optionValue("--query")
        });
        logger.info(`Updated ${path.relative(process.cwd(), result.file)}`);
        break;
      }
      if (subcommand === "compress") {
        if (rest[0] === "doctor") {
          const result = await runMemoryCompressDoctor(process.cwd(), {
            provider: optionValue("--provider"),
            model: optionValue("--model"),
            baseUrl: optionValue("--base-url")
          });
          for (const item of result.results) logger.info(item.line);
          process.exit(result.ok ? 0 : 1);
        }
        const result = await runMemoryCompress(process.cwd(), {
          provider: optionValue("--provider"),
          model: optionValue("--model"),
          baseUrl: optionValue("--base-url"),
          input: optionValue("--input"),
          output: optionValue("--output")
        });
        logger.info(`Wrote ${path.relative(process.cwd(), result.file)}`);
        break;
      }
      if (subcommand === "doctor") {
        const result = runMemoryDoctor();
        for (const item of result.results) logger.info(item.line);
        process.exit(result.ok ? 0 : 1);
      }
      usage(1);
      break;
    }
    case "export": {
      const target = subcommand || "all";
      if (target === "doctor") {
        const result = runMemoryExportDoctor();
        for (const item of result.results) logger.info(item.line);
        process.exit(result.ok ? 0 : 1);
      }
      const result = runMemoryExport(process.cwd(), target);
      const results = result.results || [result];
      for (const item of results) logger.info(`${item.changed ? "Updated" : "Unchanged"} ${item.outputPath}`);
      break;
    }
    case "sync": {
      const result = runSync();
      logger.info(`Created ${result.created} missing file(s)`);
      break;
    }
    case "doctor": {
      const result = runDoctor();
      for (const item of result.results) logger.info(item.line);
      process.exit(result.ok ? 0 : 1);
      break;
    }
    case "debug": {
      const result = runDebug();
      for (const item of result.results) logger.info(item.line);
      process.exit(result.ok ? 0 : 1);
      break;
    }
    case "upgrade": {
      const result = runUpgrade();
      logger.info(`${result.action === "created" ? "Created" : "Updated"} .forgemind/instructions.md`);
      break;
    }
    default:
      usage(command ? 1 : 0);
  }
} catch (error) {
  trackCommandFailure(process.cwd(), [command, subcommand].filter(Boolean).join(" ") || "unknown", error);
  logger.error(error);
  process.exit(1);
}
