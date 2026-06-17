'use client';

import { Share } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/**
 * Footer banner shown in a read-only (shared) chat view in place of the
 * composer. Static — no props.
 */
export function ReadOnlyBanner() {
  const { t } = useT('chat');
  return (
    <div className="border-border bg-muted/50 flex items-center justify-center gap-2 border-t px-3 py-3">
      <Share className="text-muted-foreground size-4" />
      <span className="text-muted-foreground text-sm">
        {t('share.readOnlyBanner')}
      </span>
    </div>
  );
}
