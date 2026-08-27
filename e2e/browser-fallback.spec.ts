import { expect, test } from "playwright/test";

test("browser fallback supports the five destinations and a snippet creation journey", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByText("Browser demo mode")).toBeVisible();
  const destinations = [
    ["Recipes", "总 Prompt"],
    ["Snippets", "单 Prompt"],
    ["Studio", "创作台"],
    ["Models & LoRA", "模型与 LoRA"],
    ["Notes", "技巧"],
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
  await page.getByRole("button", { name: "新建单 Prompt" }).first().click();

  const editor = page.getByRole("dialog", { name: "新建单 Prompt" });
  await expect(editor).toBeVisible();
  await editor
    .getByPlaceholder("She made a V-sign at the camera")
    .fill("standing under a paper umbrella");
  await editor.getByPlaceholder("她对着镜头比出 V 字手势").fill("站在纸伞下");
  await editor.getByRole("button", { name: "Action", exact: true }).click();
  await editor.getByRole("button", { name: "保存词条" }).click();

  await expect(page.getByText("standing under a paper umbrella")).toBeVisible();
  await expect(page.getByText("站在纸伞下", { exact: true })).toBeVisible();

  await page.keyboard.press("Control+K");
  const search = page.getByRole("dialog", { name: "全局搜索" });
  await expect(search).toBeVisible();
  await search.getByPlaceholder("搜索中文、英文、分类或模型…").fill("纸伞");
  const searchResult = search.getByRole("button", {
    name: /standing under a paper umbrella.*站在纸伞下/,
  });
  await expect(searchResult).toBeVisible();
  await searchResult.click();
  await expect(
    page.getByRole("dialog", { name: "编辑单 Prompt" }),
  ).toBeVisible();
  await page.getByRole("dialog", { name: "编辑单 Prompt" }).getByRole("button", {
    name: "关闭",
  }).click();

  await page
    .getByRole("button", { name: /^Studio/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "创作台" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Settings & safety" })).toBeVisible();
  await expect(
    settings.getByRole("button", { name: /Backup & export/ }),
  ).toBeVisible();

  await settings.getByRole("button", { name: "Translation", exact: true }).click();
  await settings
    .getByRole("button", { name: "一键套用 Google 参数" })
    .click();
  await expect(settings.getByLabel("API 地址")).toHaveValue(
    "https://generativelanguage.googleapis.com/v1beta/openai",
  );
  await expect(settings.getByLabel("模型名称")).toHaveValue(
    "gemini-3.1-flash-lite",
  );
  await settings.getByRole("button", { name: "测试翻译" }).click();
  await expect(settings.getByText(/连接成功，测试译文：电影胶片剧照/)).toBeVisible();
  await expect(settings.getByRole("button", { name: "测试翻译" })).toBeEnabled();
});

test("recipe resource search, responsive LoRA picker and empty parameters work together", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建总 Prompt" }).click();

  const editor = page.getByRole("dialog");
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("标题（选填）")).toHaveValue("");
  await editor
    .getByPlaceholder("masterpiece, best quality, a portrait of…")
    .fill("cinematic portrait, golden hour");
  await editor.getByRole("button", { name: "模型与参数" }).click();

  await expect(editor.getByLabel("宽度")).toHaveValue("");
  await expect(editor.getByLabel("高度")).toHaveValue("");
  await expect(editor.getByLabel("采样器")).toHaveValue("");
  await expect(editor.getByLabel("调度器")).toHaveValue("");

  await editor.getByRole("button", { name: "添加 LoRA" }).click();
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

  await editor.getByRole("textbox", { name: "搜索 LoRA" }).fill("Natural");
  await expect(
    picker.getByRole("button", { name: /Natural Hand Poses/ }),
  ).toBeVisible();
  await expect(
    picker.getByRole("button", { name: /Cinematic Film Still/ }),
  ).toHaveCount(0);

  await editor
    .getByRole("textbox", { name: "搜索基础模型" })
    .fill("Dream");
  const modelSelect = editor.getByLabel("Checkpoint / Diffusion model");
  await expect(modelSelect.locator("option")).toHaveCount(2);
  await expect(
    modelSelect.getByRole("option", { name: "DreamShaper XL Turbo" }),
  ).toBeAttached();

  await editor.getByRole("button", { name: /示例图与备注/ }).click();
  await editor
    .locator('input[type="file"]')
    .setInputFiles("e2e/fixtures/wide-example.svg");
  await expect(editor.getByAltText("wide-example.svg")).toBeVisible();

  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "cinematic portrait" }),
  ).toBeVisible();
  const thumbnail = page.getByAltText("cinematic portrait示例图");
  await expect(thumbnail).toBeVisible();
  await expect(thumbnail).toHaveCSS("object-fit", "contain");

  await page
    .getByRole("button", { name: /^Models & LoRA/ })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "搜索模型与 LoRA" })
    .fill("film grain");
  await expect(
    page.getByRole("heading", { name: "Cinematic Film Still" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "DreamShaper XL Turbo" }),
  ).toHaveCount(0);
  await expect(page.getByText("显示 1 / 5")).toBeVisible();
});
