SHOPIFY DESKTOP CI BUILD FIX

This patch fixes a shared Rust compile error in src-tauri/src/lib.rs.
The Tauri setup callback was converting errors to String and then using ?,
but String cannot be converted into Box<dyn std::error::Error>.
Because the same Rust backend is compiled on Windows and macOS, both jobs failed.

It also updates GitHub Actions to Node.js 24-compatible checkout/setup actions
and adds an explicit cargo check step so future Rust errors are easier to locate.

FILES TO REPLACE
- src-tauri/src/lib.rs
- .github/workflows/build-installers.yml

AFTER COPYING
1. Commit and push both files to main.
2. Open Actions > Build Windows and macOS installers.
3. Click Run workflow, or re-run the failed workflow after the new commit.
4. Successful builds will show downloadable artifacts.
