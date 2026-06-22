'use client';

import { useCallback, useEffect, useRef } from 'react';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

/**
 * Connect an OAuth2 integration from inside the install wizard without leaving
 * it. The settings page redirects the whole tab to the provider; an inline
 * multi-step dialog can't — so we open the provider auth URL in a popup instead.
 * The OAuth callback persists the credential server-side and the dialog's
 * reactive credential query flips it active (detected by `ConnectIntegrationPanel`),
 * so this hook only owns the popup window itself — opening it (popup-blocker
 * safe), and closing it when the step advances or the component unmounts.
 */
export function useOAuth2PopupConnect(): {
  authorize: (prepareUrl: () => Promise<string | null>) => Promise<void>;
  close: () => void;
} {
  const { t } = useT('apps');
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    clearPoll();
    const popup = popupRef.current;
    if (popup && !popup.closed) popup.close();
    popupRef.current = null;
  }, [clearPoll]);

  // Tear down a lingering popup + timer if the wizard closes mid-authorization.
  useEffect(() => close, [close]);

  const authorize = useCallback(
    async (prepareUrl: () => Promise<string | null>) => {
      // Open a blank popup synchronously inside the click handler so the browser
      // doesn't block it while we await the (async) authorization URL.
      const popup = window.open(
        '',
        'tale-oauth2',
        'popup,width=600,height=720',
      );
      if (!popup) {
        toast({
          title: t('installWizard.oauthPopupBlocked'),
          variant: 'destructive',
        });
        return;
      }
      popupRef.current = popup;

      try {
        const url = await prepareUrl();
        if (!url) {
          close();
          return;
        }
        if (!popup.closed) popup.location.href = url;
      } catch (err) {
        console.error('Failed to start OAuth2 authorization:', err);
        toast({
          title: t('installWizard.oauthPopupBlocked'),
          variant: 'destructive',
        });
        close();
        return;
      }

      // Stop the poll once the user closes the popup; success itself is detected
      // by the reactive credential, not here.
      clearPoll();
      pollRef.current = setInterval(() => {
        if (popupRef.current?.closed) clearPoll();
      }, 800);
    },
    [t, close, clearPoll],
  );

  return { authorize, close };
}
