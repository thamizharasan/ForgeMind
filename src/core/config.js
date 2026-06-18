import path from "node:path";

export const PROJECT_START = "<!-- FORGEMIND:PROJECT:START -->";
export const PROJECT_END = "<!-- FORGEMIND:PROJECT:END -->";

export const STORAGE_DIR = ".forgemind";
export const INSTRUCTIONS_FILE = "instructions.md";
export function storageRelativePath(...parts) {
  return path.join(STORAGE_DIR, ...parts);
}

export function storageDisplayPath(...parts) {
  return [STORAGE_DIR, ...parts].join("/");
}

export function storagePath(root, ...parts) {
  return path.join(root, STORAGE_DIR, ...parts);
}

export const DEFAULT_MAX_FILE_SIZE_KB = 300;
export const DEFAULT_CONTEXT_PACK_MAX_SIZE_KB = 40;
export const DEFAULT_SESSION_TRACKING_ENABLED = true;
export const DEFAULT_LLM_PROVIDER = "ollama";
export const DEFAULT_LLM_MODEL = "qwen3:4b";
export const DEFAULT_LLM_BASE_URL = "http://localhost:11434";
export const SCHEMA_VERSION = 2;
export const GENERATOR_VERSION = "0.1.0";
export const HEAVY_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".next", ".nuxt", "target", "vendor", ".venv", "__pycache__"]);
export const CONTEXT_FILES = ["index.json", "summary.md", "symbols.md", "files.md", "routes.md", "dependencies.md", "recent_changes.md"];
export const RELEVANT_CONTEXT_FILE = "relevant.md";
export const CONTEXT_PACK_FILE = "context-pack.md";
export const MEMORY_FILES = ["sessions.md", "decisions.md", "failures.md", "fixes.md", "rationale.md"];
export const SESSION_SUMMARY_FILE = "session_summary.md";
export const GRAPH_FILES = ["graph.json", "graph.md", "impact.md"];
export const CROSS_AGENT_CONTEXT_ORDER = [
  ".forgemind/context-pack.md",
  ".forgemind/context/relevant.md",
  ".forgemind/graph/impact.md",
  ".forgemind/graph/query.md",
  ".forgemind/graph/graph.md",
  ".forgemind/memory/sessions.md",
  ".forgemind/memory/decisions.md",
  ".forgemind/memory/failures.md",
  ".forgemind/memory/fixes.md",
  ".forgemind/memory/rationale.md",
  ".forgemind/context/summary.md",
  ".forgemind/context/dependencies.md",
  ".forgemind/context/files.md",
  ".forgemind/context/symbols.md",
  ".forgemind/context/routes.md",
  ".forgemind/context/recent_changes.md",
  ".forgemind/context/index.json",
  ".forgemind/graph/graph.json"
];
export const SECRET_FILE_NAMES = new Set([".env", "id_rsa", "id_ed25519"]);
export const SECRET_PREFIXES = [".env.", "secrets.", "credentials."];
export const SECRET_SUFFIXES = [".pem", ".key"];
export const DEPENDENCY_FILES = ["package.json", "requirements.txt", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "build.gradle"];
export const RELEVANT_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".rs", ".go", ".java", ".cs", ".json", ".md", ".yml", ".yaml", ".toml", ".gradle", ".xml"]);
export const RELEVANT_FILE_NAMES = new Set([...DEPENDENCY_FILES.map((file) => file.toLowerCase()), "dockerfile"]);

export const requiredFiles = [
  storageRelativePath(INSTRUCTIONS_FILE),
  storageRelativePath("templates", "project_context.template.md"),
  storageRelativePath("templates", "architecture.template.md"),
  storageRelativePath("templates", "task.template.md"),
  storageRelativePath("templates", "decision_log.template.md"),
  "project_context.md",
  "architecture.md",
  "task.md",
  "decision_log.md"
];

export const contextFiles = CONTEXT_FILES.map((file) => storageRelativePath("context", file));
export const memoryFiles = MEMORY_FILES.map((file) => storageRelativePath("memory", file));
export const graphFiles = GRAPH_FILES.map((file) => storageRelativePath("graph", file));

export const projectManagedBlock = `${PROJECT_START}
# Project ForgeMind Rules

## Precomputed Context Engine

Before broad repository search, read these generated context files if present:

${CROSS_AGENT_CONTEXT_ORDER.map((file, index) => `${index + 1}. ${file}`).join("\n")}

If \`.forgemind/context/relevant.md\` exists, treat it as the task-specific context shortlist generated from the user's latest query.
Use \`.forgemind/graph/*\` as generated relationship and impact context for files, symbols, routes, dependencies, and memory links.
Use \`.forgemind/memory/*\` as persistent repository memory for decisions, sessions, failures, fixes, rationale, and handoff notes.

Use these as pre-indexed repository context.

Rules:
- Prefer these files before scanning directories.
- Use importance scores to identify likely relevant files.
- Use them to identify the smallest relevant file set.
- Do not treat them as always complete.
- Graph files are generated context, not source of truth.
- Use graph files to understand relationships and impact.
- Memory can be stale; verify memory against source code before making changes.
- If generated context conflicts with source code, source code wins.
- After meaningful code changes, update context by running:
  \`forgemind index\`
  \`forgemind graph build\`

## Context Source Priority

Then read these project-maintained files when present:

1. task.md
2. architecture.md
3. decision_log.md
4. project_context.md

Do not scan the repository until these context files have been checked.

## Project Documentation Rules

- Update task.md after meaningful progress.
- Update decision_log.md only when a technical decision is made.
- Update architecture.md only when structure, dependencies, boundaries, or data flow change.
- Update project_context.md only when product goals, constraints, or scope change.
- Do not generate extra documentation unless requested.

## Project Search Rules

- Prefer context files before broad repository search.
- Search only files directly related to the current task.
- Stop searching once sufficient context is found.
${PROJECT_END}`;

export const templates = {
  "project_context.md": `# Project Context

## Product / Project Name

TODO

## Goal

TODO

## Users

TODO

## Core Features

TODO

## Non-Goals

TODO

## Constraints

- Prefer small, maintainable changes.
- Prefer existing patterns.
- Avoid unnecessary dependencies.
- Prefer ForgeMind generated context before broad repository exploration.

## Current Scope

TODO
`,
  "architecture.md": `# Architecture

## Overview

TODO

## Tech Stack

TODO

## Main Components

TODO

## Data Flow

TODO

## Important Directories

TODO

## Integration Points

TODO

## Constraints

- Keep architecture simple.
- Avoid premature abstractions.
- Prefer modular boundaries.
`,
  "task.md": `# Task

## Current Task

TODO

## Status

Not started.

## Relevant Files

TODO

## Acceptance Criteria

TODO

## Notes for AI Agents

- Read this file first.
- Only inspect files directly related to the current task.
- Keep changes minimal.
`,
  "decision_log.md": `# Decision Log

Record only meaningful technical decisions.

## Format

### YYYY-MM-DD - Decision Title

Decision:
TODO

Reason:
TODO

Impact:
TODO
`
};
