# Changelog

All notable changes will be documented here. The format follows Keep a Changelog, and the project intends to use Semantic Versioning after the first stable release.

## [Unreleased]

## [0.2.3-beta.1] - 2026-09-19

### Added

- Browser workspace backup, validated restore, and confirmed reset to the current English starter workspace.

### Fixed

- Browser workspace exports omit translation credentials, and unsupported stored workspace versions are preserved instead of being overwritten during startup.
- Current documentation now reflects the published, clearly labelled `UNSIGNED` Windows prerelease installer while keeping trusted signing as a requirement for stable releases.

## [0.2.2-beta.1] - 2026-09-19

### Fixed

- New browser workspaces start with English sample content without prefilled Chinese translations. Existing saved content is preserved.
- Settings explicitly identifies English as the current interface language and distinguishes prompt translation from UI localization.
- Browser translation now reports that a desktop provider is required instead of returning fixed Chinese dictionary results or placeholder text as a translation.

### Distribution

- Windows preview packages are unsigned. Signing approval remains pending; an unsigned package must not be described as signed or guaranteed free of security warnings.
- There is no interface language switch yet. Checkpoint-based ComfyUI export is supported; FLUX and arbitrary custom-node graphs remain outside this release.

## [0.2.1-beta.1] - 2026-09-05

### Added

- Persistent browser-local storage for recipes, snippets, workspaces, settings, notes, resources, trash, and backup snapshots.
- Real ComfyUI Workflow JSON 0.4 downloads from the browser workspace, using the same checkpoint, LoRA, prompt, and generation-parameter graph shape as the desktop exporter.
- Browser export tests covering graph compatibility, unsupported diffusion-model recipes, file downloads, and persistence across reloads.
- A short visual walkthrough showing the path from a saved recipe to a downloaded ComfyUI workflow.

### Changed

- Repositioned the repository around its concrete outcome: turning scattered prompt and model notes into editable ComfyUI workflows.
- Replaced the temporary in-memory demo language with an honest browser-workspace experience; local folder scanning and verified backups remain clearly marked desktop-only.
- Made ComfyUI export available in both browser and desktop recipe editors.

### Known limitations

- Browser data belongs to the current browser profile and can be removed when site data is cleared; users should treat it as a convenient trial workspace rather than a verified backup.
- The browser sandbox cannot scan local model folders. That feature remains in the desktop application.
- Official Windows binaries remain withheld until the trusted code-signing workflow is approved.

## [0.2.0-beta.1] - 2026-08-31

### Added

- ComfyUI Workflow JSON 0.4 export for checkpoint-based text-to-image recipes.
- Standard ComfyUI nodes for checkpoint loading, ordered LoRA loading, prompt encoding, latent creation, sampling, VAE decoding, and image saving.
- Portable model and LoRA references relative to configured model folders, with explicit warnings for missing, offline, or out-of-folder resources.
- A native Save dialog for choosing the workflow destination.
- Rust coverage for workflow structure, generation parameters, offline resources, and unsupported diffusion-model recipes.
- Browser API coverage and repeatable Playwright screenshot capture for the export-era interface.

### Changed

- Completed the English-first primary interface migration across recipes, snippets, Studio, model management, settings, backup, trash, tips, search, and recovery states.
- Refreshed all public screenshots using the English browser demo.
- Updated browser demo content and error messages for an international audience while retaining multilingual prompt examples.

### Known limitations

- The first ComfyUI exporter intentionally supports checkpoint workflows only. FLUX/diffusion-model graphs require a separate template and fail with a clear message instead of producing a misleading workflow.
- Some low-level Rust diagnostic messages still need migration from the original prototype; normal interface flows are English.
- Official Windows binaries remain withheld until the trusted code-signing workflow is approved; this prerelease is source-only.

## [0.1.0-preview] - 2026-08-28

### Added

- User-defined prompt workspaces with isolated libraries and Studio defaults.
- Configurable translation target language.
- PromptNook branding, application icon, bilingual project documentation, and community files.
- GitHub Actions quality checks and Dependabot configuration.

### Changed

- Desktop data now uses a dedicated PromptNook directory.
- Default categories, recipe tags, sample resources, and prompts are general-purpose.
- Translation is language-agnostic and disabled by default.

### Removed

- Fixed workspace/model names from the private prototype.
- Adult-oriented seed data and content-specific cleanup behavior.
- Personal filesystem defaults and private-project branding.
