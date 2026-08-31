import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { AppSettings, RecipeInput } from "../types";
import { StudioPage } from "./StudioPage";

const settings: AppSettings = {
  privacyMode: false,
  loraPath: "",
  checkpointPath: "",
  diffusionModelPath: "",
  backupPath: "",
  translationProvider: "off",
  translationEndpoint: "",
  translationModel: "",
  onlineTranslationEnabled: false,
  translationTargetLanguage: "en",
  promptModels: [
    { id: "general", name: "General", description: "General workspace" },
  ],
  activePromptModel: "general",
  defaultPrefix: "best quality",
  defaultNegative: "",
};

it("saves from the studio without requiring a recipe title", async () => {
  const onSaveRecipe = vi.fn(async (_recipe: RecipeInput) => undefined);
  render(
    <StudioPage
      snippets={[]}
      categories={[]}
      recipes={[]}
      resources={[]}
      tips={[]}
      settings={settings}
      onQueuedSnippetConsumed={vi.fn()}
      onSaveRecipe={onSaveRecipe}
      onSnippetUsed={vi.fn(async () => undefined)}
      onToast={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Save as recipe" }));
  expect(screen.getByLabelText("Recipe title (optional)")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));

  await waitFor(() => expect(onSaveRecipe).toHaveBeenCalledTimes(1));
  expect(onSaveRecipe.mock.calls[0][0]).toMatchObject({
    title: "",
    positivePrompt: "best quality",
    status: "draft",
  });
});
