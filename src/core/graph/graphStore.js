import fs from "node:fs";
import path from "node:path";
import { storagePath } from "../utils/config.js";
import { writeFileAtomic } from "../utils/fsSafe.js";

export function graphDir(root) {
  return storagePath(root, "graph");
}

export function graphPath(root, file) {
  return path.join(graphDir(root), file);
}

export function readGraph(root) {
  const file = graphPath(root, "graph.json");
  if (!fs.existsSync(file)) throw new Error("Knowledge graph not found. Run `forgemind graph build` first.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function countType(graph, type) {
  return graph.entities.filter((entity) => entity.type === type).length;
}

function mostConnectedFiles(graph) {
  const counts = new Map();
  for (const rel of graph.relationships) {
    for (const id of [rel.from, rel.to]) if (id.startsWith("file:")) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([id, count]) => `- ${id.slice(5)} (${count})`);
}

export function graphMarkdown(graph) {
  const byId = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const routes = graph.relationships
    .filter((rel) => rel.type === "DECLARES_ROUTE")
    .slice(0, 50)
    .map((rel) => `- ${byId.get(rel.to)?.name || rel.to} -> ${byId.get(rel.from)?.name || rel.from}`);
  const dependencies = graph.relationships
    .filter((rel) => rel.type === "IMPORTS" || rel.type === "DEPENDS_ON")
    .slice(0, 50)
    .map((rel) => `- ${byId.get(rel.to)?.name || rel.to} -> ${byId.get(rel.from)?.name || rel.from}`);
  const memory = graph.relationships
    .filter((rel) => rel.type.endsWith("_RELATES_TO") || rel.type === "MENTIONS")
    .slice(0, 40)
    .map((rel) => `- ${byId.get(rel.from)?.name || rel.from} -> ${byId.get(rel.to)?.name || rel.to}`);
  return `# Repository Knowledge Graph

Generated: ${graph.generatedAt}

## Overview

- Entities: ${graph.entityCount}
- Relationships: ${graph.relationshipCount}
- Files: ${countType(graph, "file")}
- Symbols: ${countType(graph, "symbol")}
- Routes: ${countType(graph, "route")}
- Dependencies: ${countType(graph, "dependency")}
- Memory items: ${graph.entities.filter((entity) => entity.type.startsWith("memory_")).length}

## Most Connected Files

${mostConnectedFiles(graph).join("\n") || "None found."}

## Routes

${routes.join("\n") || "None found."}

## Dependencies

${dependencies.join("\n") || "None found."}

## Memory Links

${memory.join("\n") || "None found."}
`;
}

export function writeGraphArtifacts(root, graph) {
  const dir = graphDir(root);
  const artifacts = {
    "graph.json": JSON.stringify(graph, null, 2),
    "graph.md": graphMarkdown(graph)
  };
  let written = 0;
  for (const [file, content] of Object.entries(artifacts)) {
    const target = path.join(dir, file);
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (current !== content) {
      writeFileAtomic(target, content);
      written += 1;
    }
  }
  return { artifacts: Object.keys(artifacts).length, written };
}
