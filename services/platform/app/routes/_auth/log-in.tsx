import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  createFileRoute,
  useNavigate,
  useSearch,
} from '@tanstack/react-router';
import { useEffect, useMemo, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import { Form } from '@/app/components/ui/forms/form';
import { Input } from '@/app/components/ui/forms/input';
import { Stack } from '@/app/components/ui/layout/layout';
import { Separator } from '@/app/components/ui/layout/separator';
import { Button } from '@/app/components/ui/primitives/button';
import { AuthFormLayout } from '@/app/features/auth/components/auth-form-layout';
import {
  useHasAnyUsers,
  useIsSsoConfigured,
} from '@/app/features/auth/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';

const searchSchema = z.object({
  redirectTo: z.string().optional(),
});

export const Route = createFileRoute('/_auth/log-in')({
  validateSearch: searchSchema,
  component: LogInPage,
});

type LogInFormData = {
  email: string;
  password: string;
};

function LogInPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { redirectTo } = useSearch({ from: '/_auth/log-in' });
  const { t } = useT('auth');
  const { t: tCommon } = useT('common');

  const { data: hasUsers, isLoading: isLoadingUsers } = useHasAnyUsers();
  const { data: ssoConfig } = useIsSsoConfigured();

  useEffect(() => {
    if (hasUsers === false) {
      void navigate({ to: '/sign-up' });
    }
  }, [hasUsers, navigate]);

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

  const { isSubmitting, errors } = form.formState;

  const handleSubmit = async (data: LogInFormData) => {
    form.clearErrors('password');

    try {
      const response = await authClient.signIn.email(
        { email: data.email, password: data.password },
        {
          onError: () => {
            form.setError('password', { message: t('login.wrongCredentials') });
          },
        },
      );

      if (!response.data?.user) {
        form.setError('password', { message: t('login.wrongCredentials') });
        return;
      }

      toast({
        title: t('login.toast.success'),
        variant: 'success',
      });

      await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
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
    const callbackUri = `${window.location.origin}/http_api/api/sso/callback`;
    const authorizeUrl = `/http_api/api/sso/authorize?redirect_uri=${encodeURIComponent(callbackUri)}`;
    window.location.href = authorizeUrl;
  }, []);

  if (isLoadingUsers) {
    return null;
  }

  const showSsoButton = ssoConfig?.enabled;

  return (
    <AuthFormLayout title={t('login.loginTitle')}>
      <Stack gap={8}>
        <Stack gap={5}>
          <Form onSubmit={form.handleSubmit(handleSubmit)} autoComplete="on">
            <Input
              id="email"
              type="email"
              size="lg"
              label={t('email')}
              placeholder={t('emailPlaceholder')}
              disabled={isSubmitting}
              autoComplete="email"
              errorMessage={errors.email?.message}
              className="shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
              {...form.register('email')}
            />

            <Input
              id="password"
              type="password"
              size="lg"
              label={t('password')}
              placeholder={t('passwordPlaceholder')}
              disabled={isSubmitting}
              autoComplete="current-password"
              errorMessage={errors.password?.message}
              className="shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
              {...form.register('password')}
            />

            <Button
              type="submit"
              size="lg"
              fullWidth
              disabled={
                isSubmitting ||
                !form.watch('email')?.trim() ||
                !form.watch('password')?.trim() ||
                !!errors.password ||
                !!errors.email
              }
            >
              {isSubmitting ? t('login.signingIn') : t('login.loginButton')}
            </Button>
          </Form>
        </Stack>

        {showSsoButton && (
          <>
            <Separator variant="muted" />

            <Button
              onClick={handleSsoLogin}
              variant="outline"
              size="lg"
              fullWidth
              disabled={isSubmitting}
            >
              <span className="mr-3 inline-flex">
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
