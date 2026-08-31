import { parsePrompt } from "./promptParser";

const AUTO_TITLE_MAX_LENGTH = 48;

function shorten(value: string): string {
  const characters = Array.from(value);
  if (characters.length <= AUTO_TITLE_MAX_LENGTH) return value;
  return `${characters.slice(0, AUTO_TITLE_MAX_LENGTH).join("")}…`;
}

function datePart(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

/**
 * Produces the persisted/display title for a recipe whose title was left blank.
 * The prompt-derived value stays stable because save operations persist it.
 */
export function deriveRecipeTitle(
  title: string,
  positivePrompt: string,
  timestamp: Date | string = new Date(),
): string {
  const explicit = title.trim();
  if (explicit) return explicit;

  const firstPromptPart =
    parsePrompt(positivePrompt).segments.find((segment) => segment.value)
      ?.value ?? "";
  const normalized = firstPromptPart.replace(/\s+/g, " ").trim();
  if (normalized) return shorten(normalized);

  return `Untitled recipe · ${datePart(timestamp)}`;
}
