import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PROJECT_END, PROJECT_START } from "../src/core/utils/config.js";
import { runProjectUpgrade } from "../src/core/engine/upgrade.js";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cci-test-"));
}

test("upgrade preserves unmanaged content", () => {
  const root = tempRoot();
  const file = path.join(root, ".forgemind", "instructions.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `before\n${PROJECT_START}\nold\n${PROJECT_END}\nafter\n`, "utf8");
  runProjectUpgrade(root);
  const content = fs.readFileSync(file, "utf8");
  assert.match(content, /^before/);
  assert.match(content, /after\n$/);
  assert.match(content, /Precomputed Context Engine/);
});
