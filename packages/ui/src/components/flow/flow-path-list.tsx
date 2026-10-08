'use client';

import { Pin } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { useT } from '../../i18n/client';
import { cn } from '../../lib/cn';
import { CLAIMS_ESCAPE_ATTRIBUTE } from '../overlays/claims-escape';
import { Button } from '../primitives/button';

/** A short fact about a path ("Urgent: No"), with a tone dot; the words
 *  always say it, the dot only repeats it. */
export interface FlowPathClause {
  id: string;
  label: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'error';
}

/** One row: a path, or (with `pinnable: false`) a node to go to. */
export interface FlowPathListRow {
  id: string;
  /** "Path 2". */
  title: string;
  /** "5 of 6 nodes run". */
  meta?: string;
  clauses?: readonly FlowPathClause[];
  /**
   * A path pins (Enter, Space or a click toggles it); a row that is not
   * pinnable — a node that ends a run when it fails — activates instead.
   * @default true
   */
  pinnable?: boolean;
}

export interface FlowPathListSection {
  id: string;
  /** Names the section's rows ("Ends the run when it fails"). */
  title?: string;
  description?: string;
  rows: readonly FlowPathListRow[];
  /** Under the rows (the host's "Too many conditions to list every path"). */
  footer?: ReactNode;
}

export interface FlowPathListProps {
  sections: readonly FlowPathListSection[];
  /** The row a pointer rests on or focus is on. */
  previewId?: string | null;
  /** The row the reader pinned. */
  pinnedId?: string | null;
  /** A row is pointed at or focused (`id`), or left (`null`). */
  onPreview?: (id: string | null) => void;
  /** A path is pinned (`id`) or unpinned (`null`). */
  onPin?: (id: string | null) => void;
  /** A row that is not pinnable is chosen. */
  onActivate?: (id: string) => void;
  /** What a screen reader hears, once, when a row is pinned ("Showing
   *  path 2: …"). */
  announce?: (row: FlowPathListRow) => string;
  'aria-label': string;
  /** Shown when no section has a row. */
  empty?: ReactNode;
  className?: string;
}

const CLAUSE_DOT: Record<NonNullable<FlowPathClause['tone']>, string> = {
  neutral: 'bg-muted-foreground',
  positive: 'bg-[hsl(var(--success))]',
  negative: 'bg-[var(--flow-edge-negative)]',
  error: 'bg-destructive',
};

/**
 * The possible paths through a workflow, as a list a reader explores the
 * chart with: pointing at or focusing a row previews its path on the
 * canvas, Enter, Space or a click pins it (and again unpins it), Escape
 * unpins, and **Show all** returns to every path. A section of rows that
 * are not paths — the nodes that end a run when they fail — activates a
 * row instead of pinning it.
 *
 * One Tab stop for every row of every section: ↑ and ↓ move between rows,
 * Home and End jump. Pinning says so once in a polite live region, in the
 * host's words. While a path is pinned the list claims Escape, so the
 * first Escape inside a sheet unpins and only the next one closes it.
 */
