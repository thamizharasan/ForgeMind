import { runGlobalDoctor, runGlobalSetup } from "../engine/global.js";
import { runProjectUpgrade } from "../engine/upgrade.js";

export class AgentService {
  setupGlobal() {
    return runGlobalSetup();
  }

  doctorGlobal() {
    return runGlobalDoctor();
  }

  upgradeProject(root) {
    return runProjectUpgrade(root);
  }
}
