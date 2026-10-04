import { describe, expect, it } from "vitest";
import { importRecipeFromText, matchResource, toRecipeInput } from "./comfyuiImport";
import { isSourceWorkflow, originalWorkflowExport } from "./sourceWorkflow";
import { recipeFingerprint } from "./recipeFingerprint";
import type { Resource } from "../types";

const graph = { version: 0.4, nodes: [
  { id: 1, type: "UNETLoader", widgets_values: ["flux1-dev.safetensors", "default"], pos: [50, 80] },
  { id: 2, type: "MyCustomUpscaler", widgets_values: ["preserve this", 1.5], properties: { custom: [1, "two"] } },
], links: [], extra: { arbitrary: { keep: true } } };

describe("original ComfyUI graph preservation", () => {
  it("keeps FLUX and custom nodes unchanged when recipe fields are edited", () => {
    const input = toRecipeInput(importRecipeFromText(JSON.stringify(graph), "flux.json"), []);
    input.positivePrompt = "edited prompt";
    input.params.seed = "99";
    const result = originalWorkflowExport({ ...input, id: "saved" });
    expect(result.workflow).toEqual(graph);
    expect(result.fileName).toBe("flux.original.json");
    expect(result.warnings[0]).toContain("recipe edits are not applied");
    result.workflow.extra = {};
    expect(input.sourceWorkflow?.graph).toEqual(graph);
  });

  it("preserves valid custom-only graphs as drafts instead of dropping their nodes", () => {
    const source = { nodes: [{ id: 1, type: "CustomPipeline", widgets_values: ["anything"] }], links: [] };
    const input = toRecipeInput(importRecipeFromText(JSON.stringify(source)), []);
    expect(input.status).toBe("draft");
    expect(input.notes).toContain("original graph is preserved");
    expect(input.sourceWorkflow?.graph).toEqual(source);
  });

  it("unwraps API prompt envelopes and identifies the export format", () => {
    const apiGraph = { "10": { class_type: "CustomRender", inputs: { value: "hello" } } };
    const input = toRecipeInput(importRecipeFromText(JSON.stringify({ prompt: apiGraph })), []);
    const result = originalWorkflowExport({ ...input, id: "api" });
    expect(result.workflow).toEqual(apiGraph);
    expect(result.format).toBe("ComfyUI API prompt");
    expect(result.fileName).toContain(".api.json");
  });

  it("rejects malformed original graphs", () => {
    expect(isSourceWorkflow({ format: "workflow", graph: { nodes: [] } })).toBe(false);
    expect(isSourceWorkflow({ format: "api_prompt", graph: { invalid: true } })).toBe(false);
    expect(() => originalWorkflowExport({ id: "old", title: "Old recipe" })).toThrow("no saved original");
  });

  it("preserves exact large seeds inside nested API and workflow envelopes", () => {
    const rawGraph = '{"version":0.4,"nodes":[{"id":1,"type":"CustomPipeline","widgets_values":[18446744073709551615]}],"links":[]}';
    const envelope = `{"description":"escaped \\"quotes\\" and } braces", "unused":[1,{"x":null}], "workflow": ${rawGraph}}`;
    const input = toRecipeInput(importRecipeFromText(envelope), []);
    expect(originalWorkflowExport({ ...input, id: "large" }).json).toBe(rawGraph);
    const rawApi = '{"1":{"class_type":"CustomPipeline","inputs":{"seed":18446744073709551615}}}';
    const api = toRecipeInput(importRecipeFromText(`{"prompt":${rawApi}}`), []);
    expect(originalWorkflowExport({ ...api, id: "api" }).json).toBe(rawApi);
  });

  it("retains distinct source graphs when their extracted recipe fields match", () => {
    const first = toRecipeInput(importRecipeFromText(JSON.stringify(graph)), []);
    const second = toRecipeInput(importRecipeFromText(JSON.stringify({ ...graph, extra: { variant: "other" } })), []);
    expect(recipeFingerprint(first, [])).not.toBe(recipeFingerprint(second, []));
    const copy = { ...first, sourceWorkflow: { ...first.sourceWorkflow!, graph: {
      extra: graph.extra, links: graph.links, nodes: graph.nodes, version: graph.version,
    } } };
    expect(recipeFingerprint(copy, [])).toBe(recipeFingerprint(first, []));
  });

  it("matches subfolders and refuses ambiguous model filenames", () => {
    const resources: Resource[] = ["style", "other"].map((folder) => ({
      id: folder, name: "Same model", path: `C:/models/${folder}/model.safetensors`,
      resourceType: "checkpoint", available: true, triggerWords: [], confirmedTriggerWords: [],
    }));
    expect(matchResource(resources, "style\\model.safetensors")?.id).toBe("style");
    expect(matchResource(resources, "model.safetensors")).toBeUndefined();
    expect(matchResource(resources, "missing/model.safetensors")).toBeUndefined();
  });
});
