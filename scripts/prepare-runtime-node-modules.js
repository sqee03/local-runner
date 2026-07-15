import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const stagingRoot = path.join(projectRoot, ".tmp", "runtime-node_modules");
const stagingNodeModulesDir = path.join(stagingRoot, "node_modules");
const packageLockPath = path.join(projectRoot, "package-lock.json");

// These packages are only needed to build the runner UI into dist/.
const excludedTopLevelPackages = new Set(["react", "react-dom", "scheduler"]);

function ensureCleanDirectory(directoryPath) {
  fs.rmSync(directoryPath, { recursive: true, force: true });
  fs.mkdirSync(directoryPath, { recursive: true });
}

function readPackageLock() {
  if (!fs.existsSync(packageLockPath)) {
    throw new Error(`Missing package-lock.json at ${packageLockPath}`);
  }

  return JSON.parse(fs.readFileSync(packageLockPath, "utf8"));
}

function listRuntimePackageDirectories() {
  const packageLock = readPackageLock();
  const packages = packageLock.packages;

  if (!packages || typeof packages !== "object") {
    throw new Error("package-lock.json does not contain a packages map.");
  }

  return Object.entries(packages)
    .filter(([relativePath, metadata]) => {
      if (!relativePath || !relativePath.startsWith("node_modules/")) {
        return false;
      }

      if (metadata && typeof metadata === "object" && metadata.dev === true) {
        return false;
      }

      return fs.existsSync(path.join(projectRoot, relativePath));
    })
    .map(([relativePath]) => path.join(projectRoot, relativePath));
}

function toRepoRelativePath(absolutePath) {
  return path.relative(projectRoot, absolutePath).split(path.sep).join("/");
}

function topLevelPackageNameFromRelativeNodeModulesPath(relativePath) {
  const segments = relativePath.split("/");
  const nodeModulesIndex = segments.indexOf("node_modules");

  if (nodeModulesIndex === -1 || nodeModulesIndex + 1 >= segments.length) {
    return null;
  }

  const firstPackageSegment = segments[nodeModulesIndex + 1];
  if (firstPackageSegment.startsWith("@")) {
    return segments[nodeModulesIndex + 2]
      ? `${firstPackageSegment}/${segments[nodeModulesIndex + 2]}`
      : firstPackageSegment;
  }

  return firstPackageSegment;
}

function shouldExcludePackage(relativePath) {
  const topLevelPackageName = topLevelPackageNameFromRelativeNodeModulesPath(relativePath);
  return topLevelPackageName ? excludedTopLevelPackages.has(topLevelPackageName) : false;
}

function selectMinimalDirectories(packageDirectories) {
  const sorted = packageDirectories
    .map((directoryPath) => toRepoRelativePath(directoryPath))
    .filter((relativePath) => !shouldExcludePackage(relativePath))
    .sort((left, right) => left.length - right.length);

  const selected = [];

  for (const relativePath of sorted) {
    if (selected.some((parentPath) => relativePath === parentPath || relativePath.startsWith(`${parentPath}/`))) {
      continue;
    }

    selected.push(relativePath);
  }

  return selected;
}

function copyRuntimeDependencies(relativeDirectories) {
  ensureCleanDirectory(stagingRoot);
  fs.mkdirSync(stagingNodeModulesDir, { recursive: true });

  for (const relativeDirectory of relativeDirectories) {
    const sourcePath = path.join(projectRoot, relativeDirectory);
    const destinationPath = path.join(stagingRoot, relativeDirectory);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.cpSync(sourcePath, destinationPath, {
      recursive: true,
      dereference: false
    });
  }
}

function main() {
  const packageDirectories = listRuntimePackageDirectories();
  const selectedDirectories = selectMinimalDirectories(packageDirectories);

  if (selectedDirectories.length === 0) {
    throw new Error("No runtime package directories were found in package-lock.json.");
  }

  copyRuntimeDependencies(selectedDirectories);
  console.log(
    `Prepared runtime-only node_modules staging at ${stagingNodeModulesDir} with ${selectedDirectories.length} top-level copies.`
  );
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
