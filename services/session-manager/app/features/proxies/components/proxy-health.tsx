import { Badge } from '@tale/ui/badge';
import { cn } from '@tale/ui/cn';
import { ReadMore } from '@tale/ui/read-more';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useNow } from '@tale/ui/use-now';
import { CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react';
import type { ComponentType } from 'react';

import { SPIN_CLASS } from '@/app/lib/pending-icon';
import type { CheckStatus, ProxyCheckResult } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useHealthLabel } from '../hooks/use-health-label';

/** The badge's icon while a check runs: still under reduced motion. */
function CheckingIcon({ className }: { className?: string }) {
  return <Loader2 className={cn(className, SPIN_CLASS)} />;
}

/** A shape and a colour for each state, besides its words: never colour alone. */
const BADGES: Record<
  CheckStatus,
  {
    variant: 'green' | 'destructive' | 'blue' | 'slate';
    icon: ComponentType<{ className?: string }>;
  }
> = {
  ok: { variant: 'green', icon: CheckCircle2 },
  failed: { variant: 'destructive', icon: XCircle },
  checking: { variant: 'blue', icon: CheckingIcon },
  unchecked: { variant: 'slate', icon: CircleDashed },
};

/** How often "5 minutes ago" is read again: it is only true for a while. */
const CLOCK_MS = 30_000;

/**
 * When the last check ended, under the badge, in words: how long ago. The
 * exact date and time are in the tooltip, which adds precision to the words
 * and is not the only place the fact is.
 */
function CheckedAt({ checkedAt }: { checkedAt: string }) {
  const { t } = useT('proxies');
  const { formatDate, formatRelative } = useFormatDate();
  // The page's clock, read again as time goes by, so that the words follow it.
  const now = useNow(CLOCK_MS);
  const checked = Date.parse(checkedAt);
  if (Number.isNaN(checked)) return null;
  // A clock that runs behind the server's must not say "in a few seconds".
  const ago = new Date(Math.min(checked, now));
  return (
    <Text as="span" variant="caption">
      <time
        dateTime={checkedAt}
        title={t('health.checkedAt', { date: formatDate(checkedAt, 'long') })}
      >
        {t('health.checked', { when: formatRelative(ago) })}
      </time>
    </Text>
  );
}

/**
 * Whether the proxy works, in words and a shape as well as a colour, and when
 * that was found out. Why it does not work is written under the badge, three
 * lines of it and a Read more for the rest: a provider's message is long, and
 * it is the one thing that says what to fix, so it is text of the page and
 * never a tooltip's. While a new check runs the time is still the last
 * check's, as the address and the ping are.
 */
export function ProxyHealth({ check }: { check: ProxyCheckResult }) {
  const { t } = useT('proxies');
  const healthLabel = useHealthLabel();
  const badge = BADGES[check.status];
  const reason = check.error ?? t('health.failedFallback');
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <Badge variant={badge.variant} icon={badge.icon}>
        {healthLabel(check.status)}
      </Badge>
      {check.status === 'failed' && (
        <ReadMore lines={3} className="max-w-full">
          <Text as="span" variant="caption" className="break-words">
            {reason}
          </Text>
        </ReadMore>
      )}
      {check.checkedAt !== null && <CheckedAt checkedAt={check.checkedAt} />}
    </div>
  );
}
