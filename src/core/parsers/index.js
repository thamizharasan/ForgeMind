import path from "node:path";
import { parseGeneric } from "./genericParser.js";
import { parseJavaScript } from "./javascriptParser.js";
import { parseJson } from "./jsonParser.js";
import { parseMarkdown } from "./markdownParser.js";
import { parsePython } from "./pythonParser.js";
import { parseTypeScript } from "./typescriptParser.js";

export function parseFile(content, context = {}) {
  const ext = context.ext || path.extname(context.relativePath || "").toLowerCase();
  const fileName = context.fileName || path.basename(context.relativePath || "");
  const parserContext = { ...context, ext, fileName };
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return parseJavaScript(content, parserContext);
  if ([".ts", ".tsx"].includes(ext)) return parseTypeScript(content, parserContext);
  if (ext === ".py") return parsePython(content, parserContext);
  if ([".md", ".mdx"].includes(ext)) return parseMarkdown(content, parserContext);
  if (ext === ".json") return parseJson(content, parserContext);
  return parseGeneric(content, parserContext);
}
