import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(".");
const cli = path.join(root, "bin", "forgemind.js");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "forgemind-test-"));
}

function nodeCli(args, cwd = root) {
  return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

test("package bin points to forgemind and fgm", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.name, "forgemind");
  assert.equal(pkg.bin.forgemind, "bin/forgemind.js");
  assert.equal(pkg.bin.fgm, "bin/forgemind.js");
  assert.equal(pkg.bin["codex-context-init"], undefined);
});

test("forgemind --help shows primary commands", () => {
  const output = nodeCli(["--help"]);
  assert.match(output, /forgemind init/);
  assert.match(output, /forgemind ask/);
  assert.doesNotMatch(output, /codex-context-init|codex-token-saver|migration|migrate/);
});

test("forgemind init creates .forgemind and not .codex", () => {
  const workspace = tempRoot();
  fs.writeFileSync(path.join(workspace, "app.js"), "export const app = 1;\n", "utf8");
  nodeCli(["init"], workspace);
  assert.ok(fs.existsSync(path.join(workspace, ".forgemind")));
  assert.ok(fs.existsSync(path.join(workspace, ".forgemind", "instructions.md")));
  assert.ok(fs.existsSync(path.join(workspace, ".forgemind", "context")));
  assert.ok(fs.existsSync(path.join(workspace, ".forgemind", "memory")));
  assert.ok(fs.existsSync(path.join(workspace, ".forgemind", "graph")));
  assert.ok(fs.existsSync(path.join(workspace, ".forgemind", "logs")));
  assert.equal(fs.existsSync(path.join(workspace, ".codex")), false);
});

test("forgemind ask and pack run", () => {
  const workspace = tempRoot();
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "package.json"), "{\"scripts\":{\"test\":\"node --test\"}}", "utf8");
  fs.writeFileSync(path.join(workspace, "src", "auth.js"), "export function loginUser() { return true }\n", "utf8");
  nodeCli(["index"], workspace);
  const ask = nodeCli(["ask", "what handles auth"], workspace);
  const pack = nodeCli(["pack"], workspace);
  assert.match(ask, /src\/auth\.js|src\\auth\.js/);
  assert.match(pack, /context-pack\.md/);
});

test("docs do not expose old package names", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.doesNotMatch(readme, /codex-context-init|codex-token-saver|Codex Token Saver/);
});
