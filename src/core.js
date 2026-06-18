import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { ensureDir, fileExists, writeFileAtomic, writeFileForce, writeFileIfMissing } from "./core/utils/fsSafe.js";
import { createLogger } from "./core/utils/logger.js";
import {
  DEFAULT_MAX_FILE_SIZE_KB,
  DEFAULT_CONTEXT_PACK_MAX_SIZE_KB,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_SESSION_TRACKING_ENABLED,
  DEPENDENCY_FILES,
  GENERATOR_VERSION,
  GLOBAL_END,
  GLOBAL_START,
  HEAVY_DIRS,
  OLD_END,
  OLD_START,
  PROJECT_END,
  PROJECT_START,
  RELEVANT_EXTENSIONS,
  RELEVANT_FILE_NAMES,
  RELEVANT_CONTEXT_FILE,
  CONTEXT_PACK_FILE,
  SESSION_SUMMARY_FILE,
  SCHEMA_VERSION,
  SECRET_FILE_NAMES,
  SECRET_PREFIXES,
  SECRET_SUFFIXES,
  contextFiles,
  globalManagedBlock,
  MEMORY_FILES,
  memoryFiles,
  projectManagedBlock,
  requiredFiles,
  templates
} from "./core/utils/config.js";
import { parseFile } from "./core/parsers/index.js";
import { queryTerms, scoreFileForQuery } from "./core/scoring/queryScorer.js";
import { agentAdapters, getAgentAdapter } from "./core/agents/index.js";
import { buildGraphFromIndex } from "./core/graph/graphBuilder.js";
import { graphDir, graphPath, readGraph, writeGraphArtifacts } from "./core/graph/graphStore.js";
import { writeImpact } from "./core/graph/graphImpact.js";
import { queryGraph, writeQuery } from "./core/graph/graphQuery.js";

export {
  GLOBAL_END,
  GLOBAL_START,
  OLD_END,
  OLD_START,
  PROJECT_END,
  PROJECT_START,
  contextFiles,
  globalManagedBlock,
  memoryFiles,
  projectManagedBlock,
  requiredFiles
} from "./core/utils/config.js";
export { createLogger, ensureDir, fileExists, writeFileAtomic, writeFileForce, writeFileIfMissing };

export function getGlobalAgentsPath() {
  return path.join(os.homedir(), ".codex", "AGENTS.md");
}

