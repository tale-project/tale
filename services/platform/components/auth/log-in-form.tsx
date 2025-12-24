'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { MicrosoftIcon } from '@/components/ui/icons';
import { AuthFormLayout } from '@/components/layout';
import { useT } from '@/lib/i18n';

// Zod validation schema
const logInSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LogInFormData = z.infer<typeof logInSchema>;

interface LogInFormProps {
  userId: string | undefined;
  microsoftEnabled?: boolean;
}

export default function LogInForm({
  userId,
  microsoftEnabled = false,
}: LogInFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirectTo');
  const { t } = useT('auth');

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
            form.setError('password', { message: 'Wrong email or password' });
          },
        },
      );

      if (!response.data?.user) {
        form.setError('password', { message: 'Wrong email or password' });
        return;
      } else {
        toast({
          title: 'Signed in successfully',
          variant: 'success',
        });

        router.push(redirectTo || '/dashboard');
        router.refresh();
      }
    } catch (error) {
      console.error('Log in error:', error);
      toast({
        title: 'Something went wrong',
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
        title: 'Microsoft sign-in failed. Please try again.',
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
      <div className="space-y-8">
        <div className="space-y-5">
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-5"
            autoComplete="on"
          >
            {/* Email Field */}
            <div className="space-y-2">
              <Label htmlFor="email">{t('email')}</Label>
              <Input
                id="email"
                type="email"
                size="lg"
                placeholder={t('emailPlaceholder')}
                disabled={isSubmitting}
                autoComplete="email"
                className="border-border shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
                {...form.register('email')}
              />
              {errors.email && (
                <p className="text-sm text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <Label
                htmlFor="password"
                error={Boolean(errors.password?.message)}
              >
                {t('password')}
              </Label>
              <Input
                id="password"
                type="password"
                size="lg"
                placeholder={t('passwordPlaceholder')}
                disabled={isSubmitting}
                autoComplete="current-password"
                errorMessage={errors.password?.message}
                className="shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
                {...form.register('password')}
              />
            </div>

            <div>
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
            </div>
          </form>
        </div>

        {/* Microsoft Login - only shown if Microsoft Entra ID is configured */}
        {microsoftEnabled && (
          <>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-muted" />
            </div>

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
      </div>
    </AuthFormLayout>
  );
}
