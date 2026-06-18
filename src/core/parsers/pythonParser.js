import { emptyParseResult, safeParse } from "./genericParser.js";

export function parsePython(content, context = {}) {
  return safeParse((text) => {
    const result = emptyParseResult();
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const imported = line.match(/^\s*import\s+([A-Za-z0-9_.,\s]+)|^\s*from\s+([A-Za-z0-9_.]+)\s+import/);
      const importName = imported?.[1] || imported?.[2];
      if (importName) result.imports.push(importName.trim());

      const fn = line.match(/^\s*def\s+([A-Za-z_]\w*)/);
      if (fn) result.symbols.push({ type: "function", name: fn[1], line: i + 1 });

      const cls = line.match(/^\s*class\s+([A-Za-z_]\w*)/);
      if (cls) result.symbols.push({ type: "class", name: cls[1], line: i + 1 });

      const route = line.match(/^\s*@(app|router)\.(get|post|put|patch|delete|route)\s*\(\s*["']([^"']+)["']/i);
      if (route) result.routes.push({ method: route[2].toUpperCase() === "ROUTE" ? "" : route[2].toUpperCase(), path: route[3], source: context.relativePath, line: i + 1, kind: "api" });
    }
    return result;
  }, content, context);
}
