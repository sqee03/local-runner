import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const releaseRoot = path.join(projectRoot, "release", "windows-x64");
const appRoot = path.join(releaseRoot, "app");
const runtimeRoot = path.join(releaseRoot, "runtime", "node");
const distDir = path.join(projectRoot, "dist");
const defaultWindowsNodeDir = path.join(projectRoot, "vendor", "windows-node-x64");
const windowsNodeDir = path.resolve(
  process.env.WINDOWS_NODE_RUNTIME_DIR ?? defaultWindowsNodeDir
);

function ensureExists(filePath, description) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${description}: ${filePath}`);
  }
}

function emptyDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDirectory(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    force: true,
    dereference: true
  });
}

function writeLauncher() {
  const launcherPath = path.join(releaseRoot, "PackageRunner.cmd");
  const content = `@echo off
setlocal
set "BASEDIR=%~dp0"
pushd "%BASEDIR%app"
"%BASEDIR%runtime\\node\\node.exe" "%BASEDIR%app\\scripts\\mvp-orchestrator.js"
set "EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %EXIT_CODE%
`;

  fs.writeFileSync(launcherPath, content, "utf8");
}

function copyRuntime() {
  const nodeExePath = path.join(windowsNodeDir, "node.exe");
  ensureExists(windowsNodeDir, "Windows Node runtime directory");
  ensureExists(nodeExePath, "Windows node.exe runtime");
  copyDirectory(windowsNodeDir, runtimeRoot);
}

function stageApplication() {
  const sources = [
    ["dist", distDir],
    ["config", path.join(projectRoot, "config")],
    ["injections", path.join(projectRoot, "injections")],
    ["scripts", path.join(projectRoot, "scripts")],
    ["node_modules", path.join(projectRoot, "node_modules")]
  ];

  for (const [name, source] of sources) {
    ensureExists(source, `${name} source`);
  }

  copyDirectory(distDir, path.join(appRoot, "dist"));
  copyDirectory(path.join(projectRoot, "config"), path.join(appRoot, "config"));
  copyDirectory(path.join(projectRoot, "injections"), path.join(appRoot, "injections"));
  copyDirectory(path.join(projectRoot, "scripts"), path.join(appRoot, "scripts"));
  copyDirectory(path.join(projectRoot, "node_modules"), path.join(appRoot, "node_modules"));
}

function maybeZipRelease() {
  const zipBinary = spawnSync("sh", ["-lc", "command -v zip"], {
    cwd: projectRoot,
    encoding: "utf8"
  });

  if (zipBinary.status !== 0) {
    console.warn("zip command not found. Skipping zip artifact creation.");
    return;
  }

  const zipPath = path.join(projectRoot, "release", "windows-x64.zip");
  fs.rmSync(zipPath, { force: true });

  const zipResult = spawnSync(
    "zip",
    ["-qr", zipPath, "windows-x64"],
    {
      cwd: path.join(projectRoot, "release"),
      stdio: "inherit"
    }
  );

  if (zipResult.status !== 0) {
    throw new Error("Failed to create windows-x64.zip artifact.");
  }
}

function main() {
  ensureExists(distDir, "runner dist build");
  ensureExists(path.join(projectRoot, "node_modules"), "installed node_modules");

  emptyDir(releaseRoot);
  fs.mkdirSync(appRoot, { recursive: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });

  stageApplication();
  copyRuntime();
  writeLauncher();
  maybeZipRelease();

  console.log(`Windows portable bundle staged at ${releaseRoot}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
