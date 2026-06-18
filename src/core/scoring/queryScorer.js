import path from "node:path";

const STOP_WORDS = new Set(["what", "which", "where", "how", "do", "does", "the", "a", "an", "to", "for", "of", "in", "on", "with", "and", "or", "is", "are"]);

const SYNONYMS = {
  auth: ["auth", "authentication", "authorize", "authorization", "login", "logout", "session", "token", "jwt", "user"],
  database: ["db", "database", "model", "schema", "migration", "repository", "query"],
  api: ["api", "route", "controller", "endpoint", "handler", "request", "response"],
  ui: ["ui", "component", "page", "view", "screen", "form"],
  config: ["config", "settings", "env", "environment"],
  test: ["test", "spec", "mock", "fixture"]
};

function normalizeTerm(term) {
  const cleaned = term.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (cleaned.length > 3 && cleaned.endsWith("s")) return cleaned.slice(0, -1);
  return cleaned;
}

export function queryTerms(question) {
  const base = question.split(/\s+/).map(normalizeTerm).filter((term) => term && !STOP_WORDS.has(term));
  const expanded = new Set(base);
  for (const term of base) {
    for (const values of Object.values(SYNONYMS)) {
      if (values.includes(term)) values.forEach((value) => expanded.add(value));
    }
  }
  return [...expanded];
}

function includesTerm(value, term) {
  return String(value || "").toLowerCase().includes(term);
}

function add(reasons, reason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

export function scoreFileForQuery(file, terms, recentPaths = new Set()) {
  let score = 0;
  const reasons = [];
  const filePath = file.path || "";
  const filename = path.basename(filePath);
  const ext = file.ext || path.extname(filePath);
  const generated = /(^|\/)(dist|build|out|coverage|generated)(\/|$)|(\.min\.)/i.test(filePath);

  for (const term of terms) {
    if (includesTerm(filePath, term)) {
      score += 40;
      add(reasons, `path matched ${term}`);
    }
    if (includesTerm(filename, term)) {
      score += 30;
      add(reasons, `filename matched ${term}`);
    }
    for (const symbol of file.symbols || []) {
      if (includesTerm(symbol.name, term)) {
        score += 25;
        add(reasons, `symbol matched ${symbol.name}`);
      }
    }
    for (const route of file.routes || file.routeHints || []) {
      const routePath = route.path || route.route || "";
      if (includesTerm(routePath, term)) {
        score += 25;
        add(reasons, `route matched ${routePath}`);
      }
    }
    for (const value of [...(file.imports || []), ...(file.exports || [])]) {
      if (includesTerm(value, term)) {
        score += 20;
        add(reasons, `import/export matched ${value}`);
      }
    }
    for (const heading of file.headings || []) {
      if (includesTerm(heading.text, term)) {
        score += 15;
        add(reasons, `heading matched ${heading.text}`);
      }
    }
  }

  if (terms.some((term) => includesTerm(ext, term))) {
    score += 10;
    add(reasons, `extension matched ${ext}`);
  }
  if (recentPaths.has(filePath)) {
    score += 10;
    add(reasons, "recently changed");
  }
  if (Number.isFinite(file.importanceScore)) {
    const bonus = Math.max(0, Math.min(20, Math.round(file.importanceScore / 5)));
    if (bonus) {
      score += bonus;
      add(reasons, `importance score bonus ${bonus}`);
    }
  }
  if (generated) {
    score -= 20;
    add(reasons, "generated/build-like file penalty");
  }

  return { path: filePath, score, reasons };
}
