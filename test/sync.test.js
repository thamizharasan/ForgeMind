import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSync } from "../src/core/engine/sync.js";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cci-test-"));
}

test("sync does not overwrite files", () => {
  const root = tempRoot();
  const file = path.join(root, "task.md");
  fs.writeFileSync(file, "custom task", "utf8");
  runSync(root);
  assert.equal(fs.readFileSync(file, "utf8"), "custom task");
});
