'use client';

import { cn } from '@tale/ui/cn';
import { Text } from '@tale/ui/text';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';

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

const ROW_CLASS = 'flex items-center justify-center gap-1.5 px-3 py-1.5';

/**
 * Confidentiality footer under the chat composer — and under the question
 * panel while that stands in for the composer. Reads the org's
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
 */
export function DataNoticeFooter({
  organizationId,
  className,
}: DataNoticeFooterProps) {
  const { t } = useT('dataNotice');
  const notice = useDataClassificationNotice(organizationId);
  const shown = notice.enabled ? notice.message : null;
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
          className="text-xs leading-tight after:content-(--boot-chat-notice)"
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
      <Text variant="caption" className="leading-tight">
        {shown}
      </Text>
    </div>
  );
}
