'use client';

import { Badge } from '@tale/ui/badge';
import { Lock } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

interface LegalHoldBadgeProps {
  /**
   * Result of `useLegalHoldByTarget`. The query is a tagged-union: admin
   * callers see the full row, member callers see a stripped projection.
   * The badge only consumes fields available to both.
   */
  hold:
    | {
        placedAt: number;
        hasPendingRelease: boolean;
        hasApprovedRelease: boolean;
        view?: 'admin' | 'member';
      }
    | null
    | undefined;
}

export function LegalHoldBadge({ hold }: LegalHoldBadgeProps) {
  const { t } = useT('legalHold');
  if (!hold) return null;

  if (hold.hasApprovedRelease) {
    return (
      <Badge variant="green" icon={Lock} aria-live="polite">
        {t('releaseApproved')}
      </Badge>
    );
  }
  if (hold.hasPendingRelease) {
    return (
      <Badge variant="yellow" icon={Lock} aria-live="polite">
        {t('releasePending')}
      </Badge>
    );
  }
  return (
    <Badge variant="orange" icon={Lock}>
      {t('held')}
    </Badge>
  );
}
