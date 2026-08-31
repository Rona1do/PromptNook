import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";

describe("PromptNook browser fallback smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders all navigation destinations, opens Ctrl+K search, and creates a new recipe", async () => {
    render(<App />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Recipes" }),
    ).toBeInTheDocument();
    for (const label of ["Recipes", "Snippets", "Studio", "Models & LoRA", "Notes"]) {
      expect(
        screen.getByRole("button", { name: new RegExp(`^${label}`) }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText("Browser demo mode")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /^New recipe$/ }),
    );
    const recipeEditor = await screen.findByRole("dialog", {
      name: /Untitled recipe/,
    });
    expect(recipeEditor).toBeInTheDocument();
    expect(recipeEditor).toHaveTextContent("New recipe");
    expect(
      screen.getByPlaceholderText("Leave blank to derive a title from the positive prompt"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));

    fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true });
    const searchDialog = await screen.findByRole("dialog", {
      name: "Global search",
    });
    expect(searchDialog).toBeInTheDocument();
    fireEvent.change(
      screen.getByPlaceholderText("Search prompts, translations, categories, or models…"),
      { target: { value: "镜头" } },
    );

    expect(
      await screen.findByText("She made a V-sign at the camera"),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Global search" }),
      ).not.toBeInTheDocument(),
    );
  });
});
