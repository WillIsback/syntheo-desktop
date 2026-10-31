import { Trans, useLingui } from "@lingui/react/macro";
import { Reorder, useDragControls } from "motion/react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import type { TemplateSection } from "@syntheo/store";
import { DotsSixVertical, X } from "@syntheo/ui/components/icons";
import { cn } from "@syntheo/utils";

import { inlineFieldClassName, LineTextarea } from "./line-textarea";

type SectionDraft = TemplateSection & { key: string };

type PendingFocus = { key: string; target: "handle" | "title" } | null;

function useEditableSections({
  disabled,
  initialItems,
  onChange,
}: {
  disabled: boolean;
  initialItems: TemplateSection[];
  onChange: (items: TemplateSection[]) => void;
}) {
  const [drafts, setDrafts] = useState<SectionDraft[]>(() =>
    initialItems.map((s) => ({ ...s, key: crypto.randomUUID() })),
  );

  useEffect(() => {
    setDrafts((prev) => {
      const changed =
        prev.length !== initialItems.length ||
        prev.some(
          (d, i) =>
            d.title !== initialItems[i]?.title ||
            d.description !== initialItems[i]?.description,
        );
      if (!changed) return prev;
      return initialItems.map((s, i) => ({
        ...s,
        key: prev[i]?.key ?? crypto.randomUUID(),
      }));
    });
  }, [initialItems]);

  const pendingCommit = useRef<TemplateSection[] | null>(null);

  useEffect(() => {
    if (pendingCommit.current) {
      const value = pendingCommit.current;
      pendingCommit.current = null;
      onChange(value);
    }
  });

  const commit = useCallback(
    (next: SectionDraft[] | ((prev: SectionDraft[]) => SectionDraft[])) => {
      setDrafts((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        pendingCommit.current = resolved.map(({ title, description }) => ({
          title,
          description,
        }));
        return resolved;
      });
    },
    [],
  );

  return {
    drafts,
    addSection: useCallback(
      (draft: SectionDraft) => commit((prev) => [...prev, draft]),
      [commit],
    ),
    changeSection: useCallback(
      (draft: SectionDraft) =>
        commit((prev) => prev.map((s) => (s.key === draft.key ? draft : s))),
      [commit],
    ),
    deleteSection: useCallback(
      (key: string) => commit((prev) => prev.filter((s) => s.key !== key)),
      [commit],
    ),
    moveSection: useCallback(
      (key: string, direction: -1 | 1) =>
        commit((prev) => {
          const i = prev.findIndex((s) => s.key === key);
          const j = i + direction;
          if (i < 0 || j < 0 || j >= prev.length) return prev;
          const next = [...prev];
          const [s] = next.splice(i, 1);
          next.splice(j, 0, s);
          return next;
        }),
      [commit],
    ),
    reorderSections: useCallback(
      (next: SectionDraft[]) => {
        if (!disabled) commit(next);
      },
      [commit, disabled],
    ),
  };
}

/**
 * Sections d'un modèle : un titre et une consigne d'une ligne par section,
 * réordonnables à la souris (poignée) ou au clavier (flèches sur la poignée).
 */
