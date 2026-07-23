'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { HStack, Row, Stack } from '@tale/ui/layout';
import { useNavigate } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useDeleteAgent } from '../hooks/mutations';
import { useAgentTab } from '../hooks/use-agent-tab';
import { AgentTabShell } from './agent-tab-shell';

interface GeneralFormState {
  displayName: string;
  description: string;
  visibility: 'private' | 'org';
  labels: string;
}

/**
 * The agent's identity: display name, description, visibility, labels — and
 * the delete action. The slug is immutable (file stem = frontmatter name);
 * model, timeout, env, and routing are deliberately NOT here: an agent is a
 * persona, and those belong to wherever a turn runs.
 */
export function AgentGeneralTab({
  organizationId,
  slug,
}: {
  organizationId: string;
  slug: string;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const { agentQuery, agent, canEdit, save, saving } = useAgentTab(
    organizationId,
    slug,
  );
  const deleteAgent = useDeleteAgent();

  const [form, setForm] = useState<GeneralFormState | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Seed once per loaded document; reactive refetches must not clobber edits.
  useEffect(() => {
    if (agent && form === null) {
      setForm({
        displayName: agent.displayName,
        description: agent.description ?? '',
        visibility: agent.visibility,
        labels: (agent.labels ?? []).join(', '),
      });
    }
  }, [agent, form]);

  const submit = async () => {
    if (!form) return;
    const labels = form.labels
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean);
    await save({
      displayName: form.displayName.trim(),
      description: form.description.trim(),
      visibility: form.visibility,
      labels,
    });
  };

  const confirmDelete = async () => {
    try {
      await deleteAgent.mutateAsync({ organizationId, slug });
      setDeleteOpen(false);
      toast({ title: t('agents.agentDeleted'), variant: 'success' });
      void navigate({
        to: '/dashboard/$id/agents',
        params: { id: organizationId },
      });
    } catch (error) {
      console.error('Failed to delete agent', error);
      toast({ title: t('agents.agentDeleteFailed'), variant: 'destructive' });
    }
  };

  return (
    <AgentTabShell
      isPending={agentQuery.isPending}
      isError={agentQuery.isError}
      missing={!agentQuery.isPending && !agentQuery.isError && agent == null}
    >
      {!canEdit && <Alert description={t('agents.readOnly')} />}
      <Stack gap={4}>
        <Stack gap={1}>
          <label htmlFor="agent-display-name" className="text-sm font-medium">
            {t('agents.form.displayName')}
          </label>
          <Input
            id="agent-display-name"
            value={form?.displayName ?? ''}
            onChange={(e) =>
              setForm((f) => (f ? { ...f, displayName: e.target.value } : f))
            }
            disabled={!canEdit}
            placeholder={t('agents.form.displayNamePlaceholder')}
          />
        </Stack>

        <Stack gap={1}>
          <label htmlFor="agent-description" className="text-sm font-medium">
            {t('agents.form.description')}
          </label>
          <Input
            id="agent-description"
            value={form?.description ?? ''}
            onChange={(e) =>
              setForm((f) => (f ? { ...f, description: e.target.value } : f))
            }
            disabled={!canEdit}
            placeholder={t('agents.form.descriptionPlaceholder')}
          />
        </Stack>

        <Stack gap={1}>
          <span className="text-sm font-medium">
            {t('agents.visibility.label')}
          </span>
          <RadioGroup
            aria-label={t('agents.visibility.label')}
            value={form?.visibility ?? 'private'}
            onValueChange={(visibility) =>
              setForm((f) =>
                f && (visibility === 'private' || visibility === 'org')
                  ? { ...f, visibility }
                  : f,
              )
            }
            options={[
              {
                value: 'org',
                label: t('agents.visibility.org'),
                description: t('agents.visibility.orgHelp'),
              },
              {
                value: 'private',
                label: t('agents.visibility.private'),
                description: t('agents.visibility.privateHelp'),
              },
            ]}
            disabled={!canEdit}
          />
        </Stack>

        <Stack gap={1}>
          <label htmlFor="agent-labels" className="text-sm font-medium">
            {t('agents.form.labels')}
          </label>
          <Input
            id="agent-labels"
            value={form?.labels ?? ''}
            onChange={(e) =>
              setForm((f) => (f ? { ...f, labels: e.target.value } : f))
            }
            disabled={!canEdit}
            placeholder={t('agents.form.labelsPlaceholder')}
            aria-describedby="agent-labels-help"
          />
          <p id="agent-labels-help" className="text-muted-foreground text-xs">
            {t('agents.form.labelsHelp')}
          </p>
        </Stack>

        {canEdit && (
          <Row gap={2} justify="between">
            <Button variant="secondary" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="text-destructive mr-1 size-4" />
              {t('agents.deleteAgent')}
            </Button>
            <HStack gap={2}>
              <Button
                disabled={saving || !form || form.displayName.trim() === ''}
                onClick={() => void submit()}
              >
                {saving ? tCommon('actions.saving') : tCommon('actions.save')}
              </Button>
            </HStack>
          </Row>
        )}
      </Stack>

      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('agents.deleteAgent')}
        description={t('agents.deleteConfirmation')}
        onDelete={() => void confirmDelete()}
        isDeleting={deleteAgent.isPending}
      />
    </AgentTabShell>
  );
}
