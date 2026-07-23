'use client';

/**
 * The bodies of the four Canvas modes.
 *
 * Each is a plain presentational component over the view models in
 * `../../types` — it receives what it renders, so a mode is exercised in a
 * test without a backend. A mode that the visibility matrix marked
 * not-ready never reaches these components: the panel renders
 * {@link CanvasModeNotice} in its place, which states what would fill the
 * mode instead of showing an empty frame.
 */

import { EmptyState } from '@tale/ui/empty-state';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { FileText, MonitorPlay, PanelsTopLeft, Radio } from 'lucide-react';
import { useState, type ComponentType } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { formatFileSize } from '@/lib/utils/format/file';

import type { CanvasMode, CanvasModePending } from '../../lib/canvas-modes';
import type {
  CanvasActivityEntry,
  CanvasArtifact,
  CanvasFileEntry,
} from '../../types';

/** The icon each mode carries in its tab and in its empty notice. */
export const CANVAS_MODE_ICONS: Record<
  CanvasMode,
  ComponentType<{ className?: string }>
> = {
  computer: MonitorPlay,
  live: Radio,
  file: FileText,
  browser: PanelsTopLeft,
};

/**
 * Why a shown mode is empty, in the user's words. The matrix decides WHICH
 * reason applies; this maps it to the sentence that explains it.
 */
export function CanvasModeNotice({
  mode,
  pending,
}: {
  mode: CanvasMode;
  pending: CanvasModePending;
}) {
  const { t } = useT('chat');
  return (
    <EmptyState
      icon={CANVAS_MODE_ICONS[mode]}
      title={t(`canvasPanel.modes.${mode}.label`)}
      description={t(`canvasPanel.pending.${pending}`)}
    />
  );
}

/**
 * Computer view — the CDP-attached headed browser session, i.e. the whole
 * sandbox computer. The stream is read-only here: the panel observes the
 * session, it does not drive it.
 */
export function CanvasComputerView({ streamUrl }: { streamUrl: string }) {
  const { t } = useT('chat');
  return (
    <iframe
      src={streamUrl}
      title={t('canvasPanel.modes.computer.frameTitle')}
      className="bg-muted h-full w-full flex-1 border-0"
    />
  );
}

/** Live view — the activity of the running turn, newest last. */
export function CanvasLiveView({
  activity,
}: {
  activity: readonly CanvasActivityEntry[];
}) {
  const { t } = useT('chat');
  return (
    <Stack
      as="ol"
      gap={0}
      aria-label={t('canvasPanel.modes.live.listLabel')}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      {activity.map((entry) => (
        <li
          key={entry.id}
          className="border-border flex flex-col gap-0.5 border-b px-3 py-2 last:border-b-0"
        >
          <span className="text-foreground text-sm font-medium">
            {entry.label}
          </span>
          {entry.detail && (
            <Text variant="muted" className="text-xs">
              {entry.detail}
            </Text>
          )}
        </li>
      ))}
    </Stack>
  );
}

/**
 * File view — what the sandbox workspace holds. The list is a reading
 * surface: opening a file needs the file-content read, which lands with the
 * rest of the chat backend, so there is no row control here that would do
 * nothing when clicked.
 */
export function CanvasFileView({
  files,
}: {
  files: readonly CanvasFileEntry[];
}) {
  const { t } = useT('chat');
  return (
    <Stack
      as="ul"
      gap={0}
      aria-label={t('canvasPanel.modes.file.listLabel')}
      className="min-h-0 flex-1 overflow-y-auto p-1"
    >
      {files.map((file) => (
        <li
          key={file.path}
          className="text-muted-foreground flex min-h-8 items-center gap-2 px-2 text-sm"
        >
          <FileText aria-hidden className="size-3.5 shrink-0" />
          <span className="text-foreground min-w-0 truncate">{file.path}</span>
          <span className="ml-auto shrink-0 text-xs">
            {formatFileSize(file.bytes)}
          </span>
        </li>
      ))}
    </Stack>
  );
}

/**
 * Browser view — the render frame for the thread's artifacts. It renders web
 * and document artifacts, which is why it reads as the browser of the set.
 */
export function CanvasBrowserView({
  artifacts,
}: {
  artifacts: readonly CanvasArtifact[];
}) {
  const { t } = useT('chat');
  const [picked, setPicked] = useState<string>();
  const active =
    artifacts.find((artifact) => artifact.id === picked) ?? artifacts[0];

  // The Browser mode is only shown for a thread that HAS an artifact, so an
  // empty list never reaches here; render nothing rather than a bare frame.
  if (!active) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {artifacts.length > 1 && (
        <Stack
          as="ul"
          gap={0}
          aria-label={t('canvasPanel.modes.browser.listLabel')}
          className="border-border flex-row gap-1 overflow-x-auto border-b p-1"
        >
          {artifacts.map((artifact) => (
            <li key={artifact.id}>
              <button
                type="button"
                onClick={() => setPicked(artifact.id)}
                aria-current={artifact.id === active.id ? 'true' : undefined}
                className={cn(
                  'focus-visible:ring-ring min-h-8 rounded-md px-2 text-sm whitespace-nowrap focus-visible:ring-2 focus-visible:outline-none',
                  artifact.id === active.id
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                {artifact.title}
              </button>
            </li>
          ))}
        </Stack>
      )}
      {active.url ? (
        <iframe
          src={active.url}
          title={active.title}
          className="bg-background h-full w-full flex-1 border-0"
        />
      ) : (
        <EmptyState
          icon={CANVAS_MODE_ICONS.browser}
          title={active.title}
          description={t('canvasPanel.modes.browser.notRenderable')}
        />
      )}
    </div>
  );
}
