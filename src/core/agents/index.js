import { claudeAdapter } from "./claudeAdapter.js";
import { codexAdapter } from "./codexAdapter.js";
import { copilotAdapter } from "./copilotAdapter.js";
import { cursorAdapter } from "./cursorAdapter.js";

export const agentAdapters = [codexAdapter, cursorAdapter, claudeAdapter, copilotAdapter];
export const agentAdapterById = new Map(agentAdapters.map((adapter) => [adapter.id, adapter]));

export function getAgentAdapter(id) {
  return agentAdapterById.get(id);
}
