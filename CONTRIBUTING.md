# Contributing to PromptNook

Thank you for helping make prompt workflows more portable and private.

## Before opening an issue

- Search existing issues and discussions.
- Use the bug template for reproducible defects and the feature template for product proposals.
- Do not include private prompts, API keys, model files, personal paths, or exported databases.
- For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development workflow

1. Fork the repository and create a focused branch from `main`.
2. Install dependencies with `npm ci`.
3. Keep changes scoped; avoid unrelated formatting or generated artifacts.
4. Add or update tests for behavior changes.
5. Run the checks listed below.
6. Open a pull request explaining the user problem, design choice, tests, and screenshots for visible UI changes.

```bash
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## Product principles

- Local-first by default; network features must be explicit and documented.
- No telemetry without a separate proposal and clear opt-in consent.
- Model and workspace names must remain user-configurable.
- Avoid content-specific presets in the default dataset.
- Preserve user data and provide a migration path for schema changes.
- Keep the browser fallback deterministic and clearly labeled as volatile.
- User-facing strings should move through the localization layer once the i18n milestone is merged.

## Commit and pull request style

Use short imperative commit subjects, for example `Add workspace export filter`. A pull request should be small enough to review and should not mix refactoring with unrelated feature work.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
