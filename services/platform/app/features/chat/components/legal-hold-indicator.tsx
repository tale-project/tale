'use client';

import { Lock } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useLegalHoldByTarget } from '@/app/features/settings/governance/hooks/queries';
import { useT } from '@/lib/i18n/client';

interface LegalHoldIndicatorProps {
  organizationId: string;
  targetType: 'thread' | 'document';
  targetId: string;
}

/**
 * Visible explanation for the lock icon shown on entities under a
 * legal hold. The icon alone is opaque to most users — without a
 * hover affordance, "why can't I delete this?" has no answer short
 * of clicking through to the governance page.
 *
 * Hover content is admin-aware via `getLegalHoldByTarget`: members
 * see only the protection statement; admins additionally see the
 * reason / matter / placer / placement time so the hold is
 * actionable from the surface where it bites.
 */
export function LegalHoldIndicator({
  organizationId,
  targetType,
  targetId,
}: LegalHoldIndicatorProps) {
  const { t } = useT('chat');
  const { data: hold } = useLegalHoldByTarget({
    organizationId,
    targetType,
    targetId,
  });

  const heading = t('history.legalHold.heading');
  const body = t('history.legalHold.body');

  const placedAt = hold?.placedAt
    ? new Date(hold.placedAt).toLocaleDateString()
    : undefined;

  const adminDetails =
    hold?.view === 'admin'
      ? [
          hold.reason && {
            label: t('history.legalHold.reasonLabel'),
            value: hold.reason,
          },
          hold.matterName && {
            label: t('history.legalHold.matterLabel'),
            value: hold.matterName,
          },
          hold.placedByName && {
            label: t('history.legalHold.placedByLabel'),
            value: hold.placedByName,
          },
          placedAt && {
            label: t('history.legalHold.placedAtLabel'),
            value: placedAt,
          },
        ].filter((entry): entry is { label: string; value: string } =>
          Boolean(entry),
        )
      : null;

  return (
    <Tooltip
      side="right"
      contentClassName="max-w-xs"
      content={
        <div className="flex flex-col gap-1 p-1 text-left">
          <div className="text-xs font-medium">{heading}</div>
          <div className="text-[11px] opacity-90">{body}</div>
          {adminDetails && adminDetails.length > 0 && (
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] opacity-90">
              {adminDetails.map((entry) => (
                <div key={entry.label} className="contents">
                  <dt className="opacity-70">{entry.label}</dt>
                  <dd className="break-words">{entry.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      }
    >
      <button
        type="button"
        aria-label={heading}
        onClick={(e) => e.stopPropagation()}
        className="pointer-events-auto inline-flex shrink-0 cursor-help items-center bg-transparent p-0"
      >
        <Lock className="size-3.5 text-orange-600" aria-hidden />
      </button>
    </Tooltip>
  );
}
