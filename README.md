# Shopify Product / Collection Tools

A multi-store Shopify operations application that can run as a **Tauri desktop app** or as a **Vercel web panel**.

## Included modules

- Multi-store management with secure token storage
- Live dashboard
- Product import with preview, column mapping, validation, safe test, batch import, images, inventory, and metafields
- Product export to CSV, XLSX, and JSON
- Shopify hybrid collection import and export
- Price Manager
- Inventory Manager
- Customer Transfer
- Order Transfer
- Blog Transfer
- Discount Manager
- SKU Product Images
- Store Media Export
- Persistent activity history and reports
- Product and collection file templates
- Backup and restore without access tokens
- Diagnostics
- Per-store settings
- Windows and macOS installer build automation

## Desktop development

```bash
npm ci
npm run tauri dev
```

Desktop storage uses SQLite plus Windows Credential Manager/macOS Keychain for Shopify access tokens.

## Web / Vercel

The web adapter uses PostgreSQL/Neon for persistent data and encrypts Shopify access tokens before storage. The Vercel panel is protected by `PANEL_PASSWORD` and an HttpOnly session cookie.

See [VERCEL-SETUP.md](VERCEL-SETUP.md).

Recommended Vercel project name: `shopifytools` → `https://shopifytools.vercel.app` when available.

## Frontend validation

```bash
npm run build
```

## Installers

See [BUILD_INSTALLERS.md](BUILD_INSTALLERS.md).
