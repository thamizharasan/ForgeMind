import { graphPath } from "./graphStore.js";
import { writeFileAtomic } from "../utils/fsSafe.js";

const STOP_WORDS = new Set(["what", "which", "where", "does", "will", "breaks", "break", "change", "if", "the", "a", "an", "is", "are", "we", "with", "for", "to", "in", "of"]);

function redactText(value) {
  return String(value)
    .replace(/(^|[\\/\s"'`])(?:\.env(?:\.[^\s"'`]*)?|id_rsa|id_ed25519|[^\\/\s"'`]+\.(?:pem|key))(?=$|[\s"'`,.])/g, "$1[redacted secret file]")
    .replace(/\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)\s*=\s*[^\s]+/g, "[redacted secret]")
    .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_=-]{12,}\b/g, "[redacted secret]");
}

function terms(question) {
  return String(question).toLowerCase().split(/[^a-z0-9_.$/-]+/).filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function intent(question) {
  const text = question.toLowerCase();
  if (/\b(break|breaks|change|impact)\b/.test(text)) return "impact";
  if (/\b(api|route|endpoint)\b/.test(text)) return "route";
  if (/\b(why|choose|chosen|decision)\b/.test(text)) return "decision";
  if (/\b(failed|failure|error|bug)\b/.test(text)) return "failure";
  if (/\b(used|depend|dependency|import)\b/.test(text)) return "dependency";
  return "general";
}

function entityText(entity) {
  return `${entity.id} ${entity.name || ""} ${entity.path || ""} ${JSON.stringify(entity.metadata || {})}`.toLowerCase();
}

function score(entity, queryTerms, queryIntent) {
  let value = 0;
  const text = entityText(entity);
  for (const term of queryTerms) if (text.includes(term)) value += 10;
  if (queryIntent === "route" && entity.type === "route") value += 20;
  if (queryIntent === "decision" && entity.type === "memory_decision") value += 20;
  if (queryIntent === "failure" && entity.type === "memory_failure") value += 20;
  if (queryIntent === "dependency" && entity.type === "dependency") value += 20;
  if (queryIntent === "impact" && entity.type === "file") value += 10;
  return value;
}

export function queryGraph(graph, question) {
  const queryTerms = terms(question);
  const queryIntent = intent(question);
  const matches = graph.entities
    .map((entity) => ({ entity, score: score(entity, queryTerms, queryIntent) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.entity.id.localeCompare(b.entity.id))
    .slice(0, 20);
  return { intent: queryIntent, matches };
}

export function queryMarkdown(question, result) {
  return `# Graph Query

Query: ${redactText(question)}
Intent: ${result.intent}

## Ranked Entities

${result.matches.map((match) => `- ${match.score} ${match.entity.type} ${match.entity.name}`).join("\n") || "None found."}

## Suggested Agent Usage

Use the ranked entities to inspect the smallest related source files first.
`;
}

export function writeQuery(root, question, result) {
  const content = queryMarkdown(question, result);
  writeFileAtomic(graphPath(root, "query.md"), content);
  return content;
}
