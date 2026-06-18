import { collectFiles, getWatchDirs, isIgnoredPath, isIgnoredWorkspacePath } from "../engine/index.js";

export class RepositoryService {
  collectFiles(root, options) {
    return collectFiles(root, options);
  }

  getWatchDirs(root) {
    return getWatchDirs(root);
  }

  isIgnoredPath(relativePath) {
    return isIgnoredPath(relativePath);
  }

  isIgnoredWorkspacePath(root, file) {
    return isIgnoredWorkspacePath(root, file);
  }
}
