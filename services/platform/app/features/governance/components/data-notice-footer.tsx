'use client';

import { ShieldAlert } from 'lucide-react';

import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useDataClassificationNotice } from '../hooks/use-data-classification-notice';

interface DataNoticeFooterProps {
  organizationId: string | undefined;
  /** Where the footer is rendered. Logged in audit + used for analytics. */
  context: 'chat' | 'upload' | 'prompt' | 'webhook';
  className?: string;
}

/**
 * Phase 12 — confidentiality footer rendered at risk surfaces (chat
 * composer, upload dialog, prompt save dialog, webhook config). Reads
 * the org's `data_classification_notice` policy via
 * `useDataClassificationNotice` and falls back to the platform-default
 * i18n string when the org hasn't customized.
 *
 * Visual: muted icon + small text. Mobile (≤640px) falls back to an
 * info-icon-only display via the responsive `sm:` breakpoint to avoid
 * competing with the send button.
 */
export function DataNoticeFooter({
  organizationId,
  context: _context,
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
        'flex items-start gap-1.5 px-3 py-1.5',
        'text-muted-foreground',
        className,
      )}
    >
      <ShieldAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <Text className="text-xs leading-tight">{notice.message}</Text>
    </div>
  );
}
