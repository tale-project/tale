import { Button } from '@tale/ui/button';
import { Dialog } from '@tale/ui/dialog/dialog';
import { Text } from '@tale/ui/text';
import { Shuffle } from 'lucide-react';
import { useRef } from 'react';

import { useQuoted } from '@/app/hooks/use-quoted';
import { useT } from '@/lib/i18n/client';

import { useFocusAfterOpening } from '../hooks/use-focus-after-opening';
import type { SharedIpChoice } from '../lib/proxy-flows';
import type { SharedIpConflict } from '../lib/shared-ip';

interface SharedIpDialogProps {
  /** The session that was refused its start. */
  sessionName: string;
  conflict: SharedIpConflict;
  /** What the person decided; closing the dialog any way is "cancel". */
  onAnswer: (choice: SharedIpChoice) => void;
}

/**
 * Two proxies can lead to one exit IP. Starting a session on an IP another
 * running session uses lets websites tell the two belong together, so the
 * person decides: leave it, start it anyway, or give it another proxy first
 * (which starts it afterwards), which is the way advised.
 */
export function SharedIpDialog({
  sessionName,
  conflict,
  onAnswer,
}: SharedIpDialogProps) {
  const { t } = useT('sessions');
  const { t: tCommon } = useT('common');
  const { t: tErrors } = useT('errors');
  const { quoted, quotedList } = useQuoted();
  const rotateButton = useRef<HTMLButtonElement>(null);
  useFocusAfterOpening(rotateButton);
  const known = conflict.exitIp !== null && conflict.names.length > 0;

  return (
    <Dialog
      open
      // Three choices, which in German or French need more than `md` gives
      // them on one row; the room is the dialog's, not shorter words. A
      // language that needs still more wraps them rather than leave the dialog.
      size="lg"
      footerClassName="sm:flex-wrap"
      onOpenChange={(open) => {
        if (!open) onAnswer('cancel');
      }}
      title={t('sharedIp.title')}
      description={
        known
          ? t('sharedIp.running', {
              count: conflict.names.length,
              names: quotedList(conflict.names),
              ip: conflict.exitIp,
            })
          : tErrors('ip_in_use')
      }
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onAnswer('cancel')}
          >
            {tCommon('actions.cancel')}
          </Button>
          <Button
            type="button"
            variant="warning"
            onClick={() => onAnswer('force')}
          >
            {t('sharedIp.confirm')}
          </Button>
          <Button
            ref={rotateButton}
            type="button"
            icon={Shuffle}
            onClick={() => onAnswer('rotate')}
          >
            {t('sharedIp.rotate')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <Text variant="muted">
          {t('sharedIp.consequence', { name: quoted(sessionName) })}
        </Text>
        <Text variant="muted">
          {t('sharedIp.hint', { name: quoted(sessionName) })}
        </Text>
      </div>
    </Dialog>
  );
}
