# Code signing policy

Stable Windows releases require trusted signatures. Preview releases may include unsigned Windows installers when the release is marked as a prerelease and both the asset name and release notes explicitly identify it as unsigned. Never describe an unsigned preview as signed or as guaranteed free of security warnings. Binary files remain outside source control.

## Release requirements

- Release binaries must be built from the public repository by a reproducible GitHub Actions workflow.
- For stable releases, the application executable and installer must carry a trusted Authenticode signature and timestamp. For unsigned previews, record the actual signature status and do not list a verified publisher.
- The release page must identify the expected publisher and provide SHA-256 checksums.
- Signing credentials must remain in a managed signing service or hardware-backed store; they are never committed to the repository.
- Every signing request requires explicit approval by the maintainer.

The preferred route for this open-source project is a SignPath Foundation subscription. Approval has not been verified. Only after acceptance and successful signing should releases state: **Free code signing provided by SignPath.io, certificate by SignPath Foundation.** Until then, source archives and clearly labelled unsigned previews may be distributed.

## Team roles

- Committer and reviewer: [Rona1do](https://github.com/Rona1do)
- Signing approver: [Rona1do](https://github.com/Rona1do)

Changes from outside contributors must be reviewed before merge. Every release-signing request requires manual approval from the signing approver.

## Privacy statement

PromptNook does not transfer information to another networked system unless the user explicitly requests a translation through a provider they configure. Local model scanning, prompt management, and backups remain on the user's computer. See [PRIVACY.md](PRIVACY.md) for details.
