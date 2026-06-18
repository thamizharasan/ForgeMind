# Contributing to ForgeMind

Thanks for helping improve ForgeMind, a Repository Intelligence Engine for AI coding agents.

## Principles

- Keep the core local-first.
- Prefer deterministic, explainable behavior.
- Preserve cross-platform support for Windows, macOS, and Linux.
- Avoid runtime dependencies unless they are essential.
- Keep CLI and VS Code wrappers thin over shared core logic.
- Treat generated context as advisory; source code remains the source of truth.

## Setup

```bash
npm install
npm test
npm run check
```

Test the CLI locally:

```bash
npm link
forgemind --help
fgm --help
```

## Pull Requests

- Keep changes focused.
- Add or update Node built-in tests for behavior changes.
- Update README or command docs when user-facing behavior changes.
- Do not add generated `.forgemind` artifacts, logs, package tarballs, or `node_modules`.

