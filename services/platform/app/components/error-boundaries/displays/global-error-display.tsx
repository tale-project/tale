'use client';

import * as Sentry from '@sentry/tanstackstart-react';
import { Button } from '@tale/ui/button';
import { useRouter } from '@tanstack/react-router';
import { AlertTriangle, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface GlobalErrorDisplayProps {
  error: Error;
  reset?: () => void;
}

// Hardcoded English copy used only when `useT` / the i18n bundle isn't
// available. The error boundary is also rendered very early in the tree
// (above the i18n provider in some misconfigurations), so we still need a
// resilient default — the message file's `common.errors.*` keys win when
// they load.
const FALLBACK_TEXT = {
  somethingWentWrong: 'Something went wrong',
  errorLoadingPage:
    'An error occurred while loading this page. You can try again or navigate to another section.',
  tryAgain: 'Try again',
  persistsProblem: 'If this problem persists, please',
  contactSupport: 'contact support',
  showDetails: 'Show details',
  hideDetails: 'Hide details',
};

function useFallbackTranslator() {
  // `useT` throws if the i18n provider isn't mounted (the error boundary
  // can render above it). Catch and degrade to the hardcoded copy so the
  // page still has something to show.
  try {
    const { t } = useT('common');
    return (key: keyof typeof FALLBACK_TEXT): string => {
      switch (key) {
        case 'somethingWentWrong':
          return t('errors.somethingWentWrong');
        case 'errorLoadingPage':
          return t('errors.errorLoadingPage');
        case 'tryAgain':
          return t('errors.tryAgain');
        case 'persistsProblem':
          return t('errors.persistsProblem');
        case 'contactSupport':
          return t('errors.contactSupport');
        // No translation key for the show/hide toggle yet — fall through.
        default:
          return FALLBACK_TEXT[key];
      }
    };
  } catch {
    return (key: keyof typeof FALLBACK_TEXT) => FALLBACK_TEXT[key];
  }
}

export function GlobalErrorDisplay({ error, reset }: GlobalErrorDisplayProps) {
  const router = useRouter();
  const [showError, setShowError] = useState(false);
  const t = useFallbackTranslator();

  useEffect(() => {
    Sentry.captureException(error, {
      tags: { errorBoundary: 'global' },
    });
  }, [error]);

  const handleReset = () => {
    if (reset) {
      reset();
    } else {
      void router.invalidate();
    }
  };

  const errorMessage = error.message || String(error);
  const errorStack = error.stack;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        'flex min-h-[80vh] flex-1 flex-col items-center justify-center px-6',
        'pt-(--safe-top) pr-(--safe-right) pb-(--safe-bottom) pl-(--safe-left)',
      )}
    >
      <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
        {/* The visual: muted icon in a soft circle — calmer than the offline
            overlay's pulsing rings because this isn't a "we're trying"
            state, it's a definitive failure. Static signals static. */}
        <div
          aria-hidden="true"
          className="bg-muted text-muted-foreground mb-6 flex size-16 items-center justify-center rounded-full"
        >
          <AlertTriangle className="size-7" />
        </div>
        <h1 className="text-foreground text-2xl leading-tight font-semibold tracking-tight">
          {t('somethingWentWrong')}
        </h1>
        <p className="text-muted-foreground mt-3 text-base leading-relaxed">
          {t('errorLoadingPage')}
        </p>
        <div className="mt-8 flex flex-col items-center gap-3">
          <Button
            type="button"
            variant="primary"
            icon={RotateCcw}
            className="min-h-11 px-5"
            onClick={handleReset}
          >
            {t('tryAgain')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={showError ? ChevronUp : ChevronDown}
            iconClassName="size-3.5"
            onClick={() => setShowError((v) => !v)}
            aria-expanded={showError}
          >
            {showError ? t('hideDetails') : t('showDetails')}
          </Button>
        </div>
        {showError && (
          <div
            // Theme-tokened error surface — matches the destructive palette
            // without resorting to hardcoded reds, so the panel stays in
            // sync with light/dark + future palette changes.
            className="border-destructive/30 bg-destructive/5 mt-4 max-h-64 w-full overflow-auto rounded-lg border p-3 text-left"
          >
            <pre className="text-destructive font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">
              <code>{errorStack || errorMessage}</code>
            </pre>
          </div>
        )}
        <p className="text-muted-foreground mt-6 text-xs">
          {t('persistsProblem')}{' '}
          <a
            href="https://tale.dev/contact"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline underline-offset-2 hover:no-underline"
          >
            {t('contactSupport')}
          </a>
          .
        </p>
      </div>
    </div>
  );
}
