import {
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  Check,
  GripVertical,
  Scissors,
  X,
} from "lucide-react";
import {
  joinPromptSegments,
  mergeSegments,
  parsePrompt,
  readPromptWeight,
  reorderSegments,
  updateSegmentText,
  updateSegmentWeight,
} from "../lib/promptParser";

interface PromptChipEditorProps {
  prompt: string;
  translation: string;
  onChange: (prompt: string, translation: string) => void;
  onSaveSnippet: (text: string, translation: string) => Promise<boolean>;
}

const iconButtonStyle: CSSProperties = {
  display: "inline-grid",
  width: 29,
  height: 29,
  padding: 0,
  placeItems: "center",
  flex: "0 0 auto",
  color: "var(--pv-text-muted)",
  background: "var(--pv-surface)",
  border: "1px solid var(--pv-border)",
  borderRadius: 8,
  cursor: "pointer",
};

const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 34,
  padding: "6px 9px",
  color: "var(--pv-text)",
  background: "var(--pv-surface)",
  border: "1px solid var(--pv-border)",
  borderRadius: 8,
  outline: "none",
};

type PromptParse = ReturnType<typeof parsePrompt>;

/**
 * Translation chips normally have the same segment topology as the English
 * source. When a user is still filling translations, fall back to visual chip
 * order so an empty translation slot does not shift every following row.
 */
function alignedTranslationValues(
  prompt: PromptParse,
  translation: PromptParse,
): string[] {
  if (translation.segments.length === prompt.segments.length) {
    return prompt.chips.map(
      (chip) => translation.segments[chip.segmentIndex]?.value ?? "",
    );
  }

  return prompt.chips.map(
    (_chip, index) => translation.chips[index]?.value ?? "",
  );
}

/**
 * Rebuild only when a structural operation changes chip order/count. Prompt
 * separators define the slots, while the translation's existing whitespace
 * and delimiter style are reused wherever the two sources already align.
 */
function serializeAlignedTranslation(
  prompt: PromptParse,
  values: readonly string[],
  previousSource: string,
): string {
  if (!values.some((value) => value.trim().length > 0)) {
    return "";
  }

  const previous = parsePrompt(previousSource);
  const rowBySegment = new Map(
    prompt.chips.map((chip, ordinal) => [chip.segmentIndex, ordinal]),
  );

  const items = prompt.segments.map((promptSegment, segmentIndex) => {
    const ordinal = rowBySegment.get(segmentIndex);
    const previousBySlot =
      previous.segments.length === prompt.segments.length
        ? previous.segments[segmentIndex]
        : undefined;
    const previousChip =
      ordinal === undefined ? undefined : previous.chips[ordinal];
    const previousByOrder =
      previousChip === undefined
        ? undefined
        : previous.segments[previousChip.segmentIndex];
    const style = previousBySlot ?? previousByOrder;

    const value = ordinal === undefined ? "" : (values[ordinal] ?? "");
    const raw =
      ordinal === undefined
        ? previousBySlot?.raw ?? ""
        : `${style?.leadingWhitespace ?? promptSegment.leadingWhitespace}${value.trim()}${style?.trailingWhitespace ?? promptSegment.trailingWhitespace}`;

    // Keep the translation's comma/semicolon style, but never introduce a
    // trailing separator when the authoritative prompt has no slot there.
    const separator =
      promptSegment.separator.length === 0
        ? ""
        : style?.separator || promptSegment.separator;
    return { raw, separator };
  });

  return items.map((item) => item.raw + item.separator).join("");
}

function buttonStyle(disabled = false): CSSProperties {
  return {
    ...iconButtonStyle,
    opacity: disabled ? 0.36 : 1,
    cursor: disabled ? "default" : "pointer",
  };
}

