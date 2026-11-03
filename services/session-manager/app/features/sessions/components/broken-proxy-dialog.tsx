import { Button } from '@tale/ui/button';
import { Dialog } from '@tale/ui/dialog/dialog';
import { Text } from '@tale/ui/text';
import { Shuffle } from 'lucide-react';
import { useRef } from 'react';

import { useQuoted } from '@/app/hooks/use-quoted';
import type { ApiError } from '@/app/lib/api/client';
import { causeOf } from '@/app/lib/api/failure';
import { useT } from '@/lib/i18n/client';

import { useFocusAfterOpening } from '../hooks/use-focus-after-opening';
import type { BrokenProxyChoice } from '../lib/proxy-flows';

interface BrokenProxyDialogProps {
  /** The session that was refused its start. */
  sessionName: string;
  /** The refusal: the dialog says what the last check of the proxy said. */
  error: ApiError;
  /** What the person decided; closing the dialog any way is "cancel". */
  onAnswer: (choice: BrokenProxyChoice) => void;
}

/**
 * The proxy of a session failed its check right before the start, so the
 * session did not start. The way on is another proxy: the person is asked
 * whether to give it one, and the session is started with it. The title says
 * which proxy does not work, the description only why (what the check said),
 * and the hint what the button does: nothing of it is said twice.
 */
export function BrokenProxyDialog({
  sessionName,
  error,
  onAnswer,
}: BrokenProxyDialogProps) {
  const { t } = useT('sessions');
  const { t: tCommon } = useT('common');
  const { quoted } = useQuoted();
  const rotateButton = useRef<HTMLButtonElement>(null);
  useFocusAfterOpening(rotateButton);
  const reason = causeOf(error.extra.reason);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onAnswer('cancel');
      }}
      title={t('brokenProxy.title', { name: quoted(sessionName) })}
      description={
        reason === null ? undefined : t('brokenProxy.reason', { reason })
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
            ref={rotateButton}
            type="button"
            icon={Shuffle}
            onClick={() => onAnswer('rotate')}
          >
            {t('brokenProxy.rotate')}
          </Button>
        </>
      }
    >
      <Text variant="muted">
        {t('brokenProxy.hint', { name: quoted(sessionName) })}
      </Text>
    </Dialog>
  );
}
