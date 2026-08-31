import { useEffect, useState } from "react";
import { Clock3, History, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import type { Revision } from "../types";
import { Badge, Button, EmptyState, Modal } from "./ui";

function revisionTitle(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return "Revisions";
  const value = snapshot as Record<string, unknown>;
  return String(value.title || value.text || "Revisions");
}

function revisionSummary(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return "";
  const value = snapshot as Record<string, unknown>;
  const source = String(
    value.positivePrompt || value.translation || value.text || "",
  );
  return source.length > 140 ? `${source.slice(0, 140)}…` : source;
}

function formatRevisionTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function RevisionHistory({
  entityType,
  entityId,
  onClose,
  onApply,
  onToast,
}: {
  entityType: "recipe" | "snippet";
  entityId: string;
  onClose: () => void;
  onApply: (snapshot: unknown) => void;
  onToast: (message: string) => void;
}) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void api
      .listRevisions(entityType, entityId)
      .then((items) => {
        if (active) setRevisions(items);
      })
      .catch((error) => {
        onToast(`Could not load revision history: ${String(error)}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [entityId, entityType, onToast]);

  return (
    <Modal
      title="Revision history"
      eyebrow="Restorable · Up to 100 revisions"
      size="lg"
      onClose={onClose}
    >
      <div className="revision-history">
        {loading ? (
          <div className="revision-loading">
            <Clock3 size={18} />
            Loading revisions…
          </div>
        ) : revisions.length ? (
          <div className="revision-list">
            {revisions.map((revision, index) => (
              <article className="revision-row" key={revision.id}>
                <span className="revision-icon">
                  <History size={17} />
                </span>
                <div className="revision-copy">
                  <div>
                    <strong>{revisionTitle(revision.snapshot)}</strong>
                    {index === 0 ? <Badge tone="neutral">Most recent</Badge> : null}
                  </div>
                  <small>{formatRevisionTime(revision.createdAt)}</small>
                  {revisionSummary(revision.snapshot) ? (
                    <p>{revisionSummary(revision.snapshot)}</p>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RotateCcw size={14} />}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Load this revision into the editor? It will not replace the current version until you click Save.",
                      )
                    ) {
                      onApply(revision.snapshot);
                    }
                  }}
                >
                  Load
                </Button>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<History size={23} />}
            title="No revisions yet"
            description="After the first edit is saved, the previous version will appear here."
          />
        )}
      </div>
    </Modal>
  );
}
