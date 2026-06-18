import { buildAgentContent } from "./shared.js";

export const claudeAdapter = {
  id: "claude",
  name: "Claude Code",
  outputPath: "CLAUDE.md",
  startMarker: "<!-- FORGEMIND:CLAUDE:START -->",
  endMarker: "<!-- FORGEMIND:CLAUDE:END -->",
  buildContent: (state) => buildAgentContent("Claude Code", state)
};
