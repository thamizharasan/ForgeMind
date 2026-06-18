import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runContextDoctor, runDebug } from "../src/core/engine/doctor.js";
import { runIndex, runContextClean } from "../src/core/engine/index.js";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cci-test-"));
}

test("doctor fails when artifacts are missing", () => {
  const root = tempRoot();
  const result = runContextDoctor(root);
  assert.equal(result.ok, false);
});

test("doctor fails when a Phase 2 artifact is missing", () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, "app.js"), "export const app = 1;\n", "utf8");
  runIndex(root);
  fs.rmSync(path.join(root, ".forgemind", "context", "routes.md"));
  assert.equal(runContextDoctor(root).ok, false);
});

test("doctor passes after index", () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, "app.js"), "export const app = 1;\n", "utf8");
  runIndex(root);
  assert.equal(runContextDoctor(root).ok, true);
  runContextClean(root);
});

test("debug command runs successfully", () => {
  const root = tempRoot();
  const result = runDebug(root);
  assert.equal(result.action, "debug");
  assert.ok(Array.isArray(result.results));
});
