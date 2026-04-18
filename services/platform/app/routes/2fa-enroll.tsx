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
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { Stack, VStack } from '@/app/components/ui/layout/layout';
import { LogoLink } from '@/app/components/ui/logo/logo-link';
import { Button } from '@/app/components/ui/primitives/button';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { useReactQueryClient } from '@/app/hooks/use-react-query-client';
import { toast } from '@/app/hooks/use-toast';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { extractSecret, normalizeOtpauthURI } from '@/lib/utils/totp';

export const Route = createFileRoute('/2fa-enroll')({
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

function TwoFactorEnrollPage() {
  const { t } = useT('twoFactor');
  const navigate = useNavigate();
  const queryClient = useReactQueryClient();

  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      toast({ title: t('enrollment.enabled'), variant: 'success' });
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
    void navigate({ to: '/dashboard' });
  }

  return (
    <VStack
      gap={0}
      align="stretch"
      className="bg-background text-foreground min-h-screen"
    >
      <div className="px-4 pt-8 pb-16 sm:px-8 md:pb-32">
        <LogoLink href="/" />
      </div>
      <main className="mx-auto w-full max-w-[24.875rem] px-4">
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
                    <VStack gap={1} align="center">
                      <Text variant="muted" className="text-xs">
                        {t('setup.manualEntry')}
                      </Text>
                      <code className="bg-muted rounded border px-2 py-1 text-xs select-all">
                        {extractSecret(step.totpURI)}
                      </code>
                    </VStack>
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
              <ul className="bg-muted grid grid-cols-2 gap-2 rounded-md border p-3 font-mono text-sm">
                {step.backupCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
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
    </VStack>
  );
}
