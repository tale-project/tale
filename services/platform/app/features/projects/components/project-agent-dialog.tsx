'use client';

/**
 * Create/edit form for a project agent: a name, the harness it runs on, the
 * skills/connectors/tools it comes pre-equipped with, the org secrets it
 * receives as env vars, and an instructions addendum the run lane delivers
 * through the harness's system-prompt channel. One dialog serves both modes —
 * `agent` present means edit, absent means create.
 */

import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { SearchableSelect } from '@tale/ui/searchable-select';
import { Select } from '@tale/ui/select';
import { Textarea } from '@tale/ui/textarea';
import { toast } from '@tale/ui/use-toast';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  SkillsMenu,
  type SkillOption,
  type SkillsSelection,
} from '@/app/components/skills/skills-menu';
import { failureDetail } from '@/app/lib/backend/adapters';
import { AGENT_TOOL_CATALOG } from '@/backend/core/sandbox/tool_names';
import { useT } from '@/lib/i18n/client';
import { DOCUMENT_SKILL_SLUGS } from '@/lib/shared/document-skills';
import { AppError } from '@/lib/shared/errors/app-error';

import {
  useCreateProjectAgent,
  useUpdateProjectAgent,
} from '../hooks/mutations';
import { useAgentSecrets, type AgentSecretSummary } from '../hooks/queries';
import type { ProjectAgentRow } from '../hooks/queries';
import { useUnpinnedServingPreview } from '../hooks/use-unpinned-serving-preview';
import {
  findSelectedModel,
  offeredToHarness,
  type HarnessToolWire,
  type ModelOption,
} from '../lib/model-options';
import { AgentSecretsField } from './agent-secrets-field';

/** One harness the agent can run on (the composer's managed roster entry). */
export interface HarnessOption {
  harness: string;
  label: string;
  iconUrl?: string;
  /** The wire it speaks to the gateway — decides whether a Responses-only
   * model is offered. */
  toolCallingWire?: HarnessToolWire;
}

interface ProjectAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  organizationId: string;
  harnesses: readonly HarnessOption[];
  models: readonly ModelOption[];
  /** Undefined until the project's capability catalog has loaded. */
  skills: readonly SkillOption[] | undefined;
  connectors: readonly SkillOption[];
  /** The row being edited; absent = create. */
  agent?: ProjectAgentRow;
  /** Create mode: the new agent's id, once it exists and before the dialog
   * closes — for a caller that goes on to use it (assign it to a task). */
  onCreated?: (agentId: string) => void;
}

/** Mirrors the mutation's `PROJECT_AGENT_INSTRUCTIONS_MAX`. */
const INSTRUCTIONS_MAX = 20_000;

const EMPTY_BINDING: SkillsSelection = {
  skills: [],
  connectors: [],
  tools: [],
};

