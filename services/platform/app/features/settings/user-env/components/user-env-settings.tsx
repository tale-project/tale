'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Row, Stack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize, useSkeleton } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Switch } from '@/app/components/ui/forms/switch';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsRow } from '@/app/features/settings/components/settings-row';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { convexErrorMessage } from '@/lib/utils/convex-error';

import { useDeleteMyEnvVar, useUpsertMyEnvVar } from '../hooks/mutations';
import { useMyEnv } from '../hooks/queries';

/** Mirrors the backend `^[A-Za-z_][A-Za-z0-9_]*$` / max-128 key rule so the
 *  client can show validation inline before round-tripping to the action. */
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KEY_MAX = 128;
const VALUE_MAX = 8192;

type EnvVar = {
  key: string;
  isSecret: boolean;
  value?: string;
  maskedValue?: string;
  updatedAt: number;
};

export function UserEnvSettings() {
  const organizationId = useOrganizationId();
  if (!organizationId) return null;
  return <UserEnvSettingsInner organizationId={organizationId} />;
}

function UserEnvSettingsInner({ organizationId }: { organizationId: string }) {
  const vars = useMyEnv(organizationId);
  const isLoading = vars === undefined;

  return (
    <Skeletonize loading={isLoading}>
      <UserEnvSettingsView organizationId={organizationId} vars={vars ?? []} />
    </Skeletonize>
  );
}

function UserEnvSettingsView({
  organizationId,
  vars,
}: {
  organizationId: string;
  vars: EnvVar[];
}) {
  const { t } = useT('userEnv');
  const [addOpen, setAddOpen] = useState(false);

  return (
    <SettingsPage>
      <SettingsSection
        title={t('page.title')}
        description={t('page.description')}
        action={
          <Button icon={Plus} onClick={() => setAddOpen(true)}>
            {t('add.button')}
          </Button>
        }
      >
        <Alert
          variant="warning"
          icon={ShieldAlert}
          title={t('page.agentAccessTitle')}
          description={t('page.note')}
        />
        <EnvVarList organizationId={organizationId} vars={vars} />
      </SettingsSection>
      <AddEnvVarDialog
        organizationId={organizationId}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </SettingsPage>
  );
}

function AddEnvVarDialog({
  organizationId,
  open,
  onOpenChange,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('userEnv');
  const { toast } = useToast();
  const { mutateAsync: upsert, isPending } = useUpsertMyEnvVar();

  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [isSecret, setIsSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedKey = key.trim();
  const keyInvalid =
    trimmedKey.length > 0 &&
    (!KEY_RE.test(trimmedKey) || trimmedKey.length > KEY_MAX);
  // A secret's value must be non-empty (the backend rejects an empty secret).
  const isValid =
    trimmedKey.length > 0 &&
    !keyInvalid &&
    value.length <= VALUE_MAX &&
    (!isSecret || value.length > 0);
  const isDirty = trimmedKey.length > 0 || value.length > 0;
  // Interior whitespace (space/tab/newline after trimming the ends) almost
  // always means a token wrapped across terminal lines was pasted — a silent,
  // painful-to-debug corruption. Warn loudly but don't block: legitimately
  // multi-line secrets (PEM keys) contain interior newlines. Leading/trailing
  // whitespace is fine (the backend trims it on save).
  const showWhitespaceWarning = value.length > 0 && /\s/.test(value.trim());

  const reset = useCallback(() => {
    setKey('');
    setValue('');
    setIsSecret(false);
    setError(null);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [reset, onOpenChange],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!isValid || isPending) return;
      setError(null);
      try {
        await upsert({
          organizationId,
          key: trimmedKey,
          value,
          isSecret,
        });
        toast({ title: t('toasts.saved'), variant: 'success' });
        reset();
        onOpenChange(false);
      } catch (err) {
        console.error('[user-env upsert]', err);
        setError(convexErrorMessage(err, t('errors.saveFailed')));
      }
    },
    [
      isValid,
      isPending,
      upsert,
      organizationId,
      trimmedKey,
      value,
      isSecret,
      toast,
      t,
      reset,
      onOpenChange,
    ],
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('add.title')}
      isSubmitting={isPending}
      isDirty={isDirty}
      isValid={isValid}
      confirmDiscardOnDirty
      submitText={t('add.submit')}
      onSubmit={handleSubmit}
    >
      <Input
        label={t('add.keyLabel')}
        placeholder={t('add.keyPlaceholder')}
        value={key}
        onChange={(e) => setKey(e.target.value)}
        maxLength={KEY_MAX}
        errorMessage={keyInvalid ? t('add.keyInvalid') : undefined}
        autoComplete="off"
        spellCheck={false}
      />
      <Input
        label={t('add.valueLabel')}
        placeholder={t('add.valuePlaceholder')}
        // Secret values render masked while typing and never round-trip back.
        sensitive={isSecret}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={VALUE_MAX}
        autoComplete="off"
        spellCheck={false}
      />
      {showWhitespaceWarning && (
        <Text
          role="alert"
          className="text-sm text-amber-600 dark:text-amber-500"
        >
          {t('add.whitespaceWarning')}
        </Text>
      )}
      {/* Secret as a full-width settings row (label + help left, toggle pinned
          right) so the toggle stays anchored to the right edge. */}
      <SettingsRow
        label={t('add.secretLabel')}
        description={t('add.secretHelp')}
      >
        <Switch
          checked={isSecret}
          onCheckedChange={setIsSecret}
          aria-label={t('add.secretLabel')}
        />
      </SettingsRow>
      {error && (
        <Text role="alert" className="text-destructive text-sm">
          {error}
        </Text>
      )}
    </FormDialog>
  );
}

