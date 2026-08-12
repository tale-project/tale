'use client';

/**
 * "Blank automation": the manual create lane — a name and a model, and the
 * dialog scaffolds a single `agent` node you configure on the canvas. It is
 * the counterpart to the AI builder: two nodes (a trigger you add in the
 * editor's Trigger card, and this agent) is a complete automation, so a user
 * who already knows what they want skips the goal-authoring round trip.
 *
 * The scaffold is a valid v1 document with one agent node; everything else —
 * the prompt, the granted tools/connectors/secrets, the harness, the trigger —
 * is edited afterward on the detail page (the node inspector + Trigger card).
 */

import { Alert } from '@tale/ui/alert';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { useProjectHarnesses } from '@/app/features/projects/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';

import { useSaveAutomation } from '../hooks/mutations';
import { automationErrorMessage } from '../lib/errors';

/** Mirrors the store's `NAME_RE` — the automation identity is a kebab slug. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function BlankAutomationDialog({
  organizationId,
  projectId,
  open,
  onOpenChange,
}: {
  organizationId: string;
  /** Install target — the first save binds the automation to this project. */
  projectId?: Id<'projects'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('automations');
  const navigate = useNavigate();
  const roster = useProjectHarnesses(organizationId);
  const { mutateAsync: saveAutomation, isPending } = useSaveAutomation();

  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!open) {
      setName('');
      setModel('');
      setNameError(undefined);
    }
  }, [open]);

  // One option per model id — an agent NODE stores a bare model string (the
  // serving provider resolves at run time), so unlike the project-agent dialog
  // there is nothing to pin per provider; dedupe to the first listing of each.
  const modelOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: { value: string; label: string; description?: string }[] =
      [];
    for (const row of roster.data?.models ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      options.push({
        value: row.id,
        label: row.label,
        description: row.providerLabel,
      });
    }
    return options;
  }, [roster.data]);

  const slug = slugify(name);
  const canSubmit = slug.length > 0 && model !== '';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || isPending) return;
    // The one-agent scaffold: a valid v1 document. Prompt/harness/tools/
    // connectors/secrets are filled in on the canvas afterward.
    const automation = {
      version: 1,
      name: slug,
      nodes: [
        {
          id: 'agent',
          type: 'agent',
          model,
          prompt: t('blank.defaultPrompt'),
        },
      ],
      output: '{{ nodes.agent.output.text }}',
    };
    try {
      const saved = await saveAutomation({
        organizationId,
        automation,
        message: t('blank.initialMessage'),
        ...(projectId !== undefined ? { projectId } : {}),
      });
      const automationSlug = automationSlugToParam(saved.name);
      onOpenChange(false);
      if (projectId !== undefined) {
        void navigate({
          to: '/dashboard/$id/projects/$projectId/automations/$automationSlug',
          params: { id: organizationId, projectId, automationSlug },
        });
      } else {
        void navigate({
          to: '/dashboard/$id/automations/$automationSlug',
          params: { id: organizationId, automationSlug },
        });
      }
    } catch (error) {
      const message = automationErrorMessage(error);
      // A name collision is the one error worth pinning to the field.
      if (message.toLowerCase().includes('exists')) {
        setNameError(t('blank.nameTaken'));
      } else {
        toast({ title: message, variant: 'destructive' });
      }
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('blank.title')}
      description={t('blank.description')}
      submitText={t('blank.submit')}
      submittingText={t('blank.submitting')}
      isSubmitting={isPending}
      isValid={canSubmit}
      isDirty={name.trim().length > 0}
      confirmDiscardOnDirty
      onSubmit={(e) => void handleSubmit(e)}
    >
      <Input
        id="blank-automation-name"
        label={t('blank.nameLabel')}
        placeholder={t('blank.namePlaceholder')}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setNameError(undefined);
        }}
        errorMessage={nameError}
        {...(slug !== '' && slug !== name.trim()
          ? { description: t('blank.slugHint', { slug }) }
          : {})}
      />
      <SearchableSelect
        id="blank-automation-model"
        label={t('blank.modelLabel')}
        placeholder={t('blank.modelPlaceholder')}
        searchPlaceholder={t('blank.modelSearchPlaceholder')}
        emptyText={t('blank.modelSearchEmpty')}
        options={modelOptions}
        value={model === '' ? null : model}
        onValueChange={(value) => setModel(value)}
        modal
      />
      {roster.isError ? (
        <Alert
          variant="destructive"
          description={automationErrorMessage(roster.error)}
        />
      ) : null}
    </FormDialog>
  );
}
