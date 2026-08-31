import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettings, Resource } from "../types";
import { ResourcePage } from "./ResourcePage";

const listDownloadLoras = vi.fn();
const importDownloadLoras = vi.fn();

vi.mock("../lib/api", () => ({
  api: {
    listDownloadLoras: (...args: unknown[]) => listDownloadLoras(...args),
    importDownloadLoras: (...args: unknown[]) => importDownloadLoras(...args),
    scanResources: vi.fn(),
    importAsset: vi.fn(),
  },
}));

const settings: AppSettings = {
  privacyMode: false,
  loraPath: "E:\\AI\\ComfyUI\\models\\loras",
  checkpointPath: "E:\\AI\\ComfyUI\\models\\checkpoints",
  diffusionModelPath: "E:\\AI\\ComfyUI\\models\\diffusion_models",
  backupPath: "",
  translationProvider: "off",
  translationEndpoint: "",
  translationModel: "",
  onlineTranslationEnabled: false,
  translationTargetLanguage: "en",
  promptModels: [
    { id: "general", name: "General", description: "General workspace" },
  ],
  activePromptModel: "general",
  defaultPrefix: "",
  defaultNegative: "",
};

const resources: Resource[] = [
  {
    id: "lora-portrait",
    name: "Portrait_Hero",
    resourceType: "lora",
    path: "E:\\AI\\ComfyUI\\models\\loras\\人物\\portrait.safetensors",
    available: true,
    triggerWords: ["V-sign", "soft smile"],
    confirmedTriggerWords: ["二次元人物"],
    baseModel: "SDXL 1.0",
    fileSize: 128 * 1024 * 1024,
  },
  {
    id: "checkpoint-flux",
    name: "Flux Realistic",
    resourceType: "checkpoint",
    path: "E:\\AI\\ComfyUI\\models\\checkpoints\\special\\flux.safetensors",
    available: true,
    triggerWords: [],
    confirmedTriggerWords: [],
    baseModel: "FLUX.1",
    fileSize: 8 * 1024 * 1024 * 1024,
  },
  {
    id: "diffusion-offline",
    name: "Wan Diffusion",
    resourceType: "diffusion_model",
    path: "E:\\AI\\ComfyUI\\models\\diffusion_models\\wan.safetensors",
    available: false,
    triggerWords: [],
    confirmedTriggerWords: [],
    baseModel: "Wan 2.1",
  },
];

const defaultProps = {
  settings,
  privacyMode: false,
  onClearRequestedResource: vi.fn(),
  onScanComplete: vi.fn(),
  onSave: vi.fn(async () => undefined),
  onOpenSettings: vi.fn(),
  onToast: vi.fn(),
};

function renderPage(items: Resource[] = resources) {
  return render(<ResourcePage {...defaultProps} resources={items} />);
}

function searchFor(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Search models & LoRAs" }), {
    target: { value },
  });
}

function expectOnlyResource(name: string) {
  const grid = document.querySelector(".resource-grid");
  expect(grid).not.toBeNull();
  expect(within(grid as HTMLElement).getByRole("heading", { name })).toBeVisible();
  expect(within(grid as HTMLElement).getAllByRole("article")).toHaveLength(1);
}

