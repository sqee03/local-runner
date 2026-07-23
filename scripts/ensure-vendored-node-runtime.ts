import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveProjectRoot } from "./runtime-paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = resolveProjectRoot(__dirname);

const nodeVersion = "v26.1.0";
const target = process.argv[2];

const runtimeConfigs = {
  windows: {
    destinationDir: path.join(projectRoot, ".tmp", "build-tools", "windows-node-x64"),
    requiredFile: path.join(projectRoot, ".tmp", "build-tools", "windows-node-x64", "node.exe"),
    hiddenRuntimeFile: path.join(projectRoot, ".tmp", "build-tools", "windows-node-x64", "nodew.exe"),
    archiveFileName: `node-${nodeVersion}-win-x64.zip`,
    downloadUrl: `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-win-x64.zip`,
    extract(archivePath, destinationDir) {
      extractZipArchive(archivePath, destinationDir, "Windows Node runtime archive");
    },
    finalize(destinationDir) {
      flattenSingleExtractedDirectory(destinationDir);
      createWindowsGuiRuntime(
        path.join(destinationDir, "node.exe"),
        path.join(destinationDir, "nodew.exe")
      );
    }
  },
  "mac-arm64": {
    destinationDir: path.join(projectRoot, ".tmp", "build-tools", "macos-arm64-node"),
    requiredFile: path.join(projectRoot, ".tmp", "build-tools", "macos-arm64-node", "bin", "node"),
    archiveFileName: `node-${nodeVersion}-darwin-arm64.tar.gz`,
    downloadUrl: `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-darwin-arm64.tar.gz`,
    extract(archivePath, destinationDir) {
      ensureCommand("tar");
      const result = spawnSync("tar", ["-xzf", archivePath, "-C", destinationDir], {
        stdio: "inherit"
      });

      if (result.status !== 0) {
        throw new Error("Failed to extract macOS Node runtime archive.");
      }
    },
    finalize(destinationDir) {
      flattenSingleExtractedDirectory(destinationDir);
    }
  }
};

function ensureCommand(commandName) {
  const result = spawnSync(commandName, ["--version"], {
    stdio: "ignore"
  });

  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error(`Required command "${commandName}" is not available on PATH.`);
  }
}

function getAvailableCommand(commandNames) {
  for (const commandName of commandNames) {
    const result = spawnSync(commandName, ["-Command", "$PSVersionTable.PSVersion.ToString()"], {
      stdio: "ignore"
    });

    if (!result.error || (result.error as NodeJS.ErrnoException).code !== "ENOENT") {
      return commandName;
    }
  }

  return null;
}

