import { describe, expect, it } from "vitest";

import { deriveRecipeTitle } from "./recipeTitle";

describe("deriveRecipeTitle", () => {
  it("keeps an explicitly entered title", () => {
    expect(deriveRecipeTitle("  我的配方  ", "portrait")).toBe("我的配方");
  });

  it("uses the first top-level Prompt fragment when the title is blank", () => {
    expect(
      deriveRecipeTitle("", "(portrait, close-up:1.2), soft light"),
    ).toBe("(portrait, close-up:1.2)");
  });

  it("uses a dated unnamed title when both title and Prompt are blank", () => {
    expect(
      deriveRecipeTitle("", "", "2026-07-28T05:30:00.000Z"),
    ).toBe("Untitled recipe · 2026-07-28");
  });
});
