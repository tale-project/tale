import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import {
  createFileRoute,
  useNavigate,
  useSearch,
} from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { Form } from '@/app/components/ui/forms/form';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { AuthFormLayout } from '@/app/features/auth/components/auth-form-layout';
import { useReactQueryClient } from '@/app/hooks/use-react-query-client';
import { toast } from '@/app/hooks/use-toast';
import { invalidateAuthState } from '@/app/lib/auth/session-query';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  redirectTo: z.string().optional(),
});

export const Route = createFileRoute('/_auth/2fa')({
  head: () => ({
    meta: seo('login'),
  }),
  validateSearch: searchSchema,
  component: TwoFactorVerifyPage,
});

function TwoFactorVerifyPage() {
  const { t } = useT('twoFactor');
  const navigate = useNavigate();
  const queryClient = useReactQueryClient();
  const { redirectTo } = useSearch({ from: '/_auth/2fa' });

  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isTotpValid = /^\d{6}$/.test(code);
  const isBackupValid = code.replace(/[-\s]/g, '').length === 10;
  const canSubmit = useBackup ? isBackupValid : isTotpValid;

  // better-auth stores backup codes in the generated `xxxxx-xxxxx` form
  // and verifies with a strict `codes.includes(submitted)` match, so we
  // must send the canonical format. Tolerate users typing the dash or
  // not, and any surrounding whitespace.
  function canonicalBackupCode(input: string): string {
    const stripped = input.replace(/[-\s]/g, '');
    return stripped.length === 10
      ? `${stripped.slice(0, 5)}-${stripped.slice(5)}`
      : stripped;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = useBackup
        ? await authClient.twoFactor.verifyBackupCode({
            code: canonicalBackupCode(code),
          })
        : await authClient.twoFactor.verifyTotp({ code });

      if (result.error) {
        const status = result.error.status;
        setError(
          status === 429 ? t('verify.tooManyAttempts') : t('verify.invalid'),
        );
        return;
      }

      if (useBackup) {
        // Distinct toast for the backup-code path: the user just burned a
        // one-time code, so the copy nudges toward regenerating. Uses the
        // default (info) variant rather than `success` — the dashboard
        // banner will pick up the persistent low-count warning if the
        // pool is running low.
        toast({
          title: t('verify.backupCodeSuccess'),
          position: 'top-center',
        });
      } else {
        // TOTP success during sign-in: confirm the sign-in, not enrollment.
        toast({
          title: t('verify.success'),
          variant: 'success',
          position: 'top-center',
        });
      }
      await invalidateAuthState(queryClient).catch(() => undefined);
      void navigate({ to: redirectTo || '/dashboard' });
    } catch {
      setError(t('verify.invalid'));
    } finally {
      setSubmitting(false);
    }
  }

  // Passkey escape hatch at the 2FA wall (#1508): a WebAuthn sign-in is
  // itself phishing-resistant strong auth, so completing the ceremony
  // issues a full session that supersedes the pending password+TOTP
  // half-state (the stale `two_factor` cookie is simply never consumed).
  // Same handler shape as `handlePasskeyLogin` on the log-in page.
  async function handlePasskeySignIn() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await authClient.signIn.passkey();
      if (res?.error) {
        setError(t('verify.passkeyFailed'));
        return;
      }
      await invalidateAuthState(queryClient).catch(() => undefined);
      void navigate({ to: redirectTo || '/dashboard' });
    } catch {
      // Thrown when the user dismisses the prompt or has no matching passkey.
      setError(t('verify.passkeyFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthFormLayout title={t('verify.title')}>
      <Stack gap={6}>
        <Text variant="muted" className="text-center text-sm">
          {useBackup ? t('verify.backupDescription') : t('verify.description')}
        </Text>

        <Form onSubmit={handleSubmit} autoComplete="off">
          <FormSection>
            <Input
              id="two-factor-code"
              type="text"
              label={
                useBackup ? t('verify.backupCodeLabel') : t('verify.codeLabel')
              }
              placeholder={useBackup ? 'xxxxx-xxxxx' : '000000'}
              inputMode={useBackup ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              autoFocus
              maxLength={useBackup ? 20 : 6}
              value={code}
              onChange={(e) => {
                const raw = e.target.value;
                setCode(
                  useBackup
                    ? raw.slice(0, 20)
                    : raw.replace(/\D/g, '').slice(0, 6),
                );
                setError(null);
              }}
              errorMessage={error ?? undefined}
              disabled={submitting}
            />
          </FormSection>

          <Stack gap={3} className="pt-2">
            <Button type="submit" disabled={!canSubmit || submitting}>
              {submitting
                ? t('verify.submitButton') + '…'
                : t('verify.submitButton')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setUseBackup((v) => !v);
                setCode('');
                setError(null);
              }}
              disabled={submitting}
            >
              {useBackup
                ? t('verify.useAuthenticatorToggle')
                : t('verify.useBackupCodeToggle')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={handlePasskeySignIn}
              disabled={submitting}
            >
              {t('verify.usePasskeyButton')}
            </Button>
          </Stack>
        </Form>
      </Stack>
    </AuthFormLayout>
  );
}
