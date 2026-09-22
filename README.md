<div align="center">
  <img src="public/promptnook-icon.png" alt="PromptNook icon" width="128" />
  <h1>PromptNook</h1>
  <p><strong>A local-first recipe library for ComfyUI creators.</strong></p>
  <p>Keep prompts, checkpoints, ordered LoRAs, trigger words, and generation settings together — then export an editable workflow.</p>

  [![CI](https://github.com/Rona1do/PromptNook/actions/workflows/ci.yml/badge.svg)](https://github.com/Rona1do/PromptNook/actions/workflows/ci.yml)
  [![Browser workspace: ready](https://img.shields.io/badge/browser_workspace-ready-238636.svg)](https://rona1do.github.io/PromptNook/)
  [![Windows desktop: beta](https://img.shields.io/badge/Windows_desktop-beta-d97706.svg)](https://github.com/Rona1do/PromptNook/releases/tag/v0.2.3-beta.1)
  [![License: MIT](https://img.shields.io/badge/License-MIT-5d5fef.svg)](LICENSE)

  **[Try the live browser demo →](https://rona1do.github.io/PromptNook/)** ·
  **[Download the Windows preview](https://github.com/Rona1do/PromptNook/releases/tag/v0.2.3-beta.1)** ·
  [ComfyUI export details](docs/COMFYUI_EXPORT.md)
</div>

> Built for people whose successful generations are scattered across text files, PNG metadata, model folders, and memory. PromptNook is a standalone library and workflow companion—not a prompt generator, image generator, or ComfyUI custom node.

**Project status:** the browser workspace is ready for everyday use and includes backup/restore. The Windows desktop app remains a beta while clean-machine installation, upgrade, and cross-machine backup recovery are verified and trusted signing is arranged.

![PromptNook to ComfyUI workflow demo](docs/promptnook-comfyui-demo.gif)

[简体中文](README.zh-CN.md)

## Choose how to try it

| | Browser workspace | Windows desktop |
| --- | --- | --- |
| Best for | Trying the complete recipe-to-workflow flow | Managing a real local model library |
| Setup | No account or installation | Download the clearly marked unsigned preview |
| Included | Persistent recipes, snippets, Studio, JSON backup, ComfyUI export | Everything in the browser workspace, plus folder scanning, SQLite, credential protection, and verified portable backups |
| Data | Stays in this browser | Stays on your computer |

The browser workspace is not a static mockup. You can edit the starter recipes, download a real ComfyUI Workflow JSON 0.4 file, close the tab, and return to your saved work later.

## Try it in 60 seconds

1. Open the [browser workspace](https://rona1do.github.io/PromptNook/); no account or installation is required.
2. Open **Neon street in the rain** to inspect its checkpoint, prompt, and generation settings.
3. Choose **Export ComfyUI workflow** and load the downloaded JSON in ComfyUI.

Your edits persist in that browser through local storage. Use **Settings → Backup & export** to download a versioned browser workspace backup before clearing site data. The desktop build adds local checkpoint/LoRA folder scanning, SQLite storage, verified portable backups, and operating-system credential protection.

## Why PromptNook?

Successful generations are more than prompt text. They also depend on the checkpoint, ordered LoRAs, trigger words, sampler, scheduler, seed, dimensions, and the small notes that explain why a recipe works. PromptNook keeps those pieces searchable and connected, then turns a saved checkpoint recipe into an editable ComfyUI graph.

Unlike a cloud prompt gallery, PromptNook requires no PromptNook account and does not upload your library. Unlike a plain text file, it preserves the resources and settings needed to reproduce a result.

### What makes it different

- **Recipes, not isolated prompt text** — keep the positive and negative prompts, checkpoint, ordered LoRAs, seed, sampler, scheduler, dimensions, CFG, notes, and revision history together.
- **Use the model files you already have** — the Windows app scans configured folders and records availability instead of making you rebuild a catalog by hand.
- **Leave with a workflow** — export a core-node ComfyUI graph that is ready to inspect and edit, rather than copying fields one at a time.
- **Private by default** — no PromptNook account, analytics, hosted library, or automatic prompt upload.

## Highlights

- **Working browser workspace** — create and edit recipes and snippets with browser-local persistence, then download checkpoint-based ComfyUI workflows without installing PromptNook.
- **Browser backup and restore** — download a versioned JSON workspace, validate it before restore, or reset to the current English starter workspace. Translation credentials are never exported.
- **ComfyUI workflow export** — produce an editable Workflow JSON 0.4 graph with checkpoint, ordered LoRAs, prompts, size, sampler, scheduler, steps, CFG, and seed already connected.
- **Local model catalog** — the desktop app scans configured checkpoint, diffusion-model, and LoRA folders instead of asking you to rebuild a catalog manually.
- **Custom workspaces** — create any model, client, or workflow name. Libraries are not hard-coded to three model families.
- **Recipes and snippets** — organize complete prompts, reusable fragments, negative prompts, notes, favorites, categories, and revision history.
- **Prompt Studio** — assemble prompts from reusable fragments and preserve the parameters behind a generation.
- **Language-flexible content** — use any translation target supported by your configured local or OpenAI-compatible provider. Translation is off by default.
- **Verified desktop backups** — content-addressed media, integrity checks, recovery mode, trash, JSON/CSV export, and portable `.promptnook` packages.

## Screenshots

<p align="center">
  <img src="docs/screenshots/recipes.png" alt="PromptNook recipe library" width="49%" />
  <img src="docs/screenshots/models-and-loras.png" alt="PromptNook local model and LoRA catalog" width="49%" />
</p>

![PromptNook Prompt Studio](docs/screenshots/studio.png)

The screenshots use repository sample data. They do not contain a maintainer's private library or filesystem paths.

## Project language policy

English is the repository and interface language so contributors can collaborate globally. Simplified Chinese documentation remains available because it is useful, not because prompt content is tied to Chinese. Prompt content and translation targets are language-agnostic: users can enter any target supported by their configured translation provider.

The current interface and starter workspace are English. Prompt content can use any language. A complete Simplified Chinese UI locale and localized low-level diagnostics remain on the roadmap; **Prompt translation** translates prompt content and does not change the interface language.

## ComfyUI export

Open an existing recipe in the browser workspace or Windows desktop app and choose **Export ComfyUI workflow**. PromptNook writes an editable ComfyUI Workflow JSON 0.4 file and reports any offline or unresolved model references. The current graph uses ComfyUI core nodes and supports checkpoint-based text-to-image recipes; FLUX/diffusion-model graphs are deliberately deferred to a dedicated template. See [the export design and compatibility notes](docs/COMFYUI_EXPORT.md).

## Platform and release status

The desktop app is currently developed and tested on **Windows 10/11**. The stack is cross-platform, but macOS and Linux packaging is not yet verified. Do not present those platforms as supported until their release workflows are tested.

The current Windows prerelease includes an installer whose asset name and release notes explicitly mark it **UNSIGNED**. It may trigger Windows reputation or publisher warnings. Review the release notes and checksum; do not disable Windows security protections. A formally signed stable release still depends on a trusted code-signing workflow. Source releases remain available for review and local builds; see the [code signing policy](docs/CODE_SIGNING.md).

The first stable Windows release will follow successful clean-machine install/uninstall, upgrade, and cross-machine backup/restore checks. Until those gates are recorded, changing the badge from beta to stable would be a marketing label rather than evidence of release quality.

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

To run the browser workspace locally:

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

Start with [CONTRIBUTING.md](CONTRIBUTING.md), the [roadmap](ROADMAP.md), and issues labeled [`help wanted`](https://github.com/Rona1do/PromptNook/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22help%20wanted%22). By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues should be reported privately using [SECURITY.md](SECURITY.md).

Questions, workflow ideas, and early feedback are welcome in [GitHub Discussions](https://github.com/Rona1do/PromptNook/discussions). Please use [Issues](https://github.com/Rona1do/PromptNook/issues) for reproducible bugs and scoped feature requests.

If PromptNook solves a workflow problem for you, a GitHub star helps other ComfyUI users discover it.

## License

PromptNook is released under the [MIT License](LICENSE).
