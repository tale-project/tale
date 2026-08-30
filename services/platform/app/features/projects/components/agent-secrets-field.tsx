'use client';

/**
 * The agent-secrets equipment control: grant/ungrant the org's named secrets
 * to this agent (checkboxes) and manage the org catalog inline (add a new
 * secret, delete one). Secrets are org-owned — created once, reused across
 * agents and automation nodes — so this control edits BOTH the org catalog
 * and this agent's grant set.
 *
 * A secret's value is write-only: the manager shows only the name, an
 * operator description, and a masked preview. The name IS the environment
 * variable the agent's turn receives, so the whole point is BYO credentials
 * for services with no shipped connector (a GlitchTip token, a bespoke API
 * key) — the agent reads the vendor's docs and calls the API directly.
 */

import { Button } from '@tale/ui/button';
import { Description } from '@tale/ui/description';
import { Stack } from '@tale/ui/layout';
import { KeyRound, Plus, Trash2, X } from 'lucide-react';
import { useId, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { FieldShell } from '@/app/components/ui/forms/field-shell';
import { Input } from '@/app/components/ui/forms/input';
import { Label } from '@/app/components/ui/forms/label';
import { useAbility } from '@/app/hooks/use-ability';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { AppError } from '@/lib/shared/errors/app-error';

import { useDeleteAgentSecret, useUpsertAgentSecret } from '../hooks/mutations';
import type { AgentSecretSummary } from '../hooks/queries';

/** Mirrors the server `AGENT_SECRET_NAME_RE`. */
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface AgentSecretsFieldProps {
  organizationId: string;
  secrets: readonly AgentSecretSummary[];
  /** The names granted to this agent. */
  selected: readonly string[];
  onChange: (next: readonly string[]) => void;
  disabled?: boolean;
}

export function AgentSecretsField({
  organizationId,
  secrets,
  selected,
  onChange,
  disabled,
}: AgentSecretsFieldProps) {
  const { t } = useT('projects');
  const ability = useAbility();
  // Managing the org secret store (create/delete) is a developer act — the
  // same gate the server enforces. A non-developer can still see the granted
  // set and tick/untick, but not create or delete org secrets.
  const canManage = ability.can('read', 'developerSettings');
  const { mutateAsync: upsertSecret } = useUpsertAgentSecret();
  const { mutateAsync: deleteSecret } = useDeleteAgentSecret();
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const descriptionId = `${fieldId}-description`;

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<string | undefined>(
    undefined,
  );
  const [busy, setBusy] = useState(false);

  const toggle = (name: string, on: boolean): void => {
    onChange(
      on
        ? selected.includes(name)
          ? selected
          : [...selected, name]
        : selected.filter((entry) => entry !== name),
    );
  };

  const resetForm = (): void => {
    setNewName('');
    setNewValue('');
    setNewDescription('');
    setNameError(undefined);
    setAdding(false);
  };

  const onCreate = async (): Promise<void> => {
    const name = newName.trim();
    if (!NAME_RE.test(name)) {
      setNameError(t('agents.secrets.nameInvalid'));
      return;
    }
    if (newValue.trim() === '') {
      toast({
        title: t('agents.secrets.valueRequired'),
        variant: 'destructive',
      });
      return;
    }
    setBusy(true);
    try {
      await upsertSecret({
        organizationId,
        name,
        value: newValue,
        ...(newDescription.trim() !== ''
          ? { description: newDescription.trim() }
          : {}),
      });
      // A freshly-created secret is granted to the agent being edited.
      toggle(name, true);
      toast({ title: t('agents.secrets.saved'), variant: 'success' });
      resetForm();
    } catch (error) {
      const message =
        error instanceof AppError && typeof error.data?.message === 'string'
          ? error.data.message
          : t('agents.secrets.saveError');
      toast({ title: message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (): Promise<void> => {
    const name = pendingDelete;
    if (name === undefined) return;
    setBusy(true);
    try {
      await deleteSecret({ organizationId, name });
      toggle(name, false);
      toast({ title: t('agents.secrets.deleted'), variant: 'success' });
    } catch {
      toast({ title: t('agents.secrets.deleteError'), variant: 'destructive' });
    } finally {
      setBusy(false);
      setPendingDelete(undefined);
    }
  };

  return (
    <FieldShell
      wideControl
      label={<Label id={labelId}>{t('agents.secrets.label')}</Label>}
      description={
        <Description id={descriptionId}>{t('agents.secrets.hint')}</Description>
      }
    >
      <Stack
        gap={1}
        role="group"
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
      >
        {secrets.length > 0 ? (
          <Stack gap={1} className="mt-1">
            {secrets.map((secret) => (
              <div
                key={secret.name}
                className="border-border flex items-center gap-2 rounded-md border px-2 py-1.5"
              >
                <Checkbox
                  id={`agent-secret-${secret.name}`}
                  checked={selected.includes(secret.name)}
                  onCheckedChange={(checked) =>
                    toggle(secret.name, checked === true)
                  }
                  disabled={disabled || busy}
                />
                <label
                  htmlFor={`agent-secret-${secret.name}`}
                  className="flex min-w-0 flex-1 flex-col"
                >
                  <span className="flex items-center gap-1.5 font-mono text-sm">
                    <KeyRound aria-hidden className="size-3.5 shrink-0" />
                    <span className="truncate">{secret.name}</span>
                    {secret.maskedPreview !== null ? (
                      <span className="text-muted-foreground truncate font-normal">
                        {secret.maskedPreview}
                      </span>
                    ) : null}
                  </span>
                  {secret.description !== null ? (
                    <span className="text-muted-foreground truncate text-xs">
                      {secret.description}
                    </span>
                  ) : null}
                </label>
                {canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('agents.secrets.deleteAria', {
                      name: secret.name,
                    })}
                    disabled={disabled || busy}
                    onClick={() => setPendingDelete(secret.name)}
                  >
                    <Trash2 aria-hidden className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            ))}
          </Stack>
        ) : null}

        {!canManage ? null : adding ? (
          <Stack gap={2} className="border-border mt-1 rounded-md border p-2">
            <Input
              id="agent-secret-name"
              label={t('agents.secrets.nameLabel')}
              placeholder="GLITCHTIP_TOKEN"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setNameError(undefined);
              }}
              errorMessage={nameError}
            />
            <Input
              id="agent-secret-value"
              type="password"
              label={t('agents.secrets.valueLabel')}
              placeholder={t('agents.secrets.valuePlaceholder')}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
            />
            <Input
              id="agent-secret-description"
              label={t('agents.secrets.descriptionLabel')}
              placeholder={t('agents.secrets.descriptionPlaceholder')}
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void onCreate()}
              >
                {t('agents.secrets.saveButton')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={resetForm}
              >
                <X aria-hidden className="size-3.5" />
                {t('agents.secrets.cancelButton')}
              </Button>
            </div>
          </Stack>
        ) : (
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={disabled || busy}
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden className="size-3.5" />
            {t('agents.secrets.addButton')}
          </Button>
        )}

        <ConfirmDialog
          open={pendingDelete !== undefined}
          onOpenChange={(open) => {
            if (!open && !busy) setPendingDelete(undefined);
          }}
          title={t('agents.secrets.deleteTitle')}
          description={t('agents.secrets.deleteConfirm', {
            name: pendingDelete ?? '',
          })}
          confirmText={t('agents.secrets.deleteConfirmButton')}
          variant="destructive"
          isLoading={busy}
          onConfirm={() => void onDelete()}
        />
      </Stack>
    </FieldShell>
  );
}
