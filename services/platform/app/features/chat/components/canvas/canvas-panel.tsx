'use client';

/**
 * The Canvas — the persistent right-side panel every chat carries.
 *
 * Its tabs are Canvas MODES, shown contextually: which of them appear is
 * decided in one place, `resolveCanvasModes`, and never re-derived here. A
 * mode that does not apply to the thread is absent from the strip; a mode
 * that applies but has nothing in it yet renders a notice saying what would
 * fill it, never an empty frame.
 *
 * The strip is the shared `Tabs` primitive, so it is a real tablist with
 * roving focus, arrow-key navigation, and `aria-selected` — the panel does
 * not hand-roll tab semantics.
 *
 * Like every second-level panel in the app (`SubPanel`), the Canvas docks
 * from `md` up; narrow viewports reach the same content through the chat's
 * own mobile affordance.
 */

import { Tabs, type TabItem } from '@tale/ui/tabs';
import { useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  defaultCanvasMode,
  resolveCanvasModes,
  type CanvasMode,
  type CanvasModePending,
} from '../../lib/canvas-modes';
import type { CanvasSources } from '../../types';
import {
  CANVAS_MODE_ICONS,
  CanvasBrowserView,
  CanvasComputerView,
  CanvasFileView,
  CanvasLiveView,
  CanvasModeNotice,
} from './canvas-mode-views';

interface CanvasPanelProps {
  /** Everything known about the open thread; `undefined` while none is open. */
  sources?: CanvasSources;
  className?: string;
}

function isCanvasMode(value: string): value is CanvasMode {
  return (
    value === 'computer' ||
    value === 'live' ||
    value === 'file' ||
    value === 'browser'
  );
}

export function CanvasPanel({ sources, className }: CanvasPanelProps) {
  const { t } = useT('chat');

  const states = useMemo(
    () =>
      sources
        ? resolveCanvasModes({
            kind: sources.kind,
            hasSandboxSession: sources.hasSandboxSession,
            // Streaming IFF there is a stream to show: the mode is ready
            // exactly when the panel has a frame to put on screen.
            isComputerStreaming: sources.computerStreamUrl !== undefined,
            activityCount: sources.activity.length,
            fileCount: sources.files.length,
            artifactCount: sources.artifacts.length,
          })
        : [],
    [sources],
  );

  // The user's pick, held only while it still names a shown mode — a turn
  // that ends can retire the mode the user was on, and the panel must fall
  // back rather than select a tab that no longer exists.
  const [picked, setPicked] = useState<CanvasMode>();
  const active =
    (picked && states.some((state) => state.mode === picked)
      ? picked
      : undefined) ?? defaultCanvasMode(states);

  const items = useMemo<TabItem[]>(
    () =>
      states.map((state) => {
        const Icon = CANVAS_MODE_ICONS[state.mode];
        return {
          value: state.mode,
          label: (
            <span className="flex items-center gap-1.5">
              <Icon aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">
                {t(`canvasPanel.modes.${state.mode}.label`)}
              </span>
            </span>
          ),
          content: (
            <CanvasModeBody
              mode={state.mode}
              pending={state.pending}
              sources={sources}
            />
          ),
        };
      }),
    [states, sources, t],
  );

  // Nothing applies to this thread — the right edge stays clean. This is the
  // "omit it" half of the rule: a Canvas with no mode is not a Canvas.
  if (!active || items.length === 0) return null;

  return (
    <aside
      aria-label={t('canvasPanel.title')}
      className={cn(
        'border-border bg-background hidden h-full min-h-0 w-96 shrink-0 flex-col border-l md:flex',
        className,
      )}
    >
      <Tabs
        items={items}
        value={active}
        onValueChange={(value) => {
          if (isCanvasMode(value)) setPicked(value);
        }}
        listAriaLabel={t('canvasPanel.tablistLabel')}
        variant="pill"
        className="flex min-h-0 flex-1 flex-col px-2 pt-2"
        listClassName="shrink-0 max-w-full"
        triggerClassName="min-h-8"
      />
    </aside>
  );
}

/** The body behind one tab: the mode's view, or why it has nothing to show. */
function CanvasModeBody({
  mode,
  pending,
  sources,
}: {
  mode: CanvasMode;
  pending?: CanvasModePending;
  sources?: CanvasSources;
}) {
  // `pending` and a renderable body are mutually exclusive by construction —
  // the matrix sets one exactly when the other is absent.
  if (pending || !sources) {
    return (
      <CanvasModeNotice
        mode={mode}
        pending={pending ?? 'sandbox-not-started'}
      />
    );
  }

  switch (mode) {
    case 'computer':
      return sources.computerStreamUrl ? (
        <CanvasComputerView streamUrl={sources.computerStreamUrl} />
      ) : (
        <CanvasModeNotice mode="computer" pending="computer-not-streaming" />
      );
    case 'live':
      return <CanvasLiveView activity={sources.activity} />;
    case 'file':
      return <CanvasFileView files={sources.files} />;
    case 'browser':
      return <CanvasBrowserView artifacts={sources.artifacts} />;
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}
