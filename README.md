<div align="center">
  <img src="public/promptnook-icon.png" alt="PromptNook icon" width="128" />
  <h1>PromptNook</h1>
  <p>A private, local-first prompt library and studio for generative-image creators.</p>
  <p>Designed for workflows around Stable Diffusion, SDXL, FLUX, ComfyUI, and other image-generation tools.</p>

  [![CI](https://github.com/Rona1do/PromptNook/actions/workflows/ci.yml/badge.svg)](https://github.com/Rona1do/PromptNook/actions/workflows/ci.yml)
  [![License: MIT](https://img.shields.io/badge/License-MIT-5d5fef.svg)](LICENSE)
  [![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB.svg)](https://tauri.app/)
</div>

> Latest release: [PromptNook v0.2.0 Beta 1](https://github.com/Rona1do/PromptNook/releases/tag/v0.2.0-beta.1). It is source-only while trusted Windows code signing is being arranged.

**[Try the browser demo](https://rona1do.github.io/PromptNook/)** — explore the interface with temporary sample data; nothing is uploaded or persisted.

[简体中文](README.zh-CN.md)

## Screenshots

![Prompt recipe library](docs/screenshots/recipes.png)

<details>
  <summary>Prompt Studio and local model catalog</summary>

  ![Prompt Studio](docs/screenshots/studio.png)

  ![Local model and LoRA catalog](docs/screenshots/models-and-loras.png)
</details>

The screenshots use the repository's in-memory demo data. They do not contain a maintainer's private library or filesystem paths.

## Why PromptNook?

Prompt workflows quickly outgrow text files: reusable fragments become hard to find, model-specific defaults get mixed together, and generation settings disappear after a successful experiment. PromptNook keeps those pieces searchable and connected without requiring a cloud account.

## Highlights

- **Custom workspaces** — create any model or workflow name instead of choosing from a fixed list. Each workspace has isolated recipes, snippets, tags, and Studio defaults.
- **Recipes and snippets** — organize full prompts, reusable fragments, negative prompts, notes, favorites, categories, and revision history.
- **Prompt Studio** — assemble prompts from reusable fragments and preserve the parameters behind a generation.
- **ComfyUI workflow export** — turn a checkpoint-based recipe into an editable Workflow JSON 0.4 graph with model, ordered LoRAs, prompts, and generation parameters already connected.
- **Local model catalog** — scan configured checkpoint, diffusion-model, and LoRA folders; record trigger words and availability.
- **Language-flexible content** — set any translation target such as `en`, `zh-CN`, `ja`, `de`, or a language name. Translation is off by default.
- **Local-first storage** — desktop data lives in a local SQLite database. There is no PromptNook account, telemetry, or mandatory network service.
- **Verified backups** — content-addressed media, integrity checks, recovery mode, trash, JSON/CSV export, and portable `.promptnook` packages.
- **Browser demo** — the Vite development build provides an in-memory sample mode for evaluating the interface without installing the desktop app.

## Project language policy

English is the repository and interface language so contributors can collaborate globally. Simplified Chinese documentation remains available because it is useful, not because prompt content is tied to Chinese. Prompt content and translation targets are language-agnostic: users can enter any target supported by their configured translation provider.

The original private prototype's primary Chinese-only interface has been migrated for v0.2. A resource-based Simplified Chinese UI locale and localized low-level diagnostics remain on the roadmap; the project will not claim generic “all-language UI” support before each locale is complete and reviewable.

## ComfyUI export

Open an existing recipe in the Windows desktop app and choose **Export ComfyUI workflow**. PromptNook writes an editable ComfyUI Workflow JSON 0.4 file and reports any offline or unresolved model references. The current graph uses ComfyUI core nodes and supports checkpoint-based text-to-image recipes; FLUX/diffusion-model graphs are deliberately deferred to a dedicated template. See [the export design and compatibility notes](docs/COMFYUI_EXPORT.md).

## Platform status

The desktop app is currently developed and tested on **Windows 10/11**. The stack is cross-platform, but macOS and Linux packaging is not yet verified. Do not present those platforms as supported until their release workflows are tested.

Public Windows installers are withheld until a trusted code-signing workflow is available. Source releases remain available for review and local builds. See the [code signing policy](docs/CODE_SIGNING.md).

## Quick start

Prerequisites:

- Node.js 24.15 or newer
- Rust stable with Cargo
- Windows WebView2 (normally already present on Windows 10/11)
- Tauri 2 system prerequisites

```bash
git clone https://github.com/Rona1do/PromptNook.git
cd PromptNook
npm ci
npm run tauri:dev
```

To run only the browser demo:

```bash
npm run dev
```

## Quality checks

```bash
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## Privacy and translation

Translation is disabled by default. When enabled, only text selected for translation is sent to the configured endpoint. PromptNook supports local Ollama and OpenAI-compatible endpoints; credentials are stored with the operating-system credential manager rather than in SQLite. Read [docs/PRIVACY.md](docs/PRIVACY.md) before enabling a network provider.

## Data location

On Windows, PromptNook stores its desktop data under `%LOCALAPPDATA%\PromptNook\vault`. This is intentionally separate from older/private builds. Choose a second physical drive for backups when possible.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md), the [roadmap](ROADMAP.md), and issues labeled `good first issue`. By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues should be reported privately using [SECURITY.md](SECURITY.md).

Questions, workflow ideas, and early feedback are welcome in [GitHub Discussions](https://github.com/Rona1do/PromptNook/discussions). Please use [Issues](https://github.com/Rona1do/PromptNook/issues) for reproducible bugs and scoped feature requests.

## License

PromptNook is released under the [MIT License](LICENSE).
