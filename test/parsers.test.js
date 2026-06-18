import test from "node:test";
import assert from "node:assert/strict";
import { parseJavaScript } from "../src/core/parsers/javascriptParser.js";
import { parsePython } from "../src/core/parsers/pythonParser.js";
import { parseMarkdown } from "../src/core/parsers/markdownParser.js";
import { parseJson } from "../src/core/parsers/jsonParser.js";

test("JS parser detects imports, exports, functions, classes, and Express routes", () => {
  const result = parseJavaScript("import x from 'x';\nconst y = require('y');\nexport function run() {}\nclass Service {}\napp.get('/api', h)\n", { relativePath: "src/app.js" });
  assert.deepEqual(result.imports, ["x", "y"]);
  assert.ok(result.exports.includes("run"));
  assert.ok(result.symbols.some((symbol) => symbol.name === "run"));
  assert.ok(result.symbols.some((symbol) => symbol.name === "Service"));
  assert.ok(result.routes.some((route) => route.path === "/api" && route.method === "GET"));
});

test("Python parser detects imports, def, class, FastAPI and Flask routes", () => {
  const result = parsePython("import os\nfrom fastapi import FastAPI\n@app.get('/items')\ndef list_items(): pass\n@app.route('/login')\nclass Auth: pass\n", { relativePath: "app.py" });
  assert.ok(result.imports.includes("os"));
  assert.ok(result.imports.includes("fastapi"));
  assert.ok(result.symbols.some((symbol) => symbol.name === "list_items"));
  assert.ok(result.symbols.some((symbol) => symbol.name === "Auth"));
  assert.ok(result.routes.some((route) => route.path === "/items"));
  assert.ok(result.routes.some((route) => route.path === "/login"));
});

test("Markdown parser detects headings", () => {
  const result = parseMarkdown("# Title\n\n## Details\n");
  assert.deepEqual(result.headings.map((heading) => heading.text), ["Title", "Details"]);
});

test("package.json parser extracts scripts and dependency names", () => {
  const result = parseJson(JSON.stringify({ name: "app", scripts: { test: "node --test" }, dependencies: { a: "1" }, devDependencies: { b: "1" } }), { fileName: "package.json", relativePath: "package.json" });
  assert.deepEqual(result.dependencies[0].scripts, ["test"]);
  assert.deepEqual(result.dependencies[0].dependencies, ["a"]);
  assert.deepEqual(result.dependencies[0].devDependencies, ["b"]);
});
