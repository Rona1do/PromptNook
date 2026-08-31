# Changelog

All notable changes will be documented here. The format follows Keep a Changelog, and the project intends to use Semantic Versioning after the first stable release.

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
