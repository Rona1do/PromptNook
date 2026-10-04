import { Buffer } from "node:buffer";
import { expect, test } from "playwright/test";

const parameters = (seed: string) => `a quiet garden\nNegative prompt: blurry\nSteps: 24, Sampler: Euler, CFG scale: 7, Seed: ${seed}, Size: 512x768, Model: garden.safetensors`;

// A valid 1x1 PNG with an A1111 tEXt chunk, so metadata and real cover
// persistence are exercised together without depending on a user's image.
function generationPng(text: string) {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  const payload = Buffer.from(`parameters\0${text}`, "latin1");
  const type = Buffer.from("tEXt");
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([type, payload])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([png.subarray(0, 33), length, type, payload, checksum, png.subarray(33)]);
}

test("review a mixed batch, persist selected recipes and covers, and detect duplicates after reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Recipes", exact: true })).toBeVisible();
  const before = await page.locator(".recipe-card").count();
  const files = [
    { name: "garden.png", mimeType: "image/png", buffer: generationPng(parameters("42")) },
    { name: "garden-copy.txt", mimeType: "text/plain", buffer: Buffer.from(parameters("42")) },
    { name: "another-seed.txt", mimeType: "text/plain", buffer: Buffer.from(parameters("43")) },
    { name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{invalid") },
  ];
  await page.getByLabel("Import recipe files").setInputFiles(files);
  const review = page.getByRole("dialog", { name: "Review recipe imports" });
  await expect(review.getByRole("button", { name: "Import 2 selected" })).toBeEnabled();
  await expect(review.getByLabel("Import garden-copy.txt")).not.toBeChecked();
  await expect(review.getByRole("alert")).toContainText("could not be parsed");
  await expect(page.locator(".recipe-card")).toHaveCount(before);
  const firstRow = review.locator(".import-review-row").first();
  await firstRow.getByText("Prompt & generation details").click();
  await expect(firstRow.getByText("a quiet garden", { exact: true })).toBeVisible();
  await expect(firstRow.locator("img")).toBeVisible();
  await expect(firstRow.locator("img")).toHaveJSProperty("naturalWidth", 1);
  await page.screenshot({ path: ".local/import-review.png", fullPage: true });
  await review.getByRole("button", { name: "Import 2 selected" }).click();
  await expect(review.getByText("Saved", { exact: true })).toHaveCount(2);
  await review.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".recipe-card")).toHaveCount(before + 2);

  await page.reload();
  await expect(page.locator(".recipe-card")).toHaveCount(before + 2);
  const garden = page.locator(".recipe-card").filter({ has: page.getByRole("heading", { name: "garden", exact: true }) });
  await expect(garden.locator("img")).toHaveJSProperty("naturalWidth", 1);
  await page.getByLabel("Import recipe files").setInputFiles(files.slice(0, 3));
  await expect(review.getByRole("button", { name: "Import 0 selected" })).toBeDisabled();
  await expect(review.getByText("Duplicate", { exact: true })).toHaveCount(3);
  await review.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".recipe-card")).toHaveCount(before + 2);
});
