# Roadmap

This roadmap communicates direction, not a delivery guarantee. Issues and pull requests should link to a milestone when possible.

## 0.1 — Public preview

- [x] Separate PromptNook from the private predecessor's data directory and branding.
- [x] Replace fixed model choices with user-defined workspaces.
- [x] Remove content-specific and adult-oriented default presets.
- [x] Make translation targets configurable.
- [x] Add tests, CI, security policy, contribution guide, and bilingual documentation.
- [ ] Publish the first signed Windows installer and checksums.

## 0.2 — ComfyUI export and international usability

- [x] Complete the English-first interface migration.
- [x] Export checkpoint-based recipes as editable ComfyUI Workflow JSON 0.4 graphs.
- [x] Preserve model, LoRA, prompt, and generation-parameter references in exported graphs.
- [ ] Verify package and backup round trips across Windows machines.
- [ ] Add structured workspace import/export.
- [ ] Add a dedicated FLUX/diffusion-model ComfyUI graph template.

## 0.3 — Localization and community workflows

- [ ] Move user-facing strings into locale resources.
- [ ] Ship a complete Simplified Chinese UI locale with automatic detection and a manual override.
- [ ] Replace remaining low-level Rust diagnostics with stable error codes and localized frontend messages.
- [ ] Document the locale contribution workflow and add localization completeness checks.
- [ ] Add optional prompt-template variables and reusable parameter presets.
- [ ] Add duplicate detection and merge assistance.
- [ ] Add a documented plugin/importer boundary without exposing the local database directly.
- [ ] Evaluate verified macOS and Linux builds with community maintainers.

## Non-goals

- Hosting user prompt libraries as a mandatory cloud service.
- Shipping copyrighted model files or model weights.
- Hard-coding vendor or model names into core workspace behavior.
- Bundling adult or other content-specific presets in the default dataset.
