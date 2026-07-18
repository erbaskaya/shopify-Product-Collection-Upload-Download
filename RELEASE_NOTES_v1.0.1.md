# Shopify Product Collection Upload Desktop 1.0.1

## Fixed

- Access tokens now persist in Windows Credential Manager.
- Access tokens now persist in macOS Keychain.
- Store saving verifies that the token can be read back immediately.
- Token errors now include the underlying credential-vault error.
- Existing multi-store metadata, settings, and activity history remain compatible.

## Upgrade note

Version 1.0.0 used the keyring crate without a native credential-store feature. Its fallback mock store accepted a token write but did not persist it for later reads. After installing 1.0.1, open Stores and enter each access token once again.
