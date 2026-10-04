import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { expect, test } from "playwright/test";

test("imported FLUX graph survives edits, reload and original export", async ({ page }) => {
  const graph = { version: 0.4, nodes: [
    { id: 1, type: "UNETLoader", widgets_values: ["flux1-dev.safetensors", "default"], pos: [50, 80] },
    { id: 2, type: "CustomPipeline", widgets_values: ["unchanged", 1.5], properties: { token: "node-input" } },
  ], links: [], extra: { keep: { layout: [12, 34] }, unsafeSeed: 0 } };
  const rawGraph = JSON.stringify(graph).replace('"unsafeSeed":0', '"unsafeSeed":18446744073709551615');
  await page.goto("./");
  await page.getByLabel("Import recipe files").setInputFiles({
    name: "flux-custom.json", mimeType: "application/json", buffer: Buffer.from(rawGraph),
  });
  const review = page.getByRole("dialog", { name: "Review recipe imports" });
  await expect(review.getByText("Original graph preserved")).toBeVisible();
  await review.getByRole("button", { name: "Import 1 selected" }).click();
  await expect(review.getByText("Saved", { exact: true })).toBeVisible();
  await review.getByRole("button", { name: "Done" }).click();
  await page.getByRole("heading", { name: "flux-custom", exact: true }).click();
  let editor = page.getByRole("dialog", { name: "flux-custom", exact: true });
  await editor.getByPlaceholder("masterpiece, best quality, a portrait of…").fill("changed in PromptNook");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await page.getByRole("heading", { name: "flux-custom", exact: true }).click();
  editor = page.getByRole("dialog", { name: "flux-custom", exact: true });
  await expect(editor.getByPlaceholder("masterpiece, best quality, a portrait of…")).toHaveValue("changed in PromptNook");
  await expect(editor.getByText(/Recipe edits are only used/)).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await editor.getByRole("button", { name: "Export original graph", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("flux-custom.original.json");
  const path = await download.path();
  const exported = await readFile(path!, "utf8");
  expect(JSON.parse(exported)).toEqual(JSON.parse(rawGraph));
  expect(exported).toContain('"unsafeSeed":18446744073709551615');
});

test("compare results and inspect only changed recipe fields", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("./");
  await page.getByRole("button", { name: "Compare recipes", exact: true }).click();
  const compare = page.getByRole("dialog", { name: "Compare recipes" });
  await expect(compare.locator(".compare-covers img")).toHaveCount(2);
  await expect(compare.getByLabel("Only differences")).toBeChecked();
  await expect(compare.getByRole("rowheader", { name: /Positive prompt/ })).toBeVisible();
  await expect(compare.getByRole("rowheader", { name: "Modality", exact: true })).toHaveCount(0);
  await compare.getByLabel("Only differences").uncheck();
  await expect(compare.getByRole("rowheader", { name: "Modality", exact: true })).toBeVisible();
  await compare.getByLabel("Only differences").check();
  await page.screenshot({ path: ".local/recipe-comparison.png", fullPage: true });
  await compare.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Enable privacy mode", exact: true }).click();
  await page.getByRole("button", { name: "Compare recipes", exact: true }).click();
  await expect(compare.getByText("Prompts, notes, and images are hidden in privacy mode.")).toBeVisible();
  await expect(compare.locator("img")).toHaveCount(0);
  await expect(compare.getByRole("rowheader", { name: /Positive prompt/ })).toHaveCount(0);
});
