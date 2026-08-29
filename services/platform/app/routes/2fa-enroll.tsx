import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { Grid, Stack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useQuery } from '@tanstack/react-query';
/**
 * Post-grace enrollment wall. The sign-in after-hook returns
 * `{ twoFactorRedirect: true, enrollRequired: true }` when an org policy
 * is enforced and the user is past their grace window; the login page
 * navigates here with the session still active so the plugin's
 * `/two-factor/enable` endpoint works.
 *
 * Lives at the root (not under `_auth`) for the same reason
 * `forced-change-password.$id.tsx` does: the `_auth` layout rejects
 * authenticated users, but this page requires an active session.
 */
import {
  createFileRoute,
  redirect,
  useNavigate,
  useSearch,
} from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { z } from 'zod';

import { CopyableField } from '@/app/components/ui/data-display/copyable-field';
import { Input } from '@/app/components/ui/forms/input';
import { LogoLink } from '@/app/components/ui/logo/logo-link';
import { PasskeyRegisterDialog } from '@/app/features/settings/account/components/passkey-register-dialog';
import { useReactQueryClient } from '@/app/hooks/use-react-query-client';
import { toast } from '@/app/hooks/use-toast';
import { twoFactorStatusQuery } from '@/app/lib/backend/account';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { extractSecret, normalizeOtpauthURI } from '@/lib/utils/totp';

const searchSchema = z.object({
  redirectTo: z.string().optional(),
});

export const Route = createFileRoute('/2fa-enroll')({
  validateSearch: searchSchema,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session?.data?.user) {
      throw redirect({ to: '/log-in' });
    }
  },
  component: TwoFactorEnrollPage,
});

type Step =
  | { kind: 'password' }
  | {
      kind: 'verify';
      totpURI: string;
      backupCodes: string[];
    }
  | { kind: 'done'; backupCodes: string[] };

