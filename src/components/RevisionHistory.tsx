import { useEffect, useState } from "react";
import { Clock3, History, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import type { Revision } from "../types";
import { Badge, Button, EmptyState, Modal } from "./ui";

function revisionTitle(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return "历史版本";
  const value = snapshot as Record<string, unknown>;
  return String(value.title || value.text || "历史版本");
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
        onToast(`无法读取修改历史：${String(error)}`);
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
      title="修改历史"
      eyebrow="可恢复 · 最多显示 100 个版本"
      size="lg"
      onClose={onClose}
    >
      <div className="revision-history">
        {loading ? (
          <div className="revision-loading">
            <Clock3 size={18} />
            正在读取历史版本…
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
                    {index === 0 ? <Badge tone="neutral">最近一次</Badge> : null}
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
                        "把这个历史版本载入编辑器？只有再次点击“保存”后才会覆盖当前版本。",
                      )
                    ) {
                      onApply(revision.snapshot);
                    }
                  }}
                >
                  载入
                </Button>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<History size={23} />}
            title="还没有历史版本"
            description="同一条内容首次修改并保存后，这里会保留修改前的版本。"
          />
        )}
      </div>
    </Modal>
  );
}
