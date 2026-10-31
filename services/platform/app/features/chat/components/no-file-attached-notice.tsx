'use client';

import { CircleAlert } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

/** Whether the reply speaks of a file it does not carry: the stamp the turn
 * left on the reply's usage when a file tool stored nothing or the text
 * claims an attachment, and no file rides the reply. */
export function fileNotAttached(usage: unknown): boolean {
  return isRecord(usage) && usage.fileNotAttached === true;
}

/**
 * A reply that says it attached a file, or set out to make one, without
 * carrying any says so under it, where the file would be — so the reply's
 * own words are never the last word on a file that does not exist. Body
 * text in the muted foreground: the icon carries the colour.
 */
export function NoFileAttachedNotice() {
  const { t } = useT('chat');
  return (
    <div className="text-muted-foreground flex items-start gap-1.5 py-1 text-xs">
      <CircleAlert
        className="text-destructive mt-px size-3.5 shrink-0"
        aria-hidden="true"
      />
      <span>{t('noFileAttached')}</span>
    </div>
  );
}