function downloadBackupCodes(codes: string[]) {
  const blob = new Blob([codes.join('\n')], {
    type: 'text/plain;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tale-backup-codes.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Exported for tests (mirrors `LogInPage` in `_auth/log-in.tsx`).
export function TwoFactorEnrollPage() {
  const { t } = useT('twoFactor');
  const navigate = useNavigate();
  const queryClient = useReactQueryClient();
  const { redirectTo } = useSearch({ from: '/2fa-enroll' });

  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [passkeyDialogOpen, setPasskeyDialogOpen] = useState(false);

  // Don't trap a user who is ALREADY enrolled on the enrollment wall — bounce
  // them out (parity with the forced-change-password guard). Gate on the
  // initial 'password' step so an in-progress enrollment is never interrupted
  // (verifyTotp flips twoFactorEnabled before the backup codes are shown), and
  // so /2fa-enroll stays usable for voluntary enrollment by users 2FA isn't
  // enforced for (#2085[04]).
  const { data: status } = useQuery(twoFactorStatusQuery());
  useEffect(() => {
    if (!status || !status.authenticated) return;
    if (status.twoFactorEnabled && step.kind === 'password') {
      void navigate({ to: redirectTo || '/dashboard', replace: true });
    }
  }, [status, step.kind, navigate, redirectTo]);

  async function beginEnrollment(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await authClient.twoFactor.enable({ password });
      if (result.error || !result.data) {
        setError(result.error?.message ?? t('errors.enableFailed'));
        return;
      }
      setStep({
        kind: 'verify',
        totpURI: result.data.totpURI,
        backupCodes: result.data.backupCodes,
      });
    } catch {
      setError(t('errors.enableFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (step.kind !== 'verify' || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await authClient.twoFactor.verifyTotp({ code });
      if (result.error) {
        setError(t('errors.invalidCode'));
        return;
      }
      toast({
        title: t('enrollment.enabled'),
        variant: 'success',
        position: 'top-center',
      });
      // The status read is HTTP now — tell it enrollment flipped.
      void queryClient.invalidateQueries({
        queryKey: twoFactorStatusQuery().queryKey,
      });
      setStep({ kind: 'done', backupCodes: step.backupCodes });
    } catch {
      setError(t('errors.invalidCode'));
    } finally {
      setSubmitting(false);
    }
  }

  async function finish() {
    await queryClient
      .invalidateQueries({ queryKey: ['auth', 'session'] })
      .catch(() => undefined);
    void navigate({ to: redirectTo || '/dashboard' });
  }

  return (
    <VStack
      gap={0}
      align="stretch"
      className="bg-background text-foreground min-h-dvh"
    >
      <div className="px-4 pt-8 pb-8 sm:px-8">
        <LogoLink href="/" />
      </div>
      <main className="mx-auto w-full max-w-[24.875rem] px-4 pb-12">
        <Stack gap={6}>
          <Stack gap={2} className="text-center">
            <Heading level={1} size="xl">
              {t('enroll.title')}
            </Heading>
            <Text variant="muted" className="text-sm">
              {t('enroll.description')}
            </Text>
          </Stack>

          {step.kind === 'password' && (
            <Stack gap={4}>
              <form onSubmit={beginEnrollment}>
                <Stack gap={4}>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    label={t('confirmPassword.label')}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError(null);
                    }}
                    errorMessage={error ?? undefined}
                    disabled={submitting}
                  />
                  <Button type="submit" disabled={!password || submitting}>
                    {t('enrollment.enableButton')}
                  </Button>
                </Stack>
              </form>
              {/* A passkey is a phishing-resistant second factor and satisfies
                  the enforced policy exactly like TOTP (#1508). The session is
                  intentionally kept alive on this wall, so the registration
                  ceremony can run; on success the enforcement decision flips
                  to 'ok' via `hasPasskey` and we can leave immediately. */}
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPasskeyDialogOpen(true)}
                disabled={submitting}
              >
                {t('enroll.usePasskeyButton')}
              </Button>
            </Stack>
          )}

          {step.kind === 'verify' && (
            <form onSubmit={verifyCode}>
              <Stack gap={4}>
                <Text variant="muted" className="text-sm">
                  {t('setup.qrInstructions')}
                </Text>
                <VStack gap={4} align="center">
                  <div className="rounded-md border bg-white p-3">
                    <QRCodeSVG
                      value={normalizeOtpauthURI(step.totpURI)}
                      size={200}
                      level="M"
                    />
                  </div>
                  {extractSecret(step.totpURI) && (
                    <CopyableField
                      value={extractSecret(step.totpURI) ?? ''}
                      label={t('setup.manualEntry')}
                      className="w-full min-w-0"
                    />
                  )}
                </VStack>
                <Input
                  id="code"
                  label={t('setup.verifyCodeLabel')}
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                    setError(null);
                  }}
                  errorMessage={error ?? undefined}
                  disabled={submitting}
                />
                <Button
                  type="submit"
                  disabled={!/^\d{6}$/.test(code) || submitting}
                >
                  {t('setup.verifyButton')}
                </Button>
              </Stack>
            </form>
          )}

          {step.kind === 'done' && (
            <Stack gap={4}>
              <Text className="text-sm font-medium">
                {t('backupCodes.title')}
              </Text>
              <Text variant="muted" className="text-sm">
                {t('backupCodes.warningOnce')}
              </Text>
              <Grid
                as="ul"
                cols={2}
                gap={2}
                className="bg-muted rounded-md border p-3 font-mono text-sm"
              >
                {step.backupCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </Grid>
              <Stack gap={2}>
                <Button
                  variant="secondary"
                  onClick={() => downloadBackupCodes(step.backupCodes)}
                >
                  {t('backupCodes.downloadButton')}
                </Button>
                <Button onClick={finish}>{t('backupCodes.doneButton')}</Button>
              </Stack>
            </Stack>
          )}
        </Stack>
      </main>

      <PasskeyRegisterDialog
        open={passkeyDialogOpen}
        onOpenChange={setPasskeyDialogOpen}
        onRegistered={() => {
          toast({
            title: t('passkeys.registered'),
            variant: 'success',
            position: 'top-center',
          });
          void finish();
        }}
      />
    </VStack>
  );
}
