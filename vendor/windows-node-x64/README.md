This folder is populated automatically when you run:

```bash
npm run package:windows
```

The Deno packaging step embeds this `node.exe` directly into the final `PackageRunner.exe`, so end users do not install Node separately.