export function SectionsList({
  disabled,
  items,
  onChange,
}: {
  disabled: boolean;
  items: TemplateSection[];
  onChange: (items: TemplateSection[]) => void;
}) {
  const { t } = useLingui();
  const hintId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const pendingFocus = useRef<PendingFocus>(null);
  const [announcement, setAnnouncement] = useState("");
  const {
    drafts,
    addSection,
    changeSection,
    deleteSection,
    moveSection,
    reorderSections,
  } = useEditableSections({
    disabled,
    initialItems: items,
    onChange,
  });

  useEffect(() => {
    const focus = pendingFocus.current;
    if (!focus) return;
    pendingFocus.current = null;
    const selector =
      focus.target === "handle"
        ? `[data-section-handle="${focus.key}"]`
        : `[data-section-title="${focus.key}"]`;
    const element = listRef.current?.querySelector(selector);
    if (element instanceof HTMLElement) element.focus();
  }, [drafts]);

  const handleMove = useCallback(
    (key: string, direction: -1 | 1) => {
      const index = drafts.findIndex((draft) => draft.key === key);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= drafts.length) return;
      pendingFocus.current = { key, target: "handle" };
      moveSection(key, direction);
      const position = nextIndex + 1;
      const total = drafts.length;
      setAnnouncement(t`Section moved to position ${position} of ${total}.`);
    },
    [drafts, moveSection, t],
  );

  const handleAdd = useCallback(() => {
    const key = crypto.randomUUID();
    pendingFocus.current = { key, target: "title" };
    addSection({ key, title: "", description: "" });
  }, [addSection]);

  return (
    <div className="flex flex-col">
      {!disabled ? (
        <p id={hintId} className="sr-only">
          <Trans>
            To move a section with the keyboard, focus its handle and use the up
            and down arrow keys.
          </Trans>
        </p>
      ) : null}
      <Reorder.Group
        as="ol"
        axis="y"
        ref={listRef}
        values={drafts}
        onReorder={reorderSections}
        aria-label={t`Sections`}
        className="border-border flex flex-col border-t"
      >
        {drafts.map((draft, index) => (
          <SectionRow
            key={draft.key}
            disabled={disabled}
            hintId={hintId}
            index={index}
            total={drafts.length}
            item={draft}
            onChange={changeSection}
            onDelete={deleteSection}
            onMove={handleMove}
          />
        ))}
      </Reorder.Group>

      {!disabled ? (
        <button
          type="button"
          onClick={handleAdd}
          className="text-primary hover:text-primary-hover focus-visible:ring-ring/50 w-fit rounded-sm py-3 text-left text-sm font-semibold outline-hidden focus-visible:ring-2"
        >
          <Trans>+ Add a section</Trans>
        </button>
      ) : null}

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

function SectionRow({
  disabled,
  hintId,
  index,
  total,
  item,
  onChange,
  onDelete,
  onMove,
}: {
  disabled: boolean;
  hintId: string;
  index: number;
  total: number;
  item: SectionDraft;
  onChange: (item: SectionDraft) => void;
  onDelete: (key: string) => void;
  onMove: (key: string, direction: -1 | 1) => void;
}) {
  const { t } = useLingui();
  const dragControls = useDragControls();
  const position = index + 1;

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      onMove(item.key, -1);
    } else if (event.key === "ArrowDown" && index < total - 1) {
      event.preventDefault();
      onMove(item.key, 1);
    }
  };

  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={dragControls}
      className="group border-border bg-background grid grid-cols-[22px_26px_minmax(0,1fr)_auto] items-start gap-2 border-b py-3"
    >
      {disabled ? (
        <span aria-hidden="true" />
      ) : (
        <button
          type="button"
          data-section-handle={item.key}
          aria-label={t`Move section ${position}`}
          aria-describedby={hintId}
          onPointerDown={(event) => dragControls.start(event)}
          onKeyDown={handleKeyDown}
          className="text-faint hover:text-muted-foreground focus-visible:ring-ring/50 mt-1 flex size-6 cursor-grab touch-none items-center justify-center rounded-md outline-hidden focus-visible:ring-2 active:cursor-grabbing"
        >
          <DotsSixVertical className="size-4" />
        </button>
      )}

      <span
        aria-hidden="true"
        className="text-faint pt-[7px] font-mono text-xs tabular-nums"
      >
        {String(position).padStart(2, "0")}
      </span>

      <div className="flex min-w-0 flex-col">
        <input
          type="text"
          data-section-title={item.key}
          disabled={disabled}
          value={item.title}
          onChange={(event) => onChange({ ...item, title: event.target.value })}
          aria-label={t`Section ${position} title`}
          placeholder={t`Section title`}
          className={cn([
            "w-full border-0 bg-transparent p-0 font-serif text-xl leading-snug font-medium",
            inlineFieldClassName,
          ])}
        />
        <LineTextarea
          disabled={disabled}
          value={item.description}
          onChange={(event) =>
            onChange({ ...item, description: event.target.value })
          }
          aria-label={t`Section ${position} instruction`}
          placeholder={t`Describe in one line what Syntheo should write here.`}
          className="text-muted-foreground pt-0.5 text-sm"
        />
      </div>

      {disabled ? (
        <span aria-hidden="true" />
      ) : (
        <button
          type="button"
          onClick={() => onDelete(item.key)}
          aria-label={t`Delete section ${position}`}
          className="text-faint hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 rounded-md p-1.5 opacity-0 outline-hidden group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2"
        >
          <X className="size-3.5" />
        </button>
      )}
    </Reorder.Item>
  );
}
