# ComfyUI workflow export

PromptNook v0.3 offers two exports in the browser and Windows desktop app: regenerate a checkpoint text-to-image graph from a saved recipe, or export an imported original graph unchanged. Original export includes FLUX and custom nodes; it does not apply recipe edits or install dependencies.

## Import

The recipe library accepts ComfyUI PNGs (embedded `workflow` or `prompt` text), Workflow JSON files, or A1111 `parameters` blocks. Drop one or more files onto **Recipes** or use **Choose files**. The review dialog shows model references and sampling settings; expand a row to inspect its prompts, ordered LoRAs, notes, and PNG cover. Nothing is saved until you click **Import selected**. Prompts and covers stay hidden in privacy mode.

Exact duplicates in the active workspace or current batch are unchecked by default. Comparison includes prompts, model references, ordered LoRA strengths and enabled trigger words, dimensions, sampler, scheduler, steps, CFG, seed, and any preserved source graph. Different seeds or source graphs stay separate. Original JSON text is also compared conservatively to avoid discarding graphs with different large integer seeds, so equivalent graphs with different formatting can remain selected. Titles, covers, tags, and ordinary notes do not affect comparison. You can select a duplicate explicitly to keep another copy.

Files that cannot be parsed remain listed with individual errors while valid files can still be imported. Saved rows remain visible. If a cover import or recipe save fails, its error stays in the dialog and you can retry the unfinished selection without resaving successful rows. **Cancel** closes an unsaved review; **Done** closes the results. Closing is temporarily blocked while selected recipes are being saved.

Checkpoint loaders, ordered LoRA loaders, prompts, size, sampler, scheduler, steps, CFG, and seed are copied into each selected recipe. A PNG is stored as that recipe's cover.

UNET and other diffusion-model graphs, including typical FLUX setups built around `SamplerCustomAdvanced`, preserve their original graph for export. Valid custom-only graphs are kept as drafts even when PromptNook cannot extract standard recipe fields. Ambiguous model filenames stay unresolved; model subfolders are respected.

## Original graph export

Open an imported recipe and choose **Export original graph**. This exports the graph captured during import, including nodes, connections, widget values, and layout. Original JSON text preserves integer seeds beyond JavaScript's safe range. API-format inputs remain API-format JSON, identified by an `.api.json` filename in the browser; they are not converted to UI workflows.

Original exports do not incorporate changes made to prompts, LoRAs, or parameters in PromptNook. The editor displays this boundary. For checkpoint recipes, save edits and use **Export ComfyUI workflow** to generate a new core-node graph from those saved fields. Edited FLUX recipes still require a dedicated graph template.

Source graphs travel with browser JSON backups, desktop database backups, JSON exports, and desktop recipe revisions. Desktop schema 5 migrates to 6 with a pre-migration snapshot; older app versions cannot open schema 6. An older recipe without a preserved graph must be reimported from its source PNG or JSON to gain original export.

## Recipe-based exported graph

The initial template uses only ComfyUI core nodes:

1. `CheckpointLoaderSimple`
2. Zero or more ordered `LoraLoader` nodes
3. Positive and negative `CLIPTextEncode` nodes
4. `EmptyLatentImage`
5. `KSampler`
6. `VAEDecode`
7. `SaveImage`

PromptNook carries over the positive and negative prompts, width, height, sampler, scheduler, steps, CFG, seed, checkpoint reference, LoRA order, model strength, and CLIP strength. Missing parameters use conservative ComfyUI defaults and a blank or invalid seed is exported with randomization enabled.

## Portable references

Checkpoint and LoRA paths are made relative to the model folders configured in PromptNook. ComfyUI therefore receives references such as `sdxl/model.safetensors` instead of a machine-specific absolute path. When a resource is offline, absent from the catalog, or outside its configured root, the export completes with a warning and uses the safest available saved name or filename.

## Current boundary

Recipe-based generation supports `text_to_image` recipes whose base resource is a checkpoint. A `diffusion_model` resource requires a different template, so this export is unavailable. Imported diffusion and custom-node graphs can be exported through the separate original export above.

The generated checkpoint graph uses ComfyUI's UI workflow format. Custom nodes, ControlNet, inpainting, upscalers, and platform-specific output paths are preserved in original snapshots when present, but are not inferred or rebuilt from recipe fields.

## Testing

Tests cover original UI/API graph preservation, large integer seeds, SQLite migration, revision snapshots, browser and verified desktop backup restoration, and the checkpoint generation boundary. Browser end-to-end tests exercise mixed batch review, covers, persistence, duplicates, original export after edits, and comparison privacy. Saving a valid graph does not verify that its required models/custom nodes are installed or that it will generate successfully in the user's ComfyUI environment.

If an exported core-node workflow fails to load, open a GitHub issue with the PromptNook version, ComfyUI version, recipe resource types, warnings shown at export, and the workflow JSON after removing any sensitive prompt text.

## References

- [ComfyUI Workflow JSON 0.4 specification](https://docs.comfy.org/specs/workflow_json)
- [Official ComfyUI API-format example](https://github.com/comfyanonymous/ComfyUI/blob/master/script_examples/basic_api_example.py)
