import { zodResolver } from '@hookform/resolvers/zod';
import {
  createFileRoute,
  useNavigate,
  useSearch,
} from '@tanstack/react-router';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import { Form } from '@/app/components/ui/forms/form';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Stack } from '@/app/components/ui/layout/layout';
import { Separator } from '@/app/components/ui/layout/separator';
import { Button } from '@/app/components/ui/primitives/button';
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
  const { redirectTo } = useSearch({ from: '/_auth/log-in' });
  const { t } = useT('auth');
  const { t: tCommon } = useT('common');

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
  useEffect(() => {
    if (trustedHeadersEnabled && !hasTrustedHeadersError) {
      const siteUrl = getEnv('SITE_URL');
      const basePath = getEnv('BASE_PATH');
      const target = redirectTo || `${basePath}/dashboard`;
      window.location.href = `${siteUrl}${basePath}/api/trusted-headers/authenticate?redirect=${encodeURIComponent(target)}`;
    }
  }, [trustedHeadersEnabled, hasTrustedHeadersError, redirectTo]);

  useEffect(() => {
    if (!trustedHeadersEnabled && hasUsers === false) {
      void navigate({ to: '/sign-up' });
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
        return;
      }
      setLoginError(t('login.wrongCredentials'));
    },
    [formatLockoutMessage, t],
  );

  const handleSubmit = async (data: LogInFormData) => {
    setLoginError(null);

    try {
      const response = await authClient.signIn.email(
        { email: data.email, password: data.password },
        {
          onError: handleAuthError,
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
        if (!loginError) setLoginError(t('login.wrongCredentials'));
        return;
      }

      toast({
        title: t('login.toast.success'),
        variant: 'success',
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
      });
    }
  };

  const handleSsoLogin = useCallback(() => {
    const siteUrl = getEnv('SITE_URL');
    const basePath = getEnv('BASE_PATH');
    const callbackUri = `${siteUrl}${basePath}/http_api/api/sso/callback`;
    window.location.href = `${siteUrl}${basePath}/http_api/api/sso/authorize?redirect_uri=${encodeURIComponent(callbackUri)}`;
  }, []);

  if (isLoadingUsers || (trustedHeadersEnabled && !hasTrustedHeadersError)) {
    return null;
  }

  const showSsoButton = ssoConfig?.enabled;

  return (
    <AuthFormLayout title={t('login.loginTitle')}>
      <Stack gap={8}>
        <FormSection>
          <Form onSubmit={form.handleSubmit(handleSubmit)} autoComplete="on">
            <Input
              id="email"
              type="email"
              size="lg"
              label={t('email')}
              placeholder={t('emailPlaceholder')}
              disabled={isSubmitting}
              autoComplete="email"
              className="shadow-xs"
              {...form.register('email', {
                onChange: () => setLoginError(null),
              })}
            />

            <Input
              id="password"
              type="password"
              size="lg"
              label={t('password')}
              placeholder={t('passwordPlaceholder')}
              disabled={isSubmitting}
              autoComplete="current-password"
              className="shadow-xs"
              description={t('login.forgotPassword')}
              {...form.register('password', {
                onChange: () => setLoginError(null),
              })}
            />

            {loginError && (
              <p
                role="alert"
                aria-live="polite"
                className="text-destructive flex items-center gap-1.5 text-sm"
              >
                {loginError}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              fullWidth
              disabled={isSubmitting || !isValid}
            >
              {isSubmitting ? t('login.signingIn') : t('login.loginButton')}
            </Button>
          </Form>
        </FormSection>

        {showSsoButton && (
          <>
            <Separator variant="muted" />

            <Button
              onClick={handleSsoLogin}
              variant="secondary"
              size="lg"
              fullWidth
              disabled={isSubmitting}
            >
              <span className="mr-3 inline-flex size-4">
                <MicrosoftIcon />
              </span>
              {t('login.continueWithSso')}
            </Button>
          </>
        )}
      </Stack>
    </AuthFormLayout>
  );
}
