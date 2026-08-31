import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  FileText,
  Lightbulb,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import type { SearchResult } from "../types";
import { IconButton } from "./ui";

const resultIcons = {
  recipe: FileText,
  snippet: Sparkles,
  resource: Box,
  tip: Lightbulb,
};

const resultLabels = {
  recipe: "Recipes",
  snippet: "Snippets",
  resource: "Models & LoRAs",
  tip: "Tips",
};

export function SearchPalette({
  query,
  results,
  loading,
  onQueryChange,
  onClose,
  onSelect,
}: {
  query: string;
  results: SearchResult[];
  loading: boolean;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onSelect: (result: SearchResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  const emptyMessage = useMemo(() => {
    if (!query.trim()) return "Search prompts, translations, models, LoRAs, and tips";
    if (loading) return "Searching…";
    return "No matches; try another keyword";
  }, [loading, query]);

  return (
    <div className="palette-layer" onMouseDown={onClose}>
      <section
        className="search-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input">
          <Search size={20} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search prompts, translations, categories, or models…"
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) =>
                  Math.min(current + 1, results.length - 1),
                );
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
              }
              if (event.key === "Enter" && results[activeIndex]) {
                onSelect(results[activeIndex]);
              }
            }}
          />
          <span className="keyboard-key">ESC</span>
          <IconButton label="Close search" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="palette-results">
          {results.length ? (
            results.map((result, index) => {
              const ResultIcon = resultIcons[result.entityType];
              return (
                <button
                  className={index === activeIndex ? "is-active" : ""}
                  key={`${result.entityType}-${result.id}`}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => onSelect(result)}
                >
                  <span className={`result-icon result-${result.entityType}`}>
                    <ResultIcon size={17} />
                  </span>
                  <span className="result-copy">
                    <strong>{result.title}</strong>
                    <small>{result.subtitle}</small>
                  </span>
                  <span className="result-type">
                    {resultLabels[result.entityType]}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="palette-empty">
              <Search size={25} />
              <span>{emptyMessage}</span>
            </div>
          )}
        </div>
        <footer className="palette-footer">
          <span>
            <kbd>↑</kbd><kbd>↓</kbd> Select
          </span>
          <span>
            <kbd>Enter</kbd> Open
          </span>
          <span>Search source text and translations together</span>
        </footer>
      </section>
    </div>
  );
}
