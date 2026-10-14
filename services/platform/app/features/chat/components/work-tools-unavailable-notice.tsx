'use client';

import { CircleAlert } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

/** Why the reply ran without the file tools its organization allows, when
 * it did: the stamp the turn left on the reply's usage. */
export function workToolsUnavailable(
  usage: unknown,
): 'policy_unreadable' | 'setup_failed' | undefined {
  if (!isRecord(usage)) return undefined;
  const reason = usage.workToolsUnavailable;
  return reason === 'policy_unreadable' || reason === 'setup_failed'
    ? reason
    : undefined;
}

/**
 * A reply that could not make files says why under it — the tools could not
 * be set up, or the Chat tools policy cannot be read — so a missing file is
 * never left unexplained, and a reply that answered "I cannot make files"
 * is not taken for the organization's choice. Body text in the muted
 * foreground: the icon carries the colour.
 */
export function WorkToolsUnavailableNotice({
  reason,
}: {
  reason: 'policy_unreadable' | 'setup_failed';
}) {
  const { t } = useT('chat');
  return (
    <div className="text-muted-foreground flex items-start gap-1.5 py-1 text-xs">
      <CircleAlert
        className="text-destructive mt-px size-3.5 shrink-0"
        aria-hidden="true"
      />
      <span>
        {reason === 'policy_unreadable'
          ? t('workToolsUnavailable.policyUnreadable')
          : t('workToolsUnavailable.setupFailed')}
      </span>
    </div>
  );
}
