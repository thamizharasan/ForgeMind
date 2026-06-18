import { runContextClean, runContextDoctor, runContextIndex } from "../engine/index.js";

export class ContextService {
  index(root, options) {
    return runContextIndex(root, options);
  }

  doctor(root) {
    return runContextDoctor(root);
  }

  clean(root) {
    return runContextClean(root);
  }
}
