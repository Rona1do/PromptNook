import { describe, expect, it } from "vitest";

import {
  dedupeLoraTags,
  dedupePromptValues,
  extractLoraTags,
  joinPromptSegments,
  mergeSegments,
  normalizePromptValue,
  parsePrompt,
  readPromptWeight,
  reorderSegments,
  splitSegment,
  updateSegmentText,
  updateSegmentWeight,
  updateWeight,
} from "./promptParser";

describe("parsePrompt", () => {
  it("splits every supported top-level delimiter and round-trips exactly", () => {
    const source = "alpha,  beta，gamma;delta；epsilon\r\n  zeta\neta\rtheta";
    const parsed = parsePrompt(source);

    expect(parsed.chips.map((chip) => chip.value)).toEqual([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "eta",
      "theta",
    ]);
    expect(parsed.segments.map((segment) => segment.delimiter)).toEqual([
      ",",
      "，",
      ";",
      "；",
      "\r\n",
      "\n",
      "\r",
      null,
    ]);
    expect(joinPromptSegments(parsed.segments)).toBe(source);
  });

  it("does not split nested brackets, quotes, escaped commas, or LoRA tags", () => {
    const source =
      "masterpiece, (red dress, detailed), [soft，light], {a;b}, " +
      '"quoted, phrase", \'single；phrase\', escaped\\,comma, ' +
      "<lora:style,variant:0.8>, final";
    const parsed = parsePrompt(source);

    expect(parsed.chips.map((chip) => chip.value)).toEqual([
      "masterpiece",
      "(red dress, detailed)",
      "[soft，light]",
      "{a;b}",
      '"quoted, phrase"',
      "'single；phrase'",
      "escaped\\,comma",
      "<lora:style,variant:0.8>",
      "final",
    ]);
    expect(joinPromptSegments(parsed.segments)).toBe(source);
  });

  it("handles nesting and escaped quote characters", () => {
    const source =
      '(portrait, [eyes, {catchlight, "blue,\\" cyan"}]), outside';
    const parsed = parsePrompt(source);

    expect(parsed.chips).toHaveLength(2);
    expect(parsed.chips[0].value).toBe(
      '(portrait, [eyes, {catchlight, "blue,\\" cyan"}])',
    );
    expect(parsed.chips[1].value).toBe("outside");
    expect(joinPromptSegments(parsed.segments)).toBe(source);
  });

  it("keeps empty segments, trailing separators, and separator whitespace", () => {
    const source = ",  alpha,, beta;  ";
    const parsed = parsePrompt(source);

    expect(parsed.segments).toHaveLength(5);
    expect(parsed.chips.map((chip) => chip.value)).toEqual(["alpha", "beta"]);
    expect(parsed.segments[0].separator).toBe(",  ");
    expect(parsed.segments[3].separator).toBe(";  ");
    expect(joinPromptSegments(parsed.segments)).toBe(source);
  });

  it("groups a comma and following line break as one exact separator", () => {
    const source = "alpha,\r\n    beta";
    const parsed = parsePrompt(source);

    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments[0].separator).toBe(",\r\n    ");
    expect(joinPromptSegments(parsed.segments)).toBe(source);
  });

  it("returns an empty collection for an empty source", () => {
    const parsed = parsePrompt("");

    expect(parsed.segments).toEqual([]);
    expect(parsed.chips).toEqual([]);
    expect(joinPromptSegments(parsed.segments)).toBe("");
  });

  it("protects a half-written LoRA tag instead of destructively splitting it", () => {
    const source = "start, <lora:unfinished, tag";
    const parsed = parsePrompt(source);

    expect(parsed.chips.map((chip) => chip.value)).toEqual([
      "start",
      "<lora:unfinished, tag",
    ]);
    expect(joinPromptSegments(parsed.segments)).toBe(source);
  });
});

