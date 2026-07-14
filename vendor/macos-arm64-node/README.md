Place an extracted macOS ARM64 Node.js runtime in this folder before running:

```bash
npm run package:mac:arm
```

Expected file:

```text
vendor/macos-arm64-node/bin/node
```

The Deno packaging step embeds this Node runtime directly into the final Apple Silicon binary, so end users do not install Node separately.
