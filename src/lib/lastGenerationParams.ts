import type { GenerationParams } from "../types";

const STORAGE_KEY = "promptnook:lastGenerationParams";

const EMPTY: GenerationParams = {
  width: null,
  height: null,
  sampler: null,
  scheduler: null,
  steps: null,
  cfg: null,
  seed: null,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Normalize any stored payload into a full GenerationParams object. */
export function sanitizeGenerationParams(
  value: unknown,
): GenerationParams {
  if (!value || typeof value !== "object") {
    return { ...EMPTY };
  }
  const raw = value as Record<string, unknown>;
  return {
    width: isFiniteNumber(raw.width) ? raw.width : null,
    height: isFiniteNumber(raw.height) ? raw.height : null,
    sampler:
      typeof raw.sampler === "string" && raw.sampler.trim()
        ? raw.sampler
        : null,
    scheduler:
      typeof raw.scheduler === "string" && raw.scheduler.trim()
        ? raw.scheduler
        : null,
    steps: isFiniteNumber(raw.steps) ? raw.steps : null,
    cfg: isFiniteNumber(raw.cfg) ? raw.cfg : null,
    seed:
      typeof raw.seed === "string"
        ? raw.seed
        : isFiniteNumber(raw.seed)
          ? String(raw.seed)
          : null,
  };
}

export function loadLastGenerationParams(): GenerationParams | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const params = sanitizeGenerationParams(parsed);
    // Treat all-null as "no last params".
    if (
      params.width === null &&
      params.height === null &&
      params.sampler === null &&
      params.scheduler === null &&
      params.steps === null &&
      params.cfg === null &&
      (params.seed === null || params.seed === "")
    ) {
      return null;
    }
    return params;
  } catch {
    return null;
  }
}

export function saveLastGenerationParams(params: GenerationParams): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(sanitizeGenerationParams(params)),
    );
  } catch {
    // Private mode / quota — ignore; defaults just won't persist.
  }
}

/** Params for a brand-new total prompt / studio canvas. */
export function defaultGenerationParamsForNew(): GenerationParams {
  return loadLastGenerationParams() ?? { ...EMPTY };
}
