import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { TwoFactorStatus } from '@/app/context/account-bootstrap-context';
import { backendFetch } from '@/app/lib/backend/api-client';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';

import { AgentConsent } from './agent-consent/agent-consent';
import { isAgentRequest } from './agent-consent/agent-consent-request';
import { AuthFormLayout } from './auth-form-layout';
import { AuthPageLayout } from './auth-page-layout';

/** The query is signed and expires in the provider; the browser never interprets its authority. */
export function OAuthAuthorization({ consent }: { consent: boolean }) {
  const { t } = useT('auth');
  const navigate = useNavigate();
  const [clientName, setClientName] = useState<string>();
  const [email, setEmail] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // A coding agent's request is answered by its own page, once the sign-in
  // and two-factor checks below have passed.
  const [agent, setAgent] = useState(false);
  const started = useRef(false);
  const mounted = useRef(true);

  const continueRequest = useCallback(async (accept?: boolean) => {
    setBusy(true);
    setFailed(false);
    try {
      const oauth_query = window.location.search.slice(1);
      const response =
        accept === undefined
          ? await authClient.oauth2.continue({ postLogin: true, oauth_query })
          : await authClient.oauth2.consent({ accept, oauth_query });
      if (!mounted.current) return;
      if (response.error || !response.data?.url)
        throw new Error('Authorization refused');
      // Better Auth's default fetch plugin already follows this response.
      // Navigating again races the callback's single-use state/code exchange.
    } catch {
      if (!mounted.current) return;
      setFailed(true);
      setBusy(false);
    }
  }, []);

  /** Reads who is signed in and, on the consent page, which application is
   * asking. It runs when the page opens, and again from the start each time
   * the person asks to try again, whichever step failed. */
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const session = await authClient.getSession();
      if (!mounted.current) return;
      if (session.error) throw new Error('Session unavailable');
      if (!session.data?.user) {
        await navigate({
          to: '/log-in',
          search: {
            redirectTo: window.location.pathname + window.location.search,
          },
          replace: true,
        });
        return;
      }
      const factor = await backendFetch<TwoFactorStatus>('/two-factor/status');
      if (!mounted.current) return;
      if (factor.authenticated && factor.decision === 'blocked') {
        const base = window.__ENV__?.BASE_PATH ?? '';
        const enroll = new URL(`${base}/2fa-enroll`, window.location.origin);
        enroll.searchParams.set(
          'redirectTo',
          window.location.pathname + window.location.search,
        );
        window.location.replace(enroll.toString());
        return;
      }
      setEmail(session.data.user.email);
      if (consent && isAgentRequest(window.location.search)) {
        setAgent(true);
        return;
      }
      if (!consent) {
        await continueRequest();
        return;
      }
      const clientId = new URLSearchParams(window.location.search).get(
        'client_id',
      );
      if (!clientId) throw new Error('Client missing');
      const client = await authClient.oauth2.publicClient({
        query: { client_id: clientId },
      });
      if (!mounted.current) return;
      if (client.error || !client.data?.client_name)
        throw new Error('Client unavailable');
      setClientName(client.data.client_name);
    } catch {
      if (mounted.current) setFailed(true);
    }
  }, [consent, navigate, continueRequest]);

  useEffect(() => {
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      void load();
    }
    return () => {
      mounted.current = false;
    };
  }, [load]);

  if (agent && email !== undefined) return <AgentConsent email={email} />;

  // The application that is asking could not be read: there is nothing to
  // allow yet, but the request can still be answered, and read again.
  const lookupFailed = consent && failed && clientName === undefined;

  return (
    <AuthPageLayout>
      <AuthFormLayout title={t('oauth.title')}>
        <Stack gap={4}>
          {clientName ? (
            <Text>{t('oauth.request', { application: clientName })}</Text>
          ) : null}
          {email ? <Text className="break-words">{email}</Text> : null}
          {consent ? (
            <Text variant="muted">{t('oauth.permissions')}</Text>
          ) : null}
          {failed ? <Text role="alert">{t('oauth.failed')}</Text> : null}
          {consent ? (
            <>
              {lookupFailed ? (
                <Button disabled={busy} onClick={() => void load()} fullWidth>
                  {t('oauth.retry')}
                </Button>
              ) : (
                <Button
                  disabled={!clientName || busy}
                  onClick={() => void continueRequest(true)}
                  fullWidth
                >
                  {busy ? t('oauth.continuing') : t('oauth.allow')}
                </Button>
              )}
              {/* A denial needs no application name: it stays available
                  whenever nothing is in flight, so the person can always
                  answer the application that is waiting. */}
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void continueRequest(false)}
                fullWidth
              >
                {t('oauth.cancel')}
              </Button>
            </>
          ) : failed ? (
            <Button disabled={busy} onClick={() => void load()} fullWidth>
              {t('oauth.retry')}
            </Button>
          ) : (
            <Text role="status">{t('oauth.continuing')}</Text>
          )}
        </Stack>
      </AuthFormLayout>
    </AuthPageLayout>
  );
}
