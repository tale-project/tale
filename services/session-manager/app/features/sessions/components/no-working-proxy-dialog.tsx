import { useRef } from 'react';

import { ImportProxiesDialog } from '@/app/features/proxies/components/import-proxies-dialog';
import { useMeta } from '@/app/hooks/use-meta';
import { useQuoted } from '@/app/hooks/use-quoted';
import type { Session } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

interface NoWorkingProxyDialogProps {
  /** The sessions that found no proxy that works, and wait for one. */
  sessions: readonly Session[];
  /** Whether proxies were added; closing the dialog any other way is "no". */
  onAnswer: (added: boolean) => void;
}

/**
 * Sessions the server started in the background ended because every proxy it
 * tried failed its check. One dialog for all of them is the form that imports
 * proxies: once one is added, each of the sessions tries again by itself.
 */
export function NoWorkingProxyDialog({
  sessions,
  onAnswer,
}: NoWorkingProxyDialogProps) {
  const { t } = useT('sessions');
  const { quotedList } = useQuoted();
  const meta = useMeta();
  const added = useRef(false);
  // Known once the app has told; until then the sentence about them is left out.
  const failed = meta.data?.counts.failedProxies ?? 0;
  const names = quotedList(sessions.map((session) => session.name));
  const intro =
    failed > 0
      ? t('noWorking.introFailed', { failed, sessions: sessions.length, names })
      : t('noWorking.intro', { sessions: sessions.length, names });

  return (
    <ImportProxiesDialog
      open
      purpose={{
        title: t('noWorking.title'),
        intro,
        submitText: t('addProxies'),
      }}
      onAdded={() => {
        added.current = true;
      }}
      onOpenChange={(open) => {
        if (!open) onAnswer(added.current);
      }}
    />
  );
}
