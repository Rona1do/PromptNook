import { describe, expect, it } from "vitest";
import type { Resource } from "../types";
import {
  detectLorasFromPrompt,
  isCharacterTriggerWord,
  mergeDetectedLoras,
} from "./loraDetect";

const resources: Resource[] = [
  {
    id: "lora-a",
    name: "Character A",
    resourceType: "lora",
    path: "E:\\loras\\character_a.safetensors",
    available: true,
    triggerWords: ["char a style", "masterpiece", "3d", "best quality"],
    confirmedTriggerWords: ["char_a", "XiaoXunEr IL"],
  },
  {
    id: "lora-b",
    name: "Pose Pack",
    resourceType: "lora",
    path: "E:\\loras\\pose_pack.safetensors",
    available: true,
    triggerWords: ["doggy pose pack", "3d", "masterpiece"],
    confirmedTriggerWords: [],
  },
  {
    id: "lora-c",
    name: "Lighting Pack",
    resourceType: "lora",
    path: "E:\\loras\\soft_light.safetensors",
    available: true,
    triggerWords: ["soft lighting", "cinematic film still", "highly detailed"],
    confirmedTriggerWords: [],
  },
  {
    id: "ckpt",
    name: "Base",
    resourceType: "checkpoint",
    path: "E:\\ckpts\\base.safetensors",
    available: true,
    triggerWords: [],
    confirmedTriggerWords: [],
  },
];

describe("isCharacterTriggerWord", () => {
  it("accepts character-like triggers", () => {
    expect(isCharacterTriggerWord("XiaoXunEr IL")).toBe(true);
    expect(isCharacterTriggerWord("char_a")).toBe(true);
    expect(isCharacterTriggerWord("yumeko jabami")).toBe(true);
    expect(isCharacterTriggerWord("雷电将军")).toBe(true);
  });

  it("rejects generic quality/style triggers", () => {
    expect(isCharacterTriggerWord("masterpiece")).toBe(false);
    expect(isCharacterTriggerWord("3d")).toBe(false);
    expect(isCharacterTriggerWord("best quality")).toBe(false);
    expect(isCharacterTriggerWord("soft lighting")).toBe(false);
    expect(isCharacterTriggerWord("highly detailed")).toBe(false);
    expect(isCharacterTriggerWord("doggy pose pack")).toBe(false);
    expect(isCharacterTriggerWord("cinematic film still")).toBe(false);
  });
});

describe("detectLorasFromPrompt", () => {
  it("detects explicit lora tags and character trigger words only", () => {
    const detected = detectLorasFromPrompt(
      "masterpiece, 3d, best quality, <lora:character_a:0.8>, char_a, doggy pose pack, soft lighting",
      resources,
    );
    // pose/style packs must not attach; only explicit tag + character trigger
    expect(detected.map((item) => item.resourceId).sort()).toEqual(["lora-a"]);
    expect(detected.find((item) => item.resourceId === "lora-a")?.modelStrength).toBe(
      0.8,
    );
  });

  it("attaches via character trigger like XiaoXunEr IL without generic noise", () => {
    const detected = detectLorasFromPrompt(
      "masterpiece, best quality, 3d, XiaoXunEr IL, 1girl, solo",
      resources,
    );
    expect(detected.map((item) => item.resourceId)).toEqual(["lora-a"]);
    expect(
      detected[0].enabledTriggerWords.map((word) => word.toLowerCase()),
    ).toContain("xiaoxuner il");
  });

  it("does not attach loras that only share generic trigger words", () => {
    const detected = detectLorasFromPrompt(
      "masterpiece, best quality, 3d, soft lighting, highly detailed, cinematic film still",
      resources,
    );
    expect(detected).toEqual([]);
  });

  it("does not re-add already attached loras", () => {
    const detected = detectLorasFromPrompt(
      "char_a, XiaoXunEr IL",
      resources,
      [
        {
          resourceId: "lora-a",
          name: "Character A",
          modelStrength: 1,
          clipStrength: 1,
          order: 0,
          triggerWords: ["char_a"],
          enabledTriggerWords: ["char_a"],
        },
      ],
    );
    expect(detected.map((item) => item.resourceId)).toEqual([]);
  });

  it("merges without removing manual entries", () => {
    const merged = mergeDetectedLoras(
      [
        {
          resourceId: "manual",
          name: "Manual",
          modelStrength: 0.5,
          clipStrength: 0.5,
          order: 0,
          triggerWords: [],
          enabledTriggerWords: [],
        },
      ],
      [
        {
          resourceId: "lora-a",
          name: "Character A",
          modelStrength: 1,
          clipStrength: 1,
          order: 0,
          triggerWords: ["char_a"],
          enabledTriggerWords: ["char_a"],
        },
      ],
    );
    expect(merged.map((item) => item.resourceId)).toEqual(["manual", "lora-a"]);
  });
});
