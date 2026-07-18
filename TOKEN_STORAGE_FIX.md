# Token storage fix

The previous Cargo configuration used:

```toml
keyring = "3"
```

Keyring 3 has no native credential-store feature enabled by default. The app therefore used the non-persistent mock implementation. Version 1.0.1 uses:

```toml
keyring = { version = "3", features = ["apple-native", "windows-native"] }
```

This connects Windows builds to Windows Credential Manager and macOS builds to Keychain.

## GitHub replacement

Replace the existing repository contents with this complete project, or replace at minimum:

- `src-tauri/Cargo.toml`
- `src-tauri/src/lib.rs`
- `src-tauri/tauri.conf.json`
- `src/App.tsx`
- `package.json`
- `package-lock.json`
- `.github/workflows/build-installers.yml`

Commit, then start a new Actions workflow run. Download and install the new 1.0.1 installer. Open Stores, edit each store, enter its token, save, and run Test.
