import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveProjectRoot } from "./runtime-paths.js";
import {
  type ReleaseTarget,
  errorMessage,
  isReleaseTarget
} from "./node-types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = resolveProjectRoot(__dirname);

const denoVersion = "v2.9.2";
const target = process.argv[2];

interface RuntimeConfig {
  readonly destinationDir: string;
  readonly requiredFile: string;
  readonly archiveFileName: string;
  readonly downloadUrl: string;
  extract(archivePath: string, destinationDir: string): void;
}

const runtimeConfigs: Record<ReleaseTarget, RuntimeConfig> = {
  windows: {
    destinationDir: path.join(projectRoot, ".tmp", "build-tools", "windows-deno-x64"),
    requiredFile: path.join(projectRoot, ".tmp", "build-tools", "windows-deno-x64", "deno.exe"),
    archiveFileName: `deno-x86_64-pc-windows-msvc.zip`,
    downloadUrl: `https://github.com/denoland/deno/releases/download/${denoVersion}/deno-x86_64-pc-windows-msvc.zip`,
    extract(archivePath: string, destinationDir: string): void {
      extractZipArchive(archivePath, destinationDir, "Windows Deno runtime archive");
    }
  },
  "mac-arm64": {
    destinationDir: path.join(projectRoot, ".tmp", "build-tools", "macos-arm64-deno"),
    requiredFile: path.join(projectRoot, ".tmp", "build-tools", "macos-arm64-deno", "deno"),
    archiveFileName: `deno-aarch64-apple-darwin.zip`,
    downloadUrl: `https://github.com/denoland/deno/releases/download/${denoVersion}/deno-aarch64-apple-darwin.zip`,
    extract(archivePath: string, destinationDir: string): void {
      extractZipArchive(archivePath, destinationDir, "macOS Deno runtime archive");
    }
  }
};

function ensureCommand(commandName: string): void {
  const result = spawnSync(commandName, ["--version"], {
    stdio: "ignore"
  });

  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error(`Required command "${commandName}" is not available on PATH.`);
  }
}

function getAvailablePowerShell(): string | null {
  for (const commandName of ["powershell.exe", "powershell", "pwsh.exe", "pwsh"]) {
    const result = spawnSync(commandName, ["-Command", "$PSVersionTable.PSVersion.ToString()"], {
      stdio: "ignore"
    });

    if (!result.error || (result.error as NodeJS.ErrnoException).code !== "ENOENT") {
      return commandName;
    }
  }

  return null;
}

function extractZipArchive(archivePath: string, destinationDir: string, label: string): void {
  if (process.platform === "win32") {
    const powerShellCommand = getAvailablePowerShell();

    if (!powerShellCommand) {
      throw new Error(`Failed to extract ${label}: PowerShell is not available on PATH.`);
    }

    const escapedArchivePath = archivePath.replaceAll("'", "''");
    const escapedDestinationDir = destinationDir.replaceAll("'", "''");
    const command = `Expand-Archive -LiteralPath '${escapedArchivePath}' -DestinationPath '${escapedDestinationDir}' -Force`;
    const result = spawnSync(powerShellCommand, ["-NoProfile", "-NonInteractive", "-Command", command], {
      stdio: "inherit"
    });

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

function ensureCleanDirectory(directoryPath: string): void {
  fs.rmSync(directoryPath, { recursive: true, force: true });
  fs.mkdirSync(directoryPath, { recursive: true });
}

function downloadFile(url: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(outputPath);

    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "local-mqtt-app-simulator/1.0"
        }
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const redirectUrl = response.headers.location;
          fileStream.close(() => {
            fs.rmSync(outputPath, { force: true });
            downloadFile(redirectUrl, outputPath).then(resolve, reject);
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
          fileStream.close(() => resolve());
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

async function ensureRuntime(runtimeTarget: string | undefined): Promise<void> {
  if (!isReleaseTarget(runtimeTarget)) {
    throw new Error(`Unsupported Deno runtime target "${runtimeTarget}". Use "windows" or "mac-arm64".`);
  }
  const config = runtimeConfigs[runtimeTarget];

  if (fs.existsSync(config.requiredFile)) {
    console.log(`Using existing vendored Deno runtime for ${runtimeTarget} at ${config.requiredFile}`);
    return;
  }

  const tempDir = path.join(projectRoot, ".tmp", `deno-runtime-${runtimeTarget}`);
  const archivePath = path.join(tempDir, config.archiveFileName);

  fs.mkdirSync(tempDir, { recursive: true });
  console.log(`Downloading Deno ${denoVersion} for ${runtimeTarget}...`);
  await downloadFile(config.downloadUrl, archivePath);

  ensureCleanDirectory(config.destinationDir);
  config.extract(archivePath, config.destinationDir);

  if (!fs.existsSync(config.requiredFile)) {
    throw new Error(`Downloaded Deno runtime is missing expected file: ${config.requiredFile}`);
  }

  if (runtimeTarget === "mac-arm64") {
    fs.chmodSync(config.requiredFile, 0o755);
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log(`Vendored Deno runtime ready at ${config.requiredFile}`);
}

ensureRuntime(target).catch((error) => {
  console.error(errorMessage(error));
  process.exit(1);
});
