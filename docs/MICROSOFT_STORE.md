# Microsoft Store submission

Distribution route: MSIX submitted to Microsoft Store, which signs accepted packages. The existing NSIS EXE is not the Store submission package.

## Account information required

Register a developer account, reserve the application name, then copy these exact values from Product identity in Partner Center:

- Package/Identity/Name
- Package/Identity/Publisher
- Package/Properties/PublisherDisplayName

Do not invent publisher identifiers. Do not share account passwords, identity documents or verification codes with project contributors.

## Build

Run `scripts/build-msix.ps1` with `-IdentityName`, `-Publisher` and `-PublisherDisplayName` from Partner Center. The default Store version is `0.2.3.0`; Store versions are four numeric parts, not SemVer prerelease strings. The script builds the unbundled Tauri executable and validates the package with Windows SDK MakeAppx. `-SkipBuild` is for explicitly reusing an already verified local build.

Outputs and staging folders are ignored under `release-artifacts/msix`. Unsigned submission packages are not intended for public sideloading. Do not install a development certificate on users' computers.

Initial target: Windows 11 x64, English UI. Windows 10 and ARM64 are not advertised. Verify Microsoft Edge WebView2 Runtime availability on a clean target machine. MSIX does not run the NSIS WebView2 bootstrapper.

## Certification notes draft

PromptNook is a Tauri desktop application for managing a local SQLite prompt library. No PromptNook login is required. The runFullTrust capability is required for the native desktop process, user-selected checkpoint/LoRA folder scanning, local file import/export, backup/restore and Windows Credential Manager access for optional user-configured translation credentials. The app does not require administrator privileges. Translation services are optional and may require a separately obtained API key and third-party charges. No models or image-generation engine are bundled.

Reviewer flow: create a workspace, save a recipe and snippet, search, edit generation settings, export checkpoint-based ComfyUI JSON, create a backup, restore it, and restart to confirm persistence. Actual image generation requires a separate ComfyUI installation and matching models.

## Listing draft

Title: PromptNook

Short description: Keep image-generation prompts, model notes and settings together, then export editable ComfyUI workflows.

Description: Organize prompt recipes, reusable snippets, checkpoints, LoRAs, trigger words and generation settings in a local workspace. Search your library, assemble prompts in Studio, and export checkpoint-based text-to-image recipes as ComfyUI Workflow JSON. Desktop tools include model-folder scanning, revision history and verified portable backups. Prompt translation is optional and uses a provider you configure. The interface is English; your own content may use any language. PromptNook does not generate images or include model weights. FLUX and arbitrary custom-node workflow export are not currently supported.

Category suggestion: Developer tools (confirm available categories in Partner Center).

Support: https://github.com/Rona1do/PromptNook/issues

Privacy policy source: docs/PRIVACY.md. Supply a publicly accessible URL and verify its contents before submission.

Screenshots: docs/screenshots/recipes.png, studio.png, models-and-loras.png. These represent the frontend; replace with actual packaged-desktop screenshots before certification.

## Still required before submission

- Exact Partner Center identity and reserved name.
- Clean Windows 11 installation/launch and WebView2 dependency verification.
- Test packaged data paths, Credential Manager, local folder access, backup/restore, upgrade and uninstall. MSIX virtualization may change storage behavior; never assume automatic migration from the NSIS version. Export a portable backup before switching distributions.
- Complete truthful age rating, privacy declarations and runFullTrust justification.
- Use a private testing audience/flight before broad release where available.
- Store review and signing; do not advertise Store availability until approved.

SignPath Foundation declined the free certificate application because the project had insufficient public adoption/trust signals. Signing was not rejected on a finding of poor code quality. Microsoft Store is now the primary planned signed distribution channel.

References:
- https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/guides/tauri
- https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-manual-conversion
