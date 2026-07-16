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
|-- HelloWorld.bat
`-- payload.tar.xz
```

Run `HelloWorld.bat` on Windows. It extracts and starts the Deno Desktop application.

The app uses Deno Desktop's native WebView backend. The compressed runtime payload is unpacked into the user's application-data directory on first launch and reused afterward.

## Current Deno limitation

Deno Desktop 2.9 does not currently produce a single Windows `.exe` for the WebView backend. Its supported Windows outputs are an application directory or a single `.msi` installer. The application itself needs both `HelloWorld.exe` (the WebView launcher) and `HelloWorld.dll` (the Deno runtime and this source code), which the compressed output packages behind the batch launcher.
