'use client';

import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/**
 * A conversation list whose read failed once its retries gave up. It takes
 * the place of the list's empty state, which would tell the reader there is
 * no customer work when the server simply did not answer; **Try again**
 * re-issues the request, and the search and facets stay as they were. The
 * Home panel's Inbox view and the phone list both show this one.
 */
export function ConversationListLoadError({
  onRetry,
  className,
}: {
  onRetry: () => void;
  className?: string;
}) {
  const { t } = useT('conversations');
  const { t: tCommon } = useT('common');
  return (
    <div
      className={cn(
        'animate-in fade-in-0 flex flex-col items-center gap-1 px-6 py-10 text-center duration-300',
        className,
      )}
    >
      <AlertTriangle aria-hidden className="text-destructive mb-1 size-7" />
      <div role="alert" className="flex flex-col gap-1">
        <p className="text-foreground text-sm font-medium">
          {t('list.loadFailed')}
        </p>
        <p className="text-muted-foreground text-xs">
          {t('list.loadFailedDescription')}
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        icon={RefreshCw}
        iconClassName="size-3.5"
        className="mt-3"
        onClick={onRetry}
      >
        {tCommon('actions.tryAgain')}
      </Button>
    </div>
  );
}
