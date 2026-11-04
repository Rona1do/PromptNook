# Companion node for ComfyUI — design proposal

Answers RFC #21. The goal: a ComfyUI user wires a PromptNook recipe into their
graph without leaving it, and without the node knowing anything about the
desktop SQLite schema.

## Answer to the four questions

### 1. Input: one portable recipe JSON, not a package, not a directory

The node consumes a single **`promptnook-recipe.v1.json`** file — a new,
explicitly documented per-recipe export owned by PromptNook. Reasons:

- the browser backup JSON is the app-private schema in disguise: it changes
  with desktop schema migrations (5 → 6) and carries assets, tags, snippets
  and settings a graph node never needs. Coupling to it recreates the
  migration boundary inside ComfyUI;
- a per-recipe file is the smallest stable contract: one recipe, one file, a
  `schema` field for versioning;
- a directory of exports still works: the node scans a folder and every valid
  `*.promptnook-recipe.json` becomes a pickable recipe. The `.promptnook`
  package (zip) is a later addition, not the v1 boundary.

PromptNook's side of the boundary is one new export action, **Export recipe
for ComfyUI**, next to the existing *Export original graph* — it serialises
the fields listed in the schema below from the recipe the user already has.
Original-graph exports stay untouched.

### 2. Outputs of `PromptNookRecipeLoader`

v0 exposes exactly what a standard checkpoint graph consumes, so the loader
plugs into nodes the user already has:

| output | type | source field |
|---|---|---|
| `positive` | STRING | `positivePrompt` |
| `negative` | STRING | `negativePrompt` |
| `width`, `height` | INT | `params.width`, `params.height` |
| `steps` | INT | `params.steps` |
| `cfg` | FLOAT | `params.cfg` |
| `seed` | INT | `params.seed` |
| `sampler`, `scheduler` | STRING | `params.sampler`, `params.scheduler` |
| `checkpoint_name` | STRING | `modelName` (portable path, see resources) |
| `lora_stack_json` | STRING | ordered `loras`, for the follow-up node |
| `title` | STRING | `title` (so the user can see which recipe is loaded) |

The seed deserves a note: PromptNook stores it as a string because ComfyUI
seeds exceed JavaScript's safe integer range. The node parses it to INT and
preserves `-1` as "randomize at queue time", matching KSampler behaviour.

The LoRA stack is text in v0. Building an ordered `LoraLoader` chain at
runtime is graph mutation ComfyUI does not support; the honest v0 is a JSON
output a follow-up node (or the existing Inspire-style LoRA stack builders)
can consume. That is the follow-up implementation issue, not v0.

### 3. Missing local resources: resolve, show, never substitute

`checkpoint_name` and every LoRA name are resolved against
`folder_paths.get_folder_paths("checkpoints" / "loras")` at node execution:

- resolved: the portable path is passed through unchanged;
- unresolved: the name is still passed through unchanged, the node's
  `has_unresolved_resources` output flips to true, and the title gets a
  marker in the UI. The user picks the right local model in their own
  loader — the node never silently substitutes a file it did not find.

This mirrors the boundary PromptNook's own export already documents: it
completes with a warning and uses the safest saved name, and the generated
workflow is not verified against the user's installed models.

### 4. Manager and Registry compatibility

The node ships as a standard `custom_nodes` package: `pyproject.toml` with
the ComfyUI Registry metadata, no dependencies beyond ComfyUI itself (JSON
parsing only), `NODE_CLASS_MAPPINGS` with one class, and a web directory only
if the recipe picker needs one later. It installs through ComfyUI Manager and
the Registry like any node pack. Nothing in the package reads or writes the
PromptNook application data.

## The v1 schema

```json
{
  "schema": "promptnook.recipe.v1",
  "title": "Neon street in the rain",
  "modality": "text_to_image",
  "positivePrompt": "...",
  "negativePrompt": "...",
  "modelName": "sdxl/model.safetensors",
  "loras": [
    { "name": "detail-tweaker", "modelStrength": 0.8, "clipStrength": 0.9, "order": 0 }
  ],
  "params": {
    "width": 1024, "height": 1024,
    "sampler": "euler", "scheduler": "normal",
    "steps": 30, "cfg": 7.0, "seed": "123456789012345678"
  },
  "exportedAt": "2026-11-04T12:00:00Z"
}
```

Every field is read from the existing `Recipe` type — the export is a
projection, not a new format to maintain in parallel.

## Versioning and failure behavior

- The `schema` field is required and version-checked: the node accepts
  `promptnook.recipe.v1`, rejects a higher major with a message naming the
  found version, and treats a missing field as invalid.
- Required fields (`positivePrompt`, `params`) missing or of the wrong type:
  `ValidationError` naming the field — the workflow does not queue with a
  silently emptied prompt.
- Optional fields (`negativePrompt`, `loras`, `seed`) fall back to documented
  defaults: empty strings, an empty stack, and a randomized seed.
- The watched directory missing or empty: the combo shows one
  "no PromptNook recipes found — export one from PromptNook" entry, the node
  raises on execution, and nothing queues.

## Minimal example workflow

`CheckpointLoaderSimple` → `PromptNookRecipeLoader` (recipe picked from the
watched folder) → the loader's `positive`/`negative` feed two
`CLIPTextEncode` nodes, `width`/`height` feed `EmptyLatentImage`,
`steps`/`cfg`/`seed`/`sampler` feed `KSampler`, `checkpoint_name` is advisory
for the checkpoint the user selects. The JSON the design ships with this PR
contains the same graph in ComfyUI Workflow 0.4 format.

## Proposed split into follow-up issues

1. The loader node + v1 schema + example workflow (this design).
2. The PromptNook export action (Export recipe for ComfyUI) — one button, one
   serialiser, testable in the browser suite.
3. The LoRA stack consumer (ordered LoRA application) — depends on which
   stack convention the community standardises on.
4. `.promptnook` package support and a package picker.

## Why not read the backup JSON directly

The browser backup and the desktop database are app-private: their shape
follows the schema migrations (desktop schema 5 → 6 shipped a pre-migration
snapshot precisely because the shape changes). A node that reads them breaks
on every PromptNook release that touches storage. The v1 export is a
documented boundary PromptNook owns and can keep stable across migrations —
which is the whole point of the companion node.
