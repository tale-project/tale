import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/app/components/ui/primitives/button';
import { Input } from '@/app/components/ui/forms/input';
import { Form } from '@/app/components/ui/forms/form';
import { Stack } from '@/app/components/ui/layout/layout';
import { Separator } from '@/app/components/ui/layout/separator';
import { toast } from '@/app/hooks/use-toast';
import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import { AuthFormLayout } from '@/app/features/auth/components/auth-form-layout';
import { useT } from '@/lib/i18n/client';
import { getEnv } from '@/lib/env';

export const Route = createFileRoute('/_auth/sign-up')({
  component: SignUpPage,
});

type SignUpFormData = {
  email: string;
  password: string;
};

function SignUpPage() {
  const navigate = useNavigate();
  const { t } = useT('auth');
  const { t: tCommon } = useT('common');
  const microsoftEnabled = getEnv('MICROSOFT_AUTH_ENABLED');

  const signUpSchema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .min(1, t('validation.emailRequired'))
          .email(tCommon('validation.email')),
        password: z
          .string()
          .min(8, t('validation.passwordMinLength'))
          .regex(/[a-z]/, t('validation.passwordLowercase'))
          .regex(/[A-Z]/, t('validation.passwordUppercase'))
          .regex(/\d/, t('validation.passwordNumber'))
          .regex(/[!@#$%^&*(),.?":{}|<>]/, t('validation.passwordSpecial')),
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

  const { isSubmitting, errors } = form.formState;
  const password = form.watch('password');

  const handleSubmit = async (data: SignUpFormData) => {
    form.setError('password', { message: '' });
    form.clearErrors('password');

    try {
      const result = await authClient.signUp.email(
        { name: data.email, email: data.email, password: data.password },
        {
          onError: (ctx) => {
            const errorMessage = ctx.error.message || t('signup.wrongCredentials');
            form.setError('password', { message: errorMessage });
          },
        },
      );

      if (result.error) {
        form.setError('password', {
          message: result.error.message || t('signup.wrongCredentials'),
        });
        return;
      }

      toast({
        title: t('signup.accountCreated'),
        variant: 'success',
      });

      navigate({ to: '/dashboard' });
    } catch (error) {
      console.error('Sign up error:', error);
      toast({
        title: tCommon('errors.somethingWentWrong'),
        variant: 'destructive',
      });
    }
  };

  const handleMicrosoftSignUp = async () => {
    try {
      await authClient.signIn.social({
        provider: 'microsoft',
        callbackURL: '/dashboard',
      });
    } catch (error) {
      console.error('Microsoft sign-in error:', error);
      toast({
        title: t('signup.microsoftSignInFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <AuthFormLayout title={t('signup.signupTitle')}>
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
              className="border-border shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
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
                className="shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
                {...form.register('password')}
              />
              {password && (
                <Stack gap={1} className="text-xs text-muted-foreground list-none">
                  <li className="relative pl-4 before:content-['-'] before:absolute before:left-0">
                    {t('requirements.length')}
                  </li>
                  <li className="relative pl-4 before:content-['-'] before:absolute before:left-0">
                    {t('requirements.lowercase')}
                  </li>
                  <li className="relative pl-4 before:content-['-'] before:absolute before:left-0">
                    {t('requirements.uppercase')}
                  </li>
                  <li className="relative pl-4 before:content-['-'] before:absolute before:left-0">
                    {t('requirements.number')}
                  </li>
                  <li className="relative pl-4 before:content-['-'] before:absolute before:left-0">
                    {t('requirements.specialChar')}
                  </li>
                </Stack>
              )}
            </Stack>

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
              {isSubmitting ? t('signup.creating') : t('signup.createButton')}
            </Button>
          </Form>
        </Stack>

        {microsoftEnabled && (
          <>
            <Separator variant="muted" />

            <Button
              onClick={handleMicrosoftSignUp}
              variant="outline"
              size="lg"
              fullWidth
              disabled={isSubmitting}
            >
              <span className="mr-3 inline-flex">
                <MicrosoftIcon />
              </span>
              {t('continueWithMicrosoft')}
            </Button>
          </>
        )}
      </Stack>
    </AuthFormLayout>
  );
}
