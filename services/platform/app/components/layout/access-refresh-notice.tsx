import { Button } from '@tale/ui/button';
import { useFocusHandoff } from '@tale/ui/use-focus-handoff';
import { Loader2 } from 'lucide-react';
import type { Key } from 'react';

import { ShellAlert } from '@/app/components/layout/shell-alert';
import { useT } from '@/lib/i18n/client';

/**
 * The shell's word that a refresh of the caller's membership failed while
 * the last answer still stands (`routes/dashboard/$id.tsx`): every page goes
 * on with the last known role, which may be out of date, and **Try again**
 * asks again. A `ShellAlert`, like every dashboard nudge. With nothing loaded
 * at all, the dashboard shows its full-page error instead.
 *
 * The retry keeps `CatalogLoadError`'s rules: the same focusable button
 * while the request runs, busy rather than disabled; each failure
 * (`failureKey`) writes the title afresh inside the live region, so a retry
 * that fails again is announced again; and when an answer takes the notice
 * away with the focus on it, `onFocusLost` gets the focus instead of the
 * page.
 */
export function AccessRefreshNotice({
  retrying,
  onRetry,
  failureKey,
  onFocusLost,
}: {
  retrying: boolean;
  onRetry: () => void;
  failureKey?: Key;
  onFocusLost?: () => void;
}) {
  const { t } = useT('accessDenied');
  const { t: tCommon } = useT('common');
  const setRetryRow = useFocusHandoff<HTMLSpanElement>(onFocusLost);
  return (
    <ShellAlert>
      <span className="grow">
        <span key={failureKey} className="font-medium">
          {t('refreshFailed.title')}
        </span>
        {/* Read out but not drawn on a phone or a short viewport, as every
            nudge's explanation: the title and Try again say what to do. */}
        <span className="short-viewport:sr-only sr-only sm:not-sr-only">
          {' — '}
          {t('refreshFailed.body')}
        </span>
      </span>
      <span ref={setRetryRow} className="shrink-0">
        <Button
          type="button"
          variant="link"
          className="h-auto min-h-0 p-0 text-sm underline underline-offset-2"
          icon={retrying ? Loader2 : undefined}
          iconClassName="animate-spin motion-reduce:animate-none"
          aria-busy={retrying || undefined}
          aria-disabled={retrying || undefined}
          onClick={retrying ? undefined : onRetry}
        >
          {tCommon('actions.tryAgain')}
        </Button>
      </span>
    </ShellAlert>
  );
}
