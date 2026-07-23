import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProjectRoot } from "./runtime-paths.js";
import { errorMessage, isJsonObject } from "./node-types.js";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = resolveProjectRoot(__dirname);
const stagingRoot = path.join(projectRoot, ".tmp", "packaged-runtime");

const nodeBundles: ReadonlyArray<readonly [string, string]> = [
  ["scripts/orchestrator.ts", "scripts/orchestrator.js"],
  ["injections/fe/server.ts", "injections/fe/server.js"],
  ["injections/be/server.ts", "injections/be/server.js"],
  ["injections/mqtt/server.ts", "injections/mqtt/server.js"]
];

function resolve(relativePath: string): string {
  return path.join(projectRoot, relativePath);
}

function resolveStaged(relativePath: string): string {
  return path.join(stagingRoot, relativePath);
}

function copyDirectory(relativePath: string): void {
  fs.cpSync(resolve(relativePath), resolveStaged(relativePath), {
    recursive: true
  });
}

function copyFile(relativePath: string): void {
  fs.copyFileSync(resolve(relativePath), resolveStaged(relativePath));
}

async function bundleNodeEntry(sourcePath: string, outputPath: string): Promise<void> {
  await build({
    entryPoints: [resolve(sourcePath)],
    outfile: resolveStaged(outputPath),
    bundle: true,
    minify: true,
    platform: "node",
    format: "esm",
    target: "node26",
    sourcemap: false,
    legalComments: "none",
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'
    }
  });
}

function readPackageMetadata(): { readonly name: string; readonly version: string } {
  const parsed: unknown = JSON.parse(fs.readFileSync(resolve("package.json"), "utf8"));
  if (
    !isJsonObject(parsed) ||
    typeof parsed.name !== "string" ||
    typeof parsed.version !== "string"
  ) {
    throw new Error("package.json is missing string name/version fields.");
  }

  return {
    name: parsed.name,
    version: parsed.version
  };
}

async function bundleFrontendAssets(): Promise<void> {
  const frontendDir = resolveStaged("injections/fe");
  fs.mkdirSync(frontendDir, { recursive: true });
  const minifiedHtml = fs
    .readFileSync(resolve("injections/fe/index.html"), "utf8")
    .replace(/<!--[^]*?-->/g, "")
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim();
  fs.writeFileSync(path.join(frontendDir, "index.html"), minifiedHtml, "utf8");

  await Promise.all([
    build({
      entryPoints: [resolve("injections/fe/app.ts")],
      outfile: path.join(frontendDir, "app.js"),
      bundle: true,
      minify: true,
      platform: "browser",
      format: "iife",
      target: "es2022",
      sourcemap: false,
      legalComments: "none"
    }),
    build({
      entryPoints: [resolve("injections/fe/styles.css")],
      outfile: path.join(frontendDir, "styles.css"),
      bundle: true,
      minify: true,
      sourcemap: false,
      legalComments: "none"
    })
  ]);
}

async function main(): Promise<void> {
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(stagingRoot, { recursive: true });

  copyDirectory("config");
  copyDirectory("dist");
  copyFile("version.json");
  const packageMetadata = readPackageMetadata();
  fs.writeFileSync(
    resolveStaged("package.json"),
    `${JSON.stringify({
      name: packageMetadata.name,
      version: packageMetadata.version,
      private: true,
      type: "module"
    })}\n`,
    "utf8"
  );

  await Promise.all([
    ...nodeBundles.map(([sourcePath, outputPath]) =>
      bundleNodeEntry(sourcePath, outputPath)
    ),
    bundleFrontendAssets()
  ]);

  console.log(`Prepared bundled runtime at ${stagingRoot}`);
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exit(1);
});
