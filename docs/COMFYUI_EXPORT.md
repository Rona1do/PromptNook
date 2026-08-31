# ComfyUI workflow export

PromptNook v0.2 exports an existing checkpoint-based recipe as an editable ComfyUI Workflow JSON 0.4 graph. The feature is intended as a reliable starting graph, not as a promise that every custom-node setup can be reconstructed automatically.

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

Rust tests verify the graph structure, links, relative resource references, LoRA chain, generation parameters, fixed/random seed behavior, offline warnings, and the unsupported diffusion-model boundary. Frontend tests verify desktop IPC arguments and the browser-demo explanation.

If an exported core-node workflow fails to load, open a GitHub issue with the PromptNook version, ComfyUI version, recipe resource types, warnings shown at export, and the workflow JSON after removing any sensitive prompt text.

## References

- [ComfyUI Workflow JSON 0.4 specification](https://docs.comfy.org/specs/workflow_json)
- [Official ComfyUI API-format example](https://github.com/comfyanonymous/ComfyUI/blob/master/script_examples/basic_api_example.py)
