import { buildAgentContent } from "./shared.js";

export const cursorAdapter = {
  id: "cursor",
  name: "Cursor",
  outputPath: ".cursor/rules/forgemind.mdc",
  startMarker: "<!-- FORGEMIND:CURSOR:START -->",
  endMarker: "<!-- FORGEMIND:CURSOR:END -->",
  buildContent: (state) => buildAgentContent("Cursor", state)
};
