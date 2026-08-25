# Vercel Web Deployment

The same React interface can now run in two modes:

- **Desktop:** Tauri + local SQLite + Windows Credential Manager/macOS Keychain.
- **Web:** Vercel + PostgreSQL/Neon + encrypted Shopify tokens.

The web version keeps the existing modules: multi-store management, product import/export, collection import/export, price manager, inventory manager, customer/order/blog transfer, discount manager, product image tools, store media export, activity history, templates, backup/restore, diagnostics, and per-store settings.

## 1. Import the repository into Vercel

Create a new Vercel project from this repository and set the **Project Name** to:

`shopifytools`

If the name is available, the production address becomes:

`https://shopifytools.vercel.app`

Framework preset: **Vite**. Root directory: `./`.

## 2. Environment Variables

Add these to **Production and Preview**:

- `PANEL_PASSWORD` — password used to sign in to the web panel.
- `SECRET_KEY` — long random secret used to sign login sessions.
- `APP_ENCRYPTION_KEY` — long random secret used to encrypt Shopify Admin API tokens.
- `DATABASE_URL` — PostgreSQL connection string.

Do not put Shopify access tokens into Vercel environment variables. Add stores from the **Stores** page after deployment.

## 3. Database

You can connect the same Neon resource already used by another Shopify tool project. This application uses its own prefixed tables (`spc_stores`, `spc_settings`, `spc_history`), so it does not overwrite the other panel's tables.

In Vercel: **Marketplace / Storage → Neon → Connect a Project** and connect the `shopifytools` project. Use custom prefix `DATABASE` so Vercel creates `DATABASE_URL`.

## 4. Deploy

Deploy or redeploy after adding the environment variables. Open:

`https://shopifytools.vercel.app`

Sign in with `PANEL_PASSWORD`, open **Stores**, add a Shopify `*.myshopify.com` domain and its `shpat_...` Admin API token, then run **Test**.

## Security

- The web API never sends saved Shopify tokens back to the browser.
- Tokens are authenticated-encrypted before being saved in PostgreSQL.
- Backups intentionally exclude access tokens.
- API endpoints require a signed, HttpOnly, Secure session cookie.
- `SECRET_KEY` and `APP_ENCRYPTION_KEY` must be backed up securely. Changing `APP_ENCRYPTION_KEY` later makes previously stored tokens unreadable; re-enter tokens if you rotate it.

## Local web development

The normal Tauri development flow remains unchanged:

`npm run tauri dev`

For the Vercel web runtime, use Vercel CLI so `/api/bridge` and Python dependencies are available.
