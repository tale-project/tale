'use client';

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Archive } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/**
 * Footer banner shown for an archived thread in place of the composer, with
 * an inline unarchive action. Fully prop-driven — the surface owns the write
 * and flips back to the live composer when the thread row updates.
 */
export function ArchivedBanner({
  isUnarchiving,
  onUnarchive,
}: {
  isUnarchiving: boolean;
  onUnarchive: () => void;
}) {
  const { t } = useT('chat');
  return (
    <Row
      gap={2}
      justify="center"
      align="center"
      className="border-border bg-muted/50 w-full border-t px-3 py-3"
    >
      <Archive className="text-muted-foreground size-4" aria-hidden="true" />
      <span className="text-muted-foreground text-sm">
        {t('archivedBanner')}
      </span>
      <Button
        variant="secondary"
        disabled={isUnarchiving}
        onClick={onUnarchive}
      >
        {t('unarchive')}
      </Button>
    </Row>
  );
}
