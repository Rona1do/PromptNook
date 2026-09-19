# Code signing policy

Stable Windows releases require trusted signatures. Preview releases may include unsigned Windows installers when the release is marked as a prerelease and both the asset name and release notes explicitly identify it as unsigned. Never describe an unsigned preview as signed or as guaranteed free of security warnings. Binary files remain outside source control.

## Current release status

The `0.2.2-beta.1` Windows prerelease publishes a clearly labelled `UNSIGNED` installer and checksum. This is an allowed preview distribution, not a trusted signed release. Windows may show reputation or unknown-publisher warnings. A signed stable release remains pending an approved trusted code-signing path.

## Release requirements

- Release binaries must be built from the public repository by a reproducible GitHub Actions workflow.
- For stable releases, the application executable and installer must carry a trusted Authenticode signature and timestamp. For unsigned previews, record the actual signature status and do not list a verified publisher.
- The release page must state the actual signature and publisher status and provide SHA-256 checksums.
- Signing credentials must remain in a managed signing service or hardware-backed store; they are never committed to the repository.
- Every signing request requires explicit approval by the maintainer.

The SignPath Foundation application was declined because the project had insufficient public adoption and trust signals. Microsoft Store MSIX distribution is now the primary planned signed channel; see [Store preparation](MICROSOFT_STORE.md). Microsoft signs accepted Store packages, not the separate NSIS EXE distributed on GitHub. Store certification is still pending submission. Source archives and clearly labelled unsigned previews may be distributed in the meantime. Do not claim SignPath sponsorship or signing.

## Team roles

- Committer and reviewer: [Rona1do](https://github.com/Rona1do)
- Signing approver: [Rona1do](https://github.com/Rona1do)

Changes from outside contributors must be reviewed before merge. Every release-signing request requires manual approval from the signing approver.

## Privacy statement

PromptNook does not transfer information to another networked system unless the user explicitly requests a translation through a provider they configure. Local model scanning, prompt management, and backups remain on the user's computer. See [PRIVACY.md](PRIVACY.md) for details.
