import { emptyParseResult, safeParse } from "./genericParser.js";

export function parseMarkdown(content, context = {}) {
  return safeParse((text) => {
    const result = emptyParseResult();
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const heading = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (heading) result.headings.push({ level: heading[1].length, text: heading[2].trim(), line: i + 1 });
    }
    return result;
  }, content, context);
}
