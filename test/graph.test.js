import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectManagedBlock } from "../src/core/utils/config.js";
import { runIndex } from "../src/core/engine/index.js";
import { runMemoryAddDecision, runMemoryAddFailure } from "../src/core/engine/memory.js";
import { runGraphBuild, runGraphClean, runGraphDoctor, runGraphImpact, runGraphQuery } from "../src/core/engine/graph.js";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cci-test-"));
}

function graph(root) {
  return JSON.parse(fs.readFileSync(path.join(root, ".codex", "graph", "graph.json"), "utf8"));
}

function setupGraphProject() {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, "src", "auth"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { express: "1" } }), "utf8");
  fs.writeFileSync(path.join(root, "src", "auth", "login.js"), "import express from 'express';\nexport function loginUser() {}\napp.post('/login', h)\n", "utf8");
  runIndex(root);
  runMemoryAddDecision(root, "Use loginUser for auth flow in src/auth/login.js");
  runMemoryAddFailure(root, { failure: "Auth route failed", files: "src/auth/login.js" });
  return root;
}

test("graph build creates graph.json and graph.md", () => {
  const root = setupGraphProject();
  const result = runGraphBuild(root);
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(path.join(root, ".codex", "graph", "graph.json")));
  assert.ok(fs.existsSync(path.join(root, ".codex", "graph", "graph.md")));
});

test("graph.json has stable entity IDs and deduplicates entities", () => {
  const root = setupGraphProject();
  runGraphBuild(root);
  const first = graph(root);
  runGraphBuild(root);
  const second = graph(root);
  assert.deepEqual(first.entities.map((entity) => entity.id), second.entities.map((entity) => entity.id));
  assert.equal(new Set(first.entities.map((entity) => entity.id)).size, first.entities.length);
});

test("graph.json is stable across unchanged builds", () => {
  const root = setupGraphProject();
  runGraphBuild(root);
  const first = fs.readFileSync(path.join(root, ".codex", "graph", "graph.json"), "utf8");
  runGraphBuild(root);
  const second = fs.readFileSync(path.join(root, ".codex", "graph", "graph.json"), "utf8");
  assert.equal(first, second);
});

test("file entities are linked to symbols", () => {
  const root = setupGraphProject();
  runGraphBuild(root);
  const g = graph(root);
  assert.ok(g.relationships.some((rel) => rel.from === "file:src/auth/login.js" && rel.type === "DEFINES" && rel.to === "symbol:loginUser"));
});

test("routes are linked to source files", () => {
  const root = setupGraphProject();
  runGraphBuild(root);
  const g = graph(root);
  assert.ok(g.relationships.some((rel) => rel.from === "file:src/auth/login.js" && rel.type === "DECLARES_ROUTE" && rel.to.includes("/login")));
});

test("dependencies are represented", () => {
  const root = setupGraphProject();
  runGraphBuild(root);
  const g = graph(root);
  assert.ok(g.entities.some((entity) => entity.id === "dependency:express"));
  assert.ok(g.relationships.some((rel) => rel.type === "DEPENDS_ON" && rel.to === "dependency:express"));
});

test("memory decisions and failures are represented", () => {
  const root = setupGraphProject();
  runGraphBuild(root);
  const g = graph(root);
  assert.ok(g.entities.some((entity) => entity.type === "memory_decision"));
  assert.ok(g.entities.some((entity) => entity.type === "memory_failure"));
  assert.ok(g.relationships.some((rel) => rel.type === "DECISION_RELATES_TO"));
  assert.ok(g.relationships.some((rel) => rel.type === "FAILURE_RELATES_TO"));
});

test("graph impact creates impact.md", () => {
  const root = setupGraphProject();
  runGraphBuild(root);
  const result = runGraphImpact(root, "src/auth/login.js");
  assert.equal(result.ok, true);
  assert.match(fs.readFileSync(path.join(root, ".codex", "graph", "impact.md"), "utf8"), /loginUser/);
});

test("graph query handles what breaks if I change auth", () => {
  const root = setupGraphProject();
  runGraphBuild(root);
  const result = runGraphQuery(root, "what breaks if I change auth");
  assert.equal(result.intent, "impact");
  assert.ok(fs.existsSync(path.join(root, ".codex", "graph", "query.md")));
});

test("graph artifacts redact secrets and source-like memory lines", () => {
  const root = setupGraphProject();
  runMemoryAddDecision(root, "Do not store API_TOKEN=abc123456789 from .env.local\nexport function leaked() {}");
  runGraphBuild(root);
  runGraphQuery(root, "why API_TOKEN=abc123456789 .env.local");
  const json = fs.readFileSync(path.join(root, ".codex", "graph", "graph.json"), "utf8");
  const query = fs.readFileSync(path.join(root, ".codex", "graph", "query.md"), "utf8");
  assert.doesNotMatch(json, /API_TOKEN=abc|\.env|export function leaked/);
  assert.doesNotMatch(query, /API_TOKEN=abc|\.env/);
});

test("graph doctor fails when graph.json missing", () => {
  assert.equal(runGraphDoctor(tempRoot()).ok, false);
});

test("graph doctor passes after build", () => {
  const root = setupGraphProject();
  runGraphBuild(root);
  assert.equal(runGraphDoctor(root).ok, true);
});

test("graph clean deletes only .codex/graph", () => {
  const root = setupGraphProject();
  runGraphBuild(root);
  fs.mkdirSync(path.join(root, ".codex", "memory"), { recursive: true });
  fs.writeFileSync(path.join(root, ".codex", "memory", "sessions.md"), "# Sessions\n", "utf8");
  runGraphClean(root);
  assert.equal(fs.existsSync(path.join(root, ".codex", "graph")), false);
  assert.equal(fs.existsSync(path.join(root, ".codex", "context")), true);
  assert.equal(fs.existsSync(path.join(root, ".codex", "memory")), true);
  assert.equal(fs.existsSync(path.join(root, ".codex", "AGENTS.md")), true);
});

test("AGENTS.md references graph files", () => {
  assert.ok(projectManagedBlock.includes(".codex/graph/impact.md"));
  assert.ok(projectManagedBlock.includes(".codex/graph/graph.json"));
});

test("AGENTS.md references graph files in correct order", () => {
  const ordered = [
    ".codex/context/relevant.md",
    ".codex/graph/impact.md",
    ".codex/graph/query.md",
    ".codex/graph/graph.md",
    ".codex/memory/sessions.md",
    ".codex/memory/decisions.md",
    ".codex/memory/failures.md",
    ".codex/memory/fixes.md",
    ".codex/memory/rationale.md",
    ".codex/context/summary.md",
    ".codex/context/dependencies.md",
    ".codex/context/files.md",
    ".codex/context/symbols.md",
    ".codex/context/routes.md",
    ".codex/context/recent_changes.md",
    ".codex/context/index.json",
    ".codex/graph/graph.json"
  ];
  for (let i = 1; i < ordered.length; i += 1) {
    assert.ok(projectManagedBlock.indexOf(ordered[i - 1]) < projectManagedBlock.indexOf(ordered[i]));
  }
});
