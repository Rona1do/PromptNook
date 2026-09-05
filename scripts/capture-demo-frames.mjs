import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.PROMPTNOOK_DEMO_BASE_URL ?? "http://127.0.0.1:1423";
const outputDirectory = path.resolve("test-results", "demo-frames");
await fs.mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  acceptDownloads: true,
});
const page = await context.newPage();
page.on("pageerror", (error) => console.error("Browser error:", error.message));

async function addCaption(text) {
  await page.evaluate((caption) => {
    document.querySelector("[data-promptnook-demo-caption]")?.remove();
    const element = document.createElement("div");
    element.dataset.promptnookDemoCaption = "true";
    element.textContent = caption;
    Object.assign(element.style, {
      position: "fixed",
      zIndex: "99999",
      left: "50%",
      bottom: "24px",
      transform: "translateX(-50%)",
      padding: "13px 22px",
      borderRadius: "999px",
      color: "white",
      background: "rgba(22, 29, 62, .92)",
      boxShadow: "0 16px 45px rgba(19, 28, 63, .28)",
      font: "600 17px/1.35 Inter, system-ui, sans-serif",
      letterSpacing: ".01em",
      whiteSpace: "nowrap",
      pointerEvents: "none",
    });
    document.body.appendChild(element);
  }, text);
}

async function frame(number, caption) {
  await addCaption(caption);
  await page.screenshot({
    path: path.join(outputDirectory, `${String(number).padStart(2, "0")}.png`),
  });
}

try {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1, name: "Recipes" }).waitFor();
  await frame(1, "1 · Keep prompts, models, LoRAs and settings together");

  await page.getByRole("heading", { name: "Neon street in the rain" }).click();
  const editor = page.getByRole("dialog");
  await editor.getByRole("button", { name: "Models & parameters" }).click();
  await frame(2, "2 · Review the exact checkpoint and generation parameters");

  const downloadPromise = page
    .waitForEvent("download", { timeout: 5_000 })
    .catch(() => null);
  await editor.getByRole("button", { name: "Export ComfyUI workflow" }).click();
  const download = await downloadPromise;
  if (!download) {
    const toast = await page.locator(".toast").allTextContents();
    throw new Error(`Workflow download did not start. Toasts: ${toast.join(" | ")}`);
  }
  await frame(3, "3 · Download an editable ComfyUI workflow in one click");
} finally {
  await browser.close();
}
