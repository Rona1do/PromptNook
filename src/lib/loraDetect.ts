import {
  extractLoraTags,
  normalizePromptValue,
} from "./promptParser";
import type { RecipeLora, Resource } from "../types";

/**
 * Generic / quality / style tags that must never auto-attach a LoRA.
 * Matching is done on normalizePromptValue() form (lowercase, collapsed spaces).
 */
const GENERIC_TRIGGER_BLOCKLIST = new Set(
  [
    // quality
    "masterpiece",
    "best quality",
    "high quality",
    "amazing quality",
    "great quality",
    "normal quality",
    "low quality",
    "worst quality",
    "highres",
    "absurdres",
    "incredibly absurdres",
    "ultra detailed",
    "highly detailed",
    "extremely detailed",
    "detailed",
    "intricate details",
    "8k",
    "4k",
    "uhd",
    "hdr",
    // media / style
    "3d",
    "2d",
    "cgi",
    "render",
    "rendering",
    "realistic",
    "photorealistic",
    "photo",
    "photography",
    "anime",
    "manga",
    "cartoon",
    "comic",
    "illustration",
    "painting",
    "sketch",
    "lineart",
    "monochrome",
    "greyscale",
    "grayscale",
    "cinematic",
    "film grain",
    "film still",
    "cinematic film still",
    "soft lighting",
    "dramatic lighting",
    "studio lighting",
    "volumetric lighting",
    "ray tracing",
    "depth of field",
    "bokeh",
    "blurry",
    "sharp focus",
    "shallow depth of field",
    "chibi",
    "pixel art",
    "oil painting",
    "watercolor",
    "concept art",
    // composition counts
    "solo",
    "1girl",
    "1boy",
    "2girls",
    "2boys",
    "3girls",
    "multiple girls",
    "multiple boys",
    "cowboy shot",
    "full body",
    "upper body",
    "portrait",
    "close up",
    "from above",
    "from below",
    "from behind",
    "from side",
    "looking at viewer",
    "looking away",
    "eye contact",
    // generic expressions / poses (not character identity)
    "smile",
    "blush",
    "open mouth",
    "closed mouth",
    "closed eyes",
    "standing",
    "sitting",
    "lying",
    "kneeling",
    "walking",
    "running",
    "simple background",
    "white background",
    "grey background",
    "gradient background",
    "outdoors",
    "indoors",
    "day",
    "night",
    // model family words alone
    "sdxl",
    "pony",
    "illustrious",
    "flux",
    "noobai",
    "anima",
    "checkpoint",
    "lora",
    // common junk
    "style",
    "styles",
    "quality",
    "detail",
    "details",
    "lighting",
    "light",
    "shadow",
    "color",
    "colours",
    "colors",
    "texture",
    "textures",
    "background",
    "wallpaper",
    "official art",
    "artwork",
    "beautiful",
    "gorgeous",
    "aesthetic",
    "very aesthetic",
  ].map((item) => normalizePromptValue(item)),
);

/** Base-model / pack suffixes often appended to character triggers (e.g. "XiaoXunEr IL"). */
const MODEL_FAMILY_SUFFIX =
  /(?:\s+|[_-])(il|xl|pony|sdxl|nai|noob|noobai|flux|anima|illustrious|v\d+|v\d+\.\d+)$/i;

function resourceFileStem(path: string): string {
  const file = path.replace(/\\/g, "/").split("/").pop() ?? path;
  return file.replace(/\.(safetensors|ckpt|pt|bin)$/i, "");
}

function resourceMatchKeys(resource: Resource): string[] {
  return [
    resource.name,
    resourceFileStem(resource.path),
    resourceFileStem(resource.name),
  ]
    .map((value) => normalizePromptValue(value))
    .filter(Boolean);
}

/**
 * True only for character-identity style trigger words.
 * Generic quality/style/pose tags are rejected so they never auto-attach LoRAs.
 *
 * Accepts e.g. "XiaoXunEr IL", "yumeko jabami", "char_a", "雷电将军".
 */
