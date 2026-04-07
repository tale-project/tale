import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useCallback, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import { ValidationCheckList } from '@/app/components/ui/feedback/validation-check-item';
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
import { usePasswordValidation } from '@/app/hooks/use-password-validation';
import { useReactQueryClient } from '@/app/hooks/use-react-query-client';
import { toast } from '@/app/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { getEnv } from '@/lib/env';
import { useT } from '@/lib/i18n/client';
import { createPasswordSchema } from '@/lib/shared/schemas/password';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/_auth/sign-up')({
  head: () => ({
    meta: seo('signup'),
  }),
  component: SignUpPage,
});

type SignUpFormData = {
  email: string;
  password: string;
};

function SignUpPage() {
  const navigate = useNavigate();
  const queryClient = useReactQueryClient();
  const { t } = useT('auth');
  const { t: tCommon } = useT('common');

  const signUpStartedRef = useRef(false);

  const { data: hasUsers, isLoading: isLoadingUsers } = useHasAnyUsers();
  const { data: ssoConfig } = useIsSsoConfigured();

  useEffect(() => {
    if (hasUsers === true && !signUpStartedRef.current) {
      void navigate({ to: '/log-in' });
    }
  }, [hasUsers, navigate]);

  const signUpSchema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .min(1, t('validation.emailRequired'))
          .email(tCommon('validation.email')),
        password: createPasswordSchema({
          minLength: t('validation.passwordMinLength'),
          lowercase: t('validation.passwordLowercase'),
          uppercase: t('validation.passwordUppercase'),
          number: t('validation.passwordNumber'),
          specialChar: t('validation.passwordSpecial'),
        }),
      }),
    [t, tCommon],
  );

  const form = useForm<SignUpFormData>({
    resolver: zodResolver(signUpSchema),
    mode: 'onChange',
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const { isSubmitting, isValid, errors } = form.formState;
  const password = form.watch('password');
  const passwordValidationItems = usePasswordValidation(password);

  const handleSubmit = async (data: SignUpFormData) => {
    form.setError('password', { message: '' });
    form.clearErrors('password');
    signUpStartedRef.current = true;

    try {
      const result = await authClient.signUp.email(
        { name: data.email, email: data.email, password: data.password },
        {
          onError: (ctx) => {
            const errorMessage =
              ctx.error.message || t('signup.wrongCredentials');
            form.setError('password', { message: errorMessage });
          },
        },
      );

      if (result.error) {
        signUpStartedRef.current = false;
        form.setError('password', {
          message: result.error.message || t('signup.wrongCredentials'),
        });
        return;
      }

      toast({
        title: t('signup.accountCreated'),
        variant: 'success',
      });

      await queryClient
        .invalidateQueries({ queryKey: ['auth', 'session'] })
        .catch((error) =>
          console.warn('Session cache invalidation failed:', error),
        );
      void navigate({ to: '/dashboard' });
    } catch (error) {
      signUpStartedRef.current = false;
      console.error('Sign up error:', error);
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

  if (isLoadingUsers || (hasUsers === true && !signUpStartedRef.current)) {
    return null;
  }

  const showSsoButton = ssoConfig?.enabled;

  return (
    <AuthFormLayout title={t('signup.signupTitle')}>
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
              errorMessage={errors.email?.message}
              className="border-border shadow-xs"
              {...form.register('email')}
            />

            <Stack gap={2}>
              <Input
                id="password"
                type="password"
                size="lg"
                label={t('password')}
                placeholder={t('passwordPlaceholder')}
                disabled={isSubmitting}
                autoComplete="new-password"
                errorMessage={errors.password?.message}
                className="shadow-xs"
                {...form.register('password')}
              />
              {password && (
                <ValidationCheckList
                  items={passwordValidationItems}
                  className="text-xs"
                />
              )}
            </Stack>

            <Button
              type="submit"
              size="lg"
              fullWidth
              disabled={isSubmitting || !isValid}
            >
              {isSubmitting ? t('signup.creating') : t('signup.createButton')}
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
