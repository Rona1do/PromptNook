# Code signing policy

PromptNook does not publish unsigned Windows executables or installers as official GitHub Release assets. Development builds may be produced locally for testing, but they must be clearly marked as unsigned and kept outside version control.

## Release requirements

- Release binaries must be built from the public repository by a reproducible GitHub Actions workflow.
- The application executable and installer must carry a trusted Authenticode signature and timestamp.
- The release page must identify the expected publisher and provide SHA-256 checksums.
- Signing credentials must remain in a managed signing service or hardware-backed store; they are never committed to the repository.
- Every signing request requires explicit approval by the maintainer.

The preferred route for this open-source project is a SignPath Foundation subscription. The application is currently pending. If accepted, official Windows releases will state: **Free code signing provided by SignPath.io, certificate by SignPath Foundation.** Until the application is accepted and the workflow is configured, releases contain source archives only.

## Team roles

- Committer and reviewer: [Rona1do](https://github.com/Rona1do)
- Signing approver: [Rona1do](https://github.com/Rona1do)

Changes from outside contributors must be reviewed before merge. Every release-signing request requires manual approval from the signing approver.

## Privacy statement

PromptNook does not transfer information to another networked system unless the user explicitly requests a translation through a provider they configure. Local model scanning, prompt management, and backups remain on the user's computer. See [PRIVACY.md](PRIVACY.md) for details.
