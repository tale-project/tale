'use client';

import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize, useSkeleton } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { ConvexError } from 'convex/values';
import { Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Switch } from '@/app/components/ui/forms/switch';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

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

  return (
    <SettingsPage narrow>
      <SettingsSection
        title={t('page.title')}
        description={t('page.description')}
      >
        <Text className="text-muted-foreground text-sm">{t('page.note')}</Text>
        <AddEnvVarForm organizationId={organizationId} />
        <EnvVarList organizationId={organizationId} vars={vars} />
      </SettingsSection>
    </SettingsPage>
  );
}

/** Pull `{ code, message }` off a thrown `ConvexError`, else the fallback. */
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ConvexError) {
    const data: unknown = err.data;
    if (
      data !== null &&
      typeof data === 'object' &&
      'message' in data &&
      typeof data.message === 'string'
    ) {
      return data.message;
    }
  }
  return fallback;
}

function AddEnvVarForm({ organizationId }: { organizationId: string }) {
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
  const canSubmit =
    trimmedKey.length > 0 &&
    !keyInvalid &&
    value.length <= VALUE_MAX &&
    (!isSecret || value.length > 0) &&
    !isPending;

  const reset = useCallback(() => {
    setKey('');
    setValue('');
    setIsSecret(false);
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
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
    } catch (err) {
      console.error('[user-env upsert]', err);
      setError(errorMessage(err, t('errors.saveFailed')));
    }
  }, [
    canSubmit,
    upsert,
    organizationId,
    trimmedKey,
    value,
    isSecret,
    toast,
    t,
    reset,
  ]);

  return (
    <form
      className="border-border flex flex-col gap-4 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Input
          label={t('add.keyLabel')}
          placeholder={t('add.keyPlaceholder')}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          maxLength={KEY_MAX}
          errorMessage={keyInvalid ? t('add.keyInvalid') : undefined}
          wrapperClassName="flex-1"
          autoComplete="off"
          spellCheck={false}
        />
        <Input
          label={t('add.valueLabel')}
          placeholder={t('add.valuePlaceholder')}
          // Secret values render masked while typing and never round-trip back.
          type={isSecret ? 'password' : 'text'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={VALUE_MAX}
          wrapperClassName="flex-1"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Switch
          checked={isSecret}
          onCheckedChange={setIsSecret}
          label={t('add.secretLabel')}
          description={t('add.secretHelp')}
        />
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {t('add.submit')}
        </Button>
      </div>
      {error && (
        <Text role="alert" className="text-destructive text-sm">
          {error}
        </Text>
      )}
    </form>
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
      <ul className="divide-border divide-y" aria-hidden="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="flex items-start gap-3 py-2">
            <div className="flex-1" style={{ width: `${70 - i * 10}%` }}>
              <SkeletonText />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (vars.length === 0) {
    return (
      <Text className="text-muted-foreground text-sm">{t('list.empty')}</Text>
    );
  }

  return (
    <ul className="divide-border divide-y">
      {vars.map((envVar) => (
        <EnvVarRow
          key={envVar.key}
          organizationId={organizationId}
          envVar={envVar}
        />
      ))}
    </ul>
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
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <code className="text-foreground truncate text-sm font-medium">
            {envVar.key}
          </code>
          {envVar.isSecret && (
            <span className="text-muted-foreground text-xs">
              {t('list.secretBadge')}
            </span>
          )}
        </div>
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