export function isCharacterTriggerWord(trigger: string): boolean {
  const raw = trigger.trim();
  if (!raw) return false;

  const normalized = normalizePromptValue(raw);
  if (normalized.length < 3) return false;
  if (GENERIC_TRIGGER_BLOCKLIST.has(normalized)) return false;

  // Pure short English dictionary words are almost never character names.
  if (/^[a-z]+$/.test(normalized) && normalized.length <= 6) {
    return false;
  }

  // Reject obvious style/quality phrases even if not in the static list.
  if (
    /\b(quality|masterpiece|detailed|lighting|background|cinematic|photoreal|realistic|render|3d|2d)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }

  // CJK / other non-latin character names.
  if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(raw)) {
    return true;
  }

  // CamelCase / PascalCase identity tokens: XiaoXunEr, RaidenShogun
  if (/[a-z][A-Z]/.test(raw) || /[A-Z]{2,}[a-z]/.test(raw)) {
    return true;
  }

  // Explicit model-family character markers: "Name IL", "name_xl", "foo pony"
  if (MODEL_FAMILY_SUFFIX.test(raw) || MODEL_FAMILY_SUFFIX.test(normalized)) {
    // Require a non-trivial head before the suffix.
    const head = normalized
      .replace(/(?:\s+|[_-])(il|xl|pony|sdxl|nai|noob|noobai|flux|anima|illustrious|v\d+(?:\.\d+)?)$/i, "")
      .trim();
    if (head.length >= 3 && !GENERIC_TRIGGER_BLOCKLIST.has(head)) {
      return true;
    }
  }

  // Multi-token name-like triggers: "yumeko jabami", "char_a_style" still needs care.
  const tokens = normalized.split(/[\s_/\-]+/).filter(Boolean);
  if (tokens.length >= 2) {
    // Drop if every token is a generic word.
    const meaningful = tokens.filter(
      (token) =>
        token.length >= 2 &&
        !GENERIC_TRIGGER_BLOCKLIST.has(token) &&
        !/^(style|pose|pack|outfit|clothing|dress|hair|eyes?|face|body|skin|quality|detail)$/i.test(
          token,
        ),
    );
    // Require at least one "name-like" token (longer or mixed).
    if (
      meaningful.length >= 1 &&
      meaningful.some((token) => token.length >= 3) &&
      // Reject pure pose packs: "doggy pose pack"
      !tokens.every((token) =>
        /^(pose|pack|style|outfit|clothing|dress|hair|soft|hard|light|dark|natural|cinematic|film|still)$/i.test(
          token,
        ),
      ) &&
      !/\b(pose|pack)\b/i.test(normalized)
    ) {
      // "char a style" — has style → reject as non-character
      if (/\b(style|styles)\b/i.test(normalized) && tokens.length <= 3) {
        // allow if first tokens look like a proper name id (char_a) without only style words
        const withoutStyle = tokens.filter(
          (token) => !/^(style|styles)$/i.test(token),
        );
        if (withoutStyle.join(" ").length >= 4) {
          // still ambiguous; only accept if it looks like an id (has digit or underscore origin)
          if (/[0-9]/.test(raw) || raw.includes("_")) return true;
        }
        return false;
      }
      return true;
    }
  }

  // Single token but long / id-like: "raiden", "hutao", "char_a", "xiaoxuner"
  if (tokens.length === 1) {
    const token = tokens[0];
    if (token.length >= 5 && /[a-z]/.test(token) && /[0-9_]/.test(raw)) {
      return true;
    }
    // Long single names without being blocklisted (e.g. "ganyu" alone is weak;
    // require length >= 7 to reduce false positives from common words)
    if (token.length >= 7 && /^[a-z0-9]+$/.test(token)) {
      return true;
    }
  }

  // Underscore ids commonly used as character triggers: char_a, xiao_xun_er
  if (raw.includes("_") && normalized.replace(/_/g, "").length >= 4) {
    if (!/\b(pose|pack|style|quality|lighting)\b/i.test(normalized)) {
      return true;
    }
  }

  return false;
}

/**
 * Character triggers must appear as whole prompt tags (comma/semicolon separated),
 * not as accidental substrings inside unrelated words.
 */
function triggerMatchesPrompt(
  promptNormalized: string,
  trigger: string,
): boolean {
  if (!isCharacterTriggerWord(trigger)) return false;
  const needle = normalizePromptValue(trigger);
  if (needle.length < 3) return false;

  const parts = promptNormalized
    .split(/[,，;；\n\r|/]+/u)
    .map((part) => normalizePromptValue(part))
    .filter(Boolean);

  return parts.some((part) => part === needle);
}

