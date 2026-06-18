import { parseJavaScript } from "./javascriptParser.js";

export function parseTypeScript(content, context = {}) {
  return parseJavaScript(content, context);
}
