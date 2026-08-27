/**
 * Lossless, UI-friendly parsing helpers for Stable Diffusion style prompts.
 *
 * A segment owns the separator which follows it. Keeping `raw` and `separator`
 * separate lets the UI render clean chips while `joinPromptSegments()` can
 * reproduce an untouched prompt byte-for-byte (within JavaScript's UTF-16
 * string model).
 */

export type PromptDelimiter = "," | "，" | ";" | "；" | "\n" | "\r\n" | "\r";

export interface PromptSegment {
  /** Deterministic for one parse. Editing may create new ids. */
  id: string;
  /** Exact text before this segment's separator. */
  raw: string;
  /** `raw` without outer whitespace; suitable for a chip label/editor. */
  value: string;
  leadingWhitespace: string;
  trailingWhitespace: string;
  /** Exact delimiter and whitespace following it, or an empty string. */
  separator: string;
  /** The first delimiter in `separator`, or null for the final segment. */
  delimiter: PromptDelimiter | null;
  /** UTF-16 source offsets for `raw` (end-exclusive). */
  start: number;
  end: number;
  separatorEnd: number;
}

export interface PromptWeightInfo {
  content: string;
  weight: number;
}

export interface LoraTag {
  raw: string;
  name: string;
  normalizedName: string;
  modelStrength?: number;
  clipStrength?: number;
  /** UTF-16 source offsets (end-exclusive). */
  start: number;
  end: number;
}

export interface PromptChip {
  id: string;
  segmentIndex: number;
  value: string;
  /** Value without an outer `(content:weight)` wrapper. */
  content: string;
  weight: number | null;
  loraTags: LoraTag[];
}

export interface ParsedPrompt {
  source: string;
  /** Includes empty segments so all source text remains lossless. */
  segments: PromptSegment[];
  /** Non-empty segment views intended for UI rendering. */
  chips: PromptChip[];
  loraTags: LoraTag[];
}

const OPEN_TO_CLOSE: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "{": "}",
};

const NUMERIC_TOKEN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

function readDelimiter(source: string, index: number): PromptDelimiter | null {
  if (source.startsWith("\r\n", index)) {
    return "\r\n";
  }

  const character = source[index];
  if (
    character === "," ||
    character === "，" ||
    character === ";" ||
    character === "；" ||
    character === "\n" ||
    character === "\r"
  ) {
    return character;
  }

  return null;
}

function splitOuterWhitespace(raw: string): {
  value: string;
  leadingWhitespace: string;
  trailingWhitespace: string;
} {
  const leadingWhitespace = raw.match(/^\s*/u)?.[0] ?? "";
  const remainder = raw.slice(leadingWhitespace.length);
  const trailingWhitespace = remainder.match(/\s*$/u)?.[0] ?? "";
  const value = remainder.slice(0, remainder.length - trailingWhitespace.length);

  return { value, leadingWhitespace, trailingWhitespace };
}

function createSegment(
  raw: string,
  separator: string,
  delimiter: PromptDelimiter | null,
  start: number,
  end: number,
  index: number,
): PromptSegment {
  const whitespace = splitOuterWhitespace(raw);

  return {
    id: `segment-${index}-${start}-${end + separator.length}`,
    raw,
    ...whitespace,
    separator,
    delimiter,
    start,
    end,
    separatorEnd: end + separator.length,
  };
}

function isLoraTagStart(source: string, index: number): boolean {
  return source.slice(index, index + 6).toLocaleLowerCase("en-US") === "<lora:";
}

function findUnescapedClosingAngle(source: string, start: number): number {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === ">") {
      return index;
    }
  }
  return -1;
}

/**
 * Parse on top-level commas, Chinese commas, semicolons and newlines.
 * Brackets, quoted strings, escaped characters and `<lora:...>` are protected.
 */
