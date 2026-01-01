'use client';

import { useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form } from '@/components/ui/form';
import { Stack, HStack } from '@/components/ui/layout';
import { toast } from '@/hooks/use-toast';
import { MicrosoftIcon } from '@/components/ui/icons';
import { AuthFormLayout } from '@/components/layout/auth-form-layout';
import { useT } from '@/lib/i18n';

type LogInFormData = {
  email: string;
  password: string;
};

interface LogInFormProps {
  userId: string | undefined;
  microsoftEnabled?: boolean;
}

export function LogInForm({
  userId,
  microsoftEnabled = false,
}: LogInFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirectTo');
  const { t } = useT('auth');
  const { t: tCommon } = useT('common');

  // Zod validation schema with translated messages
  const logInSchema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .min(1, tCommon('validation.required', { field: t('email') }))
          .email(tCommon('validation.email')),
        password: z.string().min(1, tCommon('validation.required', { field: t('password') })),
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
    // Clear any previous auth errors
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
      } else {
        toast({
          title: t('login.toast.success'),
          variant: 'success',
        });

        router.push(redirectTo || '/dashboard');
        router.refresh();
      }
    } catch (error) {
      console.error('Log in error:', error);
      toast({
        title: tCommon('errors.somethingWentWrong'),
        variant: 'destructive',
      });
    }
  };

  const handleMicrosoftLogIn = async () => {
    try {
      await authClient.signIn.social({
        provider: 'microsoft',
        callbackURL: redirectTo || '/dashboard',
      });
    } catch (error) {
      console.error('Microsoft sign-in error:', error);
      toast({
        title: t('login.toast.microsoftFailed'),
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    if (redirectTo && userId) {
      router.push(redirectTo);
    }
  }, [redirectTo, router, userId]);

  return (
    <AuthFormLayout title={t('login.loginTitle')}>
      <Stack gap={8}>
        <Stack gap={5}>
          <Form
            onSubmit={form.handleSubmit(handleSubmit)}
            autoComplete="on"
          >
            {/* Email Field */}
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

            {/* Password Field */}
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
              className="w-full"
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

        {/* Microsoft Login - only shown if Microsoft Entra ID is configured */}
        {microsoftEnabled && (
          <>
            <HStack gap={2}>
              <div className="flex-1 h-px bg-muted" />
            </HStack>

            <Button
              onClick={handleMicrosoftLogIn}
              variant="outline"
              size="lg"
              className="w-full shadow-[0px_1px_2px_0px_rgba(0,0,0,0.03)]"
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
