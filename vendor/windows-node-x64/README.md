Place an extracted Windows x64 Node.js runtime in this folder before running:

```bash
npm run package:windows
```

Expected file:

```text
vendor/windows-node-x64/node.exe
```

You can also point the packaging script at a different extracted Windows Node runtime with:

```bash
WINDOWS_NODE_RUNTIME_DIR=/absolute/path/to/node-win-x64 npm run package:windows
```
