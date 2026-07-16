# Deno Desktop Hello World

This is an isolated Deno 2.9 desktop prototype. It has no imports, packages, or references to the existing application.

## Requirements

- Deno 2.9 or newer on the build machine
- Microsoft Edge WebView2 Runtime on the Windows machine (normally included with current Windows releases)

## Run locally

```sh
deno task start
```

## Build for Windows

```sh
deno task build:windows
```

The output is:

```text
dist/HelloWorld/
|-- HelloWorld.exe
`-- HelloWorld.dll
```

Run `HelloWorld.exe` on Windows. Keep `HelloWorld.dll` beside it in the same directory.

The app uses Deno Desktop's native WebView backend. This diagnostic build is intentionally uncompressed so startup does not depend on extraction into `%LOCALAPPDATA%`.

## Current Deno limitation

Deno Desktop 2.9 does not currently produce a single Windows `.exe` for the WebView backend. Its supported Windows outputs are an application directory or a single `.msi` installer. The application itself needs both `HelloWorld.exe` (the WebView launcher) and `HelloWorld.dll` (the Deno runtime and this source code).
