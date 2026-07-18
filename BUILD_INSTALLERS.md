# Installer build guide

## What this project produces

- Windows: an NSIS `*-setup.exe` installer. An MSI can also be generated.
- macOS: a universal DMG that runs on Apple Silicon and Intel Macs, plus a zipped `.app` bundle.

The installed application runs as a normal desktop program. It stores local records in the operating system application-data directory and stores each Shopify Admin API token in Windows Credential Manager or macOS Keychain.

## Windows one-click build

Prerequisites:

1. Node.js 22 LTS.
2. Rust stable with the MSVC toolchain.
3. Visual Studio 2022 Build Tools with **Desktop development with C++**.
4. WebView2 Runtime, normally already present on current Windows versions.

Double-click:

```text
BUILD-WINDOWS.cmd
```

Output:

```text
installers\windows\Shopify Product Collection Upload_1.0.0_x64-setup.exe
```

PowerShell alternative:

```powershell
.\build-windows.ps1
```

To additionally build MSI:

```powershell
.\build-windows.ps1 -IncludeMsi
```

## macOS one-click build

Prerequisites:

1. A Mac with Xcode Command Line Tools.
2. Node.js 22 LTS.
3. Rust stable through rustup.

Double-click `BUILD-MAC.command`, or run:

```bash
./build-macos.sh
```

Output:

```text
installers/macos/*.dmg
installers/macos/*.app.zip
```

The local unsigned build uses an ad-hoc macOS signature. For public distribution without Gatekeeper warnings, add an Apple Developer ID certificate and notarization credentials.

## Build both platforms using GitHub Actions

1. Put this project in a private GitHub repository.
2. Open **Actions**.
3. Run **Build Windows and macOS installers**.
4. Download `windows-x64-installers` and `macos-universal-installer` from the workflow artifacts.

The workflow is in:

```text
.github/workflows/build-installers.yml
```

## Security

No Shopify token is included in the source code or installers. Add each store after installation from **Stores**. Because a token was shared in chat during development, rotate that token in Shopify after the first successful connection test.

## Shopify API versions

Product operations use the version saved for the store. Hybrid collection operations use Admin GraphQL API `2026-07`, because the sources-based collection model is unavailable in `2026-04` and older versions.