export function parsePrompt(source: string): ParsedPrompt {
  if (source.length === 0) {
    return { source, segments: [], chips: [], loraTags: [] };
  }

  const segments: PromptSegment[] = [];
  const bracketStack: string[] = [];
  let quote: "'" | '"' | null = null;
  let segmentStart = 0;
  let index = 0;

  while (index < source.length) {
    const character = source[index];

    if (character === "\\") {
      index = Math.min(index + 2, source.length);
      continue;
    }

    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      index += 1;
      continue;
    }

    if (character === "<" && isLoraTagStart(source, index)) {
      const closingAngle = findUnescapedClosingAngle(source, index + 6);
      // A malformed LoRA tag is treated as protected through the end so that
      // commas in a half-written tag do not unexpectedly explode into chips.
      index = closingAngle === -1 ? source.length : closingAngle + 1;
      continue;
    }

    const closingBracket = OPEN_TO_CLOSE[character];
    if (closingBracket !== undefined) {
      bracketStack.push(closingBracket);
      index += 1;
      continue;
    }

    if (
      bracketStack.length > 0 &&
      character === bracketStack[bracketStack.length - 1]
    ) {
      bracketStack.pop();
      index += 1;
      continue;
    }

    const delimiter = bracketStack.length === 0 ? readDelimiter(source, index) : null;
    if (delimiter === null) {
      index += 1;
      continue;
    }

    const rawEnd = index;
    let separatorEnd = index + delimiter.length;
    while (separatorEnd < source.length && /\s/u.test(source[separatorEnd])) {
      separatorEnd += 1;
    }

    const separator = source.slice(index, separatorEnd);
    segments.push(
      createSegment(
        source.slice(segmentStart, rawEnd),
        separator,
        delimiter,
        segmentStart,
        rawEnd,
        segments.length,
      ),
    );
    segmentStart = separatorEnd;
    index = separatorEnd;
  }

  segments.push(
    createSegment(
      source.slice(segmentStart),
      "",
      null,
      segmentStart,
      source.length,
      segments.length,
    ),
  );

  const loraTags = extractLoraTags(source);
  const chips = segments.flatMap<PromptChip>((segment, segmentIndex) => {
    if (segment.value.length === 0) {
      return [];
    }

    const weighted = readPromptWeight(segment.value);
    return [
      {
        id: segment.id,
        segmentIndex,
        value: segment.value,
        content: weighted?.content ?? segment.value,
        weight: weighted?.weight ?? null,
        loraTags: extractLoraTags(segment.value),
      },
    ];
  });

  return { source, segments, chips, loraTags };
}

/** Reconstruct the exact prompt represented by a segment list. */
export function joinPromptSegments(segments: readonly PromptSegment[]): string {
  return segments.map((segment) => segment.raw + segment.separator).join("");
}

function assertSegmentIndex(
  segments: readonly PromptSegment[],
  index: number,
  label = "index",
): void {
  if (!Number.isInteger(index) || index < 0 || index >= segments.length) {
    throw new RangeError(`${label} must address an existing prompt segment`);
  }
}

function reparseEditedSegments(
  items: readonly Pick<PromptSegment, "raw" | "separator">[],
): PromptSegment[] {
  return parsePrompt(items.map((item) => item.raw + item.separator).join("")).segments;
}

/**
 * Replace a chip's value while preserving the whitespace and separator in that
 * layout slot.
 */
export function updateSegmentText(
  segments: readonly PromptSegment[],
  index: number,
  text: string,
): PromptSegment[] {
  assertSegmentIndex(segments, index);
  const edited = segments.map((segment, segmentIndex) => ({
    raw:
      segmentIndex === index
        ? segment.leadingWhitespace + text.trim() + segment.trailingWhitespace
        : segment.raw,
    separator: segment.separator,
  }));
  return reparseEditedSegments(edited);
}

/**
 * Merge an inclusive, adjacent range into one chip. The removed top-level
 * separators are replaced with `joiner` (a plain space by default).
 */
export function mergeSegments(
  segments: readonly PromptSegment[],
  startIndex: number,
  endIndex = startIndex + 1,
  joiner = " ",
): PromptSegment[] {
  assertSegmentIndex(segments, startIndex, "startIndex");
  assertSegmentIndex(segments, endIndex, "endIndex");
  if (endIndex <= startIndex) {
    throw new RangeError("endIndex must be greater than startIndex");
  }

  const first = segments[startIndex];
  const last = segments[endIndex];
  const mergedValue = segments
    .slice(startIndex, endIndex + 1)
    .map((segment) => segment.value)
    .join(joiner);
  const merged = {
    raw: first.leadingWhitespace + mergedValue + last.trailingWhitespace,
    separator: last.separator,
  };

  const edited = [
    ...segments
      .slice(0, startIndex)
      .map((segment) => ({ raw: segment.raw, separator: segment.separator })),
    merged,
    ...segments
      .slice(endIndex + 1)
      .map((segment) => ({ raw: segment.raw, separator: segment.separator })),
  ];

  return reparseEditedSegments(edited);
}

