import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const taskName = process.argv[2];
const target = process.argv[3];
const stagedWindowsBackend = path.join(projectRoot, ".tmp", "windows-icon-backend");

const denoBinaries = {
  windows: path.join(projectRoot, ".tmp", "build-tools", "windows-deno-x64", "deno.exe"),
  "mac-arm64": path.join(projectRoot, ".tmp", "build-tools", "macos-arm64-deno", "deno")
};

const hostTarget = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac-arm64" : null;

if (!taskName) {
  throw new Error("Missing Deno task name.");
}

if (!target || !denoBinaries[target]) {
  throw new Error(`Unsupported Deno runtime target "${target ?? "<missing>"}".`);
}

function resolveDenoCommand() {
  if (hostTarget === target) {
    return denoBinaries[target];
  }

  const result = spawnSync("deno", ["--version"], {
    cwd: projectRoot,
    stdio: "ignore"
  });

  if (result.status === 0) {
    return "deno";
  }

  throw new Error(
    `Cross-target packaging for ${target} requires a host Deno installation because ${path.basename(denoBinaries[target])} cannot run on ${process.platform}.`
  );
}

const denoCommand = resolveDenoCommand();
const denoBinaryDir = denoCommand === "deno" ? null : path.dirname(denoCommand);
const inheritedPath = process.env.PATH ?? process.env.Path ?? "";
const composedPath = denoBinaryDir ? `${denoBinaryDir}${path.delimiter}${inheritedPath}` : inheritedPath;
const env = {
  ...process.env,
  PATH: composedPath,
  Path: composedPath
};

if (taskName === "compile:windows:installer") {
  if (!fs.existsSync(stagedWindowsBackend)) {
    throw new Error(
      `Missing staged Windows backend at ${stagedWindowsBackend}. Finalize the Windows bundle before compiling the installer.`
    );
  }

  env.LAUFEY_DEV_DIR = stagedWindowsBackend;
}

const result = spawnSync(denoCommand, ["task", taskName], {
  cwd: projectRoot,
  env,
  stdio: "inherit"
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
