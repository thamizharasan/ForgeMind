import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectManagedBlock } from "../src/core/utils/config.js";
import {
  runMemoryAddDecision,
  runMemoryAddFailure,
  runMemoryDoctor,
  runMemorySnapshot
} from "../src/core/engine/memory.js";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cci-test-"));
}

test("memory snapshot creates sessions.md", () => {
  const root = tempRoot();
  const result = runMemorySnapshot(root);
  const file = path.join(root, ".codex", "memory", "sessions.md");
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(file));
  assert.match(fs.readFileSync(file, "utf8"), /Git Status/);
});

test("add-decision appends to decisions.md", () => {
  const root = tempRoot();
  runMemoryAddDecision(root, "Use deterministic repository memory.");
  const content = fs.readFileSync(path.join(root, ".codex", "memory", "decisions.md"), "utf8");
  assert.match(content, /Use deterministic repository memory/);
});

test("add-failure appends to failures.md", () => {
  const root = tempRoot();
  runMemoryAddFailure(root, { failure: "Index failed", cause: "bad JSON", fix: "skip invalid file", files: "package.json" });
  const content = fs.readFileSync(path.join(root, ".codex", "memory", "failures.md"), "utf8");
  assert.match(content, /Index failed/);
  assert.match(content, /bad JSON/);
  assert.match(content, /skip invalid file/);
  assert.match(content, /package\.json/);
});

test("memory entries redact secret files and token-like values", () => {
  const root = tempRoot();
  runMemoryAddFailure(root, {
    failure: "Failed with API_TOKEN=abc123456789",
    cause: ".env.local was loaded",
    fix: "remove ghp_abcdefghijklmnop",
    files: ".env.local"
  });
  const content = fs.readFileSync(path.join(root, ".codex", "memory", "failures.md"), "utf8");
  assert.doesNotMatch(content, /\.env/);
  assert.doesNotMatch(content, /API_TOKEN=abc/);
  assert.doesNotMatch(content, /ghp_/);
  assert.match(content, /\[redacted secret/);
});

test("memory snapshot redacts relevant.md summary", () => {
  const root = tempRoot();
  const contextDir = path.join(root, ".codex", "context");
  fs.mkdirSync(contextDir, { recursive: true });
  fs.writeFileSync(path.join(contextDir, "relevant.md"), "# Relevant Context\n\nQuery: API_TOKEN=abc123456789 .env.local\n", "utf8");
  runMemorySnapshot(root);
  const content = fs.readFileSync(path.join(root, ".codex", "memory", "sessions.md"), "utf8");
  assert.doesNotMatch(content, /API_TOKEN=abc/);
  assert.doesNotMatch(content, /\.env/);
  assert.match(content, /\[redacted secret/);
});

test("memory doctor fails when files are missing", () => {
  assert.equal(runMemoryDoctor(tempRoot()).ok, false);
});

test("memory doctor passes after memory setup", () => {
  const root = tempRoot();
  runMemorySnapshot(root);
  assert.equal(runMemoryDoctor(root).ok, true);
});

test("AGENTS project block references memory files", () => {
  assert.ok(projectManagedBlock.includes(".codex/memory/sessions.md"));
  assert.ok(projectManagedBlock.indexOf(".codex/context/relevant.md") < projectManagedBlock.indexOf(".codex/memory/sessions.md"));
  assert.ok(projectManagedBlock.indexOf(".codex/memory/rationale.md") < projectManagedBlock.indexOf(".codex/context/summary.md"));
});
