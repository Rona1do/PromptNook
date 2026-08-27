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
      await screen.findByRole("heading", { level: 1, name: "总 Prompt" }),
    ).toBeInTheDocument();
    for (const label of ["Recipes", "Snippets", "Studio", "Models & LoRA", "Notes"]) {
      expect(
        screen.getByRole("button", { name: new RegExp(`^${label}`) }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText("Browser demo mode")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /^新建总 Prompt$/ }),
    );
    const recipeEditor = await screen.findByRole("dialog", {
      name: /未命名 Prompt/,
    });
    expect(recipeEditor).toBeInTheDocument();
    expect(recipeEditor).toHaveTextContent("新建总 Prompt");
    expect(
      screen.getByPlaceholderText("留空将使用正向 Prompt 开头自动命名"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^关闭$/ }));

    fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true });
    const searchDialog = await screen.findByRole("dialog", {
      name: "全局搜索",
    });
    expect(searchDialog).toBeInTheDocument();
    fireEvent.change(
      screen.getByPlaceholderText("搜索中文、英文、分类或模型…"),
      { target: { value: "镜头" } },
    );

    expect(
      await screen.findByText("She made a V-sign at the camera"),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "全局搜索" }),
      ).not.toBeInTheDocument(),
    );
  });
});