export function ProjectAgentDialog({
  open,
  onOpenChange,
  projectId,
  organizationId,
  harnesses,
  models,
  skills,
  connectors,
  agent,
  onCreated,
}: ProjectAgentDialogProps) {
  const { t } = useT('projects');
  const { mutateAsync: createAgent } = useCreateProjectAgent();
  const { mutateAsync: updateAgent } = useUpdateProjectAgent();
  const { data: orgSecrets } = useAgentSecrets(
    open ? organizationId : undefined,
  );

  const [name, setName] = useState('');
  const [harness, setHarness] = useState('');
  const [model, setModel] = useState('');
  const [modelProvider, setModelProvider] = useState('');
  const [binding, setBinding] = useState(EMPTY_BINDING);
  const [secretNames, setSecretNames] = useState<readonly string[]>([]);
  const [instructions, setInstructions] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Whether this opening of a create dialog already ticked the document
  // skills — once, so unticking one sticks while the catalog refetches.
  const documentSkillsSeeded = useRef(false);

  // Re-seed from the row each time the dialog opens; create mode seeds blank.
  useEffect(() => {
    if (!open) return;
    setName(agent?.name ?? '');
    setHarness(agent?.harness ?? '');
    setModel(agent?.model ?? '');
    setModelProvider(agent?.modelProvider ?? '');
    setBinding(
      agent
        ? {
            skills: agent.skills,
            connectors: agent.connectors,
            tools: agent.tools ?? [],
          }
        : EMPTY_BINDING,
    );
    setSecretNames(agent?.secrets ?? []);
    setInstructions(agent?.instructions ?? '');
    setNameError(undefined);
    documentSkillsSeeded.current = false;
  }, [open, agent]);

  // A new agent starts with the document skills the project can see ticked.
  // Wait for the first catalog, including a successful empty result. Later
  // refreshes must not add equipment to a form the person is already editing.
  useEffect(() => {
    if (!open || agent || skills === undefined || documentSkillsSeeded.current)
      return;
    documentSkillsSeeded.current = true;
    const visible = new Set(skills.map((option) => option.slug));
    const defaults = DOCUMENT_SKILL_SLUGS.filter((slug) => visible.has(slug));
    if (defaults.length === 0) return;
    setBinding((current) => ({
      ...current,
      skills: [...new Set([...current.skills, ...defaults])],
    }));
  }, [open, agent, skills]);

  // The grantable platform tools, labelled per name with a read/write badge
  // and grouped by their org module (Tasks, Documents, …).
  const toolOptions = useMemo<SkillOption[]>(
    () =>
      AGENT_TOOL_CATALOG.map((tool) => ({
        slug: tool.name,
        label: t(`agents.tool.${tool.name}`, { defaultValue: tool.name }),
        description: t(
          tool.effect === 'write'
            ? 'agents.tool.writeBadge'
            : 'agents.tool.readBadge',
        ),
        group: t(`agents.tool.module.${tool.module}`),
      })),
    [t],
  );

  const secrets: readonly AgentSecretSummary[] = orgSecrets ?? [];

  const canSubmit = name.trim().length > 0 && harness !== '' && model !== '';

  // Subscription-served entries are bound to their forced harness, and a
  // Responses-only model needs a harness that speaks that API — offer each
  // only where it can run. Other direct-served entries fit every harness.
  const harnessWire = harnesses.find(
    (option) => option.harness === harness,
  )?.toolCallingWire;
  const offeredModels = useMemo(
    () =>
      models.filter((option) => offeredToHarness(option, harness, harnessWire)),
    [models, harness, harnessWire],
  );
  const selectedModel = findSelectedModel(offeredModels, model, modelProvider);
  // A pick saved before providers were part of it names a model but no
  // provider — the run's walk decides at kick time. Show what that walk
  // would pick RIGHT NOW (the task lane's own resolver answers, so display
  // and run cannot drift), never a lookalike row matched by id alone.
  const unpinnedModel = model !== '' && modelProvider === '';
  const preview = useUnpinnedServingPreview(
    'task',
    open && unpinnedModel && harness !== ''
      ? { organizationId, model, harness }
      : undefined,
  );
  const resolved = preview.data;
  const resolvedRow =
    unpinnedModel && resolved?.ok === true
      ? offeredModels.find(
          (option) =>
            option.providerSlug === resolved.providerSlug &&
            option.id === resolved.modelId,
        )
      : undefined;
  // What the trigger displays: the pinned pair, or the row runs would use.
  const displayedModel = selectedModel ?? resolvedRow;
  const unpinnedDescription = !unpinnedModel
    ? undefined
    : resolved === undefined
      ? t('agents.modelUnpinnedResolving', { model })
      : resolved.ok
        ? t('agents.modelUnpinnedResolved', {
            model,
            provider: resolvedRow?.providerLabel ?? resolved.providerSlug,
          })
        : t('agents.modelUnpinnedUnserved', {
            model,
            reason: resolved.reason,
          });
  const modelOptions = useMemo(
    () =>
      offeredModels.map((option, index) => ({
        // Index-keyed: model ids carry `/` and `:`, so no composed string
        // value can safely encode the (provider, id) pair.
        value: String(index),
        label: option.label,
        description:
          option.subscription === undefined
            ? option.providerLabel
            : t('agents.modelProviderSubscription', {
                provider: option.providerLabel,
              }),
      })),
    [offeredModels, t],
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        harness,
        model,
        // A pick made in this dialog always carries its provider; the empty
        // string survives only from a legacy row the author left untouched
        // (the picker warns and offers pinning, but never adopts a provider
        // on its own) — keep that row unpinned.
        ...(modelProvider !== '' ? { modelProvider } : {}),
        skills: [...binding.skills],
        connectors: [...binding.connectors],
        tools: [...binding.tools],
        secrets: [...secretNames],
        ...(instructions.trim() !== ''
          ? { instructions: instructions.trim() }
          : {}),
      };
      if (agent) {
        await updateAgent({ agentId: agent._id, ...payload });
      } else {
        const agentId = await createAgent({ projectId, ...payload });
        onCreated?.(agentId);
      }
      toast({
        title: t(agent ? 'agents.editSuccess' : 'agents.createSuccess'),
        variant: 'success',
      });
      onOpenChange(false);
    } catch (error) {
      const code = error instanceof AppError ? error.data?.code : undefined;
      if (
        code === 'PROJECT_AGENT_NAME_INVALID' ||
        code === 'PROJECT_AGENT_NAME_TAKEN'
      ) {
        setNameError(t(`errors.${code}`));
      } else if (
        code === 'PROJECT_AGENT_HARNESS_INVALID' ||
        code === 'PROJECT_AGENT_MODEL_INVALID' ||
        code === 'PROJECT_AGENT_INSTRUCTIONS_TOO_LONG' ||
        code === 'PROJECT_AGENT_LIMIT' ||
        code === 'PROJECT_ARCHIVED' ||
        code === 'RBAC_FORBIDDEN'
      ) {
        toast({ title: t(`errors.${code}`), variant: 'destructive' });
      } else {
        console.error('saveProjectAgent failed', error);
        toast({
          title: t('agents.mutationError'),
          description: failureDetail(error),
          variant: 'destructive',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(agent ? 'agents.dialogEditTitle' : 'agents.dialogCreateTitle')}
      submitText={t(agent ? 'agents.editSubmit' : 'agents.createSubmit')}
      submittingText={t(
        agent ? 'agents.editSubmitting' : 'agents.createSubmitting',
      )}
      isSubmitting={isSubmitting}
      isValid={canSubmit}
      onSubmit={(e) => void onSubmit(e)}
    >
      <Input
        id="project-agent-name"
        label={t('agents.nameLabel')}
        placeholder={t('agents.namePlaceholder')}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setNameError(undefined);
        }}
        errorMessage={nameError}
      />
      <Select
        id="project-agent-harness"
        label={t('agents.harnessLabel')}
        placeholder={t('agents.harnessPlaceholder')}
        options={harnesses.map((option) => ({
          value: option.harness,
          label: option.label,
          ...(option.iconUrl !== undefined
            ? {
                icon: (
                  <img
                    src={option.iconUrl}
                    alt=""
                    className="size-4 rounded-sm"
                  />
                ),
              }
            : {}),
        }))}
        required
        value={harness}
        // Radix fires a spurious '' on unmount/re-select races — never let it
        // clear a real choice.
        onValueChange={(value) => {
          if (value === '') return;
          setHarness(value);
          // A subscription-served pick is bound to its harness; a switch
          // that invalidates it clears the model rather than submitting a
          // pair the run would refuse.
          const selected = findSelectedModel(models, model, modelProvider);
          if (
            selected?.subscription !== undefined &&
            selected.subscription.harness !== value
          ) {
            setModel('');
            setModelProvider('');
          }
        }}
      />
      <SearchableSelect
        id="project-agent-model"
        label={t('agents.modelLabel')}
        placeholder={t('agents.modelPlaceholder')}
        searchPlaceholder={t('agents.modelSearchPlaceholder')}
        emptyText={t('agents.modelSearchEmpty')}
        options={modelOptions}
        filterFn={(option, query) => {
          const search = query.toLowerCase();
          return [
            option.label,
            option.description,
            offeredModels[Number(option.value)]?.id,
          ].some((value) => value?.toLowerCase().includes(search));
        }}
        required
        value={
          displayedModel !== undefined
            ? String(offeredModels.indexOf(displayedModel))
            : null
        }
        {...(unpinnedDescription !== undefined
          ? { description: unpinnedDescription }
          : {})}
        onValueChange={(value) => {
          const option = offeredModels[Number(value)];
          if (option === undefined) return;
          setModel(option.id);
          setModelProvider(option.providerSlug);
        }}
        // Inside a modal dialog the popover must register its own
        // scroll-lock shard, or the option list won't wheel-scroll.
        modal
      />
      <SkillsMenu
        skills={skills ?? []}
        connectors={connectors}
        tools={toolOptions}
        value={binding}
        onChange={setBinding}
        label={t('agents.equipmentLabel')}
        // Team skills resolve against the PROJECT's teams here, not the
        // member configuring the agent — the agent runs for everyone in
        // the project.
        description={t('agents.equipmentVisibilityHint')}
      />
      <AgentSecretsField
        organizationId={organizationId}
        secrets={secrets}
        selected={secretNames}
        onChange={setSecretNames}
        disabled={isSubmitting}
      />
      <Textarea
        id="project-agent-instructions"
        label={t('agents.instructionsLabel')}
        placeholder={t('agents.instructionsPlaceholder')}
        description={t('agents.instructionsHint')}
        rows={6}
        maxLength={INSTRUCTIONS_MAX}
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
      />
    </FormDialog>
  );
}
