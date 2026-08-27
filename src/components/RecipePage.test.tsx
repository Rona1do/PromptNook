import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeInput, Resource } from "../types";
import { api } from "../lib/api";
import { RecipeEditor } from "./RecipePage";

const resources: Resource[] = [
  {
    id: "model-flux",
    name: "Flux Realistic",
    resourceType: "checkpoint",
    path: "E:\\AI\\ComfyUI\\models\\checkpoints\\flux.safetensors",
    available: true,
    triggerWords: [],
    confirmedTriggerWords: [],
    baseModel: "FLUX.1",
  },
  {
    id: "model-sdxl",
    name: "SDXL Base",
    resourceType: "diffusion_model",
    path: "E:\\AI\\ComfyUI\\models\\diffusion_models\\sdxl.safetensors",
    available: true,
    triggerWords: [],
    confirmedTriggerWords: [],
    baseModel: "SDXL",
  },
  {
    id: "lora-pose",
    name: "Yumeko_Jabami_This_Is_A_Very_Long_LoRA_Name",
    resourceType: "lora",
    path: "E:\\AI\\ComfyUI\\models\\loras\\characters\\yumeko.safetensors",
    available: true,
    triggerWords: ["yumeko jabami", "V-sign"],
    confirmedTriggerWords: ["yumeko jabami"],
    baseModel: "SDXL",
  },
  {
    id: "lora-light",
    name: "Soft Light",
    resourceType: "lora",
    path: "E:\\AI\\ComfyUI\\models\\loras\\lighting\\soft.safetensors",
    available: true,
    triggerWords: ["soft lighting"],
    confirmedTriggerWords: [],
    baseModel: "SDXL",
  },
];

const defaultProps = {
  resources,
  recipeTags: [
    {
      id: "tag-portrait",
      name: "Portrait",
      color: "#d6578b",
      kind: "pose",
      sortOrder: 0,
    },
    {
      id: "tag-landscape",
      name: "Landscape",
      color: "#ef7a51",
      kind: "pose",
      sortOrder: 1,
    },
  ],
  privacyMode: false,
  targetLanguage: "zh-CN",
  onClose: vi.fn(),
  onSave: vi.fn(async (_recipe: RecipeInput) => undefined),
  onSaveSnippet: vi.fn(async () => true),
  onToast: vi.fn(),
};

function renderEditor(
  overrides: Partial<typeof defaultProps> = {},
) {
  return render(<RecipeEditor {...defaultProps} {...overrides} />);
}

function openParameters() {
  fireEvent.click(screen.getByRole("button", { name: /模型与参数/ }));
}

