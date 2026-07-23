import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveProjectRoot } from "./runtime-paths.js";
import { errorMessage } from "./node-types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = resolveProjectRoot(__dirname);
const sourceAppPath = "/tmp/simulator.app";
const destinationAppPath = path.join(projectRoot, "release", "mac", "simulator.app");
const destinationDmgPath = path.join(projectRoot, "release", "mac", "simulator.dmg");
const createDmg = process.argv.includes("--dmg");

function runCommand(
  commandName: string,
  args: ReadonlyArray<string>,
  failureMessage: string
): void {
  const result = spawnSync(commandName, args, {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    throw new Error(failureMessage);
  }
}

function stripExtendedAttributes(targetPath: string): void {
  runCommand("xattr", ["-cr", targetPath], `Failed to strip extended attributes from ${targetPath}`);
}

function signApp(targetPath: string): void {
  runCommand(
    "codesign",
    ["--force", "--deep", "--sign", "-", targetPath],
    `Failed to ad-hoc sign ${targetPath}`
  );
}

function createDiskImage(appPath: string): void {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "simulator-dmg-"));

  try {
    fs.cpSync(appPath, path.join(stagingDir, "simulator.app"), { recursive: true });
    fs.symlinkSync("/Applications", path.join(stagingDir, "Applications"));
    runCommand(
      "hdiutil",
      [
        "create",
        "-volname",
        "simulator",
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

function main(): void {
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
  console.error(errorMessage(error));
  process.exit(1);
}
