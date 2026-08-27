# GitHub setup for the first release

## Repository settings

- Name: `PromptNook`
- Visibility: Public
- Description: `A private, local-first prompt library and studio for generative-image creators.`
- Website: leave empty until an official project page exists
- Topics: `prompt-manager`, `generative-ai`, `stable-diffusion`, `flux`, `tauri`, `react`, `rust`, `sqlite`, `local-first`, `windows`
- Default branch: `main`
- Enable Issues and Discussions.
- Disable Wikis initially; keep canonical documentation versioned in `docs/`.
- Enable private vulnerability reporting and Dependabot alerts.
- Enable `Automatically delete head branches` after pull-request merges.

## Branch protection

After CI runs successfully once, protect `main`:

- Require a pull request before merging.
- Require the `frontend` and `rust` checks.
- Require branches to be up to date.
- Block force pushes and branch deletion.
- Allow the maintainer to bypass only for an urgent security release.

## Files to customize

The repository links are configured for `Rona1do/PromptNook`. Add a private security contact through GitHub's advisory settings; do not publish a personal email merely to fill a template.

## Suggested first issues

1. `i18n: extract React UI copy into locale resources` — milestone 0.2, help wanted.
2. `i18n: complete English locale` — blocked by extraction issue.
3. `docs: add sanitized Windows screenshots` — no personal prompts or paths.
4. `release: automate signed Windows artifacts and checksums`.
5. `test: add backup/package round-trip fixtures`.

## Launch sequence

1. Run `OPEN_SOURCE_CHECKLIST.md` and resolve every blocker.
2. Publish the source and let CI pass.
3. Create the five issues above and label them.
4. Publish a clearly marked `v0.1.0-preview` release after installer smoke testing.
5. Share the project in relevant communities, ask for concrete feedback, and respond publicly to issues.
6. Apply to programs based on real public maintenance and adoption evidence, never fabricated metrics.