describe("RecipeEditor save and resource selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("saves a title-only draft with genuinely empty generation parameters", async () => {
    const onSave = vi.fn(async (_recipe: RecipeInput) => undefined);
    const onClose = vi.fn();
    renderEditor({ onSave, onClose });

    fireEvent.change(screen.getByLabelText("标题（选填）"), {
      target: { value: "只有标题的灵感草稿" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      title: "只有标题的灵感草稿",
      status: "draft",
      positivePrompt: "",
      params: {
        width: null,
        height: null,
        sampler: null,
        scheduler: null,
        steps: null,
        cfg: null,
        seed: null,
      },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("allows a draft to be saved without entering a title", async () => {
    const onSave = vi.fn(async (_recipe: RecipeInput) => undefined);
    renderEditor({ onSave });

    fireEvent.change(screen.getByPlaceholderText("masterpiece, best quality, a portrait of…"), {
      target: { value: "cinematic portrait, golden hour" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      title: "",
      status: "draft",
      positivePrompt: "cinematic portrait, golden hour",
    });
  });

  it("keeps the editor open and shows the backend error when saving fails", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("数据库暂时不可写");
    });
    const onClose = vi.fn();
    renderEditor({ onSave, onClose });

    fireEvent.change(screen.getByLabelText("标题（选填）"), {
      target: { value: "失败反馈测试" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("保存失败：数据库暂时不可写");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops translating and keeps the provider error visible", async () => {
    vi.spyOn(api, "translateText").mockRejectedValueOnce(
      new Error("Google 返回 HTTP 401：API 密钥无效"),
    );
    renderEditor();

    fireEvent.change(
      screen.getByPlaceholderText(
        "masterpiece, best quality, a portrait of…",
      ),
      { target: { value: "cinematic portrait" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "自动翻译" }));

    expect(
      await screen.findAllByText(/Google 返回 HTTP 401：API 密钥无效/),
    ).not.toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "自动翻译" }),
    ).toBeEnabled();
  });

  it("searches models and LoRAs by metadata without collapsing the LoRA picker", () => {
    renderEditor();
    openParameters();

    fireEvent.change(
      screen.getByRole("textbox", { name: "搜索基础模型" }),
      { target: { value: "flux.1" } },
    );
    const modelSelect = screen.getByLabelText("Checkpoint / Diffusion model");
    expect(within(modelSelect).getByRole("option", { name: "Flux Realistic" })).toBeVisible();
    expect(
      within(modelSelect).queryByRole("option", { name: "SDXL Base" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "添加 LoRA" }));
    const picker = document.querySelector(".lora-picker");
    expect(picker).not.toBeNull();
    expect(picker).toHaveClass("lora-picker");

    fireEvent.change(screen.getByRole("textbox", { name: "搜索 LoRA" }), {
      target: { value: "V-SIGN" },
    });
    expect(
      within(picker as HTMLElement).getByText(
        "Yumeko_Jabami_This_Is_A_Very_Long_LoRA_Name",
      ),
    ).toBeVisible();
    expect(
      within(picker as HTMLElement).queryByText("Soft Light"),
    ).not.toBeInTheDocument();
  });

  it("lists dpmpp_2m_sde among sampler options", () => {
    renderEditor();
    openParameters();
    const sampler = screen.getByLabelText("采样器");
    expect(
      within(sampler).getByRole("option", { name: "dpmpp_2m_sde" }),
    ).toBeInTheDocument();
  });

  it("reuses last saved generation params when opening a new draft", async () => {
    const onSave = vi.fn(async (_recipe: RecipeInput) => undefined);
    const first = renderEditor({ onSave });
    openParameters();
    fireEvent.change(screen.getByLabelText("宽度"), {
      target: { value: "832" },
    });
    fireEvent.change(screen.getByLabelText("高度"), {
      target: { value: "1216" },
    });
    fireEvent.change(screen.getByLabelText("采样器"), {
      target: { value: "dpmpp_2m_sde" },
    });
    fireEvent.change(screen.getByLabelText("步数"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("CFG"), {
      target: { value: "4.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    first.unmount();

    renderEditor({ onSave: vi.fn(async () => undefined) });
    openParameters();
    expect(screen.getByLabelText("宽度")).toHaveValue(832);
    expect(screen.getByLabelText("高度")).toHaveValue(1216);
    expect(screen.getByLabelText("采样器")).toHaveValue("dpmpp_2m_sde");
    expect(screen.getByLabelText("步数")).toHaveValue(30);
    expect(screen.getByLabelText("CFG")).toHaveValue(4.5);
  });

  it("can apply recommended parameters and clear every field again", () => {
    renderEditor();
    openParameters();

    expect(screen.getByLabelText("宽度")).toHaveValue(null);
    expect(screen.getByLabelText("采样器")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "使用推荐值" }));
    expect(screen.getByLabelText("宽度")).toHaveValue(1024);
    expect(screen.getByLabelText("采样器")).toHaveValue("euler");
    expect(screen.getByLabelText("CFG")).toHaveValue(3.5);

    fireEvent.click(screen.getByRole("button", { name: "全部留空" }));
    expect(screen.getByLabelText("宽度")).toHaveValue(null);
    expect(screen.getByLabelText("采样器")).toHaveValue("");
    expect(screen.getByLabelText(/^Seed/)).toHaveValue("");
  });
});
