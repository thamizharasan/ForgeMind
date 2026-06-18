import { runProjectUpgrade } from "../engine/upgrade.js";

export class AgentService {
  upgradeProject(root) {
    return runProjectUpgrade(root);
  }
}