export function PromptChipEditor({
  prompt,
  translation,
  onChange,
  onSaveSnippet,
}: PromptChipEditorProps) {
  const parsed = useMemo(() => parsePrompt(prompt), [prompt]);
  const parsedTranslation = useMemo(
    () => parsePrompt(translation),
    [translation],
  );
  const translations = useMemo(
    () => alignedTranslationValues(parsed, parsedTranslation),
    [parsed, parsedTranslation],
  );
  const [dragging, setDragging] = useState<number | null>(null);
  const [splitEditor, setSplitEditor] = useState<{
    ordinal: number;
    value: string;
  } | null>(null);
  const [savingOrdinal, setSavingOrdinal] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  function emitPromptChange(
    nextSegments: ReturnType<typeof parsePrompt>["segments"],
    nextTranslations?: readonly string[],
  ) {
    const nextPrompt = joinPromptSegments(nextSegments);
    const nextParsed = parsePrompt(nextPrompt);
    onChange(
      nextPrompt,
      nextTranslations
        ? serializeAlignedTranslation(
            nextParsed,
            nextTranslations,
            translation,
          )
        : translation,
    );
  }

  function editEnglish(
    ordinal: number,
    segmentIndex: number,
    value: string,
  ) {
    const nextSegments = updateSegmentText(
      parsed.segments,
      segmentIndex,
      value,
    );
    const nextPrompt = joinPromptSegments(nextSegments);
    const nextParsed = parsePrompt(nextPrompt);
    const delta = nextParsed.chips.length - parsed.chips.length;

    if (delta === 0) {
      onChange(nextPrompt, translation);
      return;
    }

    const nextTranslations = [...translations];
    if (delta > 0) {
      nextTranslations.splice(
        ordinal + 1,
        0,
        ...Array.from({ length: delta }, () => ""),
      );
    } else {
      const removeCount = Math.abs(delta);
      const removed =
        value.trim().length === 0
          ? nextTranslations.splice(ordinal, removeCount)
          : nextTranslations.splice(ordinal + 1, removeCount);
      if (value.trim().length > 0) {
        const preserved = removed.filter((item) => item.trim().length > 0);
        if (preserved.length) {
          nextTranslations[ordinal] = [
            nextTranslations[ordinal],
            ...preserved,
          ]
            .filter(Boolean)
            .join(" ");
        }
      }
    }
    emitPromptChange(nextSegments, nextTranslations);
  }

  function editTranslation(ordinal: number, value: string) {
    const nextTranslations = [...translations];
    nextTranslations[ordinal] = value;
    onChange(
      prompt,
      serializeAlignedTranslation(parsed, nextTranslations, translation),
    );
  }

  function move(fromOrdinal: number, toOrdinal: number) {
    if (
      fromOrdinal === toOrdinal ||
      fromOrdinal < 0 ||
      toOrdinal < 0 ||
      fromOrdinal >= parsed.chips.length ||
      toOrdinal >= parsed.chips.length
    ) {
      return;
    }
    const from = parsed.chips[fromOrdinal].segmentIndex;
    const to = parsed.chips[toOrdinal].segmentIndex;
    const nextSegments = reorderSegments(parsed.segments, from, to);
    const nextTranslations = [...translations];
    const [moved] = nextTranslations.splice(fromOrdinal, 1);
    nextTranslations.splice(toOrdinal, 0, moved ?? "");
    emitPromptChange(nextSegments, nextTranslations);
    setAnnouncement(`已将第 ${fromOrdinal + 1} 项移动到第 ${toOrdinal + 1} 项`);
  }

  function mergeWithNext(ordinal: number) {
    const current = parsed.chips[ordinal];
    const next = parsed.chips[ordinal + 1];
    if (!current || !next) return;

    const nextSegments = mergeSegments(
      parsed.segments,
      current.segmentIndex,
      next.segmentIndex,
    );
    const nextTranslations = [...translations];
    const mergedTranslation = [
      nextTranslations[ordinal],
      nextTranslations[ordinal + 1],
    ]
      .filter((value) => value?.trim())
      .join(" ");
    nextTranslations.splice(ordinal, 2, mergedTranslation);
    emitPromptChange(nextSegments, nextTranslations);
    setAnnouncement(`已合并第 ${ordinal + 1}、${ordinal + 2} 项`);
  }

  function setWeight(segmentIndex: number, value: string) {
    const numeric = value === "" ? null : Number(value);
    if (numeric !== null && !Number.isFinite(numeric)) return;
    const nextSegments = updateSegmentWeight(
      parsed.segments,
      segmentIndex,
      numeric,
    );
    emitPromptChange(nextSegments);
  }

  function applySplit() {
    if (!splitEditor) return;
    const row = parsed.chips[splitEditor.ordinal];
    if (!row) {
      setSplitEditor(null);
      return;
    }

    const candidate = parsePrompt(splitEditor.value);
    if (candidate.chips.length <= 1) {
      setAnnouncement("没有找到顶层逗号、分号或换行；括号和引号内不会拆分");
      return;
    }

    const nextSegments = updateSegmentText(
      parsed.segments,
      row.segmentIndex,
      splitEditor.value,
    );
    const added = Math.max(0, candidate.chips.length - 1);
    const nextTranslations = [...translations];
    nextTranslations.splice(
      splitEditor.ordinal + 1,
      0,
      ...Array.from({ length: added }, () => ""),
    );
    emitPromptChange(nextSegments, nextTranslations);
    setSplitEditor(null);
    setAnnouncement(`已按顶层分隔符拆成 ${candidate.chips.length} 项`);
  }

  async function saveSnippet(ordinal: number) {
    const chip = parsed.chips[ordinal];
    if (!chip) return;
    setSavingOrdinal(ordinal);
    try {
      const saved = await onSaveSnippet(
        chip.value,
        translations[ordinal] ?? "",
      );
      setAnnouncement(
        saved
          ? `“${chip.value}”已保存到单 Prompt`
          : `“${chip.value}”已存在，没有重复保存`,
      );
    } catch {
      setAnnouncement("保存单 Prompt 失败，请稍后重试");
    } finally {
      setSavingOrdinal(null);
    }
  }

  if (!parsed.chips.length) {
    return (
      <div className="chip-empty">
        输入 Prompt 后，这里会自动拆成可编辑的小卡片
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gap: 8,
        padding: 10,
        background: "var(--pv-surface-soft)",
        border: "1px solid var(--pv-border)",
        borderRadius: 12,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "25px minmax(220px, 1.2fr) minmax(180px, 0.9fr) 136px",
          gap: 8,
          padding: "0 8px",
          color: "var(--pv-text-faint)",
          fontSize: 12,
          fontWeight: 650,
        }}
        aria-hidden="true"
      >
        <span>#</span>
        <span>英文原文</span>
        <span>中文译文</span>
        <span>操作</span>
      </div>

      {parsed.chips.map((chip, ordinal) => {
        const segment = parsed.segments[chip.segmentIndex];
        const weighted = readPromptWeight(segment.value);
        const isSplitting = splitEditor?.ordinal === ordinal;
        return (
          <div
            key={`prompt-row-${ordinal}`}
            onDragOver={(event) => {
              if (dragging !== null) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging !== null) move(dragging, ordinal);
              setDragging(null);
            }}
            style={{
              display: "grid",
              gridTemplateColumns:
                "25px minmax(220px, 1.2fr) minmax(180px, 0.9fr) 136px",
              gap: 8,
              alignItems: "start",
              padding: 8,
              background:
                dragging === ordinal
                  ? "var(--pv-indigo-soft)"
                  : "var(--pv-surface)",
              border: "1px solid var(--pv-border)",
              borderRadius: 10,
              boxShadow: "var(--pv-shadow-sm)",
            }}
          >
            <span
              draggable
              role="button"
              tabIndex={0}
              aria-label={`拖动第 ${ordinal + 1} 项`}
              title="拖动排序"
              onDragStart={(event: DragEvent<HTMLSpanElement>) => {
                event.dataTransfer.effectAllowed = "move";
                setDragging(ordinal);
              }}
              onDragEnd={() => setDragging(null)}
              style={{
                display: "grid",
                height: 34,
                placeItems: "center",
                color: "var(--pv-text-faint)",
                cursor: "grab",
              }}
            >
              <GripVertical size={16} />
            </span>

            <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
              <input
                aria-label={`第 ${ordinal + 1} 项英文原文`}
                value={segment.value}
                onChange={(event) =>
                  editEnglish(ordinal, chip.segmentIndex, event.target.value)
                }
                style={inputStyle}
              />
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 5,
                  color: "var(--pv-text-faint)",
                  fontSize: 11,
                }}
              >
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  权重
                  <input
                    type="number"
                    min="-10"
                    max="10"
                    step="0.05"
                    aria-label={`第 ${ordinal + 1} 项权重`}
                    value={weighted?.weight ?? ""}
                    placeholder="无"
                    onChange={(event) =>
                      setWeight(chip.segmentIndex, event.target.value)
                    }
                    style={{
                      width: 66,
                      height: 26,
                      padding: "2px 6px",
                      color: "var(--pv-text)",
                      background: "var(--pv-surface)",
                      border: "1px solid var(--pv-border)",
                      borderRadius: 7,
                    }}
                  />
                </label>
                {weighted ? (
                  <button
                    type="button"
                    onClick={() => setWeight(chip.segmentIndex, "")}
                    style={{
                      padding: "3px 7px",
                      color: "var(--pv-text-muted)",
                      background: "var(--pv-surface-soft)",
                      border: "1px solid var(--pv-border)",
                      borderRadius: 7,
                      cursor: "pointer",
                    }}
                  >
                    清除
                  </button>
                ) : null}
                <span title={`原分隔符：${JSON.stringify(segment.separator)}`}>
                  {segment.delimiter ? `分隔 ${segment.delimiter}` : "末项"}
                </span>
              </div>
            </div>

            <input
              aria-label={`第 ${ordinal + 1} 项中文译文`}
              value={translations[ordinal] ?? ""}
              placeholder="待翻译"
              onChange={(event) =>
                editTranslation(ordinal, event.target.value)
              }
              style={{
                ...inputStyle,
                background:
                  translations[ordinal]?.trim().length > 0
                    ? "var(--pv-surface)"
                    : "var(--pv-surface-soft)",
              }}
            />

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 5,
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                aria-label={`上移第 ${ordinal + 1} 项`}
                title="上移（键盘可操作）"
                disabled={ordinal === 0}
                onClick={() => move(ordinal, ordinal - 1)}
                style={buttonStyle(ordinal === 0)}
              >
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                aria-label={`下移第 ${ordinal + 1} 项`}
                title="下移（键盘可操作）"
                disabled={ordinal === parsed.chips.length - 1}
                onClick={() => move(ordinal, ordinal + 1)}
                style={buttonStyle(ordinal === parsed.chips.length - 1)}
              >
                <ArrowDown size={14} />
              </button>
              <button
                type="button"
                aria-label={`再次拆分第 ${ordinal + 1} 项`}
                title="在编辑框加入顶层分隔符后拆分"
                onClick={() =>
                  setSplitEditor(
                    isSplitting
                      ? null
                      : { ordinal, value: segment.value },
                  )
                }
                style={buttonStyle()}
              >
                <Scissors size={14} />
              </button>
              <button
                type="button"
                aria-label={`合并第 ${ordinal + 1} 项与下一项`}
                title="与下一项合并"
                disabled={ordinal === parsed.chips.length - 1}
                onClick={() => mergeWithNext(ordinal)}
                style={buttonStyle(ordinal === parsed.chips.length - 1)}
              >
                <span style={{ fontSize: 15, lineHeight: 1 }}>↔</span>
              </button>
              <button
                type="button"
                aria-label={`将第 ${ordinal + 1} 项保存为单 Prompt`}
                title="保存为单 Prompt"
                disabled={savingOrdinal === ordinal}
                onClick={() => void saveSnippet(ordinal)}
                style={{
                  ...buttonStyle(savingOrdinal === ordinal),
                  color: "var(--pv-indigo)",
                  background: "var(--pv-indigo-soft)",
                }}
              >
                {savingOrdinal === ordinal ? (
                  <Check size={14} />
                ) : (
                  <BookmarkPlus size={14} />
                )}
              </button>
            </div>

            {isSplitting ? (
              <div
                style={{
                  gridColumn: "2 / -1",
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  gap: 7,
                  padding: 8,
                  background: "var(--pv-indigo-soft)",
                  border: "1px solid rgba(91, 98, 232, 0.2)",
                  borderRadius: 9,
                }}
              >
                <textarea
                  autoFocus
                  rows={2}
                  aria-label="输入带顶层分隔符的片段"
                  value={splitEditor.value}
                  placeholder="例如：looking at camera, smiling"
                  onChange={(event) =>
                    setSplitEditor({
                      ordinal,
                      value: event.target.value,
                    })
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      (event.ctrlKey || event.metaKey)
                    ) {
                      event.preventDefault();
                      applySplit();
                    }
                    if (event.key === "Escape") setSplitEditor(null);
                  }}
                  style={{
                    ...inputStyle,
                    height: "auto",
                    minHeight: 52,
                    resize: "vertical",
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <button
                    type="button"
                    onClick={applySplit}
                    title="按顶层逗号、分号或换行拆分（Ctrl+Enter）"
                    style={{
                      ...iconButtonStyle,
                      color: "#fff",
                      background: "var(--pv-indigo)",
                      borderColor: "var(--pv-indigo)",
                    }}
                  >
                    <Check size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSplitEditor(null)}
                    title="取消（Esc）"
                    style={iconButtonStyle}
                  >
                    <X size={14} />
                  </button>
                </div>
                <small
                  style={{
                    gridColumn: "1 / -1",
                    color: "var(--pv-text-muted)",
                  }}
                >
                  仅识别顶层的英文/中文逗号、分号和换行；括号、引号、转义逗号与
                  LoRA 标签内部保持完整。
                </small>
              </div>
            ) : null}
          </div>
        );
      })}

      <div
        aria-live="polite"
        style={{
          minHeight: 17,
          padding: "0 4px",
          color: "var(--pv-text-muted)",
          fontSize: 12,
        }}
      >
        {announcement ||
          `${parsed.chips.length} 个片段 · 拖动或用上下按钮排序 · 原始 Prompt 始终可无损复制`}
      </div>
    </div>
  );
}
