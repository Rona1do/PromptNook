import { useEffect, useRef, useState } from "react";
import type { Asset, Recipe, RecipeInput, Resource } from "../types";
import { importRecipeFromFile, recipeExportDeferred, toRecipeInput } from "../lib/comfyuiImport";
import { readableError } from "../lib/errors";
import { recipeFingerprint } from "../lib/recipeFingerprint";
import { Badge, Button, Modal } from "./ui";

type ImportStatus = "reading" | "ready" | "invalid" | "saving" | "saved" | "failed";
interface ImportRow {
  file: File;
  status: ImportStatus;
  selected: boolean;
  recipe?: RecipeInput;
  duplicateOf?: string;
  error?: string;
  previewUrl?: string;
}

export function RecipeImportDialog({ files, recipes, resources, privacyMode, onSave,
  importCover, onClose, onToast }: {
  files: File[];
  recipes: Recipe[];
  resources: Resource[];
  privacyMode: boolean;
  onSave: (recipe: RecipeInput) => Promise<void>;
  importCover: (file: File) => Promise<Asset>;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [rows, setRows] = useState<ImportRow[]>(() => files.map((file) => ({
    file, status: "reading", selected: false,
  })));
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const initial = useRef({ files, recipes, resources });

  function updateRow(index: number, update: Partial<ImportRow>) {
    setRows((current) => current.map((row, i) => i === index ? { ...row, ...update } : row));
  }

  useEffect(() => {
    let active = true;
    const previews: string[] = [];
    const snapshot = initial.current;
    const known = new Map(snapshot.recipes.map((recipe) => [
      recipeFingerprint(recipe, snapshot.resources), recipe.title || "Untitled recipe",
    ]));
    async function readFiles() {
      for (const [index, file] of snapshot.files.entries()) {
        if (!active) break;
        try {
          if (!/\.(png|json|txt)$/i.test(file.name) &&
            !["image/png", "application/json", "text/plain"].includes(file.type)) {
            throw new Error("Unsupported file. Choose a ComfyUI PNG, workflow JSON, or A1111 text file.");
          }
          const draft = await importRecipeFromFile(file);
          if (!active) break;
          const recipe = toRecipeInput(draft, snapshot.resources);
          const fingerprint = recipeFingerprint(recipe, snapshot.resources);
          const duplicateOf = known.get(fingerprint);
          if (!duplicateOf) known.set(fingerprint, file.name);
          let previewUrl: string | undefined;
          if (file.type === "image/png" || /\.png$/i.test(file.name)) {
            previewUrl = URL.createObjectURL(file);
            previews.push(previewUrl);
          }
          updateRow(index, { recipe, duplicateOf, previewUrl, status: "ready", selected: !duplicateOf });
        } catch (error) {
          if (active) updateRow(index, { status: "invalid", error: readableError(error) });
        }
      }
    }
    void readFiles();
    return () => {
      active = false;
      previews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const reading = rows.some((row) => row.status === "reading");
  const selected = rows.filter((row) => row.selected && ["ready", "failed"].includes(row.status));
  const savedCount = rows.filter((row) => row.status === "saved").length;
  const errorCount = rows.filter((row) => ["invalid", "failed"].includes(row.status)).length;
  const duplicateCount = rows.filter((row) => row.duplicateOf).length;

  async function saveSelected() {
    if (saveLock.current || reading || !selected.length) return;
    saveLock.current = true;
    setSaving(true);
    let saved = 0;
    let failed = 0;
    try {
      for (const [index, row] of rows.entries()) {
        if (!row.selected || !row.recipe || !["ready", "failed"].includes(row.status)) continue;
        updateRow(index, { status: "saving", error: undefined });
        try {
          // Create cover assets only after the user chooses to save. Reuse a
          // successfully imported cover if the recipe write needs to be retried.
          let recipe = row.recipe;
          if (row.previewUrl && !recipe.coverAssetId) {
            const asset = await importCover(row.file);
            recipe = { ...recipe, assets: [asset], coverAssetId: asset.id };
            updateRow(index, { recipe });
          }
          await onSave(recipe);
          updateRow(index, { status: "saved", selected: false });
          saved += 1;
        } catch (error) {
          updateRow(index, { status: "failed", error: readableError(error) });
          failed += 1;
        }
      }
      onToast(`Imported ${saved} recipe(s)${failed ? `; ${failed} failed. Review the errors and retry.` : "."}`);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  function selectNew() {
    setRows((current) => current.map((row) => ({ ...row,
      selected: ["ready", "failed"].includes(row.status) && !row.duplicateOf,
    })));
  }

  return (
    <Modal title="Review recipe imports" eyebrow="Batch import" size="lg"
      onClose={() => { if (!saveLock.current) onClose(); }}
      footer={<>
        <span className="import-footer-status" role="status" aria-live="polite">
          {saving ? "Saving selected recipes…" : reading ? "Reading files…" : `${selected.length} selected · ${savedCount} saved · ${errorCount} errors`}
        </span>
        <Button variant="secondary" disabled={saving} onClick={onClose}>{savedCount ? "Done" : "Cancel"}</Button>
        <Button disabled={reading || saving || !selected.length} onClick={() => void saveSelected()}>
          {saving ? "Importing…" : `Import ${selected.length} selected`}
        </Button>
      </>}
    >
      <div className="recipe-import-review" aria-busy={reading || saving}>
        <p>Review generation data before adding it to this workspace. Matching prompts, models, ordered LoRAs, and parameters are unchecked by default. You can select duplicates to keep another copy.</p>
        <div className="import-review-toolbar">
          <span>{files.length} files · {duplicateCount} duplicates</span>
          <Button variant="ghost" size="sm" disabled={reading || saving} onClick={selectNew}>Select new recipes</Button>
          <Button variant="ghost" size="sm" disabled={reading || saving}
            onClick={() => setRows((current) => current.map((row) => ({ ...row, selected: false })))}>Deselect all</Button>
        </div>
        <ul className="import-review-list">
          {rows.map((row, index) => (
            <li className="import-review-row" key={index}>
              <div className="import-review-heading">
                <input type="checkbox" aria-label={`Import ${row.file.name}`}
                  checked={row.selected} disabled={reading || saving || !["ready", "failed"].includes(row.status)}
                  onChange={(event) => updateRow(index, { selected: event.target.checked })} />
                <strong>{row.file.name}</strong>
                <Badge tone={row.status === "saved" ? "success" : row.error ? "danger" : row.duplicateOf ? "warning" : "neutral"}>
                  {row.status === "ready" ? row.duplicateOf ? "Duplicate" : "Ready" : row.status === "invalid" ? "Cannot import" : row.status === "failed" ? "Save failed" : row.status === "saved" ? "Saved" : row.status === "saving" ? "Saving…" : "Reading…"}
                </Badge>
              </div>
              {row.duplicateOf ? <p className="import-duplicate">Same generation data as “{row.duplicateOf}”.</p> : null}
              {row.error ? <p className="import-error" role="alert">{row.error}</p> : null}
              {row.recipe ? <>
                <div className="import-recipe-meta">
                  {row.recipe.sourceWorkflow ? <Badge tone="success">Original graph preserved</Badge> : null}
                  <span>{row.recipe.modelName || "Model not found in metadata"}</span>
                  <span>{row.recipe.loras.length} LoRA(s)</span>
                  {row.recipe.params.width && row.recipe.params.height ? <span>{row.recipe.params.width} × {row.recipe.params.height}</span> : null}
                  {row.recipe.params.steps != null ? <span>{row.recipe.params.steps} steps</span> : null}
                  {recipeExportDeferred(row.recipe, resources) ? <Badge tone="warning">Recipe template unavailable</Badge> : null}
                </div>
                <details className="import-recipe-details">
                  <summary>Prompt & generation details</summary>
                  {privacyMode ? <p>Prompts and covers are hidden in privacy mode.</p> : <>
                    {row.previewUrl ? <img className="import-cover-preview" src={row.previewUrl} alt={`Cover from ${row.file.name}`} /> : null}
                    <dl><dt>Positive prompt</dt><dd>{row.recipe.positivePrompt || "None found"}</dd>
                      <dt>Negative prompt</dt><dd>{row.recipe.negativePrompt || "None found"}</dd></dl>
                  </>}
                  <dl><dt>Sampling</dt><dd>{row.recipe.params.sampler || "Not found"} · {row.recipe.params.scheduler || "Not found"} · CFG {row.recipe.params.cfg ?? "not found"} · Seed {row.recipe.params.seed || "not found"}</dd>
                    {row.recipe.loras.length ? <><dt>Ordered LoRAs</dt><dd>{row.recipe.loras.map((lora) => `${lora.name} (${lora.modelStrength} / ${lora.clipStrength})`).join(" → ")}</dd></> : null}
                    <dt>Import notes</dt><dd>{row.recipe.notes}</dd></dl>
                </details>
              </> : null}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
