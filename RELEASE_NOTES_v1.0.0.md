# Shopify Product Collection Upload Desktop 1.0.0

## Included

- Local, serverless Tauri desktop application
- Multiple Shopify stores with active-store switching
- Shopify Admin API token storage in Windows Credential Manager / macOS Keychain
- Live dashboard and store connection testing
- Product import: CSV/XLS/XLSX/JSON preview, mapping, validation, safe test, images, metafields, inventory and batch transfer
- Product export: CSV/XLSX/JSON
- Shopify hybrid collection import/export using Admin GraphQL API 2026-07
- Persistent local activity history
- File templates
- Local backup and restore without Shopify tokens
- Diagnostics
- Per-store settings
- Native Windows NSIS setup EXE and MSI build configuration
- Native universal macOS application and DMG build configuration
- GitHub Actions workflow for both platforms

## Security

No Shopify access token is embedded in the source package or installers. Store tokens are entered after installation and saved in the operating system credential vault.

## Native installer builds

Windows installers must be built on Windows. macOS DMG/app bundles must be built on macOS. Use the included one-click scripts or the included GitHub Actions workflow. See `BUILD_INSTALLERS.md`.

## API versions

Product operations use the API version saved for each store. Hybrid collection operations use API version 2026-07 because the sources-based collection model is not available in 2026-04.