function newlineOf(content) {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function finish(content, newline) {
  return content.replace(/[\r\n]*$/, "") + newline;
}

export function upsertManagedBlock(existingContent, startMarker, endMarker, newBlock) {
  const hasStart = existingContent.includes(startMarker);
  const hasEnd = existingContent.includes(endMarker);
  const newline = newlineOf(existingContent || newBlock);
  const block = newBlock.replace(/\n/g, newline);

  if (hasStart !== hasEnd) return { ok: false, error: "Managed block has only one marker." };

  if (hasStart) {
    const start = existingContent.indexOf(startMarker);
    const end = existingContent.indexOf(endMarker);
    if (end < start) return { ok: false, error: "Managed block markers are out of order." };
    const next = existingContent.slice(0, start) + block + existingContent.slice(end + endMarker.length);
    return { ok: true, content: finish(next, newline), action: "updated" };
  }

  const base = existingContent.trimEnd();
  const next = base ? `${base}${newline}${newline}${block}` : block;
  return { ok: true, content: finish(next, newline), action: existingContent ? "appended" : "created" };
}

function migrateOldProjectMarkers(content) {
  return content.replace(OLD_START, PROJECT_START).replace(OLD_END, PROJECT_END);
}

function filesFor(root) {
  return {
    [path.join(root, ".codex", "AGENTS.md")]: projectManagedBlock,
    [path.join(root, ".codex", "templates", "project_context.template.md")]: templates["project_context.md"],
    [path.join(root, ".codex", "templates", "architecture.template.md")]: templates["architecture.md"],
    [path.join(root, ".codex", "templates", "task.template.md")]: templates["task.md"],
    [path.join(root, ".codex", "templates", "decision_log.template.md")]: templates["decision_log.md"],
    [path.join(root, "project_context.md")]: templates["project_context.md"],
    [path.join(root, "architecture.md")]: templates["architecture.md"],
    [path.join(root, "task.md")]: templates["task.md"],
    [path.join(root, "decision_log.md")]: templates["decision_log.md"]
  };
}

export function runNew(projectName, options = {}) {
  const started = Date.now();
  if (!projectName) throw new Error("Project name is required");
  const root = path.resolve(projectName);
  ensureDir(root);
  let created = 0;
  let updated = 0;
  for (const [file, content] of Object.entries(filesFor(root))) {
    if (options.force) {
      writeFileForce(file, content);
      updated += 1;
    } else if (writeFileIfMissing(file, content)) {
      created += 1;
    }
  }
  return { ok: true, action: "new", root, created, updated, durationMs: Date.now() - started, warnings: [] };
}

export function runSync(root = process.cwd()) {
  const started = Date.now();
  let created = 0;
  for (const [file, content] of Object.entries(filesFor(root))) {
    if (writeFileIfMissing(file, content)) created += 1;
  }
  return withSessionTracking(root, "sync", { ok: true, action: "sync", root, created, durationMs: Date.now() - started, warnings: [] });
}

export function runProjectDoctor(root = process.cwd()) {
  const results = requiredFiles.map((file) => {
    const found = fileExists(path.join(root, file));
    return { file, found, line: `${found ? "OK" : "MISSING"} ${file} ${found ? "found" : "missing"}` };
  });
  return { ok: results.every((result) => result.found), results };
}

export function runDoctor(root = process.cwd()) {
  const project = runProjectDoctor(root);
  const optional = [
    { file: "sessionTracking", found: true, line: `OK session tracking ${DEFAULT_SESSION_TRACKING_ENABLED ? "enabled" : "disabled"}` },
    { file: path.join(".codex", "memory", "sessions.md"), found: true, line: `${fileExists(memoryPathFor(root, "sessions.md")) ? "OK" : "MISSING"} .codex/memory/sessions.md ${fileExists(memoryPathFor(root, "sessions.md")) ? "found" : "missing optional"}` },
    { file: path.join(".codex", "memory", "decisions.md"), found: true, line: `${fileExists(memoryPathFor(root, "decisions.md")) ? "OK" : "MISSING"} .codex/memory/decisions.md ${fileExists(memoryPathFor(root, "decisions.md")) ? "found" : "missing optional"}` },
    { file: path.join(".codex", "memory", "failures.md"), found: true, line: `${fileExists(memoryPathFor(root, "failures.md")) ? "OK" : "MISSING"} .codex/memory/failures.md ${fileExists(memoryPathFor(root, "failures.md")) ? "found" : "missing optional"}` },
    { file: path.join(".codex", CONTEXT_PACK_FILE), found: true, line: `${fileExists(contextPackPathFor(root)) ? "OK" : "MISSING"} .codex/context-pack.md ${fileExists(contextPackPathFor(root)) ? "found" : "missing optional"}` },
    { file: path.join(".codex", "memory", SESSION_SUMMARY_FILE), found: true, line: `${fileExists(memoryPathFor(root, SESSION_SUMMARY_FILE)) ? "OK" : "INFO"} .codex/memory/session_summary.md ${fileExists(memoryPathFor(root, SESSION_SUMMARY_FILE)) ? "found" : "missing optional"}` },
    { file: "llm", found: true, line: `INFO local LLM ${DEFAULT_LLM_PROVIDER} ${DEFAULT_LLM_MODEL} ${DEFAULT_LLM_BASE_URL}` }
  ];
  return { ...project, results: [...project.results, ...optional] };
}

export function runProjectUpgrade(root = process.cwd()) {
  const started = Date.now();
  const file = path.join(root, ".codex", "AGENTS.md");
  const existing = fileExists(file) ? migrateOldProjectMarkers(fs.readFileSync(file, "utf8")) : "";
  const result = upsertManagedBlock(existing, PROJECT_START, PROJECT_END, projectManagedBlock);
  if (!result.ok) throw new Error(result.error);
  writeFileForce(file, result.content);
  return { ok: true, command: "project-upgrade", action: result.action, file, durationMs: Date.now() - started, warnings: [] };
}

export function runUpgrade(root = process.cwd()) {
  return runProjectUpgrade(root);
}

export function runGlobalSetup() {
  const started = Date.now();
  const file = getGlobalAgentsPath();
  const existing = fileExists(file) ? fs.readFileSync(file, "utf8") : "";
  const result = upsertManagedBlock(existing, GLOBAL_START, GLOBAL_END, globalManagedBlock);
  if (!result.ok) throw new Error(result.error);
  writeFileForce(file, result.content);
  return { ok: true, command: "global", action: result.action, file, durationMs: Date.now() - started, warnings: [] };
}

export function runGlobalDoctor() {
  const file = getGlobalAgentsPath();
  const exists = fileExists(file);
  const content = exists ? fs.readFileSync(file, "utf8") : "";
  const hasBlock = content.includes(GLOBAL_START) && content.includes(GLOBAL_END);
  const results = [
    { found: exists, line: `${exists ? "OK" : "MISSING"} ~/.codex/AGENTS.md ${exists ? "found" : "missing"}` },
    { found: hasBlock, line: `${hasBlock ? "OK" : "MISSING"} global managed block ${hasBlock ? "found" : "missing"}` }
  ];
  return { ok: results.every((result) => result.found), results };
}

function isSecretFile(name) {
  return SECRET_FILE_NAMES.has(name)
    || SECRET_PREFIXES.some((prefix) => name.startsWith(prefix))
    || SECRET_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function toDisplayPath(file) {
  return file.split(path.sep).join("/");
}

function topLevelOf(file) {
  const [first] = file.split(path.sep);
  return first || ".";
}

function languageFor(file) {
  const ext = path.extname(file).toLowerCase();
  const name = path.basename(file).toLowerCase();
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return "JavaScript";
  if ([".ts", ".tsx"].includes(ext)) return "TypeScript";
  if (ext === ".py") return "Python";
  if (ext === ".rs") return "Rust";
  if (ext === ".go") return "Go";
  if (ext === ".java") return "Java";
  if (ext === ".cs") return "C#";
  if ([".cpp", ".cc", ".cxx", ".c", ".h", ".hpp"].includes(ext)) return "C/C++";
  if ([".json", ".jsonc"].includes(ext)) return "JSON";
  if ([".md", ".mdx"].includes(ext)) return "Markdown";
  if ([".yml", ".yaml"].includes(ext)) return "YAML";
  if ([".html", ".css", ".scss", ".sass"].includes(ext)) return ext.slice(1).toUpperCase();
  if (name === "dockerfile") return "Docker";
  return ext ? ext.slice(1) : "Other";
}

function isRelevantFile(file) {
  const ext = path.extname(file).toLowerCase();
  const name = path.basename(file).toLowerCase();
  return RELEVANT_EXTENSIONS.has(ext) || RELEVANT_FILE_NAMES.has(name);
}

export function isIgnoredPath(relativePath) {
  const parts = relativePath.split(/[\\/]+/);
  return parts.some((part) => HEAVY_DIRS.has(part) || isSecretFile(part)) || isIgnoredContextPath(parts);
}

function isIgnoredContextPath(relativeParts) {
  return relativeParts.length >= 2 && relativeParts[0] === ".codex" && relativeParts[1] === "context";
}

export function isLikelyBinary(buffer) {
  if (buffer.length === 0) return false;
    let control = 0;
  for (let i = 0; i < buffer.length; i += 1) {
      const value = buffer[i];
      if (value === 0) return true;
      if (value < 7 || (value > 14 && value < 32)) control += 1;
    }
  return control / buffer.length > 0.2;
}

function isBinaryFile(file) {
  const buffer = Buffer.alloc(8000);
  const fd = fs.openSync(file, "r");
  try {
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return isLikelyBinary(buffer.subarray(0, bytes));
  } finally {
    fs.closeSync(fd);
  }
}

function walk(root, dir, options, state, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (options.limit && files.length >= options.limit) return;
    const full = path.join(dir, entry.name);
    const relativeParts = path.relative(root, full).split(path.sep);
    if (entry.isDirectory()) {
      if (HEAVY_DIRS.has(entry.name) || isIgnoredContextPath(relativeParts)) {
        state.ignored += 1;
        continue;
      }
      walk(root, full, options, state, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isSecretFile(entry.name)) {
      state.ignored += 1;
      continue;
    }
    const stat = fs.statSync(full);
    if (stat.size > options.maxFileSizeBytes) {
      state.skippedLarge += 1;
      continue;
    }
    if (isBinaryFile(full)) {
      state.ignored += 1;
      continue;
    }
    files.push({ full, relative: path.relative(root, full), size: stat.size, mtimeMs: stat.mtimeMs, ext: path.extname(entry.name).toLowerCase() || "(none)" });
  }
}

export function getWatchDirs(root = process.cwd()) {
  const dirs = [];
  function visit(dir) {
    dirs.push(dir);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      const relativeParts = path.relative(root, full).split(path.sep);
      if (HEAVY_DIRS.has(entry.name) || isIgnoredContextPath(relativeParts)) continue;
      visit(full);
    }
  }
  visit(root);
  return dirs;
}

export function isIgnoredWorkspacePath(root, file) {
  const parts = path.relative(root, file).split(path.sep);
  return parts.some((part) => HEAVY_DIRS.has(part) || isSecretFile(part)) || isIgnoredContextPath(parts);
}

function scanProject(root, options = {}) {
  const state = { ignored: 0, skippedLarge: 0 };
  const files = [];
  const maxFileSizeKb = options.maxFileSizeKb ?? DEFAULT_MAX_FILE_SIZE_KB;
  walk(root, root, { maxFileSizeBytes: maxFileSizeKb * 1024, limit: options.limit }, state, files);
  return { root, files, ignored: state.ignored, skippedLarge: state.skippedLarge, maxFileSizeKb };
}

export function collectFiles(root = process.cwd(), options = {}) {
  return scanProject(root, options).files;
}

export function countEligibleFiles(root = process.cwd(), options = {}) {
  return scanProject(root, { ...options, limit: options.limit ?? 1000 }).files.length;
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function hashText(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function writeFileIfChanged(file, content) {
  if (fileExists(file) && hashText(fs.readFileSync(file)) === hashText(content)) return false;
  writeFileAtomic(file, content);
  return true;
}

function topLanguages(files) {
  const counts = new Map();
  for (const file of files) counts.set(file.language, (counts.get(file.language) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export function extractImports(content, ext) {
  const imports = [];
  const pattern = /^\s*import\s+.*?\s+from\s+["'`]([^"'`]+)|^\s*import\s+["'`]([^"'`]+)|require\(\s*["'`]([^"'`]+)["'`]\s*\)|^\s*from\s+([A-Za-z0-9_.$-]+)\s+import|^\s*import\s+([A-Za-z0-9_.$-]+)/;
  if (![".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".go", ".java"].includes(ext)) return imports;
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(pattern);
    const name = match?.[1] || match?.[2] || match?.[3] || match?.[4] || match?.[5];
    if (name) imports.push(name);
  }
  return [...new Set(imports)].slice(0, 50);
}

export function extractExports(content, ext) {
  const exports = [];
  if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) {
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*export\s+(?:default\s+)?(?:(?:async\s+)?(?:function|class|const|let|var|type|interface)\s+)?([A-Za-z_$][\w$]*)?/);
      if (match) exports.push(match[1] || "default");
    }
  }
  return [...new Set(exports)].slice(0, 50);
}

export function extractSymbols(content, ext) {
  const symbols = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let match;
    if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) {
      match = line.match(/^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Z][A-Za-z0-9_$]*|[A-Za-z_$][\w$]*)|^\s*(?:export\s+)?const\s+([A-Z][A-Za-z0-9_$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
    } else if (ext === ".py") {
      match = line.match(/^\s*(?:def|class)\s+([A-Za-z_]\w*)/);
    } else if (ext === ".go") {
      match = line.match(/^\s*(?:func|type)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)|^\s*type\s+([A-Za-z_]\w*)\s+struct/);
    } else if (ext === ".java") {
      match = line.match(/^\s*(?:public\s+)?(?:class|interface)\s+([A-Za-z_]\w*)|^\s*public\s+(?:static\s+)?[\w<>\[\]]+\s+([A-Za-z_]\w*)\s*\(/);
    } else if ([".md", ".mdx"].includes(ext)) {
      match = line.match(/^(#{1,6})\s+(.+)/);
      if (match) symbols.push({ name: match[2].trim(), line: i + 1 });
      continue;
    }
    const name = match?.[1] || match?.[2];
    if (name) symbols.push({ name, line: i + 1 });
  }
  return symbols.slice(0, 80);
}

export function extractRouteHints(content, ext, relativePath = "") {
  const routeHints = [];
  const lines = content.split(/\r?\n/);
  const routePattern = /<(?:Route|Link|NavLink)\b[^>]*(?:path|to)=["'`]([^"'`]+)|\bpath\s*:\s*["'`]([^"'`]+)|(?:app|router)\.(?:get|post|put|patch|delete|use)\s*\(\s*["'`]([^"'`]+)|@(?:app|router)\.(?:get|post|put|patch|delete|route)\s*\(\s*["'`]([^"'`]+)|@app\.route\s*\(\s*["'`]([^"'`]+)/;
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(routePattern);
    const route = match?.[1] || match?.[2] || match?.[3] || match?.[4] || match?.[5];
    if (route) routeHints.push({ route, line: i + 1 });
  }
  const parts = relativePath.split(path.sep);
  if ((parts[0] === "pages" || parts[0] === "app" || parts.includes("pages") || parts.includes("app")) && [".js", ".jsx", ".ts", ".tsx", ".mdx"].includes(ext)) {
    routeHints.push({ route: nextRouteFromPath(relativePath), line: 1 });
  }
  return routeHints.slice(0, 50);
}

export function extractFileMetadata(filePath, content) {
  const ext = path.extname(filePath).toLowerCase();
  const parsed = parseFile(content, { relativePath: filePath, ext, fileName: path.basename(filePath) });
  const testHints = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (/\b(describe|it|test)\s*\(|^\s*def\s+test_/.test(lines[i])) testHints.push({ line: i + 1 });
  }
  return {
    imports: parsed.imports.length ? parsed.imports : extractImports(content, ext),
    exports: parsed.exports.length ? parsed.exports : extractExports(content, ext),
    symbols: parsed.symbols.length ? parsed.symbols : extractSymbols(content, ext),
    headings: parsed.headings,
    dependencies: parsed.dependencies,
    routes: parsed.routes,
    routeHints: parsed.routes.length ? parsed.routes : extractRouteHints(content, ext, filePath),
    testHints: testHints.slice(0, 50)
  };
}

function nextRouteFromPath(file) {
  const parts = file.split(path.sep);
  const start = parts.indexOf("pages") >= 0 ? parts.indexOf("pages") : parts.indexOf("app");
  if (start < 0) return "";
  const routeParts = parts.slice(start + 1);
  const last = routeParts.pop() || "";
  const cleanLast = last.replace(/\.[^.]+$/, "");
  if (!["page", "route", "index"].includes(cleanLast)) routeParts.push(cleanLast);
  const route = routeParts.filter((part) => !part.startsWith("_") && !part.startsWith("(")).map((part) => part.replace(/\[(.+?)\]/g, ":$1")).join("/");
  return `/${route}`;
}

function enrichFiles(files) {
  return files.map((file) => {
    const content = readText(file.full);
    return { ...file, hash: hashText(content), language: languageFor(file.relative), ...extractFileMetadata(file.relative, content) };
  });
}

function recentChangedPaths(root) {
  try {
    const output = execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (!output) return new Set();
    return new Set(output.split(/\r?\n/).map((line) => line.slice(3).trim().replace(/^"|"$/g, "")).filter(Boolean));
  } catch {
    return new Set();
  }
}

function scoreFile(file, recentPaths) {
  let score = 0;
  const reasons = [];
  const display = toDisplayPath(file.relative);
  const base = path.basename(file.relative).toLowerCase();
  const add = (points, reason) => {
    score += points;
    reasons.push(reason);
  };
  if (/^(index|main|app|server)\.[^.]+$/i.test(base)) add(30, "entrypoint file");
  if (/^(package|tsconfig)\.json$/i.test(base) || /^(vite|next)\.config\./i.test(base)) add(25, "package/config file");
  if (/routes?|router|app\/api|(^|\/)pages(\/|$)/i.test(display)) add(20, "route file");
  if (file.exports.length) add(15, "has exports");
  if (file.symbols.length || file.headings.length) add(15, "has symbols");
  if (file.imports.length) add(10, "has imports");
  if (/(^|\/)(__tests__|tests?|spec)(\/|$)|(\.test|\.spec)\.[^.]+$/i.test(display)) add(10, "test file");
  if (recentPaths.has(display) || recentPaths.has(file.relative)) add(10, "recently changed");
  if (/(^|\/)(dist|build|out|coverage|generated)(\/|$)|(\.min\.)/i.test(display)) add(-20, "generated/build-like file");
  return { importanceScore: score, importanceReasons: reasons };
}

function groupedFilesMd(files) {
  const groups = new Map();
  for (const file of files.filter((item) => isRelevantFile(item.relative)).sort((a, b) => b.importanceScore - a.importanceScore || a.relative.localeCompare(b.relative))) {
    const top = topLevelOf(file.relative);
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top).push(file);
  }
  const rows = ["# Files", ""];
  for (const [top, group] of [...groups.entries()].sort()) {
    rows.push(`## ${toDisplayPath(top)}`, "");
    for (const file of group.slice(0, 40)) rows.push(`- ${toDisplayPath(file.relative)} (${file.language}, score ${file.importanceScore})`);
    rows.push("");
  }
  return rows.join("\n").trimEnd() + "\n";
}

function symbolsMd(files) {
  const rows = ["# Symbols", ""];
  for (const file of files.filter((item) => item.symbols.length || item.exports.length || item.headings.length).slice(0, 250)) {
    rows.push(`## ${toDisplayPath(file.relative)}`);
    for (const item of file.symbols.slice(0, 30)) rows.push(`- ${item.type || "symbol"} ${item.name}`);
    for (const item of file.headings.slice(0, 20)) rows.push(`- heading ${item.text}`);
    if (file.exports.length) rows.push(`- Exports: ${file.exports.join(", ")}`);
    rows.push("");
  }
  if (rows.length === 2) rows.push("None found.");
  return rows.join("\n").trimEnd() + "\n";
}

function routeHintsMd(files) {
  const api = [];
  const ui = [];
  for (const file of files) {
    for (const hint of file.routeHints) {
      const routePath = hint.path || hint.route;
      const row = `- ${hint.method ? `${hint.method} ` : ""}${routePath} - ${toDisplayPath(file.relative)}`;
      if (hint.kind === "ui" || !hint.method) ui.push(row);
      else api.push(row);
    }
  }
  return `# Routes\n\n## API Routes\n\n${api.length ? api.join("\n") : "None found."}\n\n## UI Routes\n\n${ui.length ? ui.join("\n") : "None found."}\n`;
}

function collectDependencies(root, files) {
  const rows = ["# Dependencies", ""];
  const names = new Set(files.map((file) => path.basename(file.relative).toLowerCase()));
  const parsedPackage = files.flatMap((file) => file.dependencies || []).find((item) => path.basename(item.file || "") === "package.json");
  const packageFile = path.join(root, "package.json");
  if (parsedPackage) {
    rows.push("## package.json", "");
    if (parsedPackage.packageName) rows.push(`- name: ${parsedPackage.packageName}`);
    if (parsedPackage.scripts.length) rows.push(`- scripts: ${parsedPackage.scripts.join(", ")}`);
    if (parsedPackage.dependencies.length) rows.push(`- dependencies: ${parsedPackage.dependencies.join(", ")}`);
    if (parsedPackage.devDependencies.length) rows.push(`- devDependencies: ${parsedPackage.devDependencies.join(", ")}`);
    rows.push("");
  } else if (names.has("package.json") && fileExists(packageFile)) {
    try {
      const pkg = JSON.parse(readText(packageFile));
      const scripts = Object.keys(pkg.scripts || {});
      const dependencies = Object.keys(pkg.dependencies || {});
      const devDependencies = Object.keys(pkg.devDependencies || {});
      rows.push("## package.json", "");
      if (scripts.length) rows.push(`- scripts: ${scripts.join(", ")}`);
      if (dependencies.length) rows.push(`- dependencies: ${dependencies.join(", ")}`);
      if (devDependencies.length) rows.push(`- devDependencies: ${devDependencies.join(", ")}`);
      rows.push("");
    } catch {
      rows.push("## package.json", "", "- Could not parse package.json", "");
    }
  }
  for (const depFile of DEPENDENCY_FILES.filter((file) => file !== "package.json")) {
    if (names.has(depFile.toLowerCase())) rows.push(`- ${depFile}`);
  }
  if (rows.length === 2) rows.push("None found.");
  return rows.join("\n").trimEnd() + "\n";
}

export function detectDependencies(root) {
  const found = [];
  for (const name of DEPENDENCY_FILES) {
    const file = path.join(root, name);
    if (!fileExists(file)) continue;
    if (name === "package.json") {
      try {
        const pkg = JSON.parse(readText(file));
        found.push({
          file: name,
          scripts: Object.keys(pkg.scripts || {}),
          dependencies: Object.keys(pkg.dependencies || {}),
          devDependencies: Object.keys(pkg.devDependencies || {})
        });
      } catch {
        found.push({ file: name, error: "Could not parse package.json" });
      }
    } else {
      found.push({ file: name });
    }
  }
  return found;
}

function entrypointCandidates(files) {
  const names = ["src/index.ts", "src/index.js", "src/main.ts", "src/main.js", "src/App.tsx", "src/App.jsx", "app/page.tsx", "pages/index.tsx", "index.js", "server.js", "main.py", "app.py"];
  const lookup = new Set(files.map((file) => toDisplayPath(file.relative)));
  return names.filter((name) => lookup.has(name));
}

function testCandidates(files) {
  return files.filter((file) => /(^|[\\/.])(__tests__|tests?|spec)[\\/.]|(\.test|\.spec)\.[^.]+$/.test(toDisplayPath(file.relative))).map((file) => toDisplayPath(file.relative)).slice(0, 30);
}

function likelyProjectType(files) {
  const names = new Set(files.map((file) => toDisplayPath(file.relative)));
  if (names.has("next.config.js") || names.has("next.config.mjs") || [...names].some((name) => name.startsWith("app/") || name.startsWith("pages/"))) return "Next.js or React web app";
  if (names.has("package.json")) return "Node.js project";
  if (names.has("pyproject.toml") || names.has("requirements.txt")) return "Python project";
  if (names.has("Cargo.toml")) return "Rust project";
  if (names.has("go.mod")) return "Go project";
  return "Unknown";
}

function importantDirs(files) {
  const counts = new Map();
  for (const file of files) {
    const top = topLevelOf(file.relative);
    counts.set(top, (counts.get(top) || 0) + 1);
  }
  return [...counts.entries()].filter(([dir]) => dir !== ".").sort((a, b) => b[1] - a[1]).slice(0, 12).map(([dir, count]) => `${toDisplayPath(dir)} (${count})`);
}

function buildRunScripts(root) {
  const packageFile = path.join(root, "package.json");
  if (fileExists(packageFile)) {
    try {
      const pkg = JSON.parse(readText(packageFile));
      return Object.keys(pkg.scripts || {}).filter((name) => /^(dev|start|build|test|lint|check)$/.test(name)).map((name) => `npm run ${name}`);
    } catch {
      return [];
    }
  }
  return [];
}

function mdList(title, rows, empty = "None found.") {
  return `# ${title}\n\n${rows.length ? rows.join("\n") : empty}\n`;
}

function gitStatus(root) {
  try {
    const output = execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return output || "No changes.";
  } catch {
    return "Git status unavailable.";
  }
}

function gitBranch(root) {
  try {
    const output = execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return output || "detached";
  } catch {
    return "Git branch unavailable.";
  }
}

function contextDirFor(root) {
  return path.join(root, ".codex", "context");
}

function indexPathFor(root) {
  return path.join(contextDirFor(root), "index.json");
}

function relevantPathFor(root) {
  return path.join(contextDirFor(root), RELEVANT_CONTEXT_FILE);
}

function memoryDirFor(root) {
  return path.join(root, ".codex", "memory");
}

function memoryPathFor(root, file) {
  return path.join(memoryDirFor(root), file);
}

function contextPackPathFor(root) {
  return path.join(root, ".codex", CONTEXT_PACK_FILE);
}

function agentOutputPath(root, adapter) {
  return path.join(root, ...adapter.outputPath.split("/"));
}

function memoryTitle(file) {
  return file.replace(/\.md$/, "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function defaultMemoryContent(file) {
  return `# ${memoryTitle(file)}\n\n`;
}

function ensureMemoryFiles(root) {
  ensureDir(memoryDirFor(root));
  let created = 0;
  for (const file of MEMORY_FILES) {
    const target = memoryPathFor(root, file);
    if (writeFileIfMissing(target, defaultMemoryContent(file))) created += 1;
  }
  return created;
}

function appendMemoryEntry(root, file, entry) {
  ensureMemoryFiles(root);
  const target = memoryPathFor(root, file);
  const existing = fileExists(target) ? readText(target).trimEnd() : defaultMemoryContent(file).trimEnd();
  writeFileAtomic(target, `${existing}\n\n${entry.trimEnd()}\n`);
  return target;
}

function relativeArtifact(root, file) {
  return toDisplayPath(path.relative(root, file));
}

function resultArtifacts(root, result) {
  const artifacts = [];
  if (result?.relevantPath) artifacts.push(result.relevantPath);
  if (result?.outputPath) artifacts.push(result.outputPath);
  if (result?.file) artifacts.push(relativeArtifact(root, result.file));
  if (result?.results) {
    for (const item of result.results) if (item.outputPath) artifacts.push(item.outputPath);
  }
  if (result?.action === "index") artifacts.push(...contextFiles.map(toDisplayPath));
  if (result?.action === "graph-build") artifacts.push(".codex/graph/graph.json", ".codex/graph/graph.md");
  return [...new Set(artifacts)].filter(Boolean);
}

export function trackSessionEvent(root = process.cwd(), event = {}, options = {}) {
  if (options.enabled === false || DEFAULT_SESSION_TRACKING_ENABLED === false) {
    return { ok: true, action: "session-track", skipped: true, warnings: [] };
  }
  try {
    const rows = [
      `## ${formatTimestamp()}`,
      "",
      `Command: ${redactMemoryText(event.command || "unknown")}`,
      `Status: ${event.status || "success"}`,
      `Git branch: ${gitBranch(root)}`,
      "",
      "Changed files:",
      recentChangedFiles(root),
      "",
      "Generated artifacts:",
      ...(event.artifacts?.length ? event.artifacts.map((file) => `- ${redactMemoryText(file)}`) : ["- none"]),
      "",
      "Warnings/errors:",
      ...(event.warnings?.length ? event.warnings.map((warning) => `- ${redactMemoryText(warning)}`) : ["- none"]),
      `DurationMs: ${Number.isFinite(event.durationMs) ? event.durationMs : "unavailable"}`,
      ""
    ];
    const file = appendMemoryEntry(root, "sessions.md", rows.join("\n"));
    return { ok: true, action: "session-track", file, warnings: [] };
  } catch (error) {
    return { ok: false, action: "session-track", warnings: [`Session tracking failed: ${error.message}`] };
  }
}

function withSessionTracking(root, command, result, options = {}) {
  const event = trackSessionEvent(root, {
    command,
    status: "success",
    artifacts: resultArtifacts(root, result),
    warnings: result?.warnings || [],
    durationMs: result?.durationMs
  }, options.sessionTracking || {});
  if (!event.ok) result.warnings = [...(result.warnings || []), ...event.warnings];
  return result;
}

export function trackCommandFailure(root = process.cwd(), command = "unknown", error) {
  return trackSessionEvent(root, {
    command,
    status: "failure",
    warnings: [error instanceof Error ? error.message : String(error)]
  });
}

function relevantSummary(root) {
  const file = relevantPathFor(root);
  if (!fileExists(file)) return "No relevant.md found.";
  const lines = readText(file).split(/\r?\n/).filter((line) => /^(#|Query:|Score:|- )/.test(line)).slice(0, 30);
  return lines.length ? redactMemoryText(lines.join("\n")) : "relevant.md found; no summary lines detected.";
}

function recentChangedFiles(root) {
  const status = gitStatus(root);
  if (status === "No changes." || status === "Git status unavailable.") return status;
  return status.split(/\r?\n/).map((line) => {
    const changed = gitStatusPath(line);
    return `- ${isIgnoredPath(changed) ? "[redacted ignored/secret file]" : redactMemoryText(changed)}`;
  }).join("\n");
}

function gitStatusPath(line) {
  return (line.slice(3).trim() || line.trim()).replace(/^"|"$/g, "");
}

function readOptionalText(file, maxChars = 8000) {
  if (!fileExists(file)) return "";
  return sanitizePackText(readText(file).slice(0, maxChars));
}

function tailMarkdown(file, maxLines = 40) {
  const text = readOptionalText(file, 20000);
  if (!text) return "";
  return text.split(/\r?\n/).slice(-maxLines).join("\n").trim();
}

function section(title, body) {
  const trimmed = (body || "").trim();
  return trimmed ? `## ${title}\n\n${trimmed}\n` : "";
}

function truncatePack(sections, maxBytes) {
  let current = [...sections];
  let content = current.filter(Boolean).join("\n").trimEnd() + "\n";
  while (Buffer.byteLength(content, "utf8") > maxBytes && current.length > 2) {
    current.splice(current.length - 2, 1);
    content = current.filter(Boolean).join("\n").trimEnd() + "\n";
  }
  if (Buffer.byteLength(content, "utf8") <= maxBytes) return content;
  return `${content.slice(0, Math.max(0, maxBytes - 120)).trimEnd()}\n\n[Truncated to configured context pack size.]\n`;
}

function localHttpJson(url, payload) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const body = JSON.stringify(payload);
    const request = client.request(parsed, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      timeout: 5000
    }, (response) => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { data += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Ollama returned HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error("Ollama returned invalid JSON"));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("Ollama request timed out")));
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function formatTimestamp() {
  return new Date().toISOString();
}

function redactMemoryText(value) {
  return String(value)
    .replace(/(^|[\\/\s"'`])(?:\.env(?:\.[^\s"'`]*)?|id_rsa|id_ed25519|[^\\/\s"'`]+\.(?:pem|key))(?=$|[\s"'`,.])/g, "$1[redacted secret file]")
    .replace(/\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)\s*=\s*[^\s]+/g, "[redacted secret]")
    .replace(/\b[A-Za-z0-9_]*(?:token|secret|password|api[_-]?key|private[_-]?key)\b\s*[:=]\s*["']?[^"'\s]+["']?/gi, "[redacted secret]")
    .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_=-]{12,}\b/g, "[redacted secret]");
}

function sanitizePackText(value) {
  return redactMemoryText(value)
    .split(/\r?\n/)
    .filter((line) => !/^\s*```/.test(line))
    .filter((line) => !/^\s*(?:export|import|const|let|var|function|class|def|console\.|return\s+[{[(])\b/.test(line))
    .join("\n");
}

export function runMemorySnapshot(root = process.cwd(), options = {}) {
  const started = Date.now();
  const created = ensureMemoryFiles(root);
  const contextDoctor = runContextDoctor(root);
  const entry = [
    `## ${formatTimestamp()}`,
    "",
    "### Git Status",
    "",
    gitStatus(root).split(/\r?\n/).map((line) => (isIgnoredPath(gitStatusPath(line)) ? "[redacted ignored/secret file]" : redactMemoryText(line))).join("\n"),
    "",
    "### Recent Changed Files",
    "",
    recentChangedFiles(root),
    "",
    "### Relevant Context",
    "",
    relevantSummary(root),
    "",
    "### Validation Status",
    "",
    options.validationStatus || `Context doctor: ${contextDoctor.ok ? "pass" : "issues found"}`,
    "",
    "### Next Step",
    "",
    "- TODO",
    ""
  ].join("\n");
  appendMemoryEntry(root, "sessions.md", entry);
  return withSessionTracking(root, "memory snapshot", { ok: true, action: "memory-snapshot", root, file: memoryPathFor(root, "sessions.md"), created, durationMs: Date.now() - started, warnings: [] }, options);
}

export function runMemoryAddDecision(root = process.cwd(), message, options = {}) {
  const started = Date.now();
  if (!message || !message.trim()) throw new Error("Decision message is required. Usage: forgemind memory add-decision \"Use SQLite for local cache\"");
  const rows = [`## ${formatTimestamp()}`, "", "Decision:", redactMemoryText(message.trim()), ""];
  if (options.reason) rows.push("Reason:", redactMemoryText(options.reason.trim()), "");
  if (options.files) rows.push("Affected Files:", redactMemoryText(options.files.trim()), "");
  if (options.command || options.query) rows.push("Related:", redactMemoryText((options.command || options.query).trim()), "");
  const file = appendMemoryEntry(root, "decisions.md", rows.join("\n"));
  return withSessionTracking(root, "memory add-decision", { ok: true, action: "memory-add-decision", root, file, durationMs: Date.now() - started, warnings: [] }, options);
}

export function runMemoryAddFailure(root = process.cwd(), options = {}) {
  const started = Date.now();
  const failure = options.failure || options.message;
  if (!failure || !failure.trim()) throw new Error("Failure message is required. Usage: forgemind memory add-failure \"Tests failed\" --cause \"missing fixture\" --fix \"add fixture\" --files \"test/app.test.js\"");
  const rows = [`## ${formatTimestamp()}`, "", "Failure:", redactMemoryText(failure.trim()), ""];
  if (options.cause) rows.push("Cause:", redactMemoryText(options.cause.trim()), "");
  if (options.fix) rows.push("Fix:", redactMemoryText(options.fix.trim()), "");
  if (options.files) rows.push("Affected Files:", redactMemoryText(options.files.trim()), "");
  if (options.command || options.query) rows.push("Related:", redactMemoryText((options.command || options.query).trim()), "");
  const file = appendMemoryEntry(root, "failures.md", rows.join("\n"));
  return withSessionTracking(root, "memory add-failure", { ok: true, action: "memory-add-failure", root, file, durationMs: Date.now() - started, warnings: [] }, options);
}

export function runMemoryDoctor(root = process.cwd()) {
  const dir = memoryDirFor(root);
  const dirFound = fileExists(dir) && fs.statSync(dir).isDirectory();
  const results = [
    { file: path.join(".codex", "memory"), found: dirFound, line: `${dirFound ? "OK" : "MISSING"} .codex/memory ${dirFound ? "found" : "missing"}` }
  ];
  for (const file of memoryFiles) {
    const target = path.join(root, file);
    let found = false;
    try {
      found = fileExists(target) && fs.statSync(target).isFile();
      if (found) readText(target);
    } catch {
      found = false;
    }
    results.push({ file, found, line: `${found ? "OK" : "MISSING"} ${file} ${found ? "readable" : "missing or unreadable"}` });
  }
  return { ok: results.every((result) => result.found), action: "memory-doctor", results };
}

export function runContextPack(root = process.cwd(), options = {}) {
  const started = Date.now();
  const maxSizeKb = Number.parseInt(options.maxSizeKb ?? DEFAULT_CONTEXT_PACK_MAX_SIZE_KB, 10) || DEFAULT_CONTEXT_PACK_MAX_SIZE_KB;
  const contextDir = contextDirFor(root);
  const graphRoot = graphDir(root);
  const memoryRoot = memoryDirFor(root);
  const sections = [
    "# ForgeMind Pack\n\nGenerated context is advisory. Source code remains the source of truth.\n",
    section("Compressed Session Summary", readOptionalText(path.join(memoryRoot, SESSION_SUMMARY_FILE), 6000)),
    section("Project Summary", readOptionalText(path.join(contextDir, "summary.md"), 6000)),
    section("Task Relevant Context", readOptionalText(path.join(contextDir, RELEVANT_CONTEXT_FILE), 6000)),
    section("Graph Impact", readOptionalText(path.join(graphRoot, "impact.md"), 4000)),
    section("Graph Query", readOptionalText(path.join(graphRoot, "query.md"), 4000)),
    section("Latest Session", tailMarkdown(path.join(memoryRoot, "sessions.md"), 45)),
    section("Recent Decisions", tailMarkdown(path.join(memoryRoot, "decisions.md"), 45)),
    section("Recent Failures", tailMarkdown(path.join(memoryRoot, "failures.md"), 45)),
    section("Recent Fixes", tailMarkdown(path.join(memoryRoot, "fixes.md"), 30)),
    section("Important Files", readOptionalText(path.join(contextDir, "files.md"), 5000)),
    section("Routes", readOptionalText(path.join(contextDir, "routes.md"), 4000)),
    section("Dependencies", readOptionalText(path.join(contextDir, "dependencies.md"), 5000))
  ];
  const output = truncatePack(sections, maxSizeKb * 1024);
  const file = contextPackPathFor(root);
  writeFileAtomic(file, output);
  return withSessionTracking(root, "pack", {
    ok: true,
    action: "context-pack",
    root,
    file,
    outputPath: ".codex/context-pack.md",
    sizeBytes: Buffer.byteLength(output, "utf8"),
    maxSizeKb,
    durationMs: Date.now() - started,
    warnings: []
  }, options);
}

export async function runMemoryCompress(root = process.cwd(), options = {}) {
  const started = Date.now();
  const provider = options.provider || DEFAULT_LLM_PROVIDER;
  const model = options.model || DEFAULT_LLM_MODEL;
  const baseUrl = options.baseUrl || options["base-url"] || DEFAULT_LLM_BASE_URL;
  const input = options.input ? path.resolve(root, options.input) : contextPackPathFor(root);
  const output = options.output ? path.resolve(root, options.output) : memoryPathFor(root, SESSION_SUMMARY_FILE);
  if (provider !== "ollama") throw new Error("Only --provider ollama is supported.");
  if (!fileExists(input)) throw new Error(`Compression input not found: ${path.relative(root, input)}`);
  const prompt = [
    "Summarize this repository context for a future AI coding session.",
    "Include concise summary, current task state, important decisions, known failures, affected files, next suggested steps, and warnings.",
    "State that source code remains the source of truth.",
    "Do not include secrets or source code dumps.",
    "",
    readOptionalText(input, DEFAULT_CONTEXT_PACK_MAX_SIZE_KB * 1024)
  ].join("\n");
  let response;
  try {
    response = await localHttpJson(`${baseUrl.replace(/\/$/, "")}/api/generate`, { model, prompt, stream: false });
  } catch (error) {
    throw new Error(`Local Ollama compression failed. Ensure Ollama is running at ${baseUrl} and model ${model} is available. ${error.message}`);
  }
  const text = redactMemoryText(response.response || response.message?.content || "");
  if (!text.trim()) throw new Error("Local Ollama compression returned no text.");
  writeFileAtomic(output, `# Session Summary\n\n${text.trim()}\n\nGenerated context is advisory. Source code remains the source of truth.\n`);
  return withSessionTracking(root, "memory compress", {
    ok: true,
    action: "memory-compress",
    root,
    file: output,
    outputPath: relativeArtifact(root, output),
    provider,
    model,
    baseUrl,
    durationMs: Date.now() - started,
    warnings: []
  }, options);
}

export async function runMemoryCompressDoctor(root = process.cwd(), options = {}) {
  const provider = options.provider || DEFAULT_LLM_PROVIDER;
  const model = options.model || DEFAULT_LLM_MODEL;
  const baseUrl = options.baseUrl || options["base-url"] || DEFAULT_LLM_BASE_URL;
  const results = [
    { found: provider === "ollama", line: `${provider === "ollama" ? "OK" : "MISSING"} provider ${provider}` },
    { found: Boolean(model), line: `${model ? "OK" : "MISSING"} model ${model || "missing"}` },
    { found: Boolean(baseUrl), line: `${baseUrl ? "OK" : "MISSING"} baseUrl ${baseUrl || "missing"}` }
  ];
  try {
    await localHttpJson(`${baseUrl.replace(/\/$/, "")}/api/generate`, { model, prompt: "Reply OK.", stream: false, options: { num_predict: 2 } });
    results.push({ found: true, line: "OK Ollama endpoint reachable" });
  } catch (error) {
    results.push({ found: false, line: `MISSING Ollama endpoint unreachable: ${error.message}` });
  }
  return { ok: results.every((result) => result.found), action: "memory-compress-doctor", root, results };
}

function buildManagedAgentBlock(adapter, state) {
  return `${adapter.startMarker}\n${adapter.buildContent(state).trimEnd()}\n${adapter.endMarker}`;
}

function exportAgentMemory(root, adapter) {
  const started = Date.now();
  const file = agentOutputPath(root, adapter);
  const existing = fileExists(file) ? readText(file) : "";
  const block = buildManagedAgentBlock(adapter, {});
  const result = upsertManagedBlock(existing, adapter.startMarker, adapter.endMarker, block);
  if (!result.ok) throw new Error(`${adapter.name} export failed: ${result.error}`);
  const changed = !fileExists(file) || readText(file) !== result.content;
  if (changed) writeFileAtomic(file, result.content);
  return {
    ok: true,
    action: "memory export",
    agent: adapter.id,
    outputPath: adapter.outputPath,
    changed,
    durationMs: Date.now() - started,
    warnings: []
  };
}

export function runMemoryExport(root = process.cwd(), agent = "all") {
  if (agent === "doctor") return runMemoryExportDoctor(root);
  const targets = agent === "all" ? agentAdapters : [getAgentAdapter(agent)];
  if (targets.some((adapter) => !adapter)) throw new Error(`Unknown memory export agent: ${agent}`);
  const results = targets.map((adapter) => exportAgentMemory(root, adapter));
  const result = agent === "all" ? { ok: results.every((item) => item.ok), action: "memory export", agent: "all", results, warnings: [] } : results[0];
  return withSessionTracking(root, `memory export ${agent}`, result);
}

export function runMemoryExportDoctor(root = process.cwd()) {
  const results = [];
  for (const adapter of agentAdapters) {
    const file = agentOutputPath(root, adapter);
    if (!fileExists(file)) {
      results.push({ agent: adapter.id, found: true, line: `INFO ${adapter.outputPath} not exported` });
      continue;
    }
    const content = readText(file);
    const hasStart = content.includes(adapter.startMarker);
    const hasEnd = content.includes(adapter.endMarker);
    const markersValid = hasStart === hasEnd;
    if (!hasStart && !hasEnd) {
      results.push({ agent: adapter.id, found: true, line: `INFO ${adapter.outputPath} has no managed export` });
      continue;
    }
    const hasMemory = [".codex/memory/sessions.md", ".codex/memory/decisions.md", ".codex/memory/failures.md"].every((item) => content.includes(item));
    const hasContext = [".codex/context/relevant.md", ".codex/context/summary.md", ".codex/context/index.json"].every((item) => content.includes(item));
    const ok = markersValid && hasStart && hasMemory && hasContext;
    results.push({
      agent: adapter.id,
      found: ok,
      line: `${ok ? "OK" : "MISSING"} ${adapter.outputPath} ${ok ? "valid export" : "malformed export"}`
    });
  }
  return { ok: results.every((result) => result.found), action: "memory export doctor", results };
}

export function runGraphBuild(root = process.cwd(), options = {}) {
  const started = Date.now();
  const graph = buildGraphFromIndex(root);
  const artifactResult = writeGraphArtifacts(root, graph);
  const upgrade = runProjectUpgrade(root);
  return withSessionTracking(root, "graph build", {
    ok: true,
    action: "graph-build",
    root,
    entityCount: graph.entityCount,
    relationshipCount: graph.relationshipCount,
    written: artifactResult.written,
    durationMs: Date.now() - started,
    warnings: [],
    upgrade
  }, options);
}

export function runGraphDoctor(root = process.cwd()) {
  const jsonPath = graphPath(root, "graph.json");
  const mdPath = graphPath(root, "graph.md");
  let graphValid = false;
  let schemaVersion = false;
  let generatedAt = false;
  let entityCount = false;
  let relationshipCount = false;
  if (fileExists(jsonPath)) {
    try {
      const graph = JSON.parse(readText(jsonPath));
      graphValid = Array.isArray(graph.entities) && Array.isArray(graph.relationships);
      schemaVersion = Boolean(graph.schemaVersion);
      generatedAt = Boolean(graph.generatedAt);
      entityCount = typeof graph.entityCount === "number";
      relationshipCount = typeof graph.relationshipCount === "number";
    } catch {
      graphValid = false;
    }
  }
  const agentsPath = path.join(root, ".codex", "AGENTS.md");
  const agentsContent = fileExists(agentsPath) ? readText(agentsPath) : "";
  const agentsReferencesGraph = [".codex/graph/impact.md", ".codex/graph/query.md", ".codex/graph/graph.md", ".codex/graph/graph.json"].every((item) => agentsContent.includes(item));
  const results = [
    { file: path.join(".codex", "graph", "graph.json"), found: fileExists(jsonPath), line: `${fileExists(jsonPath) ? "OK" : "MISSING"} .codex/graph/graph.json ${fileExists(jsonPath) ? "found" : "missing"}` },
    { file: "graph.json", found: graphValid, line: `${graphValid ? "OK" : "MISSING"} graph.json valid` },
    { file: "schemaVersion", found: schemaVersion, line: `${schemaVersion ? "OK" : "MISSING"} graph schemaVersion` },
    { file: "generatedAt", found: generatedAt, line: `${generatedAt ? "OK" : "MISSING"} graph generatedAt` },
    { file: "entityCount", found: entityCount, line: `${entityCount ? "OK" : "MISSING"} entityCount number` },
    { file: "relationshipCount", found: relationshipCount, line: `${relationshipCount ? "OK" : "MISSING"} relationshipCount number` },
    { file: path.join(".codex", "graph", "graph.md"), found: fileExists(mdPath), line: `${fileExists(mdPath) ? "OK" : "MISSING"} .codex/graph/graph.md ${fileExists(mdPath) ? "found" : "missing"}` },
    { file: path.join(".codex", "AGENTS.md"), found: agentsReferencesGraph, line: `${agentsReferencesGraph ? "OK" : "MISSING"} .codex/AGENTS.md references graph files` }
  ];
  return { ok: results.every((result) => result.found), action: "graph doctor", results };
}

export function runGraphClean(root = process.cwd()) {
  const started = Date.now();
  const dir = graphDir(root);
  if (!fileExists(dir)) return { ok: true, action: "graph clean", removed: false, dir, durationMs: Date.now() - started, warnings: [] };
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true, action: "graph clean", removed: true, dir, durationMs: Date.now() - started, warnings: [] };
}

export function runGraphImpact(root = process.cwd(), target) {
  const started = Date.now();
  if (!target || !target.trim()) throw new Error("Graph impact target is required.");
  const graph = readGraph(root);
  const report = writeImpact(root, graph, target.trim());
  return withSessionTracking(root, "graph impact", { ok: true, action: "graph impact", target, outputPath: path.join(".codex", "graph", "impact.md"), report, durationMs: Date.now() - started, warnings: [] });
}

export function runGraphQuery(root = process.cwd(), question) {
  const started = Date.now();
  if (!question || !question.trim()) throw new Error("Graph query is required.");
  const graph = readGraph(root);
  const result = queryGraph(graph, question);
  const report = writeQuery(root, question, result);
  return withSessionTracking(root, "graph query", { ok: true, action: "graph query", question, outputPath: path.join(".codex", "graph", "query.md"), matches: result.matches, intent: result.intent, report, durationMs: Date.now() - started, warnings: [] });
}

function readIndex(root) {
  const file = indexPathFor(root);
  if (!fileExists(file)) throw new Error("Context index not found. Run `forgemind index` first.");
  try {
    return JSON.parse(readText(file));
  } catch {
    throw new Error("Context index not found. Run `forgemind index` first.");
  }
}

export function generateSummary(index) {
  const files = index._files || [];
  const languageRows = Object.entries(index.languageCounts || {}).slice(0, 8).map(([language, count]) => `- ${language}: ${count}`);
  const entries = entrypointCandidates(files);
  const tests = testCandidates(files);
  const scripts = buildRunScripts(index._root);
  const dirs = importantDirs(files);
  const topImportant = [...files].sort((a, b) => b.importanceScore - a.importanceScore || a.relative.localeCompare(b.relative)).slice(0, 10).map((file) => `- ${toDisplayPath(file.relative)} (${file.importanceScore})`);
  return `# Context Summary\n\n- Root: ${index.root}\n- Likely project type: ${likelyProjectType(files)}\n- Files indexed: ${index.fileCount}\n- Route count: ${index.routeCount}\n- Symbol count: ${index.symbolCount}\n- Dependency file count: ${index.dependencyFileCount}\n- Recent changed files count: ${index.recentChangesCount}\n\n## Primary Languages\n\n${languageRows.length ? languageRows.join("\n") : "None found."}\n\n## Important Directories\n\n${dirs.length ? dirs.map((dir) => `- ${dir}`).join("\n") : "None found."}\n\n## Top Important Files\n\n${topImportant.length ? topImportant.join("\n") : "None found."}\n\n## Entrypoint Candidates\n\n${entries.length ? entries.map((entry) => `- ${entry}`).join("\n") : "None found."}\n\n## Test Candidates\n\n${tests.length ? tests.map((test) => `- ${test}`).join("\n") : "None found."}\n\n## Build / Run Script Candidates\n\n${scripts.length ? scripts.map((script) => `- ${script}`).join("\n") : "None found."}\n`;
}

export function writeContextArtifacts(root, index) {
  const contextDir = path.join(root, ".codex", "context");
  const files = index._files || [];
  const artifacts = {
    "index.json": JSON.stringify({
      schemaVersion: index.schemaVersion,
      generatedAt: index.generatedAt,
      generatorVersion: index.generatorVersion,
      root: index.root,
      fileCount: index.fileCount,
      languageCounts: index.languageCounts,
      symbolCount: index.symbolCount,
      routeCount: index.routeCount,
      dependencyFileCount: index.dependencyFileCount,
      recentChangesCount: index.recentChangesCount,
      maxFileSizeKb: index.maxFileSizeKb,
      counts: index.counts,
      files: index.files
    }, null, 2),
    "summary.md": generateSummary(index),
    "symbols.md": symbolsMd(files),
    "files.md": groupedFilesMd(files),
    "routes.md": routeHintsMd(files),
    "dependencies.md": collectDependencies(root, files),
    "recent_changes.md": `# Recent Changes\n\n${gitStatus(root)}\n`
  };
  let written = 0;
  for (const [file, content] of Object.entries(artifacts)) {
    if (writeFileIfChanged(path.join(contextDir, file), content)) written += 1;
  }
  return { artifacts: Object.keys(artifacts).length, written };
}

export function runIndex(root = process.cwd(), options = {}) {
  const started = Date.now();
  const scan = scanProject(root, options);
  const recentPaths = recentChangedPaths(root);
  const files = enrichFiles(scan.files.sort((a, b) => a.relative.localeCompare(b.relative))).map((file) => ({ ...file, ...scoreFile(file, recentPaths) }));
  const languageCounts = Object.fromEntries(topLanguages(files));
  const symbolCount = files.reduce((sum, file) => sum + file.symbols.length + file.headings.length, 0);
  const routeCount = files.reduce((sum, file) => sum + file.routeHints.length, 0);
  const dependencyFileCount = detectDependencies(root).length;
  const index = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    generatorVersion: GENERATOR_VERSION,
    root: path.basename(root),
    fileCount: files.length,
    languageCounts,
    symbolCount,
    routeCount,
    dependencyFileCount,
    recentChangesCount: recentPaths.size,
    maxFileSizeKb: scan.maxFileSizeKb,
    counts: { files: files.length, ignored: scan.ignored, skippedLarge: scan.skippedLarge },
    files: files.map((file) => ({
        path: toDisplayPath(file.relative),
        ext: file.ext,
        size: file.size,
        hash: file.hash,
        imports: file.imports,
        exports: file.exports,
        symbols: file.symbols,
        routes: file.routeHints,
        routeHints: file.routeHints,
        headings: file.headings,
        testHints: file.testHints,
        importanceScore: file.importanceScore,
        importanceReasons: file.importanceReasons
      })),
    _files: files,
    _root: root
  };
  const artifactResult = writeContextArtifacts(root, index);
  const upgrade = runProjectUpgrade(root);
  return withSessionTracking(root, "index", {
    ok: true,
    action: "index",
    root,
    filesIndexed: files.length,
    skippedFiles: scan.skippedLarge + scan.ignored,
    ignored: scan.ignored,
    skippedLarge: scan.skippedLarge,
    artifacts: artifactResult.artifacts,
    written: artifactResult.written,
    durationMs: Date.now() - started,
    warnings: [],
    upgrade
  }, options);
}

export function runContextIndex(root = process.cwd(), options = {}) {
  return runIndex(root, options);
}

export function runContextDoctor(root = process.cwd()) {
  const artifactResults = contextFiles.map((file) => {
    const found = fileExists(path.join(root, file));
    return { file, found, line: `${found ? "OK" : "MISSING"} ${file} ${found ? "found" : "missing"}` };
  });
  const indexPath = path.join(root, ".codex", "context", "index.json");
  let indexValid = false;
  let schemaVersion = "unavailable";
  let generatedAt = "unavailable";
  let fileCount = "unavailable";
  let noSecretsIndexed = false;
  if (fileExists(indexPath)) {
    try {
      const index = JSON.parse(readText(indexPath));
      indexValid = Boolean(index && Array.isArray(index.files));
      schemaVersion = index.schemaVersion ? String(index.schemaVersion) : "unavailable";
      const parsedDate = Date.parse(index.generatedAt);
      generatedAt = Number.isNaN(parsedDate) ? "invalid generatedAt" : index.generatedAt;
      const matchesLength = Number.isInteger(index.fileCount) && index.fileCount === index.files.length;
      fileCount = matchesLength ? String(index.fileCount) : "invalid file count";
      noSecretsIndexed = index.files.every((file) => file.path && !isIgnoredPath(file.path));
    } catch {
      generatedAt = "invalid index.json";
      fileCount = "invalid index.json";
    }
  }
  const agentsPath = path.join(root, ".codex", "AGENTS.md");
  const agentsReferencesContext = fileExists(agentsPath) && readText(agentsPath).includes("Precomputed Context Engine");
  const relevantPath = relevantPathFor(root);
  const relevantReadable = !fileExists(relevantPath) || fs.statSync(relevantPath).isFile();
  const results = [
    ...artifactResults,
    { file: "index.json", found: indexValid, line: `${indexValid ? "OK" : "MISSING"} index.json valid` },
    { file: "schemaVersion", found: schemaVersion !== "unavailable", line: `${schemaVersion !== "unavailable" ? "OK" : "MISSING"} schemaVersion ${schemaVersion}` },
    { file: "fileCount", found: /^\d+$/.test(fileCount), line: `${/^\d+$/.test(fileCount) ? "OK" : "MISSING"} file count ${fileCount}` },
    { file: "generatedAt", found: !generatedAt.startsWith("invalid") && generatedAt !== "unavailable", line: `${!generatedAt.startsWith("invalid") && generatedAt !== "unavailable" ? "OK" : "MISSING"} generatedAt ${generatedAt}` },
    { file: "secrets", found: noSecretsIndexed, line: `${noSecretsIndexed ? "OK" : "MISSING"} no secret files indexed` },
    {
      file: path.join(".codex", "AGENTS.md"),
      found: agentsReferencesContext,
      line: `${agentsReferencesContext ? "OK" : "MISSING"} .codex/AGENTS.md references context engine`
    },
    {
      file: path.join(".codex", "context", RELEVANT_CONTEXT_FILE),
      found: relevantReadable,
      line: `${fileExists(relevantPath) ? "OK" : "INFO"} .codex/context/relevant.md ${fileExists(relevantPath) ? "readable" : "missing optional"}`
    }
  ];
  return { ok: results.every((result) => result.found), results };
}

export function runContextClean(root = process.cwd()) {
  const started = Date.now();
  const dir = path.join(root, ".codex", "context");
  if (!fileExists(dir)) return { ok: true, action: "context-clean", removed: false, dir, durationMs: Date.now() - started, warnings: [] };
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true, action: "context-clean", removed: true, dir, durationMs: Date.now() - started, warnings: [] };
}

function detectedContext(file) {
  const rows = [];
  if (file.exports?.length) rows.push(`- exports: ${file.exports.slice(0, 8).join(", ")}`);
  if (file.symbols?.length) rows.push(`- symbols: ${file.symbols.slice(0, 8).map((item) => item.name).join(", ")}`);
  if (file.routes?.length) rows.push(`- routes: ${file.routes.slice(0, 8).map((item) => `${item.method ? `${item.method} ` : ""}${item.path || item.route}`).join(", ")}`);
  if (file.headings?.length) rows.push(`- headings: ${file.headings.slice(0, 8).map((item) => item.text).join(", ")}`);
  return rows.length ? rows.join("\n") : "- none";
}

function relevantMarkdown(question, matches, byPath) {
  const lines = ["# Relevant Context", "", `Query: ${question}`, "", `Generated: ${new Date().toISOString()}`, "", "## Top Matches", ""];
  matches.forEach((match, index) => {
    const file = byPath.get(match.path) || {};
    lines.push(`### ${index + 1}. ${match.path}`, `Score: ${match.score}`, "", "Reasons:");
    for (const reason of match.reasons.slice(0, 8)) lines.push(`- ${reason}`);
    lines.push("", "Detected context:", detectedContext(file), "");
  });
  lines.push("## Suggested Agent Usage", "", "Before editing, inspect only the top relevant files first.", "If these files are insufficient, then perform a targeted search.", "", "## Notes", "", "Generated by ForgeMind ask.", "Source code remains the source of truth.", "");
  return lines.join("\n");
}

export function runQuery(root = process.cwd(), question, options = {}) {
  const started = Date.now();
  if (!question || !question.trim()) throw new Error("Query question is required.");
  const topCount = Number.parseInt(options.top ?? 10, 10) || 10;
  const index = readIndex(root);
  const terms = queryTerms(question);
  const recentPaths = new Set((index.files || [])
    .filter((file) => (file.importanceReasons || []).includes("recently changed"))
    .map((file) => file.path));
  const byPath = new Map((index.files || []).map((file) => [file.path, file]));
  const matches = (index.files || [])
    .map((file) => scoreFileForQuery(file, terms, recentPaths))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, topCount);
  const relevantPath = relevantPathFor(root);
  writeFileAtomic(relevantPath, relevantMarkdown(question, matches, byPath));
  return withSessionTracking(root, "query", {
    ok: true,
    action: "query",
    question,
    topCount,
    relevantPath: path.join(".codex", "context", RELEVANT_CONTEXT_FILE),
    matches,
    durationMs: Date.now() - started,
    warnings: []
  }, options);
}

export function runDebug(root = process.cwd()) {
  const globalAgentsPath = getGlobalAgentsPath();
  const projectAgentsPath = path.join(root, ".codex", "AGENTS.md");
  const contextDoctor = runContextDoctor(root);
  const projectDoctor = runProjectDoctor(root);
  const graphDoctor = runGraphDoctor(root);
  const relevantPath = relevantPathFor(root);
  const relevantExists = fileExists(relevantPath);
  const results = [
    { line: `OS ${os.platform()} ${os.release()}`, found: true },
    { line: `Node ${process.version}`, found: true },
    { line: "CLI version 0.1.0", found: true },
    { line: `${fileExists(globalAgentsPath) ? "OK" : "MISSING"} global AGENTS ${globalAgentsPath}`, found: fileExists(globalAgentsPath) },
    { line: `${fileExists(projectAgentsPath) ? "OK" : "MISSING"} project AGENTS ${projectAgentsPath}`, found: fileExists(projectAgentsPath) },
    { line: `${contextDoctor.ok ? "OK" : "MISSING"} context status`, found: contextDoctor.ok },
    { line: `${graphDoctor.ok ? "OK" : "MISSING"} graph status`, found: true },
    { line: `OK session tracking ${DEFAULT_SESSION_TRACKING_ENABLED ? "enabled" : "disabled"}`, found: true },
    { line: `${fileExists(memoryPathFor(root, "sessions.md")) ? "OK" : "MISSING"} sessions.md ${fileExists(memoryPathFor(root, "sessions.md")) ? "present" : "missing"}`, found: true },
    { line: `${fileExists(memoryPathFor(root, "decisions.md")) ? "OK" : "MISSING"} decisions.md ${fileExists(memoryPathFor(root, "decisions.md")) ? "present" : "missing"}`, found: true },
    { line: `${fileExists(memoryPathFor(root, "failures.md")) ? "OK" : "MISSING"} failures.md ${fileExists(memoryPathFor(root, "failures.md")) ? "present" : "missing"}`, found: true },
    { line: `${fileExists(contextPackPathFor(root)) ? "OK" : "MISSING"} context-pack.md ${fileExists(contextPackPathFor(root)) ? "present" : "missing"}`, found: true },
    { line: `${fileExists(memoryPathFor(root, SESSION_SUMMARY_FILE)) ? "OK" : "INFO"} session_summary.md ${fileExists(memoryPathFor(root, SESSION_SUMMARY_FILE)) ? "present" : "missing optional"}`, found: true },
    { line: `Local LLM ${DEFAULT_LLM_PROVIDER} ${DEFAULT_LLM_MODEL} ${DEFAULT_LLM_BASE_URL}`, found: true },
    { line: `${relevantExists ? "OK" : "MISSING"} relevant.md ${relevantExists ? "present" : "missing"}`, found: true },
    { line: `relevant.md modified ${relevantExists ? fs.statSync(relevantPath).mtime.toISOString() : "n/a"}`, found: true },
    { line: `Log location ${path.join(root, ".codex", "logs", "latest.log")}`, found: true }
  ];
  const ok = results.every((result) => result.found) && projectDoctor.ok;
  return { ok, action: "debug", root, results, durationMs: 0, warnings: [] };
}
