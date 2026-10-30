'use client';

import * as ToastPrimitives from '@radix-ui/react-toast';
import { useEffect, useRef } from 'react';

import { toastActionGroupClassName } from '../components/feedback/toast';
import { Button } from '../components/primitives/button';
import { toast } from '../hooks/use-toast';
import { useT } from './client';
import { useLocale } from './locale-provider';
import { baseLocaleOf } from './locales';

/**
 * Says so, in the language the page shows, when the language picked in
 * client mode (`useLocale()`) did not load, and offers to try again; it stays
 * until it is closed or a switch runs again. Renders nothing: mount it once
 * inside `<AppShell locale={{ mode: 'client' }}>`, beside the service's other
 * toasts, as the platform does (`services/platform/app/main.tsx`).
 */
export function LocaleLoadNotice(): null {
  const { locale, setLocale, status } = useLocale();
  const { t } = useT('languageSwitcher');
  const { t: tCommon } = useT('common');
  // The words at the moment the switch fails, without raising the notice
  // again when they change (a topic that lands hands out a new `t`).
  const words = useRef({ t, tCommon });
  words.current = { t, tCommon };
  useEffect(() => {
    if (status !== 'failed') return undefined;
    const said = words.current;
    const tryAgain = said.tCommon('actions.tryAgain');
    const notice = toast({
      variant: 'destructive',
      // An error toast stays until it is dismissed (design/docs/app.md); the
      // toaster has no close control, so it carries its own.
      duration: Infinity,
      title: said.t('loadFailed', {
        language: said.t(`locales.${baseLocaleOf(locale)}`),
      }),
      description: said.t('loadFailedHint'),
      action: (
        <div className={toastActionGroupClassName}>
          <ToastPrimitives.Close asChild>
            <Button type="button" variant="secondary" size="sm">
              {said.tCommon('aria.close')}
            </Button>
          </ToastPrimitives.Close>
          <ToastPrimitives.Action
            altText={tryAgain}
            asChild
            // Picking the language again fetches what did not load.
            onClick={() => setLocale(locale)}
          >
            <Button type="button" variant="primary" size="sm">
              {tryAgain}
            </Button>
          </ToastPrimitives.Action>
        </div>
      ),
    });
    return notice.dismiss;
  }, [locale, setLocale, status]);
  return null;
}
