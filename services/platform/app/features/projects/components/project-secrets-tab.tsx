'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Text } from '@tale/ui/text';
import { KeyRound, ShieldAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import {
  useDeleteProjectSecret,
  useProjectSecrets,
  useSetProjectSecret,
} from '../hooks/secrets';

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
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');

  const resetForm = () => {
    setName('');
    setValue('');
    setDescription('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setSecret.mutateAsync({
        organizationId,
        projectId,
        name: name.trim(),
        value,
        description: description.trim() || undefined,
      });
      toast({ title: t('saveSuccess'), variant: 'success' });
      resetForm();
      setDialogOpen(false);
    } catch (error) {
      console.error('Save secret error:', error);
      toast({ title: tCommon('errors.generic'), variant: 'destructive' });
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
    <ContentArea variant="narrow" gap={6} className="py-6">
      <StickySectionHeader
        title={t('title')}
        description={t('description')}
        action={
          <Button size="sm" icon={KeyRound} onClick={() => setDialogOpen(true)}>
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
        <ul className="flex flex-col gap-2">
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
              <div className="flex items-center gap-2">
                <Text as="span" variant="muted" className="font-mono text-xs">
                  ••••••••
                </Text>
                <Button
                  size="icon"
                  variant="ghost"
                  icon={Trash2}
                  aria-label={tCommon('actions.delete')}
                  onClick={() => void handleDelete(secret.name)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <FormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) resetForm();
          setDialogOpen(open);
        }}
        title={t('addButton')}
        isSubmitting={setSecret.isPending}
        isDirty={name.length > 0 || value.length > 0}
        onSubmit={handleSave}
      >
        <Input
          id="secret-name"
          label={t('nameLabel')}
          placeholder="GITHUB_PAT"
          value={name}
          onChange={(e) => setName(e.target.value.toUpperCase())}
          disabled={setSecret.isPending}
          required
        />
        <Input
          id="secret-value"
          type="password"
          label={t('valueLabel')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={setSecret.isPending}
          required
        />
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
