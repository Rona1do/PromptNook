import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const source = new URL("../docs/social-preview.html", import.meta.url);
const output = fileURLToPath(new URL("../docs/social-preview.png", import.meta.url));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });

try {
  await page.goto(source.href, { waitUntil: "networkidle" });
  await page.screenshot({ path: output, type: "png" });
  console.log(`Rendered ${output}`);
} finally {
  await browser.close();
}