describe("ResourcePage search and filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("searches name, path, base model and all trigger words case-insensitively", () => {
    renderPage();

    searchFor("portrait_HERO");
    expectOnlyResource("Portrait_Hero");

    searchFor("CHECKPOINTS\\SPECIAL");
    expectOnlyResource("Flux Realistic");

    searchFor("flux.1");
    expectOnlyResource("Flux Realistic");

    searchFor("V-SIGN");
    expectOnlyResource("Portrait_Hero");

    searchFor("二次元人物");
    expectOnlyResource("Portrait_Hero");
    expect(screen.getByText("Show 1 / 3")).toBeVisible();
  });

  it("combines resource-type filtering with search and can clear an empty result", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /^LoRA1$/ }));
    searchFor("flux");

    expect(screen.getByText("No matching resources")).toBeVisible();
    expect(screen.getByText("Show 0 / 3")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Clear search & filters" }));

    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByText("Show 3 / 3")).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Search models & LoRAs" }),
    ).toHaveValue("");
  });

  it("shows a scan-oriented empty state when no resources have been indexed", () => {
    renderPage([]);

    expect(screen.getByText("No model resources scanned yet")).toBeVisible();
    expect(screen.getByRole("button", { name: "Scan again" })).toBeVisible();
    expect(screen.getByText("Show 0 / 0")).toBeVisible();
  });

  it("imports selected recent download LoRAs and names them in the toast", async () => {
    listDownloadLoras.mockResolvedValue({
      downloadsPath: "C:\\Users\\Example\\Downloads",
      loraPath: settings.loraPath,
      recentDays: 14,
      defaultSelectHours: 6,
      candidates: [
        {
          name: "portrait_style_v2",
          fileName: "portrait_style_v2.safetensors",
          sourcePath:
            "C:\\Users\\Example\\Downloads\\portrait_style_v2.safetensors",
          destinationPath: `${settings.loraPath}\\portrait_style_v2.safetensors`,
          fileSize: 138_720_752,
          modifiedAt: new Date().toISOString(),
          alreadyExists: false,
          withinDefaultWindow: true,
          companionFiles: [],
        },
        {
          name: "older_not_default",
          fileName: "older_not_default.safetensors",
          sourcePath:
            "C:\\Users\\Example\\Downloads\\older_not_default.safetensors",
          destinationPath: `${settings.loraPath}\\older_not_default.safetensors`,
          fileSize: 40_000_000,
          modifiedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
          alreadyExists: false,
          withinDefaultWindow: false,
          companionFiles: [],
        },
        {
          name: "already_here",
          fileName: "already_here.safetensors",
          sourcePath: "C:\\Users\\Example\\Downloads\\already_here.safetensors",
          destinationPath: `${settings.loraPath}\\already_here.safetensors`,
          fileSize: 50_000_000,
          modifiedAt: new Date().toISOString(),
          alreadyExists: true,
          withinDefaultWindow: true,
          companionFiles: [],
        },
      ],
    });
    importDownloadLoras.mockResolvedValue({
      imported: [
        {
          name: "portrait_style_v2",
          fileName: "portrait_style_v2.safetensors",
          sourcePath:
            "C:\\Users\\Example\\Downloads\\portrait_style_v2.safetensors",
          destinationPath: `${settings.loraPath}\\portrait_style_v2.safetensors`,
        },
      ],
      skipped: [],
      failed: [],
      scan: {
        resources,
        scanned: resources.length,
        added: 1,
        updated: 0,
        offlinePaths: [],
      },
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Import downloaded LoRAs" }));

    expect(
      await screen.findByRole("dialog", { name: "Import LoRAs from Downloads" }),
    ).toBeVisible();
    expect(
      (await screen.findAllByText("portrait_style_v2")).length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Already exists")).toBeVisible();
    expect(screen.getByText("older_not_default")).toBeVisible();
    expect(screen.getByText(/These LoRAs will be imported/)).toBeVisible();
    // Default selection is only within the last 6 hours (and not already existing).
    expect(
      screen.getByRole("button", { name: "Import 1 selected" }),
    ).toBeVisible();
    expect(screen.getByText(/Import mode/)).toBeVisible();
    expect(screen.getByText("move")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Import 1 selected" }));

    await waitFor(() => {
      expect(importDownloadLoras).toHaveBeenCalledWith({
        sourcePaths: [
          "C:\\Users\\Example\\Downloads\\portrait_style_v2.safetensors",
        ],
        overwrite: false,
      });
    });
    expect(defaultProps.onToast).toHaveBeenCalledWith(
      expect.stringContaining("portrait_style_v2"),
    );
    expect(defaultProps.onScanComplete).toHaveBeenCalled();
  });
});
