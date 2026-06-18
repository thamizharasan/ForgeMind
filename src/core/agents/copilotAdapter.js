import { buildAgentContent } from "./shared.js";

export const copilotAdapter = {
  id: "copilot",
  name: "GitHub Copilot",
  outputPath: ".github/copilot-instructions.md",
  startMarker: "<!-- FORGEMIND:COPILOT:START -->",
  endMarker: "<!-- FORGEMIND:COPILOT:END -->",
  buildContent: (state) => buildAgentContent("GitHub Copilot", state)
};
