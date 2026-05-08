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
  const { t } = useT('governance');
  if (!hold) return null;

  if (hold.hasApprovedRelease) {
    return (
      <Badge variant="green" icon={Lock} aria-live="polite">
        {t('legalHold.badges.releaseApproved')}
      </Badge>
    );
  }
  if (hold.hasPendingRelease) {
    return (
      <Badge variant="yellow" icon={Lock} aria-live="polite">
        {t('legalHold.badges.releasePending')}
      </Badge>
    );
  }
  return (
    <Badge variant="orange" icon={Lock}>
      {t('legalHold.badges.held')}
    </Badge>
  );
}