export function FlowPathList({
  sections,
  previewId = null,
  pinnedId = null,
  onPreview,
  onPin,
  onActivate,
  announce,
  'aria-label': ariaLabel,
  empty,
  className,
}: FlowPathListProps) {
  const { t } = useT('flow');
  const baseId = useId();
  const rows = sections.flatMap((section) => section.rows);
  const ids = rows.map((row) => row.id);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [spoken, setSpoken] = useState({ text: '', serial: 0 });

  // The one Tab stop: the row last focused while it is still listed, else
  // the pinned row, else the first.
  const listed = (id: string | null): id is string =>
    id !== null && ids.includes(id);
  const rovingId = listed(focusedId)
    ? focusedId
    : listed(pinnedId)
      ? pinnedId
      : (ids[0] ?? null);

  // Say a pin once, when it happens; a row pinned again is said again.
  const lastPinned = useRef(pinnedId);
  useEffect(() => {
    if (lastPinned.current === pinnedId) return;
    lastPinned.current = pinnedId;
    if (pinnedId === null || announce === undefined) return;
    const row = rows.find((candidate) => candidate.id === pinnedId);
    if (row === undefined) return;
    const text = announce(row);
    setSpoken((previous) => ({ text, serial: previous.serial + 1 }));
  }, [pinnedId, announce, rows]);

  const focusRow = useCallback((id: string) => {
    buttons.current.get(id)?.focus();
  }, []);

  const choose = (row: FlowPathListRow) => {
    if (row.pinnable === false) onActivate?.(row.id);
    else onPin?.(pinnedId === row.id ? null : row.id);
  };

  const onRowKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let next: string | undefined;
    switch (event.key) {
      case 'ArrowDown':
        next = ids[Math.min(index + 1, ids.length - 1)];
        break;
      case 'ArrowUp':
        next = ids[Math.max(index - 1, 0)];
        break;
      case 'Home':
        next = ids[0];
        break;
      case 'End':
        next = ids.at(-1);
        break;
      case 'Escape':
        if (pinnedId === null) return;
        event.preventDefault();
        event.stopPropagation();
        onPin?.(null);
        return;
      default:
        return;
    }
    event.preventDefault();
    if (next !== undefined) focusRow(next);
  };

  if (rows.length === 0) {
    return (
      <div className={cn('text-muted-foreground p-3 text-sm', className)}>
        {empty}
      </div>
    );
  }

  let index = -1;
  return (
    <div
      data-slot="flow-path-list"
      className={cn('flex flex-col', className)}
      {...(pinnedId === null ? {} : { [CLAIMS_ESCAPE_ATTRIBUTE]: '' })}
    >
      <div
        role="group"
        aria-label={ariaLabel}
        className="flex flex-col gap-3"
        onPointerLeave={() => {
          if (previewId !== null) onPreview?.(null);
        }}
      >
        {sections.map((section) => {
          const titleId = `${baseId}-${section.id}-title`;
          const descriptionId = `${baseId}-${section.id}-description`;
          if (section.rows.length === 0 && section.footer === undefined)
            return null;
          return (
            <div key={section.id} className="flex flex-col">
              {section.title && (
                <p
                  id={titleId}
                  className="text-muted-foreground px-3 pb-1 text-xs font-medium"
                >
                  {section.title}
                </p>
              )}
              {section.description && (
                <p
                  id={descriptionId}
                  className="text-muted-foreground px-3 pb-1 text-xs"
                >
                  {section.description}
                </p>
              )}
              {section.rows.length > 0 && (
                <ul
                  role="list"
                  aria-labelledby={section.title ? titleId : undefined}
                  aria-describedby={
                    section.description ? descriptionId : undefined
                  }
                  className="flex flex-col"
                >
                  {section.rows.map((row) => {
                    index += 1;
                    const at = index;
                    const pinnable = row.pinnable !== false;
                    const pinned = pinnable && pinnedId === row.id;
                    const previewed = previewId === row.id;
                    return (
                      <li key={row.id}>
                        <button
                          ref={(node) => {
                            if (node === null) buttons.current.delete(row.id);
                            else buttons.current.set(row.id, node);
                          }}
                          type="button"
                          data-flow-path-row={row.id}
                          tabIndex={rovingId === row.id ? 0 : -1}
                          aria-pressed={pinnable ? pinned : undefined}
                          onClick={() => choose(row)}
                          onKeyDown={(event) => onRowKeyDown(event, at)}
                          onFocus={() => {
                            setFocusedId(row.id);
                            onPreview?.(row.id);
                          }}
                          onBlur={(event) => {
                            // Leaving the list ends the preview; moving
                            // to the next row hands it over.
                            const next = event.relatedTarget;
                            if (
                              !(next instanceof Element) ||
                              next.closest('[data-flow-path-row]') === null
                            )
                              onPreview?.(null);
                          }}
                          onPointerEnter={() => onPreview?.(row.id)}
                          className={cn(
                            'flex w-full cursor-pointer items-start gap-2 rounded-md px-3 py-2 text-left',
                            'hover:bg-muted/60 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
                            previewed && 'bg-muted/60',
                            pinned && 'bg-muted',
                          )}
                        >
                          <span className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="flex items-baseline gap-2">
                              <span className="text-foreground text-sm font-medium">
                                {row.title}
                              </span>
                              {row.meta && (
                                <span className="text-muted-foreground text-xs">
                                  {row.meta}
                                </span>
                              )}
                            </span>
                            {row.clauses && row.clauses.length > 0 && (
                              <span className="flex flex-wrap gap-1">
                                {row.clauses.map((clause) => (
                                  <span
                                    key={clause.id}
                                    className="border-border text-foreground inline-flex h-5 max-w-full items-center gap-1.5 rounded-full border px-2 text-xs"
                                  >
                                    <span
                                      aria-hidden="true"
                                      className={cn(
                                        'size-1.5 shrink-0 rounded-full',
                                        CLAUSE_DOT[clause.tone ?? 'neutral'],
                                      )}
                                    />
                                    <span className="truncate">
                                      {clause.label}
                                    </span>
                                  </span>
                                ))}
                              </span>
                            )}
                          </span>
                          {pinned && (
                            <Pin
                              aria-hidden="true"
                              className="text-foreground mt-0.5 size-3.5 shrink-0"
                            />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {section.footer !== undefined && (
                <div className="text-muted-foreground px-3 pt-1 text-xs">
                  {section.footer}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {pinnedId !== null && (
        <div className="px-3 pt-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onPin?.(null);
              focusRow(pinnedId);
            }}
          >
            {t('paths.showAll')}
          </Button>
        </div>
      )}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {spoken.text === '' ? null : (
          <span key={spoken.serial}>{spoken.text}</span>
        )}
      </div>
    </div>
  );
}
