import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runIndex } from "../src/core/engine/index.js";
import { writeFileAtomic } from "../src/core/utils/fsSafe.js";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cci-test-"));
}

test("index skips .env files", () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, ".env"), "TOKEN=secret", "utf8");
  fs.writeFileSync(path.join(root, "app.js"), "export function app() {}\n", "utf8");
  runIndex(root);
  const index = JSON.parse(fs.readFileSync(path.join(root, ".forgemind", "context", "index.json"), "utf8"));
  assert.equal(index.files.some((file) => file.path === ".env"), false);
});

test("index skips ignored directories", () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "pkg.js"), "export const pkg = 1;\n", "utf8");
  fs.writeFileSync(path.join(root, "app.js"), "export const app = 1;\n", "utf8");
  runIndex(root);
  const index = JSON.parse(fs.readFileSync(path.join(root, ".forgemind", "context", "index.json"), "utf8"));
  assert.equal(index.files.some((file) => file.path.includes("node_modules")), false);
});

test("atomic writes create valid files", () => {
  const root = tempRoot();
  const file = path.join(root, "out", "index.json");
  writeFileAtomic(file, "{\"ok\":true}");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { ok: true });
});

test("index generates Phase 2 artifacts and deterministic importance scores", () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" }, dependencies: { express: "1" } }), "utf8");
  fs.writeFileSync(path.join(root, "server.js"), "import express from 'express';\nexport function start() {}\napp.get('/api', h)\n", "utf8");
  runIndex(root);
  for (const name of ["symbols.md", "dependencies.md", "routes.md", "recent_changes.md"]) {
    assert.equal(fs.existsSync(path.join(root, ".forgemind", "context", name)), true);
  }
  const first = JSON.parse(fs.readFileSync(path.join(root, ".forgemind", "context", "index.json"), "utf8"));
  runIndex(root);
  const second = JSON.parse(fs.readFileSync(path.join(root, ".forgemind", "context", "index.json"), "utf8"));
  const firstServer = first.files.find((file) => file.path === "server.js");
  const secondServer = second.files.find((file) => file.path === "server.js");
  assert.equal(typeof firstServer.importanceScore, "number");
  assert.deepEqual(firstServer.importanceReasons, secondServer.importanceReasons);
});
