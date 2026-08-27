# Security Policy

## Supported versions

PromptNook is pre-1.0. Security fixes are made on the latest release and the `main` branch only.

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** private advisory flow on the repository's Security tab. Do not open a public issue and do not attach real prompts, credentials, databases, or model files.

Include the affected version or commit, platform, reproduction steps, impact, and any suggested mitigation. You should receive an acknowledgement within seven days. A fix timeline depends on severity and complexity; the maintainer will coordinate disclosure after a patched release is available.

## Security boundaries

- Translation endpoints receive selected text only when translation is enabled and requested.
- API credentials use the operating-system credential manager.
- Scanned model paths and prompt content remain local unless the user explicitly exports or translates them.
- Imported `.promptnook` and legacy `.promptvault` packages are untrusted input and should come from a source you trust.
