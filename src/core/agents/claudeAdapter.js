import { buildAgentContent } from "./shared.js";

export const claudeAdapter = {
  id: "claude",
  name: "Claude Code",
  outputPath: "CLAUDE.md",
  startMarker: "<!-- CODEX-TOKEN-SAVER:CLAUDE:START -->",
  endMarker: "<!-- CODEX-TOKEN-SAVER:CLAUDE:END -->",
  buildContent: (state) => buildAgentContent("Claude Code", state)
};
