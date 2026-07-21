import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as PELibrary from "pe-library";
import * as ResEdit from "resedit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const runnerPath = path.join(projectRoot, "release", "windows", "runner", "runner.exe");
const iconPath = path.join(projectRoot, "desktop", "assets", "app-icon.ico");
const temporaryRunnerPath = `${runnerPath}.with-icon`;

function main() {
  if (!fs.existsSync(runnerPath)) {
    throw new Error(`Missing Windows runner executable at ${runnerPath}`);
  }

  if (!fs.existsSync(iconPath)) {
    throw new Error(`Missing Windows application icon at ${iconPath}`);
  }

  const executable = PELibrary.NtExecutable.from(fs.readFileSync(runnerPath));
  const resources = PELibrary.NtExecutableResource.from(executable);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));

  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    1,
    1033,
    iconFile.icons.map((item) => item.data)
  );
  resources.outputResource(executable);

  fs.writeFileSync(temporaryRunnerPath, Buffer.from(executable.generate()));
  fs.copyFileSync(temporaryRunnerPath, runnerPath);
  fs.rmSync(temporaryRunnerPath, { force: true });
  console.log(`Embedded ${iconFile.icons.length} icon sizes into ${runnerPath}`);
}

try {
  main();
} catch (error) {
  fs.rmSync(temporaryRunnerPath, { force: true });
  console.error(error.message);
  process.exit(1);
}
