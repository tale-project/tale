'use client';

import * as ToastPrimitives from '@radix-ui/react-toast';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import { useChangelogNotification } from '@/app/hooks/use-changelog-notification';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

/**
 * Fires a one-shot toast when the user's last-toasted version is older
 * than the current deployment version. After the toast dispatches the
 * client records `markToasted`, so the same version never re-toasts —
 * even across sessions. The red dot on UserButton persists separately
 * (governed by `markSeen`) until the user actually views the release
 * notes.
 *
 * On a fresh install (`needsBaseline`: no notification row exists yet)
 * there is no previous version to have updated from, so nothing is
 * announced — the current version is recorded silently as the baseline
 * so the next release toasts normally.
 */
export function ChangelogToastTrigger() {
  const { t } = useT('changelog');
  const {
    shouldShowToast,
    needsBaseline,
    currentVersion,
    lastSeenVersion,
    markSeen,
    markToasted,
  } = useChangelogNotification();
  const firedRef = useRef(false);

  useEffect(() => {
    if (!currentVersion) return;
    if (firedRef.current) return;

    if (needsBaseline) {
      // Fresh install: record the current version (seen + toasted) without
      // notifying. `markSeen` writes both fields in one mutation.
      firedRef.current = true;
      markSeen();
      return;
    }

    if (!shouldShowToast) return;
    firedRef.current = true;

    toast({
      duration: 15_000,
      title: t('toast.title', { version: currentVersion }),
      description: t('toast.description'),
      action: (
        <ToastPrimitives.Action altText={t('toast.action')} asChild>
          <Link
            to="/dashboard/changelog"
            search={{ from: lastSeenVersion, to: currentVersion }}
            onClick={() => {
              markSeen();
            }}
            className="bg-foreground text-background inline-flex h-8 shrink-0 items-center rounded-md px-3 text-xs font-medium transition-colors hover:opacity-90"
          >
            {t('toast.action')}
          </Link>
        </ToastPrimitives.Action>
      ),
    });
    markToasted();
  }, [
    shouldShowToast,
    needsBaseline,
    currentVersion,
    lastSeenVersion,
    markSeen,
    markToasted,
    t,
  ]);

  return null;
}
