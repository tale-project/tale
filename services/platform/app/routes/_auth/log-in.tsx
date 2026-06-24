import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import {
  createFileRoute,
  useNavigate,
  useSearch,
} from '@tanstack/react-router';
import { AlertCircle } from 'lucide-react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import { Form } from '@/app/components/ui/forms/form';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Label } from '@/app/components/ui/forms/label';
import { AuthFormLayout } from '@/app/features/auth/components/auth-form-layout';
import {
  useHasAnyUsers,
  useIsSsoConfigured,
} from '@/app/features/auth/hooks/queries';
import { useReactQueryClient } from '@/app/hooks/use-react-query-client';
import { toast } from '@/app/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { getEnv } from '@/lib/env';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  redirectTo: z.string().optional(),
  // Why the user landed here. `idle` is set by the session idle watchdog and
  // renders a "signed out due to inactivity" notice (#1502). `.catch` so an
  // unknown value degrades to the plain login page instead of erroring the
  // route.
  reason: z.literal('idle').optional().catch(undefined),
});

export const Route = createFileRoute('/_auth/log-in')({
  head: () => ({
    meta: seo('login'),
  }),
  validateSearch: searchSchema,
  component: LogInPage,
});

type LogInFormData = {
  email: string;
  password: string;
};

// Tale is offline-first — there is no self-service sign-up or forgot-password flow.
// Users are created by admins (Settings → Members). To enable self-service login,
// configure SSO or trusted headers (see docs/authentication.md).
// If no users exist yet, the page redirects to /sign-up for initial owner setup.
export function LogInPage() {
  const navigate = useNavigate();
  const queryClient = useReactQueryClient();
  const { redirectTo, reason } = useSearch({ from: '/_auth/log-in' });
  const { t } = useT('auth');
  const { t: tCommon } = useT('common');

  const signedOutForIdle = reason === 'idle';

  const { data: hasUsers, isLoading: isLoadingUsers } = useHasAnyUsers();
  const { data: ssoConfig } = useIsSsoConfigured();

  // When trusted headers auth is enabled, the reverse proxy has already
  // authenticated the user. Navigate to the Convex HTTP endpoint that reads
  // the proxy headers and creates a session — the user never sees the login form.
  // If the auth endpoint fails, it redirects back here with ?trusted_headers_error=1
  // to break the redirect loop and show the regular login form.
  const trustedHeadersEnabled = getEnv('TRUSTED_HEADERS_ENABLED');
  const hasTrustedHeadersError = new URLSearchParams(
    window.location.search,
  ).has('trusted_headers_error');
  const redirectToTrustedHeadersAuth = useCallback(() => {
    const siteUrl = getEnv('SITE_URL');
    const basePath = getEnv('BASE_PATH');
    const target = redirectTo || `${basePath}/dashboard`;
    window.location.href = `${siteUrl}${basePath}/api/trusted-headers/authenticate?redirect=${encodeURIComponent(target)}`;
  }, [redirectTo]);
  useEffect(() => {
    // After an idle sign-out (#1502) the auto-redirect would silently
    // re-establish the session, hiding the sign-out entirely. Hold the
    // redirect behind an explicit "Continue" click instead (rendered below)
    // so the inactivity notice is visible — the proxy/IdP still owns the
    // actual authentication.
    if (trustedHeadersEnabled && !hasTrustedHeadersError && !signedOutForIdle) {
      redirectToTrustedHeadersAuth();
    }
  }, [
    trustedHeadersEnabled,
    hasTrustedHeadersError,
    signedOutForIdle,
    redirectToTrustedHeadersAuth,
  ]);

  useEffect(() => {
    if (!trustedHeadersEnabled && hasUsers === false) {
      void navigate({ to: '/setup' });
    }
  }, [trustedHeadersEnabled, hasUsers, navigate]);

  const logInSchema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .trim()
          .min(1, tCommon('validation.required', { field: t('email') }))
          .email(tCommon('validation.email')),
        password: z
          .string()
          .min(1, tCommon('validation.required', { field: t('password') })),
      }),
    [tCommon, t],
  );

  const form = useForm<LogInFormData>({
    resolver: zodResolver(logInSchema),
    mode: 'onChange',
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const [loginError, setLoginError] = useState<string | null>(null);
  // Standing, count-free advisory shown on a failed credential attempt. We
  // deliberately never reveal attempts-remaining: a live counter would break
  // the uniform "wrong email or password" response and hand an attacker both
  // account-enumeration and a brute-force budget (#1566).
  const [showLockoutHint, setShowLockoutHint] = useState(false);

  const { isSubmitting, isValid } = form.formState;

  const formatLockoutMessage = useCallback(
    (retryAfterSec: number | undefined): string => {
      if (!retryAfterSec || retryAfterSec <= 0) {
        return t('login.accountLockedGeneric');
      }
      if (retryAfterSec < 60) {
        return t('login.accountLockedSeconds', { seconds: retryAfterSec });
      }
      const minutes = Math.ceil(retryAfterSec / 60);
      if (minutes < 60) {
        return t('login.accountLockedMinutes', { minutes });
      }
      const hours = Math.ceil(retryAfterSec / 3600);
      return t('login.accountLockedHours', { hours });
    },
    [t],
  );

  const handleAuthError = useCallback(
    (ctx?: {
      error?: { status?: number; retryAfter?: unknown } | null;
      response?: Response;
    }) => {
      const status = ctx?.error?.status;
      if (status === 429) {
        const headerVal = ctx?.response?.headers.get('retry-after');
        const headerSec = headerVal ? Number(headerVal) : NaN;
        const errVal = ctx?.error?.retryAfter;
        const errSec =
          typeof errVal === 'number'
            ? errVal
            : typeof errVal === 'string'
              ? Number(errVal)
              : NaN;
        const retryAfterSec = Number.isFinite(headerSec)
          ? headerSec
          : Number.isFinite(errSec)
            ? errSec
            : undefined;
        setLoginError(formatLockoutMessage(retryAfterSec));
        // Already locked — the lockout message stands on its own.
        setShowLockoutHint(false);
        return;
      }
      setLoginError(t('login.wrongCredentials'));
      setShowLockoutHint(true);
    },
    [formatLockoutMessage, t],
  );

  const handleSubmit = async (data: LogInFormData) => {
    setLoginError(null);
    setShowLockoutHint(false);

    try {
      // Track whether onError fired this attempt rather than reading the
      // pre-await `loginError` (a stale closure value) in the fallback below.
      let authErrorHandled = false;
      const response = await authClient.signIn.email(
        { email: data.email, password: data.password },
        {
          onError: (ctx) => {
            authErrorHandled = true;
            handleAuthError(ctx);
          },
        },
      );

      // 2FA handling (issue #1507). Better-auth returns
      // `{ twoFactorRedirect: true }` when the account has 2FA enabled
      // and the password step succeeded. We add our own
      // `enrollRequired: true` alongside it when the org policy is
      // enforced and the user is past the grace window — in that case
      // the user must enrol before continuing. Better-auth's types
      // don't model these fields, so we read them via a Record view.
      const rawData: Record<string, unknown> = response.data ?? {};
      if (rawData.twoFactorRedirect === true) {
        const target = rawData.enrollRequired === true ? '/2fa-enroll' : '/2fa';
        await queryClient
          .invalidateQueries({ queryKey: ['auth', 'session'] })
          .catch(() => undefined);
        void navigate({
          to: target,
          search: redirectTo ? { redirectTo } : undefined,
        });
        return;
      }

      if (!response.data?.user) {
        // Fallback: signIn returned without a user but onError wasn't triggered.
        if (!authErrorHandled) {
          setLoginError(t('login.wrongCredentials'));
          setShowLockoutHint(true);
        }
        return;
      }

      toast({
        title: t('login.toast.success'),
        variant: 'success',
        position: 'top-center',
      });

      await queryClient
        .invalidateQueries({ queryKey: ['auth', 'session'] })
        .catch((error) =>
          console.warn('Session cache invalidation failed:', error),
        );
      void navigate({ to: redirectTo || '/dashboard' });
    } catch (error) {
      console.error('Log in error:', error);
      toast({
        title: tCommon('errors.somethingWentWrong'),
        variant: 'destructive',
        position: 'top-center',
      });
    }
  };

  const handleSsoLogin = useCallback(async () => {
    const siteUrl = getEnv('SITE_URL');
    const basePath = getEnv('BASE_PATH');
    const base = `${siteUrl}${basePath}/http_api/api/sso`;

    // Route to the org whose connection matches the entered email. Each SSO
    // connection is scoped per organization, so on a multi-org deployment we
    // must resolve WHICH org before starting the flow — otherwise the server
    // falls back to the first enabled connection and second-org users land at
    // the wrong IdP (#2082). Discovery also tells us the protocol, which we use
    // for the SAML-vs-OIDC branch instead of the deployment-global status
    // (which likewise reports only the first connection).
    const email = form.getValues('email')?.trim();
    let organizationId: string | undefined;
    let protocol: string | undefined;
    if (email) {
      try {
        const res = await fetch(`${base}/discover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (res.ok) {
          const data: {
            ssoEnabled?: boolean;
            organizationId?: string;
            protocol?: string;
          } = await res.json();
          if (data.ssoEnabled) {
            organizationId = data.organizationId;
            protocol = data.protocol;
          }
        }
      } catch (error) {
        // Network/parse failure: fall back to the deployment-global status
        // below rather than blocking sign-in.
        console.warn(
          '[SSO] Discovery failed, using default connection:',
          error,
        );
      }
    }

    // Fall back to the global status when discovery didn't resolve a connection
    // (empty email, single-org deployment, or discovery failure).
    const resolvedProtocol = protocol ?? ssoConfig?.providerType;

    // SAML uses SP-initiated redirect (AuthnRequest); OIDC/OAuth2 use the
    // authorization-code flow via /authorize.
    if (resolvedProtocol === 'saml') {
      const samlUrl = new URL(`${base}/saml/login`);
      if (organizationId) samlUrl.searchParams.set('org', organizationId);
      window.location.href = samlUrl.toString();
      return;
    }
    const authorizeUrl = new URL(`${base}/authorize`);
    authorizeUrl.searchParams.set('redirect_uri', `${base}/callback`);
    if (email) authorizeUrl.searchParams.set('email', email);
    if (organizationId) {
      authorizeUrl.searchParams.set('organizationId', organizationId);
    }
    window.location.href = authorizeUrl.toString();
  }, [ssoConfig?.providerType, form]);

  // Passkey / WebAuthn sign-in (#1508). Drives the browser's get-credential
  // ceremony; on success the session is live, so refresh the cache and route
  // like the password path. A passkey is itself strong auth, so there is no
  // second-factor step.
  const handlePasskeyLogin = useCallback(async () => {
    setLoginError(null);
    setShowLockoutHint(false);
    try {
      const res = await authClient.signIn.passkey();
      if (res?.error) {
        setLoginError(t('login.passkeyFailed'));
        return;
      }
      await queryClient
        .invalidateQueries({ queryKey: ['auth', 'session'] })
        .catch(() => undefined);
      void navigate({ to: redirectTo || '/dashboard' });
    } catch {
      // Thrown when the user dismisses the prompt or has no matching passkey.
      setLoginError(t('login.passkeyFailed'));
    }
  }, [navigate, queryClient, redirectTo, t]);

  // Trusted-headers deployments after an idle sign-out (#1502): make the
  // sign-out visible and require an explicit click before the proxy
  // re-authenticates, instead of bouncing straight back into a session.
  if (trustedHeadersEnabled && !hasTrustedHeadersError && signedOutForIdle) {
    return (
      <AuthFormLayout title={t('login.loginTitle')}>
        <Stack gap={6}>
          <p
            role="status"
            className="bg-muted/50 text-muted-foreground rounded-lg border p-3 text-sm"
          >
            {tCommon('sessionIdle.signedOutNotice')}
          </p>
          <Button onClick={redirectToTrustedHeadersAuth} fullWidth>
            {tCommon('sessionIdle.continueToSignIn')}
          </Button>
        </Stack>
      </AuthFormLayout>
    );
  }

  if (isLoadingUsers || (trustedHeadersEnabled && !hasTrustedHeadersError)) {
    return null;
  }

  const showSsoButton = ssoConfig?.enabled;

  return (
    <AuthFormLayout title={t('login.loginTitle')}>
      <Stack gap={6}>
        {signedOutForIdle && (
          <p
            role="status"
            className="bg-muted/50 text-muted-foreground rounded-lg border p-3 text-sm"
          >
            {tCommon('sessionIdle.signedOutNotice')}
          </p>
        )}
        <FormSection>
          <Form onSubmit={form.handleSubmit(handleSubmit)} autoComplete="on">
            <Input
              id="email"
              type="email"
              label={t('email')}
              placeholder={t('emailPlaceholder')}
              disabled={isSubmitting}
              autoComplete="email"
              className="shadow-xs"
              {...form.register('email', {
                onChange: () => setLoginError(null),
              })}
            />

            {/* "Forgot password?" sits on the label row (label left, link
                right) — the standard pattern — so the space directly under the
                input is free for the error message to read as field feedback. */}
            <div className="flex flex-col gap-1.5">
              <Row gap={2} justify="between">
                <Label htmlFor="password">{t('password')}</Label>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() =>
                    toast({
                      title: t('login.forgotPasswordToast.title'),
                      description: t('login.forgotPasswordToast.description'),
                      position: 'top-center',
                    })
                  }
                >
                  {t('login.forgotPassword')}
                </Button>
              </Row>
              <Input
                id="password"
                type="password"
                placeholder={t('passwordPlaceholder')}
                disabled={isSubmitting}
                autoComplete="current-password"
                className="shadow-xs"
                {...form.register('password', {
                  onChange: () => setLoginError(null),
                })}
              />
            </div>

            {loginError && (
              // Pull up tight against the fields (counteracting the form's
              // `space-y-4`) so the message reads as feedback on the inputs —
              // matching the ~6px gap a field-level error uses — rather than
              // floating midway to the button.
              <Stack
                role="alert"
                aria-live="polite"
                gap={1}
                className="-mt-2.5"
              >
                <p className="text-destructive flex items-start gap-1.5 text-sm font-medium">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {loginError}
                </p>
                {showLockoutHint && (
                  <p className="text-muted-foreground pl-[1.375rem] text-xs">
                    {t('login.lockoutAdvisory')}
                  </p>
                )}
              </Stack>
            )}

            <Button type="submit" fullWidth disabled={isSubmitting || !isValid}>
              {isSubmitting ? t('login.signingIn') : t('login.loginButton')}
            </Button>
          </Form>
        </FormSection>

        {/* A single "or" divider separates the credential method above from the
            alternative sign-in methods grouped below — it reads correctly with
            one alternative (passkey) or two (passkey + SSO). */}
        <Row gap={3} aria-hidden="true">
          <span className="bg-border h-px flex-1" />
          <span className="text-muted-foreground text-xs">{tCommon('or')}</span>
          <span className="bg-border h-px flex-1" />
        </Row>

        <Stack gap={3}>
          <Button
            onClick={handlePasskeyLogin}
            variant="secondary"
            fullWidth
            disabled={isSubmitting}
          >
            {t('login.continueWithPasskey')}
          </Button>

          {showSsoButton && (
            <Button
              onClick={handleSsoLogin}
              variant="secondary"
              fullWidth
              disabled={isSubmitting}
            >
              <span className="mr-3 inline-flex size-4">
                <MicrosoftIcon />
              </span>
              {t('login.continueWithSso')}
            </Button>
          )}
        </Stack>
      </Stack>
    </AuthFormLayout>
  );
}
