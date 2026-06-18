import { buildAgentContent } from "./shared.js";

export const codexAdapter = {
  id: "codex",
  name: "Codex",
  outputPath: ".codex/AGENTS.md",
  startMarker: "<!-- CODEX-TOKEN-SAVER:CODEX:START -->",
  endMarker: "<!-- CODEX-TOKEN-SAVER:CODEX:END -->",
  buildContent: (state) => buildAgentContent("Codex", state)
};