describe("segment editing", () => {
  it("updates text without changing the layout whitespace", () => {
    const parsed = parsePrompt("  old value  ,  next");
    const edited = updateSegmentText(parsed.segments, 0, "new value");

    expect(joinPromptSegments(edited)).toBe("  new value  ,  next");
  });

  it("merges an adjacent inclusive range", () => {
    const parsed = parsePrompt("alpha, beta, gamma");
    const edited = mergeSegments(parsed.segments, 0, 1);

    expect(edited.map((segment) => segment.value)).toEqual([
      "alpha beta",
      "gamma",
    ]);
    expect(joinPromptSegments(edited)).toBe("alpha beta, gamma");
  });

  it("splits at an offset in the displayed value", () => {
    const parsed = parsePrompt("alpha beta, gamma");
    const edited = splitSegment(parsed.segments, 0, 5);

    expect(edited.map((segment) => segment.value)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(joinPromptSegments(edited)).toBe("alpha, beta, gamma");
  });

  it("supports a Chinese inserted separator and rejects invalid separators", () => {
    const parsed = parsePrompt("甲乙");

    expect(joinPromptSegments(splitSegment(parsed.segments, 0, 1, "； "))).toBe(
      "甲； 乙",
    );
    expect(() => splitSegment(parsed.segments, 0, 1, " / ")).toThrow(TypeError);
  });

  it("reorders values while keeping clean positional separators", () => {
    const parsed = parsePrompt("alpha, beta, gamma");
    const edited = reorderSegments(parsed.segments, 2, 0);

    expect(joinPromptSegments(edited)).toBe("gamma, alpha, beta");
  });

  it("validates editing indices and split boundaries", () => {
    const segments = parsePrompt("alpha, beta").segments;

    expect(() => mergeSegments(segments, 0, 4)).toThrow(RangeError);
    expect(() => splitSegment(segments, 0, 0)).toThrow(RangeError);
    expect(() => reorderSegments(segments, -1, 0)).toThrow(RangeError);
  });
});

describe("prompt weights", () => {
  it("reads only an explicit outer numeric weight", () => {
    expect(readPromptWeight("(portrait, close-up:1.25)")).toEqual({
      content: "portrait, close-up",
      weight: 1.25,
    });
    expect(readPromptWeight("((eyes:1.1):1.35)")).toEqual({
      content: "(eyes:1.1)",
      weight: 1.35,
    });
    expect(readPromptWeight("(portrait)")).toBeNull();
    expect(readPromptWeight("(portrait:strong)")).toBeNull();
    expect(readPromptWeight("(a:1.1) and (b:1.2)")).toBeNull();
  });

  it("adds, changes, and removes weights while retaining outer whitespace", () => {
    expect(updateWeight("  portrait  ", 1.25)).toBe("  (portrait:1.25)  ");
    expect(updateWeight("(portrait:1.1)", 0.8)).toBe("(portrait:0.8)");
    expect(updateWeight(" (portrait:1.1) ", null)).toBe(" portrait ");
    expect(() => updateWeight("portrait", Number.NaN)).toThrow(TypeError);
  });

  it("updates a segment weight without changing its separator", () => {
    const parsed = parsePrompt("alpha, beta");
    const weighted = updateSegmentWeight(parsed.segments, 1, 1.2);

    expect(joinPromptSegments(weighted)).toBe("alpha, (beta:1.2)");
    expect(weighted[1].value).toBe("(beta:1.2)");
  });

  it("exposes parsed weight information on chips", () => {
    const parsed = parsePrompt("(portrait:1.4), background");

    expect(parsed.chips[0]).toMatchObject({
      content: "portrait",
      weight: 1.4,
    });
    expect(parsed.chips[1]).toMatchObject({
      content: "background",
      weight: null,
    });
  });
});

describe("LoRA tags and normalized duplicate handling", () => {
  it("extracts names, one strength, and separate model/CLIP strengths", () => {
    const source =
      "<lora:Portrait Style:0.8>, <lora:detail:1.1:0.65>, <lora:no-weight>";
    const tags = extractLoraTags(source);

    expect(tags).toHaveLength(3);
    expect(tags[0]).toMatchObject({
      name: "Portrait Style",
      modelStrength: 0.8,
    });
    expect(tags[0].clipStrength).toBeUndefined();
    expect(tags[1]).toMatchObject({
      name: "detail",
      modelStrength: 1.1,
      clipStrength: 0.65,
    });
    expect(tags[2]).toMatchObject({
      name: "no-weight",
    });
    expect(tags[2].modelStrength).toBeUndefined();
    expect(tags[2].clipStrength).toBeUndefined();
    expect(source.slice(tags[1].start, tags[1].end)).toBe(tags[1].raw);
  });

  it("ignores escaped and malformed tags", () => {
    const source = "\\<lora:hidden:1>, <lora:valid:0.7>, <lora:unfinished";

    expect(extractLoraTags(source).map((tag) => tag.name)).toEqual(["valid"]);
  });

  it("normalizes Unicode width, case, and repeated whitespace", () => {
    expect(normalizePromptValue("  ＮＥＯＮ　 Light  ")).toBe("neon light");
    expect(
      dedupePromptValues([
        "Best   Quality",
        "best quality",
        "ＢＥＳＴ　ＱＵＡＬＩＴＹ",
        "cinematic",
        " ",
      ]),
    ).toEqual(["Best   Quality", "cinematic"]);
  });

  it("deduplicates LoRA resources by normalized name while preserving first use", () => {
    const tags = extractLoraTags(
      "<lora:Portrait Style:0.8>, <lora:portrait   style:1.1>, <lora:detail:1>",
    );

    expect(dedupeLoraTags(tags).map((tag) => tag.name)).toEqual([
      "Portrait Style",
      "detail",
    ]);
  });

  it("makes whole-prompt LoRA tags available to parsed consumers", () => {
    const parsed = parsePrompt(
      "portrait, <lora:face-detail:0.75>, <lora:face-detail:1>",
    );

    expect(parsed.loraTags).toHaveLength(2);
    expect(dedupeLoraTags(parsed.loraTags)).toHaveLength(1);
    expect(parsed.chips[1].loraTags[0].name).toBe("face-detail");
  });
});
