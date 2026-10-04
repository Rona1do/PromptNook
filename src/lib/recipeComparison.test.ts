import { describe, expect, it } from "vitest";
import { compareRecipes } from "./recipeComparison";
import { importRecipeFromText, toRecipeInput } from "./comfyuiImport";
import type { Recipe, Resource } from "../types";

const recipe = (): Recipe => ({ ...toRecipeInput(importRecipeFromText("a garden\nSteps: 24, Seed: 42"), []),
  id: "test", createdAt: "", updatedAt: "", promptModel: "general" });
describe("recipe comparison", () => {
  it("distinguishes identically named models in different catalog subfolders", () => {
    const resources: Resource[] = ["a", "b"].map((id) => ({ id, name: "Model", resourceType: "checkpoint",
      path: `C:/models/checkpoints/${id}/model.safetensors`, available: true, triggerWords: [], confirmedTriggerWords: [] }));
    const left = { ...recipe(), modelId: "a", modelName: "Model" };
    const right = { ...recipe(), modelId: "b", modelName: "Model" };
    expect(compareRecipes(left, right, resources).find((field) => field.label === "Base model")?.different).toBe(true);
  });
  it("reports parameter and prompt changes while ignoring titles and rating", () => {
    const left = recipe();
    const right = { ...recipe(), title: "Different title", rating: 5, negativePrompt: "blurry", params: { ...left.params, seed: "43" } };
    expect(compareRecipes(left, right).filter((field) => field.different).map((field) => field.label))
      .toEqual(["Negative prompt", "Seed"]);
  });
  it("distinguishes zero from missing parameters", () => {
    const left = recipe();
    const right = { ...recipe(), params: { ...left.params, cfg: 0 } };
    expect(compareRecipes(left, right).find((field) => field.label === "CFG"))
      .toMatchObject({ left: "Not set", right: "0", different: true });
  });
});
