import fs from "node:fs";
import path from "node:path";
import { GRAPH_SCHEMA_VERSION, ENTITY_TYPES, RELATIONSHIP_TYPES } from "./graphTypes.js";
import { MEMORY_FILES, storageDisplayPath, storagePath } from "../utils/config.js";

function toDisplayPath(file) {
  return file.split(path.sep).join("/");
}

function entityId(type, name) {
  return `${type}:${String(name).replace(/\\/g, "/")}`;
}

function addEntity(map, entity) {
  if (!entity?.id || map.has(entity.id)) return;
  map.set(entity.id, { metadata: {}, ...entity, metadata: entity.metadata || {} });
}

function relationshipKey(relationship) {
  return `${relationship.from}\0${relationship.type}\0${relationship.to}`;
}

function addRelationship(map, relationship) {
  if (!relationship.from || !relationship.to || !relationship.type) return;
  const key = relationshipKey(relationship);
  if (!map.has(key)) map.set(key, { metadata: {}, ...relationship, metadata: relationship.metadata || {} });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function redactText(value) {
  return String(value)
    .replace(/(^|[\\/\s"'`])(?:\.env(?:\.[^\s"'`]*)?|id_rsa|id_ed25519|[^\\/\s"'`]+\.(?:pem|key))(?=$|[\s"'`,.])/g, "$1[redacted secret file]")
    .replace(/\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)\s*=\s*[^\s]+/g, "[redacted secret]")
    .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_=-]{12,}\b/g, "[redacted secret]");
}

function memorySummary(section) {
  return redactText(section)
    .split(/\r?\n/)
    .filter((line) => !/^\s*```/.test(line))
    .filter((line) => !/^\s*(?:export|import|const|let|var|function|class|def)\b/.test(line))
    .slice(0, 20)
    .join(" ");
}

function readMemoryEntries(root) {
  const entries = [];
  const typeByFile = {
    "sessions.md": ENTITY_TYPES.MEMORY_SESSION,
    "decisions.md": ENTITY_TYPES.MEMORY_DECISION,
    "failures.md": ENTITY_TYPES.MEMORY_FAILURE,
    "fixes.md": ENTITY_TYPES.MEMORY_FIX,
    "rationale.md": ENTITY_TYPES.MEMORY_FIX
  };
  for (const file of MEMORY_FILES) {
    const full = storagePath(root, "memory", file);
    if (!fs.existsSync(full)) continue;
    const content = fs.readFileSync(full, "utf8");
    const sections = content.split(/\n(?=##\s+)/).filter((section) => section.trim().startsWith("## "));
    sections.forEach((section, index) => {
      if (/\nCommand:\s/.test(section)) return;
      const title = section.split(/\r?\n/, 1)[0].replace(/^##\s+/, "").trim();
      entries.push({
        id: entityId(typeByFile[file], `${file}#${index + 1}`),
        type: typeByFile[file],
        name: redactText(title || `${file} ${index + 1}`),
        path: storageDisplayPath("memory", file),
        text: memorySummary(section).slice(0, 1000)
      });
    });
  }
  return entries;
}

function mentions(text, value) {
  if (!text || !value) return false;
  return text.toLowerCase().includes(String(value).toLowerCase());
}

function memoryRelationType(type) {
  if (type === ENTITY_TYPES.MEMORY_DECISION) return RELATIONSHIP_TYPES.DECISION_RELATES_TO;
  if (type === ENTITY_TYPES.MEMORY_FAILURE) return RELATIONSHIP_TYPES.FAILURE_RELATES_TO;
  if (type === ENTITY_TYPES.MEMORY_FIX) return RELATIONSHIP_TYPES.FIX_RELATES_TO;
  return RELATIONSHIP_TYPES.MENTIONS;
}

