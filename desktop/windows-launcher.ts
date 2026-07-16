import path from "node:path";

const launcherDir = path.dirname(Deno.execPath());
const appDir = path.join(launcherDir, "app");
const appExecutable = path.join(appDir, "runner.exe");

try {
  const child = new Deno.Command(appExecutable, {
    args: Deno.args,
    cwd: appDir,
    stdin: "null",
    stdout: "null",
    stderr: "null"
  }).spawn();

  child.unref();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await Deno.writeTextFile(
    path.join(appDir, "launcher-error.log"),
    `[${new Date().toISOString()}] ${message}\n`,
    { append: true, create: true }
  ).catch(() => {});
  Deno.exit(1);
}
