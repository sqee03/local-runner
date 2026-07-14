Place an extracted Windows x64 Node.js runtime in this folder before running:

```bash
npm run package:windows
```

Expected file:

```text
vendor/windows-node-x64/node.exe
```

The Deno packaging step embeds this `node.exe` directly into the final `PackageRunner.exe`, so end users do not install Node separately.
