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
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { SECRET_NAME_MAX, SECRET_NAME_RE } from '@/lib/shared/schemas/secrets';

import {
  useDeleteProjectSecret,
  useProjectSecrets,
  useSetProjectSecret,
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
  const { secrets } = useProjectSecrets(projectId);
  const setSecret = useSetProjectSecret();
  const deleteSecret = useDeleteProjectSecret();

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
  };

  const openEdit = (secret: { name: string; description?: string }) => {
    resetForm();
    setEditingName(secret.name);
    setName(secret.name);
    setType('custom');
    setDescription(secret.description ?? '');
    setDialogOpen(true);
  };

  // The single-value field is relabelled per type so the form reads like a
  // dedicated form for each credential shape.
  const valueLabel =
    type === 'api_key'
      ? t('apiKeyValueLabel')
      : type === 'bearer'
        ? t('tokenLabel')
        : t('valueLabel');

  const isEditing = editingName !== null;

  // Mirror the server's env-var-name rule (SECRET_NAME_RE) client-side so an
  // invalid or whitespace-only name is caught inline — disabling Save and showing
  // a message — instead of round-tripping to a generic SECRET_NAME_INVALID toast
  // that leaves the dialog stuck. An existing secret's name is fixed and already
  // valid, so only the create path is checked.
  const nameValid = isEditing || SECRET_NAME_RE.test(name.trim());
  const nameError =
    !isEditing && name.length > 0 && !nameValid ? t('nameInvalid') : undefined;

  const isDirty = isEditing
    ? value.length > 0 || description.trim().length > 0
    : name.length > 0 ||
      value.length > 0 ||
      username.length > 0 ||
      password.length > 0;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const baseName = name.trim().toUpperCase();
    const desc = description.trim() || undefined;
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
        // Two secrets so each value is independently injectable as an env var.
        await setSecret.mutateAsync({
          organizationId,
          projectId,
          name: `${baseName}_USERNAME`,
          value: username,
          description: desc,
        });
        await setSecret.mutateAsync({
          organizationId,
          projectId,
          name: `${baseName}_PASSWORD`,
          value: password,
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
      const message = error instanceof Error ? error.message : String(error);
      toast({
        // The encryption key is a server env var (`tale init` generates it);
        // surface that actionable cause instead of a generic failure.
        title: /ENCRYPTION_SECRET_HEX/.test(message)
          ? t('encryptionNotConfigured')
          : tCommon('errors.generic'),
        variant: 'destructive',
      });
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
        isSubmitting={setSecret.isPending}
        isDirty={isDirty}
        isValid={nameValid}
        onSubmit={handleSave}
      >
        {!isEditing && (
          <Select
            id="secret-type"
            label={t('typeLabel')}
            value={type}
            onValueChange={(next) =>
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- options are the SecretType union
              setType(next as SecretType)
            }
            options={typeOptions}
            disabled={setSecret.isPending}
          />
        )}
        <Input
          id="secret-name"
          label={t('nameLabel')}
          placeholder={NAME_PLACEHOLDER[type]}
          value={name}
          onChange={(e) => setName(e.target.value.toUpperCase())}
          // The name is the env-var key agents resolve — editing it would orphan
          // references, so it's fixed once created.
          disabled={setSecret.isPending || isEditing}
          // `basic` appends `_USERNAME` / `_PASSWORD`, so leave room under the cap.
          maxLength={type === 'basic' ? 50 : SECRET_NAME_MAX}
          required
          errorMessage={nameError}
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
              disabled={setSecret.isPending}
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
              disabled={setSecret.isPending}
              required
            />
            <Input
              id="secret-password"
              type="password"
              label={t('passwordLabel')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={setSecret.isPending}
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
            disabled={setSecret.isPending}
            required
          />
        )}
        <Input
          id="secret-description"
          label={t('descriptionLabel')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={setSecret.isPending}
        />
      </FormDialog>
    </ContentArea>
  );
}
