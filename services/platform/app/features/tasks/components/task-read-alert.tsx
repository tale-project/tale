'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { Loader2, RefreshCw } from 'lucide-react';
import { useLayoutEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';

/**
 * One board read that failed once its retries gave up (#3747): what did not
 * load, and **Try again**, which re-issues that read alone. It stays on
 * screen while the retry runs — the button busy, the message saying so — and
 * leaves only when an answer replaces it. A retry that works takes the
 * button with it, so the focus it held goes to `onFocusLost` (the board)
 * instead of dropping to the page.
 */
export function TaskReadAlert({
  message,
  variant = 'destructive',
  retrying,
  onRetry,
  onFocusLost,
}: {
  message: string;
  /** `destructive` when the tasks themselves failed; `warning` when the
   * board stands and only its markers are missing. */
  variant?: 'destructive' | 'warning';
  retrying: boolean;
  onRetry: () => void;
  /** Takes the focus this alert held when it goes. Keep it stable: the
   * alert reads it only as it unmounts. */
  onFocusLost: () => void;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const [root, setRoot] = useState<HTMLDivElement | null>(null);

  // The cleanup runs before React detaches the alert, while the focus is
  // still inside it; the board mounts in the same commit, so it takes the
  // focus a frame later.
  useLayoutEffect(() => {
    if (root === null) return undefined;
    return () => {
      if (root.contains(document.activeElement)) {
        requestAnimationFrame(onFocusLost);
      }
    };
  }, [root, onFocusLost]);

  return (
    <div ref={setRoot}>
      <Alert
        variant={variant}
        description={retrying ? t('read.retrying') : message}
      >
        {/* Busy without going disabled: a disabled button drops the focus
            that pressed it, and one given a reason is re-created inside a
            tooltip. This one stays the same focusable element, marked busy,
            until the answer arrives. */}
        <Button
          variant="secondary"
          size="sm"
          icon={retrying ? Loader2 : RefreshCw}
          iconClassName={cn(
            retrying && 'animate-spin motion-reduce:animate-none',
          )}
          className="mt-3"
          aria-busy={retrying || undefined}
          aria-disabled={retrying || undefined}
          onClick={() => {
            if (!retrying) onRetry();
          }}
        >
          {tCommon('actions.tryAgain')}
        </Button>
      </Alert>
    </div>
  );
}