function EnvVarList({
  organizationId,
  vars,
}: {
  organizationId: string;
  vars: EnvVar[];
}) {
  const { t } = useT('userEnv');
  const loading = useSkeleton();

  if (loading) {
    return (
      <Stack as="ul" gap={2} aria-hidden="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <li
            key={i}
            className="border-border flex flex-col gap-0.5 rounded-lg border p-3"
            style={{ width: `${90 - i * 8}%` }}
          >
            <SkeletonText />
          </li>
        ))}
      </Stack>
    );
  }

  if (vars.length === 0) {
    return (
      <Text className="text-muted-foreground text-sm">{t('list.empty')}</Text>
    );
  }

  return (
    <Stack as="ul" gap={2}>
      {vars.map((envVar) => (
        <EnvVarRow
          key={envVar.key}
          organizationId={organizationId}
          envVar={envVar}
        />
      ))}
    </Stack>
  );
}

function EnvVarRow({
  organizationId,
  envVar,
}: {
  organizationId: string;
  envVar: EnvVar;
}) {
  const { t } = useT('userEnv');
  const { toast } = useToast();
  const { formatRelative } = useFormatDate();
  const { mutateAsync: deleteVar, isPending } = useDeleteMyEnvVar();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const displayValue = useMemo(
    () =>
      envVar.isSecret
        ? (envVar.maskedValue ?? '••••••••')
        : (envVar.value ?? ''),
    [envVar],
  );

  const handleDelete = useCallback(async () => {
    try {
      await deleteVar({ organizationId, key: envVar.key });
      setConfirmOpen(false);
      toast({ title: t('toasts.deleted'), variant: 'success' });
    } catch (err) {
      console.error('[user-env delete]', err);
      toast({ title: t('errors.deleteFailed'), variant: 'destructive' });
    }
  }, [deleteVar, organizationId, envVar.key, toast, t]);

  return (
    <li className="border-border flex items-start justify-between gap-3 rounded-lg border p-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Row gap={2} align="baseline">
          <code className="text-foreground truncate text-sm font-medium">
            {envVar.key}
          </code>
          {envVar.isSecret && (
            <span className="text-muted-foreground text-xs">
              {t('list.secretBadge')}
            </span>
          )}
        </Row>
        <code className="text-muted-foreground truncate font-mono text-xs">
          {displayValue}
        </code>
        <Text className="text-muted-foreground text-xs">
          {t('list.updatedHint', {
            when: formatRelative(new Date(envVar.updatedAt)),
          })}
        </Text>
      </div>
      <IconButton
        icon={Trash2}
        aria-label={t('list.delete')}
        variant="ghost"
        disabled={isPending}
        onClick={() => setConfirmOpen(true)}
      />
      <DeleteDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('list.deleteConfirmTitle')}
        description={t('list.deleteConfirmDescription', { key: envVar.key })}
        deleteText={t('list.delete')}
        isDeleting={isPending}
        onDelete={() => void handleDelete()}
      />
    </li>
  );
}
