'use client';

import { ShieldAlert } from 'lucide-react';

import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useDataClassificationNotice } from '../hooks/use-data-classification-notice';

interface DataNoticeFooterProps {
  organizationId: string | undefined;
  className?: string;
}

/**
 * Confidentiality footer rendered at risk surfaces (chat composer,
 * upload dialog, prompt save dialog, webhook config). Reads the org's
 * `data_classification_notice` policy via `useDataClassificationNotice`
 * and falls back to the platform-default i18n string when the org
 * hasn't customized.
 *
 * Advisory only — there is no acknowledgment gate. The B2B self-host
 * model treats the deploying org as the data controller; end-user
 * explicit consent UX (a blocking modal) is product-incongruent and
 * was removed alongside the (broken) `DataNoticeAckModal`. The
 * `requireAcknowledgment` policy field is preserved server-side for a
 * future regulated-customer rewire.
 *
 * Visual: muted icon + small text.
 */
export function DataNoticeFooter({
  organizationId,
  className,
}: DataNoticeFooterProps) {
  const { t } = useT('dataNotice');
  const notice = useDataClassificationNotice(organizationId);

  if (!notice.enabled) return null;

  return (
    <div
      role="note"
      aria-label={t('footer.ariaLabel', 'Confidentiality notice')}
      className={cn(
        'flex items-center justify-center gap-1.5 px-3 py-1.5',
        'text-muted-foreground',
        className,
      )}
    >
      <ShieldAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <Text className="text-xs leading-tight">{notice.message}</Text>
    </div>
  );
}
