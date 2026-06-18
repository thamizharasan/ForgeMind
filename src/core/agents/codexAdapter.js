import { buildAgentContent } from "./shared.js";

export const codexAdapter = {
  id: "codex",
  name: "Codex",
  outputPath: ".codex/AGENTS.md",
  startMarker: "<!-- FORGEMIND:CODEX:START -->",
  endMarker: "<!-- FORGEMIND:CODEX:END -->",
  buildContent: (state) => buildAgentContent("Codex", state)
};