function characterTriggersOf(resource: Resource): string[] {
  const all = [
    ...resource.confirmedTriggerWords,
    ...resource.triggerWords,
  ].filter(Boolean);
  // Prefer confirmed first, keep unique order.
  const seen = new Set<string>();
  const result: string[] = [];
  for (const trigger of all) {
    if (!isCharacterTriggerWord(trigger)) continue;
    const key = normalizePromptValue(trigger);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(trigger);
  }
  return result;
}

function toRecipeLora(
  resource: Resource,
  modelStrength = 1,
  clipStrength = 1,
  enabled?: string[],
): RecipeLora {
  const allTriggers = [
    ...resource.confirmedTriggerWords,
    ...resource.triggerWords,
  ].filter(Boolean);
  const uniqueTriggers = Array.from(new Set(allTriggers));
  const characterTriggers = characterTriggersOf(resource);
  return {
    resourceId: resource.id,
    name: resource.name,
    modelStrength,
    clipStrength,
    order: 0,
    triggerWords: uniqueTriggers,
    enabledTriggerWords:
      enabled && enabled.length
        ? enabled
        : characterTriggers.length
          ? characterTriggers
          : resource.confirmedTriggerWords.length
            ? [...resource.confirmedTriggerWords]
            : uniqueTriggers.slice(0, 3),
  };
}

/**
 * Detect LoRAs referenced by explicit `<lora:...>` tags and/or
 * **character-only** trigger words inside a total prompt.
 *
 * Generic tags like "masterpiece" / "3d" never attach a LoRA.
 * Existing stack entries are left intact; only missing candidates are returned.
 */
export function detectLorasFromPrompt(
  prompt: string,
  resources: Resource[],
  existing: readonly RecipeLora[] = [],
): RecipeLora[] {
  const loras = resources.filter((item) => item.resourceType === "lora");
  if (!prompt.trim() || !loras.length) return [];

  const existingIds = new Set(existing.map((item) => item.resourceId));
  const found = new Map<string, RecipeLora>();
  const tags = extractLoraTags(prompt);

  // Explicit <lora:name:weight> — always trust filename / resource name match.
  for (const tag of tags) {
    const match = loras.find((resource) =>
      resourceMatchKeys(resource).some(
        (key) =>
          key === tag.normalizedName ||
          key.includes(tag.normalizedName) ||
          tag.normalizedName.includes(key),
      ),
    );
    if (!match || existingIds.has(match.id) || found.has(match.id)) continue;
    found.set(
      match.id,
      toRecipeLora(
        match,
        tag.modelStrength ?? 1,
        tag.clipStrength ?? tag.modelStrength ?? 1,
      ),
    );
  }

  const promptNormalized = normalizePromptValue(prompt);
  // Longer character triggers first so "XiaoXunEr IL" wins over shorter fragments.
  const ranked = [...loras].sort((a, b) => {
    const score = (resource: Resource) =>
      Math.max(
        0,
        ...characterTriggersOf(resource).map(
          (trigger) => normalizePromptValue(trigger).length,
        ),
      );
    return score(b) - score(a);
  });

  for (const resource of ranked) {
    if (existingIds.has(resource.id) || found.has(resource.id)) continue;
    const triggers = characterTriggersOf(resource);
    if (!triggers.length) continue;
    const matchedTriggers = triggers.filter((trigger) =>
      triggerMatchesPrompt(promptNormalized, trigger),
    );
    if (!matchedTriggers.length) continue;
    found.set(
      resource.id,
      toRecipeLora(resource, 1, 1, matchedTriggers),
    );
  }

  return Array.from(found.values()).map((item, order) => ({ ...item, order }));
}

export function mergeDetectedLoras(
  current: readonly RecipeLora[],
  detected: readonly RecipeLora[],
): RecipeLora[] {
  if (!detected.length) return [...current];
  const merged = [...current];
  for (const item of detected) {
    if (merged.some((entry) => entry.resourceId === item.resourceId)) continue;
    merged.push({ ...item, order: merged.length });
  }
  return merged.map((item, order) => ({ ...item, order }));
}
