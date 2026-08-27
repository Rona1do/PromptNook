import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  joinPromptSegments,
  parsePrompt,
} from "../lib/promptParser";
import { PromptChipEditor } from "./PromptChipEditor";

const originalPrompt =
  'alpha beta, (red, dress:1.2), escaped\\,comma; "quoted, phrase"\n<lora:style,variant:0.8>';
const originalTranslation = "阿尔法贝塔，红裙，转义逗号；引号\n风格模型";

function ControlledEditor({
  onSaveSnippet,
}: {
  onSaveSnippet: (text: string, translation: string) => Promise<boolean>;
}) {
  const [prompt, setPrompt] = useState(originalPrompt);
  const [translation, setTranslation] = useState(originalTranslation);

  return (
    <>
      <output data-testid="authoritative-prompt">{prompt}</output>
      <output data-testid="authoritative-translation">{translation}</output>
      <PromptChipEditor
        prompt={prompt}
        translation={translation}
        onChange={(nextPrompt, nextTranslation) => {
          setPrompt(nextPrompt);
          setTranslation(nextTranslation);
        }}
        onSaveSnippet={onSaveSnippet}
      />
    </>
  );
}

describe("PromptChipEditor", () => {
  it("keeps the authoritative prompt lossless through split, edit, reorder, merge, weight and snippet save", async () => {
    const onSaveSnippet = vi.fn(async () => true);
    render(<ControlledEditor onSaveSnippet={onSaveSnippet} />);

    const initialEnglish = screen.getAllByLabelText(/第 \d+ 项英文原文/);
    expect(initialEnglish).toHaveLength(5);
    expect(initialEnglish.map((input) => (input as HTMLInputElement).value)).toEqual([
      "alpha beta",
      "(red, dress:1.2)",
      "escaped\\,comma",
      '"quoted, phrase"',
      "<lora:style,variant:0.8>",
    ]);
    expect(screen.getByTestId("authoritative-prompt").textContent).toBe(
      originalPrompt,
    );
    expect(
      joinPromptSegments(parsePrompt(originalPrompt).segments),
    ).toBe(originalPrompt);

    fireEvent.click(screen.getByRole("button", { name: "再次拆分第 1 项" }));
    const splitInput = screen.getByRole("textbox", {
      name: "输入带顶层分隔符的片段",
    });
    fireEvent.change(splitInput, { target: { value: "alpha, beta" } });
    fireEvent.keyDown(splitInput, {
      key: "Enter",
      code: "Enter",
      ctrlKey: true,
    });

    expect(screen.getAllByLabelText(/第 \d+ 项英文原文/)).toHaveLength(6);
    expect(screen.getByTestId("authoritative-prompt").textContent).toBe(
      'alpha, beta, (red, dress:1.2), escaped\\,comma; "quoted, phrase"\n<lora:style,variant:0.8>',
    );

    fireEvent.change(screen.getByRole("textbox", { name: "第 2 项英文原文" }), {
      target: { value: "masterpiece" },
    });
    fireEvent.click(screen.getByRole("button", { name: "上移第 2 项" }));
    expect(screen.getByTestId("authoritative-prompt").textContent).toBe(
      'masterpiece, alpha, (red, dress:1.2), escaped\\,comma; "quoted, phrase"\n<lora:style,variant:0.8>',
    );

    fireEvent.click(
      screen.getByRole("button", { name: "合并第 1 项与下一项" }),
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "第 1 项权重" }), {
      target: { value: "1.35" },
    });

    const expectedFinalPrompt =
      '(masterpiece alpha:1.35), (red, dress:1.2), escaped\\,comma; "quoted, phrase"\n<lora:style,variant:0.8>';
    const authoritative = screen.getByTestId("authoritative-prompt").textContent;
    expect(authoritative).toBe(expectedFinalPrompt);
    expect(joinPromptSegments(parsePrompt(authoritative ?? "").segments)).toBe(
      expectedFinalPrompt,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "将第 1 项保存为单 Prompt",
      }),
    );
    await waitFor(() =>
      expect(onSaveSnippet).toHaveBeenCalledWith(
        "(masterpiece alpha:1.35)",
        "阿尔法贝塔",
      ),
    );
  });
});
