'use client';

import { cn } from '@tale/ui/cn';
import { Text } from '@tale/ui/text';
import { useResizeObserver } from '@tale/ui/use-resize-observer';
import { ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';

import { useT } from '@/lib/i18n/client';

import { useDataClassificationNotice } from '../hooks/use-data-classification-notice';
import {
  clearDataNoticeBootMarker,
  readRememberedDataNotice,
  rememberDataNotice,
} from '../lib/data-notice-boot';

interface DataNoticeFooterProps {
  organizationId: string | undefined;
  className?: string;
}

const ROW_CLASS =
  'flex items-center justify-center gap-1.5 px-3 py-1.5 compact-height:pb-0';

/** On a `compact-height` viewport (a laptop screen) the notice keeps to one
 * line under the composer, cut with an ellipsis when it is longer. The whole
 * text stays in the DOM for screen readers and find-in-page, and the toggle
 * beside a cut line unfolds it. */
const LINE_CLASS = 'min-w-0 leading-tight';
const ONE_LINE_CLASS = 'compact-height:truncate';

/**
 * Confidentiality footer under the chat composer. Reads the org's
 * `data_classification_notice` policy via `useDataClassificationNotice`:
 * it shows only when an admin turned it on, with their text for the reader's
 * language or the platform default.
 *
 * Every settled answer is also remembered for the chat's loading skeleton
 * (`data-notice-boot.ts`), so the next page load reserves the notice's row
 * before first paint. Until the read settles on that load, the footer keeps
 * the same row reserved (invisible), so the composer never drops into the
 * gap and then jumps back up when the notice arrives.
 *
 * Advisory only — there is no acknowledgment gate. The B2B self-host
 * model treats the deploying org as the data controller; end-user
 * explicit consent UX (a blocking modal) is product-incongruent and
 * was removed alongside the (broken) `DataNoticeAckModal`. The
 * `requireAcknowledgment` policy field is preserved server-side for a
 * future regulated-customer rewire.
 *
 * Visual: the caption tier — a muted icon beside small muted text. The
 * text needs its own `caption` variant: `Text` defaults to `body`, whose
 * `text-foreground` would override the color inherited from the wrapper.
 * On a `compact-height` viewport it keeps to one line (`LINE_CLASS`): an
 * admin's text runs to 280 characters, two or three lines under the composer
 * on a laptop screen.
 */
export function DataNoticeFooter({
  organizationId,
  className,
}: DataNoticeFooterProps) {
  const { t } = useT('dataNotice');
  const notice = useDataClassificationNotice(organizationId);
  const shown = notice.enabled ? notice.message : null;
  const lineRef = useRef<HTMLElement>(null);
  const lineId = useId();
  const [expanded, setExpanded] = useState(false);
  // Whether the one-line notice is cut short. Measured while it is folded,
  // and again whenever the line resizes: a narrower column, or a window
  // tall enough to lift the one-line rule.
  const [cut, setCut] = useState(false);
  useResizeObserver(
    lineRef,
    () => {
      const line = lineRef.current;
      if (line === null || expanded) return;
      setCut(line.scrollWidth > line.clientWidth + 1);
    },
    // The line mounts once the read settles, so that re-attaches too.
    { deps: [shown, expanded, notice.settled] },
  );
  // What this device showed last time, read once: it only matters until the
  // read settles, and the effect below keeps the stored value current.
  const [remembered] = useState(() =>
    organizationId === undefined
      ? null
      : readRememberedDataNotice(organizationId),
  );

  useEffect(() => {
    // Only a settled answer is worth remembering: a read that is still
    // loading, or that failed, says nothing about the org's setting.
    if (organizationId === undefined || !notice.settled) return;
    rememberDataNotice(organizationId, shown);
  }, [organizationId, notice.settled, shown]);

  useEffect(() => clearDataNoticeBootMarker, []);

  if (!notice.settled) {
    if (remembered === null) return null;
    // The remembered text sizes the row exactly as the skeleton's did.
    const reserve = { '--boot-chat-notice': remembered } as CSSProperties;
    return (
      <div aria-hidden className={cn(ROW_CLASS, 'invisible', className)}>
        <span className="size-3.5 shrink-0" />
        <p
          className={cn(
            'text-xs after:content-(--boot-chat-notice)',
            LINE_CLASS,
            ONE_LINE_CLASS,
          )}
          style={reserve}
        />
      </div>
    );
  }

  if (shown === null) return null;

  return (
    <div
      role="note"
      aria-label={t('footer.ariaLabel', 'Confidentiality notice')}
      className={cn(ROW_CLASS, 'text-muted-foreground', className)}
    >
      <ShieldAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <Text
        ref={lineRef}
        id={lineId}
        variant="caption"
        className={cn(LINE_CLASS, !expanded && ONE_LINE_CLASS)}
      >
        {shown}
      </Text>
      {(cut || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={lineId}
          aria-label={expanded ? t('footer.collapse') : t('footer.expand')}
          onClick={() => setExpanded((open) => !open)}
          // The padding widens the target; the margin keeps the row one line.
          className="hover:text-foreground hover:bg-accent -m-1.5 flex shrink-0 items-center justify-center rounded-full p-1.5 transition-colors"
        >
          {expanded ? (
            <ChevronUp aria-hidden className="size-3.5" />
          ) : (
            <ChevronDown aria-hidden className="size-3.5" />
          )}
        </button>
      )}
    </div>
  );
}
