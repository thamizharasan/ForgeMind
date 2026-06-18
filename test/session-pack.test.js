import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectManagedBlock } from "../src/core/utils/config.js";
import { runContextIndex, runContextPack, runDebug, runDoctor, runMemoryCompress, runQuery } from "../src/core.js";
import { runMemoryAddDecision, runMemoryAddFailure } from "../src/core/engine/memory.js";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cci-test-"));
}

function writeProject(root) {
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
  fs.writeFileSync(path.join(root, "src", "auth.js"), "export function loginUser() {\n  console.log('full source dump marker');\n}\n", "utf8");
}

test("session event is appended after index and query commands", () => {
  const root = tempRoot();
  writeProject(root);
  runContextIndex(root);
  runQuery(root, "login auth");
  const sessions = fs.readFileSync(path.join(root, ".codex", "memory", "sessions.md"), "utf8");
  assert.match(sessions, /Command: index/);
  assert.match(sessions, /Command: query/);
});

test("session tracking failure does not fail main command", () => {
  const root = tempRoot();
  writeProject(root);
  fs.mkdirSync(path.join(root, ".codex", "memory", "sessions.md"), { recursive: true });
  const result = runContextIndex(root);
  assert.equal(result.ok, true);
  assert.match(result.warnings.join("\n"), /Session tracking failed/);
});

test("memory decision and failure aliases write memory files", () => {
  const root = tempRoot();
  runMemoryAddDecision(root, "Keep pack generation deterministic.", { reason: "stable AI handoff", files: "src/core.js" });
  runMemoryAddFailure(root, { failure: "Pack exceeded size", cause: "large summary", fix: "truncate low priority sections", files: "README.md" });
  assert.match(fs.readFileSync(path.join(root, ".codex", "memory", "decisions.md"), "utf8"), /stable AI handoff/);
  assert.match(fs.readFileSync(path.join(root, ".codex", "memory", "failures.md"), "utf8"), /truncate low priority/);
});

test("context pack is generated without source dumps", () => {
  const root = tempRoot();
  writeProject(root);
  runContextIndex(root);
  runQuery(root, "login auth");
  runMemoryAddDecision(root, "Do not include this source:\nexport function leaked() {}\napi_key=supersecret123");
  const result = runContextPack(root);
  const content = fs.readFileSync(result.file, "utf8");
  assert.match(content, /Generated context is advisory/);
  assert.doesNotMatch(content, /console\.log\('full source dump marker'\)/);
  assert.doesNotMatch(content, /export function leaked/);
  assert.doesNotMatch(content, /api_key=supersecret/);
});

test("context pack respects max size", () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, ".codex", "context"), { recursive: true });
  fs.writeFileSync(path.join(root, ".codex", "context", "summary.md"), `# Summary\n\n${"x".repeat(10000)}`, "utf8");
  const result = runContextPack(root, { maxSizeKb: 1 });
  assert.ok(fs.statSync(result.file).size <= 1024);
});

test("AGENTS project block references context-pack first", () => {
  assert.ok(projectManagedBlock.indexOf(".codex/context-pack.md") < projectManagedBlock.indexOf(".codex/context/relevant.md"));
});

test("compression command fails gracefully when Ollama unavailable", async () => {
  const root = tempRoot();
  runContextPack(root);
  await assert.rejects(
    () => runMemoryCompress(root, { baseUrl: "http://127.0.0.1:9" }),
    /Local Ollama compression failed/
  );
});

test("pack includes session_summary.md when present", () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, ".codex", "memory"), { recursive: true });
  fs.writeFileSync(path.join(root, ".codex", "memory", "session_summary.md"), "# Session Summary\n\nCompressed handoff.", "utf8");
  const result = runContextPack(root);
  assert.match(fs.readFileSync(result.file, "utf8"), /Compressed handoff/);
});

test("doctor and debug report memory session and pack status", () => {
  const root = tempRoot();
  const doctor = runDoctor(root).results.map((item) => item.line).join("\n");
  const debug = runDebug(root).results.map((item) => item.line).join("\n");
  assert.match(doctor, /session tracking/);
  assert.match(doctor, /context-pack\.md/);
  assert.match(debug, /session_summary\.md/);
  assert.match(debug, /Local LLM/);
});
