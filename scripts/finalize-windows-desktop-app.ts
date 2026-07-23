import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProjectRoot } from "./runtime-paths.js";
import { errorMessage } from "./node-types.js";
import * as PELibrary from "pe-library";
import * as ResEdit from "resedit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = resolveProjectRoot(__dirname);
const simulatorPath = path.join(projectRoot, "release", "windows", "simulator", "simulator.exe");
const iconPath = path.join(projectRoot, "desktop", "assets", "app-icon.ico");
const temporarySimulatorPath = `${simulatorPath}.with-icon`;

function main(): void {
  if (!fs.existsSync(simulatorPath)) {
    throw new Error(`Missing Windows simulator executable at ${simulatorPath}`);
  }

  if (!fs.existsSync(iconPath)) {
    throw new Error(`Missing Windows application icon at ${iconPath}`);
  }

  const executable = PELibrary.NtExecutable.from(fs.readFileSync(simulatorPath));
  const resources = PELibrary.NtExecutableResource.from(executable);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));

  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    1,
    1033,
    iconFile.icons.map((item) => item.data)
  );
  resources.outputResource(executable);

  fs.writeFileSync(temporarySimulatorPath, Buffer.from(executable.generate()));
  fs.copyFileSync(temporarySimulatorPath, simulatorPath);
  fs.rmSync(temporarySimulatorPath, { force: true });
  console.log(`Embedded ${iconFile.icons.length} icon sizes into ${simulatorPath}`);
}

try {
  main();
} catch (error) {
  fs.rmSync(temporarySimulatorPath, { force: true });
  console.error(errorMessage(error));
  process.exit(1);
}
