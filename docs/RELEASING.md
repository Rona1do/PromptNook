# Releasing

## Before tagging

1. Confirm the working tree contains no private paths, credentials, databases, exports, or model files.
2. Update `CHANGELOG.md` and version fields in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
3. Run the full frontend and Rust checks documented in `README.md`.
4. Build the Windows installer with `npm run tauri:build` on a clean supported machine.
5. Sign the executable and installer through the approved trusted signing workflow. Never publish an unsigned Windows binary as an official release asset.
6. Install and smoke-test the signed package, including first launch, workspace creation, backup, restore, and uninstall.
7. Generate SHA-256 checksums for release assets and verify the Authenticode signature.
8. Create a signed tag when signing is configured, then draft a GitHub release from the changelog.

## Release notes

Call out database migrations, backup compatibility, new network behavior, platform support, and known limitations. Never claim macOS or Linux support based only on compilation.

## Code signing

Unsigned Windows builds can trigger reputation warnings. A self-signed certificate is only suitable for local testing and does not establish trust on a user's machine. Do not commit signing certificates or passwords. Configure signing only through a secure CI secret store and follow [the public code signing policy](CODE_SIGNING.md).