export function buildGraphFromIndex(root) {
  const indexPath = storagePath(root, "context", "index.json");
  if (!fs.existsSync(indexPath)) throw new Error("Context index not found. Run `forgemind index` first.");
  const index = readJson(indexPath);
  const entities = new Map();
  const relationships = new Map();
  const files = Array.isArray(index.files) ? index.files : [];

  for (const file of files) {
    const fileId = entityId(ENTITY_TYPES.FILE, file.path);
    const moduleName = file.path.includes("/") ? file.path.split("/").slice(0, -1).join("/") : ".";
    const moduleId = entityId(ENTITY_TYPES.MODULE, moduleName);
    addEntity(entities, { id: fileId, type: ENTITY_TYPES.FILE, name: file.path, path: file.path, metadata: { ext: file.ext, importanceScore: file.importanceScore || 0 } });
    addEntity(entities, { id: moduleId, type: ENTITY_TYPES.MODULE, name: moduleName, path: moduleName, metadata: {} });
    addRelationship(relationships, { from: moduleId, type: RELATIONSHIP_TYPES.CONTAINS, to: fileId, metadata: { source: "index" } });

    for (const item of file.imports || []) {
      const depId = entityId(ENTITY_TYPES.DEPENDENCY, item);
      addEntity(entities, { id: depId, type: ENTITY_TYPES.DEPENDENCY, name: item, metadata: {} });
      addRelationship(relationships, { from: fileId, type: RELATIONSHIP_TYPES.IMPORTS, to: depId, metadata: { source: "index" } });
      addRelationship(relationships, { from: fileId, type: RELATIONSHIP_TYPES.DEPENDS_ON, to: depId, metadata: { source: "index" } });
    }
    for (const item of file.exports || []) {
      const symbolId = entityId(ENTITY_TYPES.SYMBOL, item);
      addEntity(entities, { id: symbolId, type: ENTITY_TYPES.SYMBOL, name: item, metadata: {} });
      addRelationship(relationships, { from: fileId, type: RELATIONSHIP_TYPES.EXPORTS, to: symbolId, metadata: { source: "index" } });
    }
    for (const item of file.symbols || []) {
      const symbolId = entityId(ENTITY_TYPES.SYMBOL, item.name);
      addEntity(entities, { id: symbolId, type: ENTITY_TYPES.SYMBOL, name: item.name, metadata: { kind: item.type || "symbol", line: item.line } });
      addRelationship(relationships, { from: fileId, type: RELATIONSHIP_TYPES.DEFINES, to: symbolId, metadata: { source: "index" } });
      addRelationship(relationships, { from: fileId, type: RELATIONSHIP_TYPES.CONTAINS, to: symbolId, metadata: { source: "index" } });
    }
    for (const item of file.routes || file.routeHints || []) {
      const routePath = item.path || item.route;
      if (!routePath) continue;
      const routeName = `${item.method ? `${item.method} ` : ""}${routePath}`;
      const routeId = entityId(ENTITY_TYPES.ROUTE, routeName);
      addEntity(entities, { id: routeId, type: ENTITY_TYPES.ROUTE, name: routeName, path: routePath, metadata: { method: item.method || "", kind: item.kind || "" } });
      addRelationship(relationships, { from: fileId, type: RELATIONSHIP_TYPES.DECLARES_ROUTE, to: routeId, metadata: { source: "index" } });
    }
  }

  const memoryEntries = readMemoryEntries(root);
  const linkTargets = [...entities.values()].filter((entity) => [ENTITY_TYPES.FILE, ENTITY_TYPES.SYMBOL, ENTITY_TYPES.DEPENDENCY, ENTITY_TYPES.ROUTE].includes(entity.type));
  for (const entry of memoryEntries) {
    addEntity(entities, { id: entry.id, type: entry.type, name: entry.name, path: entry.path, metadata: { summary: entry.text } });
    for (const target of linkTargets) {
      if (mentions(entry.text, target.name) || mentions(entry.text, target.path)) {
        addRelationship(relationships, { from: entry.id, type: memoryRelationType(entry.type), to: target.id, metadata: { source: "memory" } });
      }
    }
  }

  const entityList = [...entities.values()].sort((a, b) => a.id.localeCompare(b.id));
  const relationshipList = [...relationships.values()].sort((a, b) => relationshipKey(a).localeCompare(relationshipKey(b)));
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    generatedAt: index.generatedAt || "",
    sourceIndexGeneratedAt: index.generatedAt || "",
    entityCount: entityList.length,
    relationshipCount: relationshipList.length,
    entities: entityList,
    relationships: relationshipList
  };
}
