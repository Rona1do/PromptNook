# Open-source launch checklist

## Required before making the repository public

- [x] Replace repository-owner placeholders in documentation and issue links.
- [x] Add the real repository remote and confirm it points to the intended GitHub account.
- [x] Review `git diff --cached` and `git status --ignored`.
- [x] Confirm no API keys, tokens, credentials, `.env` files, databases, exports, logs, model weights, private screenshots, or personal paths are tracked.
- [x] Run `npm audit` and review every remaining finding.
- [x] Run the full frontend and Rust quality checks.
- [ ] Verify the browser demo and a clean desktop first launch.
- [x] Confirm `%LOCALAPPDATA%\PromptNook` is used and the private predecessor's data is untouched.
- [ ] Enable GitHub private vulnerability reporting and Dependabot alerts.
- [x] Let CI pass before announcing the project.

## Required before the first binary release

- [ ] Build from a clean checkout.
- [ ] Smoke-test install, launch, backup, restore, export, import, upgrade, and uninstall.
- [ ] Verify installer publisher/signing status and document any unsigned-build warning.
- [ ] Publish SHA-256 checksums.
- [x] Mark the release as preview while interface localization and platform verification remain incomplete.

## After launch

- [ ] Create roadmap-linked starter issues and apply `good first issue`/`help wanted` labels carefully.
- [ ] Respond to bug reports and security reports within the documented window.
- [ ] Record meaningful changes in `CHANGELOG.md`.
- [ ] Collect only real, public adoption evidence for grant or maintainer-program applications.
