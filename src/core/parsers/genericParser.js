export function emptyParseResult() {
  return { imports: [], exports: [], symbols: [], routes: [], headings: [], dependencies: [] };
}

export function safeParse(parse, content, context = {}) {
  try {
    return parse(content, context);
  } catch (error) {
    context.logger?.warn?.(`Parser failed for ${context.relativePath || "unknown file"}: ${error.message}`);
    return emptyParseResult();
  }
}

export function parseGeneric() {
  return emptyParseResult();
}
