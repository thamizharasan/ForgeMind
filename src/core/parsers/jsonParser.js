import { emptyParseResult, safeParse } from "./genericParser.js";

export function parseJson(content, context = {}) {
  return safeParse((text) => {
    const result = emptyParseResult();
    if (context.fileName !== "package.json") return result;
    const pkg = JSON.parse(text);
    result.dependencies.push({
      file: context.relativePath,
      packageName: pkg.name || "",
      scripts: Object.keys(pkg.scripts || {}),
      dependencies: Object.keys(pkg.dependencies || {}),
      devDependencies: Object.keys(pkg.devDependencies || {})
    });
    return result;
  }, content, context);
}
