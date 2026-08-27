import type { PromptModelProfile } from "../types";

/** Workspaces own independent recipe/snippet libraries. */
export type PromptModelId = string;

export interface PromptModelOption {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  defaultPrefix: string;
  defaultNegative: string;
}

export const DEFAULT_PROMPT_MODELS: PromptModelOption[] = [
  {
    id: "general",
    label: "General",
    shortLabel: "General",
    description: "General-purpose prompt workspace",
    defaultPrefix: "masterpiece, best quality, highly detailed",
    defaultNegative:
      "blurry, low quality, deformed hands, extra fingers, watermark",
  },
];

export const DEFAULT_PROMPT_MODEL_PROFILES: PromptModelProfile[] =
  DEFAULT_PROMPT_MODELS.map(({ id, label, description }) => ({
    id,
    name: label,
    description,
  }));

export function normalizePromptModelId(
  value: string | null | undefined,
): PromptModelId {
  const key = (value ?? "")
    .trim()
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return key || "general";
}

export function promptModelLabel(
  id: string | null | undefined,
  profiles: readonly PromptModelProfile[] = DEFAULT_PROMPT_MODEL_PROFILES,
): string {
  const normalized = normalizePromptModelId(id);
  return profiles.find((item) => item.id === normalized)?.name ?? normalized;
}

export function promptModelOption(id: string | null | undefined): PromptModelOption {
  const normalized = normalizePromptModelId(id);
  return (
    DEFAULT_PROMPT_MODELS.find((item) => item.id === normalized) ??
    DEFAULT_PROMPT_MODELS[0]
  );
}
