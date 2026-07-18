# Shopify Product Collection Upload Desktop

A local, multi-store Tauri desktop application for Hausone GmbH.

## Included modules

- Multi-store management with secure token storage
- Live dashboard
- Product import with preview, column mapping, validation, safe test, batch import, images, inventory, and metafields
- Product export to CSV, XLSX, and JSON
- Shopify 2026-07 hybrid collection import and export
- Persistent local activity history and reports
- Product and collection file templates
- Backup and restore without access tokens
- Diagnostics
- Per-store settings
- Windows and macOS installer build automation

## Development

```bash
npm ci
npm run tauri dev
```

## Frontend validation

```bash
npm run build
```

## Installers

See [BUILD_INSTALLERS.md](BUILD_INSTALLERS.md).

## Token safety

Shopify Admin API tokens are stored by the Rust backend in Windows Credential Manager or macOS Keychain. They are not stored in SQLite, source code, backup ZIP files, or generated installers.
