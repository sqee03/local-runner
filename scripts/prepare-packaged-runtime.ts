import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProjectRoot } from "./runtime-paths.js";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = resolveProjectRoot(__dirname);
const stagingRoot = path.join(projectRoot, ".tmp", "packaged-runtime");

const nodeBundles = [
  ["scripts/mvp-orchestrator.ts", "scripts/mvp-orchestrator.js"],
  ["injections/fe/server.ts", "injections/fe/server.js"],
  ["injections/be/server.ts", "injections/be/server.js"],
  ["injections/mqtt/server.ts", "injections/mqtt/server.js"]
];

function resolve(relativePath) {
  return path.join(projectRoot, relativePath);
}

function resolveStaged(relativePath) {
  return path.join(stagingRoot, relativePath);
}

function copyDirectory(relativePath) {
  fs.cpSync(resolve(relativePath), resolveStaged(relativePath), {
    recursive: true
  });
}

function copyFile(relativePath) {
  fs.copyFileSync(resolve(relativePath), resolveStaged(relativePath));
}

async function bundleNodeEntry(sourcePath, outputPath) {
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

async function bundleFrontendAssets() {
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

async function main() {
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(stagingRoot, { recursive: true });

  copyDirectory("config");
  copyDirectory("dist");
  copyFile("version.json");
  const packageMetadata = JSON.parse(fs.readFileSync(resolve("package.json"), "utf8"));
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
  console.error(error.message);
  process.exit(1);
});
