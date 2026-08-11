'use client';

/**
 * Create/edit form for a project agent: a name, the harness it runs on, the
 * skills/connectors it comes pre-equipped with, and an instructions addendum
 * the run lane delivers through the harness's system-prompt channel. One
 * dialog serves both modes — `agent` present means edit, absent means create.
 */

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { ConvexError } from 'convex/values';
import { useEffect, useMemo, useState } from 'react';

import {
  SkillsMenu,
  type SkillOption,
  type SkillsSelection,
} from '@/app/components/skills/skills-menu';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import {
  useCreateProjectAgent,
  useUpdateProjectAgent,
} from '../hooks/mutations';
import type { ProjectAgentRow } from '../hooks/queries';

/** One harness the agent can run on (the composer's managed roster entry). */
export interface HarnessOption {
  harness: string;
  label: string;
  iconUrl?: string;
}

/** One (provider, model) pair the agent can call — a composer model listing
 * entry. The same model id can appear once per provider that serves it; the
 * pick stores the PAIR, so the run bills exactly the provider on screen. */
export interface ModelOption {
  id: string;
  label: string;
  providerSlug: string;
  /** The provider's human name, shown under each option. */
  providerLabel: string;
  /** Present when a subscription credential serves this entry — usable only
   * by its forced harness, so the picker offers it for that harness alone. */
  subscription?: { harness: string };
}

/** The offered option matching a saved pick: the exact (provider, id) pair,
 * falling back to the id alone for a row saved before providers were part of
 * the pick (same precedent as the chat composer's picker). */
function findSelectedModel(
  options: readonly ModelOption[],
  model: string,
  modelProvider: string,
): ModelOption | undefined {
  if (model === '') return undefined;
  return (
    options.find(
      (option) => option.id === model && option.providerSlug === modelProvider,
    ) ??
    (modelProvider === ''
      ? options.find((option) => option.id === model)
      : undefined)
  );
}

interface ProjectAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: Id<'projects'>;
  harnesses: readonly HarnessOption[];
  models: readonly ModelOption[];
  skills: readonly SkillOption[];
  connectors: readonly SkillOption[];
  /** The row being edited; absent = create. */
  agent?: ProjectAgentRow;
}

/** Mirrors the mutation's `PROJECT_AGENT_INSTRUCTIONS_MAX`. */
const INSTRUCTIONS_MAX = 20_000;

const EMPTY_BINDING: SkillsSelection = { skills: [], connectors: [] };

export function ProjectAgentDialog({
  open,
  onOpenChange,
  projectId,
  harnesses,
  models,
  skills,
  connectors,
  agent,
}: ProjectAgentDialogProps) {
  const { t } = useT('projects');
  const { mutateAsync: createAgent } = useCreateProjectAgent();
  const { mutateAsync: updateAgent } = useUpdateProjectAgent();

  const [name, setName] = useState('');
  const [harness, setHarness] = useState('');
  const [model, setModel] = useState('');
  const [modelProvider, setModelProvider] = useState('');
  const [binding, setBinding] = useState(EMPTY_BINDING);
  const [instructions, setInstructions] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Re-seed from the row each time the dialog opens; create mode seeds blank.
  useEffect(() => {
    if (!open) return;
    setName(agent?.name ?? '');
    setHarness(agent?.harness ?? '');
    setModel(agent?.model ?? '');
    setModelProvider(agent?.modelProvider ?? '');
    setBinding(
      agent
        ? { skills: agent.skills, connectors: agent.connectors }
        : EMPTY_BINDING,
    );
    setInstructions(agent?.instructions ?? '');
    setNameError(undefined);
  }, [open, agent]);

  const canSubmit = name.trim().length > 0 && harness !== '' && model !== '';

  // Subscription-served entries are bound to their forced harness — offer
  // them only when that harness is the one selected. Direct-served entries
  // are offered to every harness.
  const offeredModels = useMemo(
    () =>
      models.filter(
        (option) =>
          option.subscription === undefined ||
          option.subscription.harness === harness,
      ),
    [models, harness],
  );
  const selectedModel = findSelectedModel(offeredModels, model, modelProvider);
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
        // string only survives from a legacy row whose saved id no longer
        // matches any offered option — keep that row unpinned.
        ...(modelProvider !== '' ? { modelProvider } : {}),
        skills: [...binding.skills],
        connectors: [...binding.connectors],
        ...(instructions.trim() !== ''
          ? { instructions: instructions.trim() }
          : {}),
      };
      if (agent) {
        await updateAgent({ agentId: agent._id, ...payload });
      } else {
        await createAgent({ projectId, ...payload });
      }
      toast({
        title: t(agent ? 'agents.editSuccess' : 'agents.createSuccess'),
        variant: 'success',
      });
      onOpenChange(false);
    } catch (error) {
      const code = error instanceof ConvexError ? error.data?.code : undefined;
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
        code === 'RBAC_FORBIDDEN'
      ) {
        toast({ title: t(`errors.${code}`), variant: 'destructive' });
      } else {
        console.error('saveProjectAgent failed', error);
        toast({ title: t('agents.mutationError'), variant: 'destructive' });
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
        value={
          selectedModel !== undefined
            ? String(offeredModels.indexOf(selectedModel))
            : null
        }
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
      <Stack gap={1}>
        <Text variant="caption" className="font-medium">
          {t('agents.equipmentLabel')}
        </Text>
        <SkillsMenu
          skills={skills}
          connectors={connectors}
          value={binding}
          onChange={setBinding}
        />
        {/* Team skills resolve against the PROJECT's teams here, not the
            member configuring the agent — the agent runs for everyone in
            the project. */}
        <Text variant="caption" className="text-muted-foreground">
          {t('agents.equipmentVisibilityHint')}
        </Text>
      </Stack>
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
