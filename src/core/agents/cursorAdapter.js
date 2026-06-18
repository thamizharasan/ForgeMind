import { buildAgentContent } from "./shared.js";

export const cursorAdapter = {
  id: "cursor",
  name: "Cursor",
  outputPath: ".cursor/rules/forgemind.mdc",
  startMarker: "<!-- CODEX-TOKEN-SAVER:CURSOR:START -->",
  endMarker: "<!-- CODEX-TOKEN-SAVER:CURSOR:END -->",
  buildContent: (state) => buildAgentContent("Cursor", state)
};
