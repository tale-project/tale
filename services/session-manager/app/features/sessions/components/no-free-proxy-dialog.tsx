import { useRef } from 'react';

import { ImportProxiesDialog } from '@/app/features/proxies/components/import-proxies-dialog';
import { useT } from '@/lib/i18n/client';

import type { ProxyAction } from '../lib/proxy-flows';

interface NoFreeProxyDialogProps {
  /** What the person was doing: the dialog says what happens next. */
  action: ProxyAction;
  /** Whether proxies were added; closing the dialog any other way is "no". */
  onAnswer: (added: boolean) => void;
  /**
   * Where the keyboard goes back to when the dialog is given up and the control
   * that began the action is gone (the dialog that added the session has made
   * room for this one).
   */
  returnFocusTo?: HTMLElement | null | undefined;
}

/**
 * Adding, starting or rotating needs a proxy no other session has, and there
 * is none. The dialog is the form that imports proxies, so they can be added
 * right here; once one is, it closes and the action goes on by itself.
 */
export function NoFreeProxyDialog({
  action,
  onAnswer,
  returnFocusTo,
}: NoFreeProxyDialogProps) {
  const { t } = useT('sessions');
  const added = useRef(false);
  const returnTo = useRef(returnFocusTo ?? null);
  const intro = {
    start: t('noProxy.intro.start'),
    rotate: t('noProxy.intro.rotate'),
    create: t('noProxy.intro.create'),
  }[action];

  return (
    <ImportProxiesDialog
      open
      restoreFocusRef={returnTo}
      purpose={{
        title: t('noProxy.title'),
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
