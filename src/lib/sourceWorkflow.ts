import type { Recipe, SourceWorkflow } from "../types";

export function isSourceWorkflow(value: unknown): value is SourceWorkflow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Partial<SourceWorkflow>;
  let graph = source.graph;
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return false;
  if (source.json !== undefined) {
    if (typeof source.json !== "string") return false;
    try { graph = JSON.parse(source.json); } catch { return false; }
    if (!graph || typeof graph !== "object" || Array.isArray(graph)) return false;
  }
  if (source.fileName !== undefined && typeof source.fileName !== "string") return false;
  if (source.format === "workflow") return Array.isArray(graph.nodes) && graph.nodes.length > 0;
  if (source.format !== "api_prompt") return false;
  const nodes = Object.values(graph);
  return nodes.length > 0 && nodes.every((node) => node && typeof node === "object" &&
    !Array.isArray(node) && typeof (node as Record<string, unknown>).class_type === "string");
}

export const ORIGINAL_WORKFLOW_WARNING = "Original graph snapshot: recipe edits are not applied. Required models and custom nodes must be installed in ComfyUI.";

export function originalWorkflowExport(recipe: Pick<Recipe, "id" | "title" | "sourceWorkflow">) {
  if (!isSourceWorkflow(recipe.sourceWorkflow)) throw new Error("This recipe has no saved original ComfyUI graph. Import its PNG or workflow JSON first.");
  const source = recipe.sourceWorkflow;
  const stem = (source.fileName || recipe.title || recipe.id).split(/[/\\]/).pop()!
    .replace(/\.(png|json)$/i, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 80) || "workflow";
  return {
    workflow: structuredClone(source.graph),
    json: source.json,
    fileName: `${stem}.original${source.format === "api_prompt" ? ".api" : ""}.json`,
    warnings: [ORIGINAL_WORKFLOW_WARNING],
    format: source.format === "api_prompt" ? "ComfyUI API prompt" : "Original ComfyUI workflow",
  };
}

/** Used for conservative source-graph duplicate comparison; object key order
 * does not matter, but node arrays, widget values, and layout are preserved. */
export function canonicalGraph(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalGraph);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalGraph(item)]));
  }
  return value;
}
