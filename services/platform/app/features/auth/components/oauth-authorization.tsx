import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useEffect, useRef, useState } from 'react';

import { LogoLink } from '@/app/components/ui/logo/logo-link';
import type { TwoFactorStatus } from '@/app/context/account-bootstrap-context';
import { backendFetch } from '@/app/lib/backend/api-client';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';

import { AuthFormLayout } from './auth-form-layout';

/** The query is signed and expires in the provider; the browser never interprets its authority. */
export function OAuthAuthorization({ consent }: { consent: boolean }) {
  const { t } = useT('auth');
  const [clientName, setClientName] = useState<string>();
  const [email, setEmail] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const mounted = useRef(true);

  async function continueRequest(accept?: boolean) {
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
  }

  useEffect(() => {
    mounted.current = true;
    if (started.current)
      return () => {
        mounted.current = false;
      };
    started.current = true;
    void (async () => {
      try {
        const session = await authClient.getSession();
        if (!mounted.current) return;
        if (session.error) throw new Error('Session unavailable');
        if (!session.data?.user) {
          const base = window.__ENV__?.BASE_PATH ?? '';
          const login = new URL(`${base}/log-in`, window.location.origin);
          login.searchParams.set(
            'redirectTo',
            window.location.pathname + window.location.search,
          );
          window.location.replace(login.toString());
          return;
        }
        const factor =
          await backendFetch<TwoFactorStatus>('/two-factor/status');
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
    })();
    return () => {
      mounted.current = false;
    };
  }, [consent]);

  return (
    <div className="bg-background text-foreground min-h-dvh px-4 py-8">
      <div className="mb-16">
        <LogoLink href="/" />
      </div>
      <main id="main-content" tabIndex={-1} className="outline-none">
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
                <Button
                  disabled={!clientName || busy}
                  onClick={() => void continueRequest(true)}
                  fullWidth
                >
                  {busy ? t('oauth.continuing') : t('oauth.allow')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={!clientName || busy}
                  onClick={() => void continueRequest(false)}
                  fullWidth
                >
                  {t('oauth.cancel')}
                </Button>
              </>
            ) : failed ? (
              <Button
                disabled={busy}
                onClick={() => void continueRequest()}
                fullWidth
              >
                {t('oauth.retry')}
              </Button>
            ) : (
              <Text role="status">{t('oauth.continuing')}</Text>
            )}
          </Stack>
        </AuthFormLayout>
      </main>
    </div>
  );
}
