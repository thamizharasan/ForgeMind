import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectManagedBlock } from "../src/core/utils/config.js";
import { runIndex } from "../src/core/engine/index.js";
import { runContextDoctor } from "../src/core/engine/doctor.js";
import { runDebug } from "../src/core/engine/doctor.js";
import { runQuery } from "../src/core/engine/query.js";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cci-test-"));
}

test("query fails clearly when index.json is missing", () => {
  assert.throws(() => runQuery(tempRoot(), "auth files"), /Context index not found/);
});

test("query generates relevant.md and ranks auth files above unrelated files", () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, "src", "auth"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "auth", "login.js"), "export function loginUser() {}\napp.post('/login', h)\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "auth", "session.js"), "export const sessionToken = 1;\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "colors.js"), "export const palette = [];\n", "utf8");
  runIndex(root);
  const result = runQuery(root, "what files handle authentication?", { top: 2 });
  assert.equal(result.matches.length, 2);
  assert.match(result.matches[0].path, /auth/);
  const relevant = fs.readFileSync(path.join(root, ".forgemind", "context", "relevant.md"), "utf8");
  assert.match(relevant, /# Relevant Context/);
  assert.doesNotMatch(relevant, /export function loginUser/);
});

test("--top limits result count", () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, "auth.js"), "export const auth = 1;\n", "utf8");
  fs.writeFileSync(path.join(root, "login.js"), "export const login = 1;\n", "utf8");
  runIndex(root);
  const result = runQuery(root, "auth login", { top: 1 });
  assert.equal(result.matches.length, 1);
});

test("AGENTS project block references relevant.md first", () => {
  assert.ok(projectManagedBlock.indexOf(".forgemind/context/relevant.md") < projectManagedBlock.indexOf(".forgemind/context/summary.md"));
});

test("context doctor does not fail when relevant.md is missing", () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, "app.js"), "export const app = 1;\n", "utf8");
  runIndex(root);
  assert.equal(runContextDoctor(root).ok, true);
});

test("debug reports relevant.md status", () => {
  const result = runDebug(tempRoot());
  assert.ok(result.results.some((item) => item.line.includes("relevant.md")));
});
