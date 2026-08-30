'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { CopyableField } from '@/app/components/ui/data-display/copyable-field';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useToast } from '@/app/hooks/use-toast';
import { twoFactorStatusQuery } from '@/app/lib/backend/account';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { extractSecret, normalizeOtpauthURI } from '@/lib/utils/totp';

import { useShowBackupCodes } from './backup-codes-dialog-provider';

// qrcode.react is only needed during the brief TOTP-enrollment "verify" step,
// but this section renders on every Account-settings visit. Lazy-load it so the
// QR library stays out of the settings chunk until a user actually enrolls. The
// fallback reserves the QR's 180px footprint so the dialog doesn't jump.
const QRCodeSVG = lazyComponent(
  () => import('qrcode.react').then((m) => ({ default: m.QRCodeSVG })),
  { loading: () => <div className="size-[180px]" aria-busy="true" /> },
);

type EnrollState =
  | { step: 'idle' }
  | { step: 'password' }
  | {
      step: 'verify';
      totpURI: string;
      backupCodes: string[];
      password: string;
      code: string;
    };

export function TwoFactorSection() {
  const { data: status } = useQuery(twoFactorStatusQuery());

  // SSO-only users: hide the section. The backend also rejects enable
  // calls for SSO-only users — UI gate is UX only. When status isn't
  // loaded yet we render nothing; the backup-codes dialog lives in
  // BackupCodesDialogProvider at the root so it's unaffected.
  if (!status || !status.authenticated || !status.hasCredential) return null;

  return status.twoFactorEnabled ? (
    <EnrolledState enforced={status.enforced} />
  ) : (
    <NotEnrolledState enforced={status.enforced} />
  );
}

