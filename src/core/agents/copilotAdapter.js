import { buildAgentContent } from "./shared.js";

export const copilotAdapter = {
  id: "copilot",
  name: "GitHub Copilot",
  outputPath: ".github/copilot-instructions.md",
  startMarker: "<!-- CODEX-TOKEN-SAVER:COPILOT:START -->",
  endMarker: "<!-- CODEX-TOKEN-SAVER:COPILOT:END -->",
  buildContent: (state) => buildAgentContent("GitHub Copilot", state)
};
