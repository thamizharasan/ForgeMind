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
});

test("forgemind --help shows primary commands", () => {
  const output = nodeCli(["--help"]);
  assert.match(output, /forgemind init/);
  assert.match(output, /forgemind ask/);
  assert.doesNotMatch(output, /codex-context-init new/);
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
