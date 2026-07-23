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

export interface PayloadSource {
  readonly source: string;
  readonly target: string;
}

export interface PayloadFile {
  readonly path: string;
  readonly mode: number;
  readonly base64: string;
}

export interface PayloadManifest {
  readonly version: 1;
  readonly target: ReleaseTarget;
  readonly hash: string;
  readonly files: ReadonlyArray<PayloadFile>;
}

export interface PayloadManifestOptions {
  readonly projectRoot: string;
  readonly packagedRuntimeSource: string;
  readonly target: ReleaseTarget;
  readonly baseSources?: ReadonlyArray<PayloadSource>;
  readonly runtimeSources?: Partial<Record<ReleaseTarget, ReadonlyArray<PayloadSource>>>;
  readonly targetSources?: Partial<Record<ReleaseTarget, ReadonlyArray<PayloadSource>>>;
  readonly requiredRuntimeFiles?: Partial<Record<ReleaseTarget, ReadonlyArray<string>>>;
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

export function createBaseSources(
  rootPath: string,
  runtimeSourcePath: string
): ReadonlyArray<PayloadSource> {
  return [
  {
    source: path.relative(rootPath, path.join(runtimeSourcePath, "config")),
    target: "config"
  },
  {
    source: "desktop/assets",
    target: "desktop/assets"
  },
  {
    source: path.relative(rootPath, path.join(runtimeSourcePath, "dist")),
    target: "dist"
  },
  {
    source: path.relative(rootPath, path.join(runtimeSourcePath, "injections")),
    target: "injections"
  },
  {
    source: path.relative(rootPath, path.join(runtimeSourcePath, "package.json")),
    target: "package.json"
  },
  {
    source: path.relative(rootPath, path.join(runtimeSourcePath, "scripts")),
    target: "scripts"
  }
  ];
}

export function ensurePayloadSourceExists(rootPath: string, relativePath: string): void {
  const absolutePath = path.join(rootPath, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing payload source: ${absolutePath}`);
  }
}

export function readPayloadFileMode(absolutePath: string): number {
  return fs.statSync(absolutePath).mode & 0o777;
}

export function collectPayloadFiles(
  rootPath: string,
  sourceRelativePath: string,
  targetRelativePath: string,
  entries: PayloadFile[]
): void {
  const absolutePath = path.join(rootPath, sourceRelativePath);
  const stats = fs.statSync(absolutePath);

  if (stats.isDirectory()) {
    for (const childName of fs.readdirSync(absolutePath)) {
      collectPayloadFiles(
        rootPath,
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
    mode: readPayloadFileMode(absolutePath),
    base64: content.toString("base64")
  });
}

export function buildPayloadManifest(options: PayloadManifestOptions): PayloadManifest {
  const sourcePaths = [
    ...(options.baseSources ?? createBaseSources(options.projectRoot, options.packagedRuntimeSource)),
    ...(options.runtimeSources?.[options.target] ?? runtimeSources[options.target]),
    ...(options.targetSources?.[options.target] ?? targetSources[options.target])
  ];
  const requiredFiles = options.requiredRuntimeFiles?.[options.target] ?? requiredRuntimeFiles[options.target];

  for (const sourcePath of sourcePaths) {
    ensurePayloadSourceExists(options.projectRoot, sourcePath.source);
  }

  for (const requiredFile of requiredFiles) {
    ensurePayloadSourceExists(options.projectRoot, requiredFile);
  }

  const files: PayloadFile[] = [];
  for (const sourcePath of sourcePaths) {
    collectPayloadFiles(options.projectRoot, sourcePath.source, sourcePath.target, files);
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
    target: options.target,
    hash,
    files
  };
}

/* v8 ignore start */
function main(): void {
  if (target !== "windows" && target !== "mac-arm64") {
    throw new Error(`Unsupported payload target "${target}". Use "windows" or "mac-arm64".`);
  }

  const payload = buildPayloadManifest({
    projectRoot,
    packagedRuntimeSource,
    target
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(`${outputPath}`, `${JSON.stringify(payload)}\n`, "utf8");
  console.log(`Wrote payload manifest for ${target} to ${outputPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    main();
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(1);
  }
}
/* v8 ignore stop */
