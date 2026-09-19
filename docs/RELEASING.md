# Releasing

## Before tagging

1. Confirm the working tree contains no private paths, credentials, databases, exports, or model files.
2. Update `CHANGELOG.md` and version fields in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
3. Run the full frontend and Rust checks documented in `README.md`.
4. Build the Windows installer with `npm run tauri:build` on a clean supported machine.
5. For stable releases, sign the executable and installer through the approved trusted signing workflow. For unsigned previews, include `UNSIGNED` in the asset name and clearly disclose the signature status.
6. Install and smoke-test the package, including first launch, workspace creation, backup, restore, and uninstall. Record any unverified checks explicitly; do not describe a build-only check as an installation test.
7. Generate SHA-256 checksums for release assets and verify the Authenticode signature.
8. Create a signed tag when signing is configured, then draft a GitHub release from the changelog.

## Prereleases

Until trusted Windows signing is approved, maintainers may publish source-only prereleases or attach clearly labelled unsigned preview installers. The `0.2.2-beta.1` release uses the latter path. Include `UNSIGNED` in the installer asset name, provide SHA-256 checksums, disclose the signature status in release notes, link to the browser workspace, and list known compatibility boundaries. Do not ask users to disable antivirus or other security protections. The manual Windows preview workflow produces an installer and checksum artifact without automatically publishing it.

## Release notes

Call out database migrations, backup compatibility, new network behavior, platform support, and known limitations. Never claim macOS or Linux support based only on compilation.

## Code signing

Unsigned Windows builds can trigger reputation warnings. A self-signed certificate is only suitable for local testing and does not establish trust on a user's machine. Do not commit signing certificates or passwords. Configure signing only through a secure CI secret store and follow [the public code signing policy](CODE_SIGNING.md).
