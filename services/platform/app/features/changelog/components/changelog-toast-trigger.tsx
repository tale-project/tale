'use client';

import * as ToastPrimitives from '@radix-ui/react-toast';
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
 */
export function ChangelogToastTrigger() {
  const { t } = useT('changelog');
  const { shouldShowToast, currentVersion, releaseUrl, markSeen, markToasted } =
    useChangelogNotification();
  const firedRef = useRef(false);

  useEffect(() => {
    if (!shouldShowToast || !currentVersion || !releaseUrl) return;
    if (firedRef.current) return;
    firedRef.current = true;

    toast({
      duration: 15_000,
      title: t('toast.title', { version: currentVersion }),
      description: t('toast.description'),
      action: (
        <ToastPrimitives.Action altText={t('toast.action')} asChild>
          <a
            href={releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              markSeen();
            }}
            className="bg-foreground text-background inline-flex h-8 shrink-0 items-center rounded-md px-3 text-xs font-medium transition-colors hover:opacity-90"
          >
            {t('toast.action')}
          </a>
        </ToastPrimitives.Action>
      ),
    });
    markToasted();
  }, [shouldShowToast, currentVersion, releaseUrl, markSeen, markToasted, t]);

  return null;
}
