import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const stagingRoot = path.join(projectRoot, ".tmp", "runtime-node_modules");
const stagingNodeModulesDir = path.join(stagingRoot, "node_modules");

// These packages are only needed to build the runner UI into dist/.
const excludedTopLevelPackages = new Set(["react", "react-dom", "scheduler"]);

function ensureCleanDirectory(directoryPath) {
  fs.rmSync(directoryPath, { recursive: true, force: true });
  fs.mkdirSync(directoryPath, { recursive: true });
}

function listRuntimePackageDirectories() {
  const result = spawnSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], {
    cwd: projectRoot,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Failed to list production npm dependencies.");
  }

  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.filter((directoryPath) => directoryPath !== projectRoot);
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
