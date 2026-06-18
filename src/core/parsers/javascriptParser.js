import { emptyParseResult, safeParse } from "./genericParser.js";

const ROUTE_RE = /\b(app|router)\.(get|post|put|patch|delete|use)\s*\(\s*["'`]([^"'`]+)["'`]/i;
const REACT_ROUTE_RE = /<(?:Route|Link|NavLink)\b[^>]*(?:path|to)=["'`]([^"'`]+)["'`]/i;

export function parseJavaScript(content, context = {}) {
  return safeParse((text) => {
    const result = emptyParseResult();
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const importMatch = line.match(/^\s*import\s+.*?\s+from\s+["'`]([^"'`]+)|^\s*import\s+["'`]([^"'`]+)|require\(\s*["'`]([^"'`]+)["'`]\s*\)/);
      const importName = importMatch?.[1] || importMatch?.[2] || importMatch?.[3];
      if (importName) result.imports.push(importName);

      const exportMatch = line.match(/^\s*export\s+(?:default\s+)?(?:(?:async\s+)?(?:function|class|const|let|var)\s+)?([A-Za-z_$][\w$]*)?/);
      if (exportMatch) result.exports.push(exportMatch[1] || "default");

      const fn = line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
      if (fn) result.symbols.push({ type: /^[A-Z]/.test(fn[1]) ? "component" : "function", name: fn[1], line: i + 1 });

      const arrow = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
      if (arrow) result.symbols.push({ type: /^[A-Z]/.test(arrow[1]) ? "component" : "function", name: arrow[1], line: i + 1 });

      const cls = line.match(/^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/);
      if (cls) result.symbols.push({ type: /^[A-Z].*(Component|Page|Form|View)$/.test(cls[1]) ? "component" : "class", name: cls[1], line: i + 1 });

      const exportedConst = line.match(/^\s*export\s+const\s+([A-Za-z_$][\w$]*)/);
      if (exportedConst && !result.symbols.some((item) => item.name === exportedConst[1])) {
        result.symbols.push({ type: "exported constant", name: exportedConst[1], line: i + 1 });
      }

      const route = line.match(ROUTE_RE);
      if (route) result.routes.push({ method: route[2].toUpperCase(), path: route[3], source: context.relativePath, line: i + 1, kind: "api" });

      const uiRoute = line.match(REACT_ROUTE_RE);
      if (uiRoute) result.routes.push({ method: "", path: uiRoute[1], source: context.relativePath, line: i + 1, kind: "ui" });
    }
    return result;
  }, content, context);
}
