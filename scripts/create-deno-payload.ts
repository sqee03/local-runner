import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolveProjectRoot } from "./runtime-paths.js";
import { type ReleaseTarget, errorMessage } from "./node-types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = resolveProjectRoot(__dirname);
const outputPath = path.join(projectRoot, ".tmp", "payload-manifest.json");
const packagedRuntimeSource = path.join(projectRoot, ".tmp", "packaged-runtime");

const target = process.argv[2];

interface PayloadSource {
  readonly source: string;
  readonly target: string;
}

interface PayloadFile {
  readonly path: string;
  readonly mode: number;
  readonly base64: string;
}

interface PayloadManifest {
  readonly version: 1;
  readonly target: ReleaseTarget;
  readonly hash: string;
  readonly files: ReadonlyArray<PayloadFile>;
}

const runtimeSources: Record<ReleaseTarget, ReadonlyArray<PayloadSource>> = {
  windows: [
    {
      source: ".tmp/build-tools/windows-node-x64/node.exe",
      target: "vendor/windows-node-x64/node.exe"
    },
    {
      source: ".tmp/build-tools/windows-node-x64/nodew.exe",
      target: "vendor/windows-node-x64/nodew.exe"
    }
  ],
  "mac-arm64": [
    {
      source: ".tmp/build-tools/macos-arm64-node/bin/node",
      target: "vendor/macos-arm64-node/bin/node"
    }
  ]
};

const targetSources: Record<ReleaseTarget, ReadonlyArray<PayloadSource>> = {
  windows: [],
  "mac-arm64": []
};

const requiredRuntimeFiles: Record<ReleaseTarget, ReadonlyArray<string>> = {
  windows: [
    ".tmp/build-tools/windows-node-x64/node.exe",
    ".tmp/build-tools/windows-node-x64/nodew.exe"
  ],
  "mac-arm64": [".tmp/build-tools/macos-arm64-node/bin/node"]
};

const baseSources: ReadonlyArray<PayloadSource> = [
  {
    source: path.relative(projectRoot, path.join(packagedRuntimeSource, "config")),
    target: "config"
  },
  {
    source: "desktop/assets",
    target: "desktop/assets"
  },
  {
    source: path.relative(projectRoot, path.join(packagedRuntimeSource, "dist")),
    target: "dist"
  },
  {
    source: path.relative(projectRoot, path.join(packagedRuntimeSource, "injections")),
    target: "injections"
  },
  {
    source: path.relative(projectRoot, path.join(packagedRuntimeSource, "package.json")),
    target: "package.json"
  },
  {
    source: path.relative(projectRoot, path.join(packagedRuntimeSource, "scripts")),
    target: "scripts"
  }
];

function ensureExists(relativePath: string): void {
  const absolutePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing payload source: ${absolutePath}`);
  }
}

function readMode(absolutePath: string): number {
  return fs.statSync(absolutePath).mode & 0o777;
}

function collectFiles(
  sourceRelativePath: string,
  targetRelativePath: string,
  entries: PayloadFile[]
): void {
  const absolutePath = path.join(projectRoot, sourceRelativePath);
  const stats = fs.statSync(absolutePath);

  if (stats.isDirectory()) {
    for (const childName of fs.readdirSync(absolutePath)) {
      collectFiles(
        path.join(sourceRelativePath, childName),
        path.join(targetRelativePath, childName),
        entries
      );
    }
    return;
  }

  const content = fs.readFileSync(absolutePath);
  entries.push({
    path: targetRelativePath.split(path.sep).join("/"),
    mode: readMode(absolutePath),
    base64: content.toString("base64")
  });
}

function isReleaseTarget(value: string | undefined): value is ReleaseTarget {
  return value === "windows" || value === "mac-arm64";
}

function buildPayloadManifest(): PayloadManifest {
  if (!isReleaseTarget(target)) {
    throw new Error(`Unsupported payload target "${target}". Use "windows" or "mac-arm64".`);
  }

  const sourcePaths = [...baseSources, ...runtimeSources[target], ...targetSources[target]];
  const requiredFiles = requiredRuntimeFiles[target];

  for (const sourcePath of sourcePaths) {
    ensureExists(sourcePath.source);
  }

  for (const requiredFile of requiredFiles) {
    ensureExists(requiredFile);
  }

  const files: PayloadFile[] = [];
  for (const sourcePath of sourcePaths) {
    collectFiles(sourcePath.source, sourcePath.target, files);
  }

  files.sort((left, right) => left.path.localeCompare(right.path));

  const hash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        files.map((file) => ({
          path: file.path,
          mode: file.mode,
          base64: file.base64
        }))
      )
    )
    .digest("hex")
    .slice(0, 16);

  return {
    version: 1,
    target,
    hash,
    files
  };
}

function main(): void {
  const payload = buildPayloadManifest();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(`${outputPath}`, `${JSON.stringify(payload)}\n`, "utf8");
  console.log(`Wrote payload manifest for ${target} to ${outputPath}`);
}

try {
  main();
} catch (error) {
  console.error(errorMessage(error));
  process.exit(1);
}
