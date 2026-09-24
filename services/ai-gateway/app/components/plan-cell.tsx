import { Badge } from '@tale/ui/badge';

import type { AccountView } from '@/app/lib/api';
import { planName } from '@/app/lib/plan-name';
import { useT } from '@/lib/i18n/client';

/**
 * The plan an account runs on: one chip, in the vendor's own words.
 *
 * `outline` rather than a colour variant: it is the only Badge surface built
 * from theme tokens, so the chip follows the page into dark mode (`slate` and
 * its siblings are fixed light tints — see the shared Badge). A plan nobody
 * has read yet — a row whose profile call has not answered — is a dash, with
 * the words behind it for a screen reader, the way the platform's lists mark
 * an empty cell.
 */
export function PlanCell({
  provider,
  subscription,
}: Pick<AccountView, 'provider' | 'subscription'>) {
  const { t } = useT('accounts');

  if (!subscription) {
    return (
      <span className="text-muted-foreground text-xs">
        <span aria-hidden>—</span>
        <span className="sr-only">{t('planUnknown')}</span>
      </span>
    );
  }

  return <Badge variant="outline">{planName(provider, subscription, t)}</Badge>;
}
