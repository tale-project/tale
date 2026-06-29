'use client';

import { useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useCallback } from 'react';

import { useT } from '@/lib/i18n/client';

/**
 * Back affordance for the full-page "What's new" changelog view. That page is
 * reached from the post-upgrade toast (and can be deep-linked), so without this
 * the user is stranded with no way out.
 *
 * Navigation is history-based on purpose: it returns the user to wherever they
 * came from. When there's no entry to pop (deep link / fresh tab) we fall back
 * to the dashboard home so the button always leads somewhere.
 */
export function ChangelogBackButton() {
  const { t } = useT('changelog');
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();

  const handleBack = useCallback(() => {
    if (canGoBack) {
      router.history.back();
    } else {
      void navigate({ to: '/dashboard' });
    }
  }, [canGoBack, router, navigate]);

  return (
    <button
      type="button"
      onClick={handleBack}
      className="text-fg-muted hover:text-fg-base mb-6 inline-flex w-fit items-center gap-1 text-sm"
    >
      <ArrowLeft className="size-4" />
      {t('viewer.back')}
    </button>
  );
}