function isValidInsertedSeparator(separator: string): boolean {
  const delimiter = readDelimiter(separator, 0);
  return (
    delimiter !== null &&
    separator.slice(delimiter.length).split("").every((character) => /\s/u.test(character))
  );
}

/**
 * Split a segment at an offset in its trimmed `value`.
 */
export function splitSegment(
  segments: readonly PromptSegment[],
  index: number,
  splitAt: number,
  separator = ", ",
): PromptSegment[] {
  assertSegmentIndex(segments, index);
  if (!isValidInsertedSeparator(separator)) {
    throw new TypeError("separator must be a supported delimiter followed by whitespace");
  }

  const segment = segments[index];
  if (
    !Number.isInteger(splitAt) ||
    splitAt <= 0 ||
    splitAt >= segment.value.length
  ) {
    throw new RangeError("splitAt must be inside the segment value");
  }

  const leftValue = segment.value.slice(0, splitAt).trimEnd();
  const rightValue = segment.value.slice(splitAt).trimStart();
  if (leftValue.length === 0 || rightValue.length === 0) {
    throw new RangeError("splitAt must leave non-empty values on both sides");
  }

  const edited = [
    ...segments
      .slice(0, index)
      .map((item) => ({ raw: item.raw, separator: item.separator })),
    {
      raw: segment.leadingWhitespace + leftValue,
      separator,
    },
    {
      raw: rightValue + segment.trailingWhitespace,
      separator: segment.separator,
    },
    ...segments
      .slice(index + 1)
      .map((item) => ({ raw: item.raw, separator: item.separator })),
  ];

  return reparseEditedSegments(edited);
}

/**
 * Move one chip into another layout slot. Separator and outer-whitespace style
 * stay at their original positions, yielding predictable `a, b, c` formatting.
 */
export function reorderSegments(
  segments: readonly PromptSegment[],
  fromIndex: number,
  toIndex: number,
): PromptSegment[] {
  assertSegmentIndex(segments, fromIndex, "fromIndex");
  assertSegmentIndex(segments, toIndex, "toIndex");
  if (fromIndex === toIndex) {
    return segments.map((segment) => ({ ...segment }));
  }

  const values = segments.map((segment) => segment.value);
  const [moved] = values.splice(fromIndex, 1);
  values.splice(toIndex, 0, moved);

  return reparseEditedSegments(
    segments.map((slot, index) => ({
      raw: slot.leadingWhitespace + values[index] + slot.trailingWhitespace,
      separator: slot.separator,
    })),
  );
}

function hasSingleOuterParentheses(value: string): boolean {
  if (!value.startsWith("(") || !value.endsWith(")")) {
    return false;
  }

  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "<" && isLoraTagStart(value, index)) {
      const closingAngle = findUnescapedClosingAngle(value, index + 6);
      if (closingAngle === -1) {
        return false;
      }
      index = closingAngle;
      continue;
    }
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0 && index !== value.length - 1) {
        return false;
      }
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0 && quote === null;
}

function findLastTopLevelColon(value: string): number {
  const bracketStack: string[] = [];
  let quote: "'" | '"' | null = null;
  let lastColon = -1;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "<" && isLoraTagStart(value, index)) {
      const closingAngle = findUnescapedClosingAngle(value, index + 6);
      index = closingAngle === -1 ? value.length : closingAngle;
      continue;
    }

    const closingBracket = OPEN_TO_CLOSE[character];
    if (closingBracket !== undefined) {
      bracketStack.push(closingBracket);
      continue;
    }
    if (
      bracketStack.length > 0 &&
      character === bracketStack[bracketStack.length - 1]
    ) {
      bracketStack.pop();
      continue;
    }
    if (character === ":" && bracketStack.length === 0) {
      lastColon = index;
    }
  }

  return lastColon;
}

