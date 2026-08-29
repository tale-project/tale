'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Separator } from '@tale/ui/separator';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import { ValidationCheckList } from '@/app/components/ui/feedback/validation-check-item';
import { Input } from '@/app/components/ui/forms/input';
import { useForm } from '@/app/components/ui/forms/use-form';
import { WizardStep } from '@/app/components/ui/wizard/wizard';
import { useIsSsoConfigured } from '@/app/features/auth/hooks/queries';
import { usePasswordValidation } from '@/app/hooks/use-password-validation';
import { useReactQueryClient } from '@/app/hooks/use-react-query-client';
import { toast } from '@/app/hooks/use-toast';
import { invalidateAuthState } from '@/app/lib/auth/session-query';
import { authClient } from '@/lib/auth-client';
import { getEnv } from '@/lib/env';
import { useT } from '@/lib/i18n/client';
import { DEFAULT_PASSWORD_POLICY } from '@/lib/shared/schemas/governance';
import { createPasswordSchema } from '@/lib/shared/schemas/password';
import { deriveNameFromEmail } from '@/lib/utils/derive-name-from-email';

type AccountFormData = {
  email: string;
  password: string;
};

/**
 * First-run owner-account creation, inlined as a wizard step. Mirrors the
 * standalone sign-up form (`routes/_auth/sign-up.tsx`) but advances the wizard
 * on success instead of navigating — the user becomes authenticated in place
 * and continues to the workspace step. Sign-up here is only ever the very
 * first user; all later users are added by an admin in Settings.
 */
export function AccountStep() {
  const { t } = useT('auth');
  const { t: tCommon } = useT('common');
  const queryClient = useReactQueryClient();
  const { data: ssoConfig } = useIsSsoConfigured();

  const schema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .min(1, t('validation.emailRequired'))
          .email(tCommon('validation.email')),
        password: createPasswordSchema({
          minLength: t('validation.passwordMinLength', {
            n: DEFAULT_PASSWORD_POLICY.minLength,
          }),
          lowercase: t('validation.passwordLowercase'),
          uppercase: t('validation.passwordUppercase'),
          number: t('validation.passwordNumber'),
          specialChar: t('validation.passwordSpecial'),
        }),
      }),
    [t, tCommon],
  );

  const form = useForm<AccountFormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const { isValid, errors } = form.formState;
  const password = form.watch('password');
  const passwordValidationItems = usePasswordValidation(password);

  const createAccount = useCallback(async (): Promise<boolean> => {
    form.clearErrors(['email', 'password']);
    const ok = await form.trigger();
    if (!ok) return false;
    const { email, password: pw } = form.getValues();

    try {
      const result = await authClient.signUp.email({
        // Suggest a real name from the email so the profile isn't seeded with
        // the raw address; the user can rename later in Account settings.
        name: deriveNameFromEmail(email) || email,
        email,
        password: pw,
      });

      if (result.error) {
        const message = result.error.message || t('signup.wrongCredentials');
        const isUserExists =
          result.error.code === 'USER_ALREADY_EXISTS' ||
          message.toLowerCase().includes('already exists');
        form.setError(isUserExists ? 'email' : 'password', { message });
        return false;
      }

      await invalidateAuthState(queryClient).catch((error) =>
        console.warn('Session cache invalidation failed:', error),
      );
      return true;
    } catch (error) {
      console.error('Sign up error:', error);
      toast({
        title: tCommon('errors.somethingWentWrong'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
      return false;
    }
  }, [form, queryClient, t, tCommon]);

  const handleSsoLogin = useCallback(() => {
    const siteUrl = getEnv('SITE_URL');
    const basePath = getEnv('BASE_PATH');
    const callbackUri = `${siteUrl}${basePath}/http_api/api/sso/callback`;
    window.location.href = `${siteUrl}${basePath}/http_api/api/sso/authorize?redirect_uri=${encodeURIComponent(callbackUri)}`;
  }, []);

  return (
    <WizardStep id="account" valid={isValid} onBeforeNext={createAccount}>
      {/* Heading + description live in the wizard hero now. */}
      <Stack gap={4}>
        <Input
          id="email"
          type="email"
          label={t('email')}
          placeholder={t('emailPlaceholder')}
          autoComplete="email"
          errorMessage={errors.email?.message}
          {...form.register('email')}
        />

        <Stack gap={2}>
          <Input
            id="password"
            type="password"
            label={t('password')}
            placeholder={t('passwordPlaceholder')}
            autoComplete="new-password"
            errorMessage={errors.password?.message}
            {...form.register('password')}
          />
          {password && (
            <ValidationCheckList
              items={passwordValidationItems}
              className="text-xs"
            />
          )}
        </Stack>

        {ssoConfig?.enabled && (
          <>
            <Separator variant="muted" />
            <Button onClick={handleSsoLogin} variant="secondary" fullWidth>
              <span className="mr-3 inline-flex size-4">
                <MicrosoftIcon />
              </span>
              {t('login.continueWithSso')}
            </Button>
          </>
        )}
      </Stack>
    </WizardStep>
  );
}