function NotEnrolledState({ enforced }: { enforced: boolean }) {
  const { t } = useT('twoFactor');
  const showBackupCodes = useShowBackupCodes();
  const [state, setState] = useState<EnrollState>({ step: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  async function startEnrollment(password: string) {
    setSubmitting(true);
    setError(null);
    try {
      const result = await authClient.twoFactor.enable({ password });
      if (result.error || !result.data) {
        setError(result.error?.message ?? t('errors.enableFailed'));
        return;
      }
      setState({
        step: 'verify',
        totpURI: result.data.totpURI,
        backupCodes: result.data.backupCodes,
        password,
        code: '',
      });
    } catch {
      setError(t('errors.enableFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmCode(code: string) {
    if (state.step !== 'verify') return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await authClient.twoFactor.verifyTotp({ code });
      if (result.error) {
        setError(t('errors.invalidCode'));
        return;
      }
      toast({ title: t('enrollment.enabled'), variant: 'success' });
      void queryClient.invalidateQueries({
        queryKey: twoFactorStatusQuery().queryKey,
      });
      const codes = state.backupCodes;
      setState({ step: 'idle' });
      showBackupCodes(codes);
    } catch {
      setError(t('errors.invalidCode'));
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setState({ step: 'idle' });
    setError(null);
  }

  return (
    <SettingsSection
      title={t('enrollment.title')}
      description={t('enrollment.description')}
      action={
        <Button
          variant="secondary"
          onClick={() => setState({ step: 'password' })}
        >
          {t('enrollment.enableButton')}
        </Button>
      }
    >
      {enforced && (
        <Text variant="muted" className="text-sm">
          {t('enrollment.requiredByOrg')}
        </Text>
      )}

      <PasswordPromptDialog
        open={state.step === 'password'}
        title={t('enrollment.enableButton')}
        description={t('enrollment.passwordPromptDescription')}
        submitting={submitting}
        onCancel={reset}
        onSubmit={startEnrollment}
        error={error}
      />

      {state.step === 'verify' && (
        <VerifyTotpDialog
          totpURI={state.totpURI}
          backupCodes={state.backupCodes}
          submitting={submitting}
          error={error}
          onCancel={reset}
          onSubmit={confirmCode}
        />
      )}
    </SettingsSection>
  );
}

function EnrolledState({ enforced }: { enforced: boolean }) {
  const { t } = useT('twoFactor');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const showBackupCodes = useShowBackupCodes();
  const [disableOpen, setDisableOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function disable(password: string) {
    setSubmitting(true);
    setError(null);
    try {
      const result = await authClient.twoFactor.disable({ password });
      if (result.error) {
        setError(result.error.message ?? t('errors.disableFailed'));
        return;
      }
      toast({ title: t('enrollment.disabled'), variant: 'success' });
      void queryClient.invalidateQueries({
        queryKey: twoFactorStatusQuery().queryKey,
      });
      setDisableOpen(false);
    } catch {
      setError(t('errors.disableFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function regenerate(password: string) {
    setSubmitting(true);
    setError(null);
    try {
      const result = await authClient.twoFactor.generateBackupCodes({
        password,
      });
      if (result.error || !result.data) {
        setError(result.error?.message ?? t('errors.regenerateFailed'));
        return;
      }
      setRegenOpen(false);
      toast({ title: t('backupCodes.regenerated'), variant: 'success' });
      showBackupCodes(result.data.backupCodes);
    } catch {
      setError(t('errors.regenerateFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SettingsSection
      title={t('enrollment.title')}
      description={t('enrollment.description')}
      action={
        <HStack gap={2}>
          <Button variant="secondary" onClick={() => setRegenOpen(true)}>
            {t('enrollment.regenerateButton')}
          </Button>
          <Button variant="destructive" onClick={() => setDisableOpen(true)}>
            {t('enrollment.disableButton')}
          </Button>
        </HStack>
      }
    >
      <Text variant="muted" className="text-sm">
        {t('enrollment.enabledHint')}
      </Text>

      <PasswordPromptDialog
        open={disableOpen}
        title={t('enrollment.disableButton')}
        description={t('enrollment.disablePromptDescription')}
        warning={enforced ? t('enrollment.disableEnforcedWarning') : undefined}
        submitting={submitting}
        onCancel={() => {
          setDisableOpen(false);
          setError(null);
        }}
        onSubmit={disable}
        error={error}
      />

      <PasswordPromptDialog
        open={regenOpen}
        title={t('enrollment.regenerateButton')}
        description={t('enrollment.regeneratePromptDescription')}
        submitting={submitting}
        onCancel={() => {
          setRegenOpen(false);
          setError(null);
        }}
        onSubmit={regenerate}
        error={error}
      />
    </SettingsSection>
  );
}

interface PasswordPromptProps {
  open: boolean;
  title: string;
  description: string;
  /** Optional standing warning shown above the password field. */
  warning?: string;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}

function PasswordPromptDialog({
  open,
  title,
  description,
  warning,
  submitting,
  error,
  onCancel,
  onSubmit,
}: PasswordPromptProps) {
  const { t } = useT('twoFactor');
  const [password, setPassword] = useState('');

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onCancel();
          setPassword('');
        }
      }}
      title={title}
      description={description}
      submitText={t('confirmPassword.submit')}
      isSubmitting={submitting}
      isDirty={password.length > 0}
      isValid={password.length > 0}
      onSubmit={(e) => {
        e?.preventDefault?.();
        if (!submitting && password) onSubmit(password);
      }}
    >
      {warning && <Alert variant="warning" description={warning} />}
      <Input
        id="two-factor-password"
        type="password"
        autoComplete="current-password"
        label={t('confirmPassword.label')}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={submitting}
        errorMessage={error ?? undefined}
      />
    </FormDialog>
  );
}

interface VerifyTotpProps {
  totpURI: string;
  backupCodes: string[];
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (code: string) => void;
}

function VerifyTotpDialog({
  totpURI,
  submitting,
  error,
  onCancel,
  onSubmit,
}: VerifyTotpProps) {
  const { t } = useT('twoFactor');
  const [code, setCode] = useState('');
  const secret = extractSecret(totpURI);
  const qrURI = normalizeOtpauthURI(totpURI);

  return (
    <FormDialog
      open
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      title={t('setup.title')}
      description={t('setup.qrInstructions')}
      submitText={t('setup.verifyButton')}
      isSubmitting={submitting}
      isDirty={code.length > 0}
      isValid={/^\d{6}$/.test(code)}
      onSubmit={(e) => {
        e?.preventDefault?.();
        if (!submitting) onSubmit(code);
      }}
    >
      <VStack gap={4} align="center" className="w-full min-w-0">
        {/* Literal bg-white on purpose: the QR must sit on a light surface in
            BOTH themes for scanner contrast — never theme this. */}
        <div className="rounded-md border bg-white p-3">
          <QRCodeSVG value={qrURI} size={180} level="M" />
        </div>
        {secret && (
          <CopyableField
            className="w-full min-w-0"
            label={t('setup.manualEntry')}
            value={secret}
            copyAriaLabel={t('setup.manualEntry')}
          />
        )}
      </VStack>
      <Input
        id="two-factor-code"
        label={t('setup.verifyCodeLabel')}
        placeholder="000000"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        disabled={submitting}
        errorMessage={error ?? undefined}
      />
    </FormDialog>
  );
}