/** Read an explicit outer `(content:weight)` wrapper. */
export function readPromptWeight(value: string): PromptWeightInfo | null {
  const { value: core } = splitOuterWhitespace(value);
  if (!hasSingleOuterParentheses(core)) {
    return null;
  }

  const inner = core.slice(1, -1);
  const colon = findLastTopLevelColon(inner);
  if (colon === -1) {
    return null;
  }

  const numericPart = inner.slice(colon + 1).trim();
  if (!NUMERIC_TOKEN.test(numericPart)) {
    return null;
  }

  const weight = Number(numericPart);
  const content = inner.slice(0, colon).trim();
  if (!Number.isFinite(weight) || content.length === 0) {
    return null;
  }

  return { content, weight };
}

/**
 * Add, replace, or clear an outer Stable Diffusion weight while preserving
 * whitespace around the supplied value.
 */
export function updateWeight(value: string, weight: number | null): string {
  const whitespace = splitOuterWhitespace(value);
  const weighted = readPromptWeight(whitespace.value);
  const content = weighted?.content ?? whitespace.value;

  if (weight === null) {
    return (
      whitespace.leadingWhitespace +
      (weighted?.content ?? whitespace.value) +
      whitespace.trailingWhitespace
    );
  }
  if (!Number.isFinite(weight)) {
    throw new TypeError("weight must be a finite number or null");
  }
  if (content.length === 0) {
    throw new RangeError("cannot apply a weight to an empty prompt");
  }

  const formattedWeight = Object.is(weight, -0) ? "0" : String(weight);
  return (
    whitespace.leadingWhitespace +
    `(${content}:${formattedWeight})` +
    whitespace.trailingWhitespace
  );
}

export function updateSegmentWeight(
  segments: readonly PromptSegment[],
  index: number,
  weight: number | null,
): PromptSegment[] {
  assertSegmentIndex(segments, index);
  return updateSegmentText(segments, index, updateWeight(segments[index].value, weight));
}

function isEscaped(source: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function splitUnescapedColons(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === ":" && !isEscaped(value, index)) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

/** Extract valid `<lora:name[:modelStrength[:clipStrength]]>` tags. */
export function extractLoraTags(source: string): LoraTag[] {
  const tags: LoraTag[] = [];

  for (let index = 0; index < source.length; index += 1) {
    if (
      source[index] !== "<" ||
      isEscaped(source, index) ||
      !isLoraTagStart(source, index)
    ) {
      continue;
    }

    const closingAngle = findUnescapedClosingAngle(source, index + 6);
    if (closingAngle === -1) {
      break;
    }

    const payload = source.slice(index + 6, closingAngle);
    const parts = splitUnescapedColons(payload);
    const numericTail: number[] = [];
    while (parts.length > 1 && numericTail.length < 2) {
      const candidate = parts[parts.length - 1].trim();
      if (!NUMERIC_TOKEN.test(candidate)) {
        break;
      }
      numericTail.unshift(Number(candidate));
      parts.pop();
    }

    const name = parts.join(":").trim();
    if (name.length > 0) {
      const tag: LoraTag = {
        raw: source.slice(index, closingAngle + 1),
        name,
        normalizedName: normalizePromptValue(name),
        start: index,
        end: closingAngle + 1,
      };
      if (numericTail.length >= 1) {
        tag.modelStrength = numericTail[0];
      }
      if (numericTail.length === 2) {
        tag.clipStrength = numericTail[1];
      }
      tags.push(tag);
    }

    index = closingAngle;
  }

  return tags;
}

/**
 * Normalization for duplicate detection only. Display/source strings are never
 * rewritten with this value.
 */
export function normalizePromptValue(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

/** Keep the first occurrence of each normalized, non-empty value. */
export function dedupePromptValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = normalizePromptValue(value);
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(value);
  }

  return unique;
}

/** Keep the first tag for each normalized LoRA name. */
export function dedupeLoraTags(tags: readonly LoraTag[]): LoraTag[] {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    if (seen.has(tag.normalizedName)) {
      return false;
    }
    seen.add(tag.normalizedName);
    return true;
  });
}
