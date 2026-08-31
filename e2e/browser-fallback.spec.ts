import { expect, test } from "playwright/test";

test("browser fallback supports the five destinations and a snippet creation journey", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByText("Browser demo mode")).toBeVisible();
  const destinations = [
    ["Recipes", "Recipes"],
    ["Snippets", "Snippets"],
    ["Studio", "Studio"],
    ["Models & LoRA", "Models & LoRAs"],
    ["Notes", "Tips"],
  ];
  for (const [navigationLabel, heading] of destinations) {
    await page
      .getByRole("button", { name: new RegExp(`^${navigationLabel}`) })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: heading }),
    ).toBeVisible();
  }

  await page
    .getByRole("button", { name: /^Snippets/ })
    .first()
    .click();
  await page.getByRole("button", { name: "New snippet" }).first().click();

  const editor = page.getByRole("dialog", { name: "New snippet" });
  await expect(editor).toBeVisible();
  await editor
    .getByPlaceholder("She made a V-sign at the camera")
    .fill("standing under a paper umbrella");
  await editor.getByLabel("Translation", { exact: true }).fill("站在纸伞下");
  await editor.getByRole("button", { name: "Action", exact: true }).click();
  await editor.getByRole("button", { name: "Save snippet" }).click();

  await expect(page.getByText("standing under a paper umbrella")).toBeVisible();
  await expect(page.getByText("站在纸伞下", { exact: true })).toBeVisible();

  await page.keyboard.press("Control+K");
  const search = page.getByRole("dialog", { name: "Global search" });
  await expect(search).toBeVisible();
  await search.getByPlaceholder("Search prompts, translations, categories, or models…").fill("纸伞");
  const searchResult = search.getByRole("button", {
    name: /standing under a paper umbrella.*站在纸伞下/,
  });
  await expect(searchResult).toBeVisible();
  await searchResult.click();
  await expect(
    page.getByRole("dialog", { name: "Edit snippet" }),
  ).toBeVisible();
  await page.getByRole("dialog", { name: "Edit snippet" }).getByRole("button", {
    name: "Close",
  }).click();

  await page
    .getByRole("button", { name: /^Studio/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Studio" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Settings & safety" })).toBeVisible();
  await expect(
    settings.getByRole("button", { name: /Backup & export/ }),
  ).toBeVisible();

  await settings.getByRole("button", { name: "Translation", exact: true }).click();
  await settings
    .getByRole("button", { name: "Apply Google preset" })
    .click();
  await expect(settings.getByLabel("API endpoint")).toHaveValue(
    "https://generativelanguage.googleapis.com/v1beta/openai",
  );
  await expect(settings.getByLabel("Model name")).toHaveValue(
    "gemini-3.1-flash-lite",
  );
  await settings.getByRole("button", { name: "Test translation" }).click();
  await expect(settings.getByText(/Connection successful.*电影胶片剧照/i)).toBeVisible();
  await expect(settings.getByRole("button", { name: "Test translation" })).toBeEnabled();
});

test("recipe resource search, responsive LoRA picker and empty parameters work together", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New recipe" }).click();

  const editor = page.getByRole("dialog");
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Title (optional)")).toHaveValue("");
  await editor
    .getByPlaceholder("masterpiece, best quality, a portrait of…")
    .fill("cinematic portrait, golden hour");
  await editor.getByRole("button", { name: "Models & parameters" }).click();

  await expect(editor.getByLabel("Width")).toHaveValue("");
  await expect(editor.getByLabel("Height")).toHaveValue("");
  await expect(editor.getByLabel("Sampler")).toHaveValue("");
  await expect(editor.getByLabel("Scheduler")).toHaveValue("");

  await editor.getByRole("button", { name: "Add LoRA" }).click();
  const picker = editor.locator(".lora-picker");
  await expect(picker).toBeVisible();
  const pickerMetrics = await picker.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(pickerMetrics.clientWidth).toBeGreaterThan(500);
  expect(pickerMetrics.scrollWidth).toBeLessThanOrEqual(
    pickerMetrics.clientWidth + 1,
  );

  await editor.getByRole("textbox", { name: "Search LoRAs" }).fill("Natural");
  await expect(
    picker.getByRole("button", { name: /Natural Hand Poses/ }),
  ).toBeVisible();
  await expect(
    picker.getByRole("button", { name: /Cinematic Film Still/ }),
  ).toHaveCount(0);

  await editor
    .getByRole("textbox", { name: "Search base models" })
    .fill("Dream");
  const modelSelect = editor.getByLabel("Checkpoint / Diffusion model");
  await expect(modelSelect.locator("option")).toHaveCount(2);
  await expect(
    modelSelect.getByRole("option", { name: "DreamShaper XL Turbo" }),
  ).toBeAttached();

  await editor.getByRole("button", { name: /Images & notes/ }).click();
  await editor
    .locator('input[type="file"]')
    .setInputFiles("e2e/fixtures/wide-example.svg");
  await expect(editor.getByAltText("wide-example.svg")).toBeVisible();

  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "cinematic portrait" }),
  ).toBeVisible();
  const thumbnail = page.getByAltText("cinematic portrait preview image");
  await expect(thumbnail).toBeVisible();
  await expect(thumbnail).toHaveCSS("object-fit", "contain");

  await page
    .getByRole("button", { name: /^Models & LoRA/ })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Search models & LoRAs" })
    .fill("film grain");
  await expect(
    page.getByRole("heading", { name: "Cinematic Film Still" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "DreamShaper XL Turbo" }),
  ).toHaveCount(0);
  await expect(page.getByText("Show 1 / 5")).toBeVisible();
});

test("capture English documentation screenshots", async ({ page }) => {
  test.skip(
    process.env.PROMPTNOOK_CAPTURE_SCREENSHOTS !== "1",
    "Run with PROMPTNOOK_CAPTURE_SCREENSHOTS=1 to refresh documentation images",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Recipes" })).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/recipes.png", fullPage: true });

  await page.getByRole("button", { name: /^Studio/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Studio" })).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/studio.png", fullPage: true });

  await page.getByRole("button", { name: /^Models & LoRA/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Models & LoRAs" })).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/models-and-loras.png",
    fullPage: true,
  });
});
