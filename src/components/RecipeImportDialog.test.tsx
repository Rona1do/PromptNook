import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Recipe, RecipeInput } from "../types";
import { importRecipeFromText, toRecipeInput } from "../lib/comfyuiImport";
import { RecipeImportDialog } from "./RecipeImportDialog";

const parameters = (seed = "42") => `a quiet garden\nNegative prompt: blurry\nSteps: 24, Sampler: Euler, CFG scale: 7, Seed: ${seed}, Size: 512x768, Model: garden.safetensors`;
function textFile(name: string, text = parameters(), type = "text/plain") {
  const file = new File([text], name, { type });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode(text).buffer });
  return file;
}
function renderImport(files: File[], recipes: Recipe[] = []) {
  const props = { files, recipes, resources: [], privacyMode: false,
    onSave: vi.fn(async (_input: RecipeInput): Promise<void> => undefined), importCover: vi.fn(), onClose: vi.fn(), onToast: vi.fn() };
  const view = render(<RecipeImportDialog {...props} />);
  return { ...props, ...view };
}
afterEach(cleanup);

describe("recipe import review", () => {
  it("reviews mixed files, skips library and batch duplicates, and only saves selected entries", async () => {
    const existing: Recipe = { ...toRecipeInput(importRecipeFromText(parameters()), []),
      promptModel: "general", createdAt: "", updatedAt: "", id: "existing", title: "Saved garden" };
    const props = renderImport([
      textFile("existing.txt"), textFile("new.txt", parameters("43")),
      textFile("copy.txt", parameters("43")), textFile("broken.json", "{invalid"),
      textFile("unsupported.jpg", parameters(), "image/jpeg"),
    ], [existing]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Import 1 selected" })).toBeEnabled());
    expect(screen.getByLabelText("Import existing.txt")).not.toBeChecked();
    expect(screen.getByLabelText("Import copy.txt")).not.toBeChecked();
    expect(screen.getByLabelText("Import new.txt")).toBeChecked();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.importCover).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import 1 selected" }));
    await screen.findByText("Saved", { selector: ".badge" });
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onSave.mock.calls[0][0]).toMatchObject({ params: { seed: "43" } });
  });

  it("allows selecting a duplicate explicitly and cancelling without saving", async () => {
    const props = renderImport([textFile("first.txt"), textFile("copy.txt")]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Import 1 selected" })).toBeEnabled());
    fireEvent.click(screen.getByLabelText("Import copy.txt"));
    expect(screen.getByRole("button", { name: "Import 2 selected" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
    expect(screen.getByRole("button", { name: "Import 0 selected" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Select new recipes" }));
    expect(screen.getByLabelText("Import first.txt")).toBeChecked();
    expect(screen.getByLabelText("Import copy.txt")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("continues after a save failure and retries only unsaved rows", async () => {
    const props = renderImport([textFile("retry.txt"), textFile("success.txt", parameters("43"))]);
    props.onSave.mockRejectedValueOnce(new Error("Disk full"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Import 2 selected" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Import 2 selected" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Import 1 selected" })).toBeEnabled());
    expect(screen.getByRole("alert")).toHaveTextContent("Disk full");
    expect(props.onSave).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Import 1 selected" }));
    await waitFor(() => expect(screen.getAllByText("Saved", { selector: ".badge" })).toHaveLength(2));
    expect(props.onSave).toHaveBeenCalledTimes(3);
    expect(props.onSave.mock.calls[2][0]).toMatchObject({ params: { seed: "42" } });
  });

  it("prevents closing or starting another write while an import is saving", async () => {
    const props = renderImport([textFile("garden.txt")]);
    let finish!: () => void;
    props.onSave.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Import 1 selected" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Import 1 selected" }));
    expect(screen.getByRole("button", { name: "Importing…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(props.onClose).not.toHaveBeenCalled();
    finish();
    await screen.findByText("Saved", { selector: ".badge" });
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it("hides prompt text in privacy mode", async () => {
    const props = renderImport([textFile("private.txt")]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Import 1 selected" })).toBeEnabled());
    props.rerender(<RecipeImportDialog {...props} privacyMode />);
    expect(screen.queryByText("a quiet garden")).not.toBeInTheDocument();
    expect(screen.getByText("Prompts and covers are hidden in privacy mode.")).toBeInTheDocument();
  });
});
