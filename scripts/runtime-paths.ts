import fs from "node:fs";
import path from "node:path";

export function resolveProjectRoot(startDir: string): string {
  let currentDir = startDir;

  while (true) {
    if (
      fs.existsSync(path.join(currentDir, "package.json")) &&
      fs.existsSync(path.join(currentDir, "config"))
    ) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Unable to resolve project root from ${startDir}.`);
    }

    currentDir = parentDir;
  }
}
