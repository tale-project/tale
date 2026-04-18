'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { HStack, Stack, VStack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { extractSecret, normalizeOtpauthURI } from '@/lib/utils/totp';

import { useShowBackupCodes } from './backup-codes-dialog-provider';

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
  const { t } = useT('twoFactor');
  const { data: status } = useConvexQuery(api.two_factor.queries.getStatus, {});

  // SSO-only users: hide the section. The backend also rejects enable
  // calls for SSO-only users — UI gate is UX only. When status isn't
  // loaded yet we render nothing; the backup-codes dialog lives in
  // BackupCodesDialogProvider at the root so it's unaffected.
  if (!status || !status.authenticated || !status.hasCredential) return null;

  return (
    <PageSection
      title={t('enrollment.title')}
      description={t('enrollment.description')}
      titleSize="base"
      className="pt-4"
    >
      {status.twoFactorEnabled ? (
        <EnrolledState />
      ) : (
        <NotEnrolledState enforced={status.enforced} />
      )}
    </PageSection>
  );
}

function NotEnrolledState({ enforced }: { enforced: boolean }) {
  const { t } = useT('twoFactor');
  const showBackupCodes = useShowBackupCodes();
  const [state, setState] = useState<EnrollState>({ step: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

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
    <Stack gap={3}>
      <Text variant="muted" className="text-sm">
        {enforced
          ? t('enrollment.requiredByOrg')
          : t('enrollment.notEnabledHint')}
      </Text>
      <div>
        <Button onClick={() => setState({ step: 'password' })}>
          {t('enrollment.enableButton')}
        </Button>
      </div>

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
    </Stack>
  );
}

function EnrolledState() {
  const { t } = useT('twoFactor');
  const { toast } = useToast();
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
    <Stack gap={3}>
      <Text variant="muted" className="text-sm">
        {t('enrollment.enabledHint')}
      </Text>
      <HStack gap={2}>
        <Button variant="secondary" onClick={() => setRegenOpen(true)}>
          {t('enrollment.regenerateButton')}
        </Button>
        <Button variant="destructive" onClick={() => setDisableOpen(true)}>
          {t('enrollment.disableButton')}
        </Button>
      </HStack>

      <PasswordPromptDialog
        open={disableOpen}
        title={t('enrollment.disableButton')}
        description={t('enrollment.disablePromptDescription')}
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
    </Stack>
  );
}

interface PasswordPromptProps {
  open: boolean;
  title: string;
  description: string;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}

function PasswordPromptDialog({
  open,
  title,
  description,
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
        <div className="rounded-md border bg-white p-3">
          <QRCodeSVG value={qrURI} size={180} level="M" />
        </div>
        {secret && (
          <VStack gap={1} align="center" className="w-full min-w-0">
            <Text variant="muted" className="text-xs">
              {t('setup.manualEntry')}
            </Text>
            <code className="bg-muted block w-full rounded border px-2 py-1 text-center text-xs break-all select-all">
              {secret}
            </code>
          </VStack>
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
