'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Text } from '@tale/ui/text';
import { KeyRound, Pencil, ShieldAlert, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { SECRET_NAME_MAX, SECRET_NAME_RE } from '@/lib/shared/schemas/secrets';
import { convexErrorCode } from '@/lib/utils/convex-error';

import {
  useDeleteProjectSecret,
  useProjectSecrets,
  useSetProjectSecret,
  useSetProjectSecretPair,
} from '../hooks/secrets';

/** Credential shapes the form knows how to collect. All map onto the generic
 * name→value secret store; `basic` writes two secrets (`_USERNAME`/`_PASSWORD`). */
type SecretType = 'api_key' | 'bearer' | 'basic' | 'custom';

// Suggested env-var name per type — a placeholder hint only; the user still
// owns the actual name their integration expects.
const NAME_PLACEHOLDER: Record<SecretType, string> = {
  api_key: 'OPENAI_API_KEY',
  bearer: 'SERVICE_TOKEN',
  basic: 'SERVICE',
  custom: 'MY_SECRET',
};

export function ProjectSecretsTab({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: Id<'projects'>;
}) {
  const { t } = useT('projectSecrets');
  const { t: tCommon } = useT('common');
  const {
    secrets,
    isError,
    error: secretsError,
  } = useProjectSecrets(projectId);
  const setSecret = useSetProjectSecret();
  const setSecretPair = useSetProjectSecretPair();
  const deleteSecret = useDeleteProjectSecret();

  // The tab is gated on `project.canAdminister` in the project layout, but a
  // non-admin can still reach this page via a direct URL. Surface the backend's
  // structured access error as a translated message instead of the misleading
  // "No secrets yet." empty state with a dead Add-secret button.
  const accessErrorCode = isError ? convexErrorCode(secretsError) : undefined;
  const isAccessDenied =
    accessErrorCode === 'PROJECT_FORBIDDEN' ||
    accessErrorCode === 'PROJECT_NOT_FOUND' ||
    accessErrorCode === 'UNAUTHENTICATED';

  const [dialogOpen, setDialogOpen] = useState(false);
  const [type, setType] = useState<SecretType>('api_key');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [description, setDescription] = useState('');
  // Non-null while editing an existing secret: the name is fixed (it's the
  // env-var key agents resolve), so the form only re-collects the value and
  // description. A re-save re-encrypts via the same upsert path as Add — there
  // is no reveal, because stored values are never returned to the client.
  const [editingName, setEditingName] = useState<string | null>(null);
  // Gate that the user has acknowledged overwriting an existing secret. Reset
  // whenever the target name changes so each collision is confirmed afresh.
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  const typeOptions = useMemo(
    () => [
      { value: 'api_key', label: t('typeApiKey') },
      { value: 'bearer', label: t('typeBearer') },
      { value: 'basic', label: t('typeBasic') },
      { value: 'custom', label: t('typeCustom') },
    ],
    [t],
  );

  const resetForm = () => {
    setType('api_key');
    setName('');
    setValue('');
    setUsername('');
    setPassword('');
    setDescription('');
    setEditingName(null);
    setConfirmOverwrite(false);
  };

  const openEdit = (secret: { name: string; description?: string }) => {
    resetForm();
    setEditingName(secret.name);
    setName(secret.name);
    setType('custom');
    setDescription(secret.description ?? '');
    setDialogOpen(true);
  };

  const isEditing = editingName !== null;

  const baseName = name.trim().toUpperCase();
  const existingNames = useMemo(
    () => new Set(secrets.map((s) => s.name)),
    [secrets],
  );
  // Names that already exist and would be overwritten by saving. Empty unless a
  // collision is in play, which is what surfaces the warning + confirm gate.
  const collidingNames = useMemo(() => {
    if (isEditing || baseName.length === 0) return [];
    const candidates =
      type === 'basic'
        ? [`${baseName}_USERNAME`, `${baseName}_PASSWORD`]
        : [baseName];
    return candidates.filter((candidate) => existingNames.has(candidate));
  }, [baseName, type, existingNames, isEditing]);
  const hasCollision = collidingNames.length > 0;

  // For `basic`, the stored names carry the `_USERNAME`/`_PASSWORD` suffix, so
  // validate those full names rather than the bare base.
  const fullNames =
    type === 'basic' && !isEditing
      ? [`${baseName}_USERNAME`, `${baseName}_PASSWORD`]
      : [baseName];

  // The single-value field is relabelled per type so the form reads like a
  // dedicated form for each credential shape.
  const valueLabel =
    type === 'api_key'
      ? t('apiKeyValueLabel')
      : type === 'bearer'
        ? t('tokenLabel')
        : t('valueLabel');

  // Mirror the server's env-var-name rule (SECRET_NAME_RE) client-side so an
  // invalid or whitespace-only name is caught inline — disabling Save and showing
  // a message — instead of round-tripping to a generic SECRET_NAME_INVALID toast
  // that leaves the dialog stuck. An existing secret's name is fixed and already
  // valid, so only the create path is checked.
  const nameValid =
    isEditing ||
    (name.trim().length > 0 &&
      fullNames.every((secretName) => SECRET_NAME_RE.test(secretName)));
  const nameError =
    !isEditing && name.length > 0 && !nameValid ? t('nameInvalid') : undefined;

  const isDirty = isEditing
    ? value.length > 0 || description.trim().length > 0
    : name.length > 0 ||
      value.length > 0 ||
      username.length > 0 ||
      password.length > 0;

  const isSaving = setSecret.isPending || setSecretPair.isPending;

  // Map a save failure to the most specific toast we can. The secrets actions
  // raise `ConvexError({ code })` for expected failures; an unrecognized throw
  // (or a raw encryption error, redacted to "Server Error" in prod) falls back
  // to the actionable encryption hint or the generic message.
  const saveErrorTitle = (error: unknown): string => {
    switch (convexErrorCode(error)) {
      case 'SECRET_NAME_INVALID':
        return t('errors.SECRET_NAME_INVALID');
      case 'SECRET_VALUE_INVALID':
        return t('errors.SECRET_VALUE_INVALID');
      case 'UNAUTHENTICATED':
        return t('errors.unauthenticated');
      case 'SECRET_FORBIDDEN':
        return t('errors.forbidden');
      case 'PROJECT_FORBIDDEN':
        return t('errors.PROJECT_FORBIDDEN');
      case 'PROJECT_NOT_FOUND':
        return t('errors.PROJECT_NOT_FOUND');
      default: {
        const message = error instanceof Error ? error.message : String(error);
        // The encryption key is a server env var (`tale init` generates it);
        // surface that actionable cause instead of a generic failure.
        return /ENCRYPTION_SECRET_HEX/.test(message)
          ? t('encryptionNotConfigured')
          : tCommon('errors.generic');
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const desc = description.trim() || undefined;
    // Block the round-trip on a malformed name and point at the field.
    if (!isEditing && (baseName.length === 0 || !nameValid)) {
      toast({ title: t('errors.nameInvalid'), variant: 'destructive' });
      return;
    }
    try {
      if (isEditing && editingName) {
        // Editing keeps the existing key; the upsert re-encrypts the new value.
        await setSecret.mutateAsync({
          organizationId,
          projectId,
          name: editingName,
          value,
          description: desc,
        });
        toast({ title: t('updateSuccess'), variant: 'success' });
        resetForm();
        setDialogOpen(false);
        return;
      }
      if (type === 'basic') {
        // Both secrets are written in a single atomic action so a failure on
        // the second value never orphans the first.
        await setSecretPair.mutateAsync({
          organizationId,
          projectId,
          baseName,
          username,
          password,
          description: desc,
        });
      } else {
        await setSecret.mutateAsync({
          organizationId,
          projectId,
          name: baseName,
          value,
          description: desc,
        });
      }
      toast({ title: t('saveSuccess'), variant: 'success' });
      resetForm();
      setDialogOpen(false);
    } catch (error) {
      console.error('Save secret error:', error);
      toast({ title: saveErrorTitle(error), variant: 'destructive' });
    }
  };

  const handleDelete = async (secretName: string) => {
    try {
      await deleteSecret.mutateAsync({
        organizationId,
        projectId,
        name: secretName,
      });
      toast({ title: t('deleteSuccess'), variant: 'success' });
    } catch (error) {
      console.error('Delete secret error:', error);
      toast({ title: tCommon('errors.generic'), variant: 'destructive' });
    }
  };

  // Non-admin reaching this page directly: show a translated access-denied
  // notice instead of the empty state, the agent-access warning, and an
  // Add-secret button that would only fail on submit.
  if (isAccessDenied) {
    return (
      <ContentArea variant="narrow" gap={6}>
        <StickySectionHeader
          title={t('title')}
          description={t('description')}
        />
        <Alert
          variant="destructive"
          icon={ShieldAlert}
          title={t('errors.accessDeniedTitle')}
          description={
            accessErrorCode === 'PROJECT_NOT_FOUND'
              ? t('errors.PROJECT_NOT_FOUND')
              : t('errors.PROJECT_FORBIDDEN')
          }
        />
      </ContentArea>
    );
  }

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('title')}
        description={t('description')}
        action={
          <Button icon={KeyRound} onClick={() => setDialogOpen(true)}>
            {t('addButton')}
          </Button>
        }
      />

      <Alert
        variant="warning"
        icon={ShieldAlert}
        title={t('agentAccessTitle')}
        description={t('agentAccessBody')}
      />

      {secrets.length === 0 ? (
        <Text variant="muted">{t('empty')}</Text>
      ) : (
        <Stack as="ul" gap={2}>
          {secrets.map((secret) => (
            <li
              key={secret.name}
              className="border-border flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <Text as="span" variant="label" className="font-mono">
                  {secret.name}
                </Text>
                {secret.description && (
                  <Text as="p" variant="muted" className="truncate text-xs">
                    {secret.description}
                  </Text>
                )}
              </div>
              <Row gap={2}>
                <Text as="span" variant="muted" className="font-mono text-xs">
                  ••••••••
                </Text>
                <Button
                  size="icon"
                  variant="ghost"
                  icon={Pencil}
                  title={t('editButton')}
                  onClick={() => openEdit(secret)}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  icon={Trash2}
                  title={tCommon('actions.delete')}
                  onClick={() => void handleDelete(secret.name)}
                />
              </Row>
            </li>
          ))}
        </Stack>
      )}

      <FormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) resetForm();
          setDialogOpen(open);
        }}
        title={isEditing ? t('editTitle') : t('addButton')}
        isSubmitting={isSaving}
        isDirty={isDirty}
        // Invalid names block submit; a name collision also requires explicit
        // confirmation before overwriting a stored credential.
        isValid={nameValid && (isEditing || !hasCollision || confirmOverwrite)}
        submitText={
          !isEditing && hasCollision ? t('overwriteButton') : undefined
        }
        onSubmit={handleSave}
      >
        {!isEditing && (
          <Select
            id="secret-type"
            label={t('typeLabel')}
            value={type}
            onValueChange={(next) => {
              setConfirmOverwrite(false);
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- options are the SecretType union
              setType(next as SecretType);
            }}
            options={typeOptions}
            disabled={isSaving}
          />
        )}
        <Input
          id="secret-name"
          label={t('nameLabel')}
          placeholder={NAME_PLACEHOLDER[type]}
          value={name}
          onChange={(e) => {
            setConfirmOverwrite(false);
            setName(e.target.value.toUpperCase());
          }}
          // The name is the env-var key agents resolve — editing it would orphan
          // references, so it's fixed once created.
          disabled={isSaving || isEditing}
          // `basic` appends `_USERNAME` / `_PASSWORD`, so leave room under the cap.
          maxLength={type === 'basic' ? 50 : SECRET_NAME_MAX}
          required
          errorMessage={nameError}
          description={
            isEditing || type === 'basic' ? undefined : t('nameShapeHint')
          }
        />
        {type === 'basic' && !isEditing && (
          <Text variant="caption" className="-mt-2">
            {t('basicNameHint')}
          </Text>
        )}
        {isEditing ? (
          <>
            <Input
              id="secret-value"
              type="password"
              label={valueLabel}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={isSaving}
              required
            />
            <Text variant="caption" className="-mt-2">
              {t('editValueHint')}
            </Text>
          </>
        ) : type === 'basic' ? (
          <>
            <Input
              id="secret-username"
              label={t('usernameLabel')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isSaving}
              required
            />
            <Input
              id="secret-password"
              type="password"
              label={t('passwordLabel')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSaving}
              required
            />
          </>
        ) : (
          <Input
            id="secret-value"
            type="password"
            label={valueLabel}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={isSaving}
            required
          />
        )}
        <Input
          id="secret-description"
          label={t('descriptionLabel')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isSaving}
        />
        {hasCollision && (
          <Alert
            variant="warning"
            icon={ShieldAlert}
            live="assertive"
            title={t('overwriteWarningTitle')}
            description={
              <Stack gap={3}>
                <Text as="p" variant="muted" className="text-sm">
                  {t('overwriteWarningBody', {
                    names: collidingNames.join(', '),
                  })}
                </Text>
                <Checkbox
                  id="secret-confirm-overwrite"
                  label={t('overwriteConfirmLabel')}
                  checked={confirmOverwrite}
                  onCheckedChange={(checked) =>
                    setConfirmOverwrite(checked === true)
                  }
                  disabled={isSaving}
                />
              </Stack>
            }
          />
        )}
      </FormDialog>
    </ContentArea>
  );
}
