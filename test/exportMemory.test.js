import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMemoryExport, runMemoryExportDoctor } from "../src/core/engine/exportMemory.js";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cci-test-"));
}

function read(root, file) {
  return fs.readFileSync(path.join(root, ...file.split("/")), "utf8");
}

test("export codex preserves unmanaged AGENTS.md content", () => {
  const root = tempRoot();
  const file = path.join(root, ".codex", "AGENTS.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "before\n", "utf8");
  const result = runMemoryExport(root, "codex");
  const content = fs.readFileSync(file, "utf8");
  assert.equal(result.outputPath, ".codex/AGENTS.md");
  assert.match(content, /^before/);
  assert.match(content, /CODEX-TOKEN-SAVER:CODEX:START/);
});

test("export cursor creates .cursor/rules/forgemind.mdc", () => {
  const root = tempRoot();
  runMemoryExport(root, "cursor");
  const content = read(root, ".cursor/rules/forgemind.mdc");
  assert.match(content, /CODEX-TOKEN-SAVER:CURSOR:START/);
  assert.match(content, /\.codex\/memory\/sessions\.md/);
});

test("export claude preserves existing CLAUDE.md content", () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "manual notes\n", "utf8");
  runMemoryExport(root, "claude");
  const content = read(root, "CLAUDE.md");
  assert.match(content, /^manual notes/);
  assert.match(content, /CODEX-TOKEN-SAVER:CLAUDE:START/);
});

test("export copilot creates .github/copilot-instructions.md", () => {
  const root = tempRoot();
  runMemoryExport(root, "copilot");
  const content = read(root, ".github/copilot-instructions.md");
  assert.match(content, /CODEX-TOKEN-SAVER:COPILOT:START/);
  assert.match(content, /\.codex\/context\/index\.json/);
});

test("export all creates all supported agents", () => {
  const root = tempRoot();
  const result = runMemoryExport(root, "all");
  assert.equal(result.results.length, 4);
  assert.ok(fs.existsSync(path.join(root, ".codex", "AGENTS.md")));
  assert.ok(fs.existsSync(path.join(root, ".cursor", "rules", "forgemind.mdc")));
  assert.ok(fs.existsSync(path.join(root, "CLAUDE.md")));
  assert.ok(fs.existsSync(path.join(root, ".github", "copilot-instructions.md")));
});

test("export doctor passes for valid exports", () => {
  const root = tempRoot();
  runMemoryExport(root, "all");
  assert.equal(runMemoryExportDoctor(root).ok, true);
});

test("export doctor fails for malformed one-sided markers", () => {
  const root = tempRoot();
  const file = path.join(root, "CLAUDE.md");
  fs.writeFileSync(file, "<!-- CODEX-TOKEN-SAVER:CLAUDE:START -->\n", "utf8");
  assert.equal(runMemoryExportDoctor(root).ok, false);
});

test("export doctor ignores existing files without managed markers", () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "manual notes\n", "utf8");
  assert.equal(runMemoryExportDoctor(root).ok, true);
});

test("exports are deterministic when content is unchanged", () => {
  const root = tempRoot();
  assert.equal(runMemoryExport(root, "cursor").changed, true);
  assert.equal(runMemoryExport(root, "cursor").changed, false);
});

test("no source code is dumped into exported files", () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, "app.js"), "export function secretSource() {}\n", "utf8");
  runMemoryExport(root, "all");
  for (const file of [".codex/AGENTS.md", ".cursor/rules/forgemind.mdc", "CLAUDE.md", ".github/copilot-instructions.md"]) {
    assert.doesNotMatch(read(root, file), /secretSource|export function/);
  }
});
