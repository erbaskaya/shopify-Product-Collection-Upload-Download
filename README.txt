SHOPIFY DESKTOP GITHUB ACTIONS NPM REGISTRY FIX

CAUSE
The package-lock.json file contained 9 resolved package URLs pointing to an internal OpenAI package registry:
packages.applied-caas-gateway1.internal.api.openai.org

GitHub-hosted Windows and macOS runners cannot access that private hostname, so both jobs failed during npm ci with ETIMEDOUT.

FIXES INCLUDED
1. package-lock.json
   - Replaces all 9 internal registry URLs with https://registry.npmjs.org/
2. .github/workflows/build-installers.yml
   - Forces the public npm registry.
   - Adds npm network retries and longer timeouts.
   - Uses workflowArtifactNamePattern, the supported Tauri Action input.

FILES TO REPLACE IN THE GITHUB REPOSITORY
- package-lock.json
- .github/workflows/build-installers.yml

LOCAL INSTALLATION
Extract this ZIP, open PowerShell in the extracted folder and run:

powershell -ExecutionPolicy Bypass -File .\apply-ci-fix.ps1 `
  -ProjectRoot "C:\path\to\your\project"

Then commit and push the two changed files to the main branch.

GITHUB
Actions > Build Windows and macOS installers > Run workflow
Start a NEW workflow after the new commit. Do not re-run the old failed run.

EXPECTED ARTIFACTS
- windows-x64-installers
- macos-universal-installer
