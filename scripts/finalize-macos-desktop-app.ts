import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveProjectRoot } from "./runtime-paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = resolveProjectRoot(__dirname);
const sourceAppPath = "/tmp/runner.app";
const destinationAppPath = path.join(projectRoot, "release", "mac", "runner.app");
const destinationDmgPath = path.join(projectRoot, "release", "mac", "runner.dmg");
const createDmg = process.argv.includes("--dmg");

function runCommand(commandName, args, failureMessage) {
  const result = spawnSync(commandName, args, {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    throw new Error(failureMessage);
  }
}

function stripExtendedAttributes(targetPath) {
  runCommand("xattr", ["-cr", targetPath], `Failed to strip extended attributes from ${targetPath}`);
}

function signApp(targetPath) {
  runCommand(
    "codesign",
    ["--force", "--deep", "--sign", "-", targetPath],
    `Failed to ad-hoc sign ${targetPath}`
  );
}

function createDiskImage(appPath) {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-dmg-"));

  try {
    fs.cpSync(appPath, path.join(stagingDir, "runner.app"), { recursive: true });
    fs.symlinkSync("/Applications", path.join(stagingDir, "Applications"));
    runCommand(
      "hdiutil",
      [
        "create",
        "-volname",
        "runner",
        "-srcfolder",
        stagingDir,
        "-ov",
        "-format",
        "UDZO",
        destinationDmgPath
      ],
      `Failed to create macOS disk image at ${destinationDmgPath}`
    );
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function main() {
  if (!fs.existsSync(sourceAppPath)) {
    throw new Error(`Missing packaged Mac app at ${sourceAppPath}`);
  }

  fs.mkdirSync(path.dirname(destinationAppPath), { recursive: true });
  fs.rmSync(destinationAppPath, { recursive: true, force: true });
  fs.cpSync(sourceAppPath, destinationAppPath, {
    recursive: true
  });
  stripExtendedAttributes(destinationAppPath);
  signApp(destinationAppPath);
  fs.rmSync(sourceAppPath, { recursive: true, force: true });
  console.log(`Copied Mac desktop app to ${destinationAppPath}`);

  if (createDmg) {
    createDiskImage(destinationAppPath);
    console.log(`Created macOS disk image at ${destinationDmgPath}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
