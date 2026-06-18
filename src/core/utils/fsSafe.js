import fs from "node:fs";
import path from "node:path";

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function fileExists(file) {
  return fs.existsSync(file);
}

export function writeFileAtomic(file, content) {
  ensureDir(path.dirname(file));
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temp, content, "utf8");
  fs.renameSync(temp, file);
}

export function writeFileForce(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content, "utf8");
}

export function writeFileIfMissing(file, content) {
  if (fileExists(file)) return false;
  writeFileForce(file, content);
  return true;
}
