import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const outputPath = path.join(projectRoot, ".tmp", "payload-manifest.json");
const runtimeNodeModulesSource = path.join(
  projectRoot,
  ".tmp",
  "runtime-node_modules",
  "node_modules"
);

const target = process.argv[2];

const runtimeSources = {
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

const targetSources = {
  windows: [],
  "mac-arm64": []
};

const requiredRuntimeFiles = {
  windows: [
    ".tmp/build-tools/windows-node-x64/node.exe",
    ".tmp/build-tools/windows-node-x64/nodew.exe"
  ],
  "mac-arm64": [".tmp/build-tools/macos-arm64-node/bin/node"]
};

const baseSources = [
  {
    source: "config",
    target: "config"
  },
  {
    source: "desktop/assets",
    target: "desktop/assets"
  },
  {
    source: "dist",
    target: "dist"
  },
  {
    source: "injections",
    target: "injections"
  },
  {
    source: path.relative(projectRoot, runtimeNodeModulesSource),
    target: "node_modules"
  },
  {
    source: "package.json",
    target: "package.json"
  },
  {
    source: "scripts",
    target: "scripts"
  }
];

function ensureExists(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing payload source: ${absolutePath}`);
  }
}

function readMode(absolutePath) {
  return fs.statSync(absolutePath).mode & 0o777;
}

function collectFiles(sourceRelativePath, targetRelativePath, entries) {
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

function buildPayloadManifest() {
  if (!runtimeSources[target]) {
    throw new Error(`Unsupported payload target "${target}". Use "windows" or "mac-arm64".`);
  }

  const sourcePaths = [...baseSources, ...runtimeSources[target], ...(targetSources[target] ?? [])];
  const requiredFiles = requiredRuntimeFiles[target] ?? [];

  for (const sourcePath of sourcePaths) {
    ensureExists(sourcePath.source);
  }

  for (const requiredFile of requiredFiles) {
    ensureExists(requiredFile);
  }

  const files = [];
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

function main() {
  const payload = buildPayloadManifest();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(`${outputPath}`, `${JSON.stringify(payload)}\n`, "utf8");
  console.log(`Wrote payload manifest for ${target} to ${outputPath}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
