'use client';

import { Badge, type BadgeProps } from '@tale/ui/badge';

import { useT } from '@/lib/i18n/client';
import type { DocumentRecordInfo } from '@/types/documents';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

const stateConfig: Record<DocumentRecordInfo['state'], BadgeVariant> = {
  draft: 'slate',
  in_review: 'blue',
  approved: 'green',
};

/**
 * Controlled-record state chip on the document row: "v3 · Approved".
 * Rendered only for documents that opted into the controlled lifecycle;
 * while a review is pending the tooltip names the reviewer it waits on.
 */
export function DocumentRecordBadge({
  record,
}: {
  record: DocumentRecordInfo | undefined;
}) {
  const { t } = useT('documents');

  if (!record) return null;

  const stateLabel = {
    draft: t('record.state.draft'),
    in_review: t('record.state.inReview'),
    approved: t('record.state.approved'),
  }[record.state];

  const waitingOn =
    record.state === 'in_review' && record.reviewerName
      ? t('record.waitingOn', { name: record.reviewerName })
      : undefined;

  return (
    <Badge
      variant={stateConfig[record.state]}
      className="shrink-0"
      title={waitingOn}
    >
      {t('record.badge', { version: record.version, state: stateLabel })}
    </Badge>
  );
}
