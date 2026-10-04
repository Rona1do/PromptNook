# ComfyUI workflow export

PromptNook v0.2 exports an existing checkpoint-based recipe from either the browser workspace or Windows desktop app as an editable ComfyUI Workflow JSON 0.4 graph. The feature is intended as a reliable starting graph, not as a promise that every custom-node setup can be reconstructed automatically.

## Import

The recipe library accepts ComfyUI PNGs (embedded `workflow` or `prompt` text), Workflow JSON files, or A1111 `parameters` blocks. Drop one or more files onto **Recipes** or use **Choose files**. The review dialog shows model references and sampling settings; expand a row to inspect its prompts, ordered LoRAs, notes, and PNG cover. Nothing is saved until you click **Import selected**. Prompts and covers stay hidden in privacy mode.

Exact generation duplicates in the active workspace or the current batch are unchecked by default. Comparison includes positive and negative prompts, model references, ordered LoRA strengths and enabled trigger words, dimensions, sampler, scheduler, steps, CFG, and seed. Different seeds are separate recipes; matching titles alone are not duplicates. Titles, covers, tags, and ordinary notes do not affect this comparison. This compares the extracted recipe fields, not every node in the source graph. You can select a duplicate explicitly to keep a second copy.

Files that cannot be parsed remain listed with individual errors while valid files can still be imported. Saved rows remain visible. If a cover import or recipe save fails, its error stays in the dialog and you can retry the unfinished selection without resaving successful rows. **Cancel** closes an unsaved review; **Done** closes the results. Closing is temporarily blocked while selected recipes are being saved.

Checkpoint loaders, ordered LoRA loaders, prompts, size, sampler, scheduler, steps, CFG, and seed are copied into each selected recipe. A PNG is stored as that recipe's cover.

UNET and other diffusion-model graphs, including typical FLUX setups built around `SamplerCustomAdvanced`, are stored with an explicit note. Export keeps refusing them until a tested FLUX template exists, instead of writing a checkpoint graph that would not run.

## Exported graph

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

The graph currently supports `text_to_image` recipes whose base resource is a checkpoint. A `diffusion_model` resource, including typical FLUX installations, requires different loader, text encoder, and latent nodes. PromptNook rejects that case with an explicit message until a dedicated, tested template is available.

The output is the editable workflow format used by ComfyUI's UI, not the separate API prompt object. Custom nodes, ControlNet, inpainting, upscalers, and platform-specific output paths are not inferred in this first version.

## Testing

Rust tests verify the desktop graph structure, links, relative resource references, LoRA chain, generation parameters, fixed/random seed behavior, offline warnings, and the unsupported diffusion-model boundary. Frontend and browser-flow tests verify an equivalent browser graph, persistence across reloads, real JSON downloads, desktop IPC arguments, and rejected diffusion-model recipes.

If an exported core-node workflow fails to load, open a GitHub issue with the PromptNook version, ComfyUI version, recipe resource types, warnings shown at export, and the workflow JSON after removing any sensitive prompt text.

## References

- [ComfyUI Workflow JSON 0.4 specification](https://docs.comfy.org/specs/workflow_json)
- [Official ComfyUI API-format example](https://github.com/comfyanonymous/ComfyUI/blob/master/script_examples/basic_api_example.py)