function extractZipArchive(archivePath, destinationDir, label) {
  if (process.platform === "win32") {
    const powerShellCommand = getAvailableCommand(["powershell.exe", "powershell", "pwsh.exe", "pwsh"]);

    if (!powerShellCommand) {
      throw new Error(`Failed to extract ${label}: PowerShell is not available on PATH.`);
    }

    const escapedArchivePath = archivePath.replaceAll("'", "''");
    const escapedDestinationDir = destinationDir.replaceAll("'", "''");
    const command = `Expand-Archive -LiteralPath '${escapedArchivePath}' -DestinationPath '${escapedDestinationDir}' -Force`;

    const result = spawnSync(
      powerShellCommand,
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { stdio: "inherit" }
    );

    if (result.status !== 0) {
      throw new Error(`Failed to extract ${label}.`);
    }

    return;
  }

  ensureCommand("unzip");
  const result = spawnSync("unzip", ["-oq", archivePath, "-d", destinationDir], {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    throw new Error(`Failed to extract ${label}.`);
  }
}

function ensureCleanDirectory(directoryPath) {
  fs.rmSync(directoryPath, { recursive: true, force: true });
  fs.mkdirSync(directoryPath, { recursive: true });
}

function flattenSingleExtractedDirectory(directoryPath) {
  const childNames = fs
    .readdirSync(directoryPath)
    .filter((childName) => childName !== "README.md" && childName !== ".DS_Store");

  if (childNames.length !== 1) {
    return;
  }

  const extractedRoot = path.join(directoryPath, childNames[0]);
  if (!fs.statSync(extractedRoot).isDirectory()) {
    return;
  }

  for (const nestedName of fs.readdirSync(extractedRoot)) {
    fs.renameSync(path.join(extractedRoot, nestedName), path.join(directoryPath, nestedName));
  }

  fs.rmSync(extractedRoot, { recursive: true, force: true });
}

function createWindowsGuiRuntime(sourcePath, outputPath) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing Windows Node runtime at ${sourcePath}`);
  }

  const executable = fs.readFileSync(sourcePath);
  const peOffset = executable.readUInt32LE(0x3c);
  const peSignature = executable.toString("ascii", peOffset, peOffset + 4);

  if (peSignature !== "PE\u0000\u0000") {
    throw new Error(`Windows Node runtime is not a valid PE executable: ${sourcePath}`);
  }

  const optionalHeaderOffset = peOffset + 24;
  const subsystemOffset = optionalHeaderOffset + 68;
  const windowsGuiSubsystem = 2;

  executable.writeUInt16LE(windowsGuiSubsystem, subsystemOffset);
  fs.writeFileSync(outputPath, executable);
}

function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(outputPath);

    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "local-mqtt-app-runner/1.0"
        }
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          fileStream.close(() => {
            fs.rmSync(outputPath, { force: true });
            downloadFile(response.headers.location, outputPath).then(resolve, reject);
          });
          return;
        }

        if (response.statusCode !== 200) {
          fileStream.close(() => {
            fs.rmSync(outputPath, { force: true });
            reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode ?? "unknown"}`));
          });
          return;
        }

        response.pipe(fileStream);
        fileStream.on("finish", () => {
          fileStream.close(resolve);
        });
      }
    );

    request.on("error", (error) => {
      fileStream.close(() => {
        fs.rmSync(outputPath, { force: true });
        reject(error);
      });
    });
  });
}

async function ensureRuntime(runtimeTarget) {
  const config = runtimeConfigs[runtimeTarget];
  if (!config) {
    throw new Error(`Unsupported runtime target "${runtimeTarget}". Use "windows" or "mac-arm64".`);
  }

  if (fs.existsSync(config.requiredFile)) {
    console.log(`Using existing vendored Node runtime for ${runtimeTarget} at ${config.requiredFile}`);
    if (config.hiddenRuntimeFile && !fs.existsSync(config.hiddenRuntimeFile)) {
      createWindowsGuiRuntime(config.requiredFile, config.hiddenRuntimeFile);
      console.log(`Created hidden Windows Node runtime at ${config.hiddenRuntimeFile}`);
    }
    return;
  }

  const tempDir = path.join(projectRoot, ".tmp", `node-runtime-${runtimeTarget}`);
  const archivePath = path.join(tempDir, config.archiveFileName);

  fs.mkdirSync(tempDir, { recursive: true });
  console.log(`Downloading Node ${nodeVersion} for ${runtimeTarget}...`);
  await downloadFile(config.downloadUrl, archivePath);

  const readmePath = path.join(config.destinationDir, "README.md");
  const readmeContent = fs.existsSync(readmePath)
    ? fs.readFileSync(readmePath, "utf8")
    : null;

  ensureCleanDirectory(config.destinationDir);
  if (readmeContent !== null) {
    fs.writeFileSync(readmePath, readmeContent, "utf8");
  }

  config.extract(archivePath, config.destinationDir);
  config.finalize(config.destinationDir);

  if (!fs.existsSync(config.requiredFile)) {
    throw new Error(`Downloaded runtime is missing expected file: ${config.requiredFile}`);
  }

  if (runtimeTarget === "mac-arm64") {
    fs.chmodSync(config.requiredFile, 0o755);
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log(`Vendored Node runtime ready at ${config.requiredFile}`);
}

ensureRuntime(target).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
