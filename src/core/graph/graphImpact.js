import { graphPath } from "./graphStore.js";
import { writeFileAtomic } from "../utils/fsSafe.js";

function findTarget(graph, target) {
  const needle = target.toLowerCase();
  return graph.entities.find((entity) => entity.id.toLowerCase() === needle
    || entity.name?.toLowerCase() === needle
    || entity.path?.toLowerCase() === needle)
    || graph.entities.find((entity) => entity.name?.toLowerCase().includes(needle) || entity.path?.toLowerCase().includes(needle));
}

function related(graph, id) {
  return graph.relationships.filter((rel) => rel.from === id || rel.to === id);
}

function other(rel, id) {
  return rel.from === id ? rel.to : rel.from;
}

export function buildImpactMarkdown(graph, target) {
  const entity = findTarget(graph, target);
  if (!entity) throw new Error(`Graph target not found: ${target}`);
  const byId = new Map(graph.entities.map((item) => [item.id, item]));
  const direct = related(graph, entity.id);
  const secondHopIds = new Set();
  for (const rel of direct) for (const next of related(graph, other(rel, entity.id))) secondHopIds.add(other(next, other(rel, entity.id)));
  secondHopIds.delete(entity.id);
  const files = [...new Set(direct.map((rel) => byId.get(other(rel, entity.id))).filter((item) => item?.type === "file").map((item) => item.path || item.name))];
  const symbols = direct.filter((rel) => rel.type === "DEFINES" || rel.type === "EXPORTS" || rel.type === "CONTAINS").map((rel) => byId.get(other(rel, entity.id))).filter((item) => item?.type === "symbol");
  const routes = direct.filter((rel) => rel.type === "DECLARES_ROUTE").map((rel) => byId.get(other(rel, entity.id))).filter(Boolean);
  const deps = direct.filter((rel) => rel.type === "IMPORTS" || rel.type === "DEPENDS_ON").map((rel) => byId.get(other(rel, entity.id))).filter(Boolean);
  const memory = direct.map((rel) => byId.get(other(rel, entity.id))).filter((item) => item?.type?.startsWith("memory_"));
  const affected = [...secondHopIds].map((id) => byId.get(id)).filter((item) => item?.type === "file").map((item) => item.path || item.name).slice(0, 25);
  return `# Impact Analysis

Target: ${entity.name}

## Entity

- Type: ${entity.type}
- Path: ${entity.path || "n/a"}

## Direct Relationships

${direct.slice(0, 50).map((rel) => `- ${rel.type} ${byId.get(other(rel, entity.id))?.name || other(rel, entity.id)}`).join("\n") || "None found."}

## Directly Related Files

${files.map((item) => `- ${item}`).join("\n") || "None found."}

## Symbols It Defines

${symbols.map((item) => `- ${item.name}`).join("\n") || "None found."}

## Routes It Declares

${routes.map((item) => `- ${item.name}`).join("\n") || "None found."}

## Imports / Dependencies

${deps.map((item) => `- ${item.name}`).join("\n") || "None found."}

## Related Memory

${memory.map((item) => `- ${item.name}`).join("\n") || "None found."}

## Potentially Affected

${affected.map((item) => `- ${item}`).join("\n") || "None found."}

## Suggested Agent Usage

Inspect the directly related files first before broad search.
`;
}

export function writeImpact(root, graph, target) {
  const content = buildImpactMarkdown(graph, target);
  writeFileAtomic(graphPath(root, "impact.md"), content);
  return content;
}
