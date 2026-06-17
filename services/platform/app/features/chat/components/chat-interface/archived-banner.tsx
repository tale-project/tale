'use client';

import { Button } from '@tale/ui/button';
import { Archive } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

interface ArchivedBannerProps {
  isUnarchiving: boolean;
  onUnarchive: () => void;
}

/**
 * Footer banner shown for an archived thread in place of the composer, with an
 * inline unarchive action. Fully prop-driven.
 */
export function ArchivedBanner({
  isUnarchiving,
  onUnarchive,
}: ArchivedBannerProps) {
  const { t } = useT('chat');
  return (
    <div className="border-border bg-muted/50 flex items-center justify-center gap-2 border-t px-3 py-3">
      <Archive className="text-muted-foreground size-4" />
      <span className="text-muted-foreground text-sm">
        {t('archivedBanner')}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={isUnarchiving}
        onClick={onUnarchive}
      >
        {t('unarchive')}
      </Button>
    </div>
  );
}
