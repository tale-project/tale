'use client';

/**
 * Create/edit form for a project agent: a name, the harness it runs on, the
 * skills/connectors/tools it comes pre-equipped with, the org secrets it
 * receives as env vars, the credential it acts as for each connector that
 * opens git remotes and the identity its commits carry, and an
 * instructions addendum the run lane delivers
 * through the harness's system-prompt channel. One dialog serves both modes —
 * `agent` present means edit, absent means create.
 */

import { projectAgentGitIdentitySchema } from '@tale/shared/schemas/projects';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { Stack } from '@tale/ui/layout';
import { SearchableSelect } from '@tale/ui/searchable-select';
import { Select } from '@tale/ui/select';
import { Textarea } from '@tale/ui/textarea';
import { toast } from '@tale/ui/use-toast';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  SkillsMenu,
  type SkillOption,
  type SkillsCatalogState,
  type SkillsSelection,
} from '@/app/components/skills/skills-menu';
import { useAbility } from '@/app/hooks/use-ability';
import { failureDetail } from '@/app/lib/backend/adapters';
import type { ReadState } from '@/app/lib/backend/read-state';
import { useT } from '@/lib/i18n/client';
import { DOCUMENT_SKILL_SLUGS } from '@/lib/shared/document-skills';
import { AppError } from '@/lib/shared/errors/app-error';
import {
  findSelectedModel,
  offeredToHarness,
  type HarnessToolWire,
  type ModelOption,
} from '@/lib/shared/harness-offer';

import {
  useCreateProjectAgent,
  useUpdateProjectAgent,
} from '../hooks/mutations';
import {
  useAgentSecrets,
  useOrgConnectorCredentials,
  type AgentSecretSummary,
} from '../hooks/queries';
import type { ProjectAgentRow } from '../hooks/queries';
import { useAgentToolOptions } from '../hooks/use-agent-tool-options';
import { useUnpinnedServingPreview } from '../hooks/use-unpinned-serving-preview';
import {
  AgentRepositoryAccessField,
  type RepositoryConnectorOption,
} from './agent-repository-access-field';
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
  /** How the capability catalog read stands (`readStateOf`): one that has
   * not answered is not an empty catalog, and a failed read is this form's
   * to name and retry. */
  catalogRead: ReadState & { retry: () => void };
  /** The connectors it may be equipped with; `git` on one whose credential
   * also opens git remotes. */
  connectors: readonly RepositoryConnectorOption[];
  /** The row being edited; absent = create. */
  agent?: ProjectAgentRow;
  /** Create mode: the new agent's id, once it exists and before the dialog
   * closes — for a caller that goes on to use it (assign it to a task). */
  onCreated?: (agentId: string) => void;
}

/** Mirrors the mutation's `PROJECT_AGENT_INSTRUCTIONS_MAX`. */
const INSTRUCTIONS_MAX = 20_000;

/** Which message key each commit identity field fails with, by the shared
 * schema the server validates against; neither key when both pass. Both
 * empty is no identity at all. */
function validateGitIdentity(
  name: string,
  email: string,
): {
  name?: 'nameInvalid' | 'incomplete';
  email?: 'emailInvalid' | 'incomplete';
} {
  if (name === '' && email === '') return {};
  if (name === '') return { name: 'incomplete' };
  if (email === '') return { email: 'incomplete' };
  const { shape } = projectAgentGitIdentitySchema;
  return {
    ...(shape.name.safeParse(name).success
      ? {}
      : { name: 'nameInvalid' as const }),
    ...(shape.email.safeParse(email).success
      ? {}
      : { email: 'emailInvalid' as const }),
  };
}

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
  catalogRead,
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
  const { data: orgCredentials } = useOrgConnectorCredentials(
    open ? organizationId : undefined,
  );
  // Which credential an agent acts as is an Owner's or Admin's decision,
  // as its secrets are; the server refuses anyone else's change.
  const canChangePins = useAbility().can('write', 'orgSettings');

  const [name, setName] = useState('');
  const [harness, setHarness] = useState('');
  const [model, setModel] = useState('');
  const [modelProvider, setModelProvider] = useState('');
  const [binding, setBinding] = useState(EMPTY_BINDING);
  const [secretNames, setSecretNames] = useState<readonly string[]>([]);
  const [pins, setPins] = useState<Record<string, string>>({});
  const [gitName, setGitName] = useState('');
  const [gitEmail, setGitEmail] = useState('');
  const [gitNameError, setGitNameError] = useState<string | undefined>(
    undefined,
  );
  const [gitEmailError, setGitEmailError] = useState<string | undefined>(
    undefined,
  );
  const [instructions, setInstructions] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Whether this opening of a create dialog already ticked the document
  // skills — once, so unticking one sticks while the catalog refetches.
  const documentSkillsSeeded = useRef(false);
  const snapshot = useRef<{ agentId?: string; updatedAt?: number } | null>(
    null,
  );

  // Re-seed from the row each time the dialog opens; create mode seeds blank.
  useEffect(() => {
    if (!open) {
      snapshot.current = null;
      return;
    }
    if (snapshot.current && snapshot.current.agentId === agent?._id) return;
    snapshot.current = { agentId: agent?._id, updatedAt: agent?.updatedAt };
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
    setPins({ ...agent?.connectorCredentials });
    setGitName(agent?.gitIdentity?.name ?? '');
    setGitEmail(agent?.gitIdentity?.email ?? '');
    setGitNameError(undefined);
    setGitEmailError(undefined);
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

  // The grantable platform tools plus the always-on knowledge search.
  const { tools: toolOptions, lockedTools } = useAgentToolOptions('project');

  // Until the catalog answers, what the project offers is unknown, not
  // empty: the menu says so and keeps the equipment it cannot check yet.
  const catalog: SkillsCatalogState =
    skills !== undefined
      ? 'loaded'
      : catalogRead.unavailable
        ? 'unavailable'
        : 'loading';
  const equipmentRef = useRef<HTMLDivElement>(null);
  // Once a retried read takes its notice away, the focus returns to the
  // menu the notice was about.
  const focusEquipment = () =>
    equipmentRef.current
      ?.querySelector<HTMLElement>('[aria-haspopup="menu"]')
      ?.focus();

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
    const commitName = gitName.trim();
    const commitEmail = gitEmail.trim();
    // The server's own rule for each field, so the error lands on the field
    // at fault instead of coming back as one refusal of the whole save.
    const identity = validateGitIdentity(commitName, commitEmail);
    if (identity.name !== undefined || identity.email !== undefined) {
      setGitNameError(
        identity.name === undefined
          ? undefined
          : t(`agents.gitIdentity.${identity.name}`),
      );
      setGitEmailError(
        identity.email === undefined
          ? undefined
          : t(`agents.gitIdentity.${identity.email}`),
      );
      return;
    }
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
        connectorCredentials: { ...pins },
        gitIdentity:
          commitName === '' ? null : { name: commitName, email: commitEmail },
        ...(instructions.trim() !== ''
          ? { instructions: instructions.trim() }
          : {}),
      };
      if (agent) {
        await updateAgent({
          agentId: agent._id,
          expectedUpdatedAt: snapshot.current?.updatedAt,
          ...payload,
        });
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
      } else if (code === 'PROJECT_AGENT_GIT_IDENTITY_INVALID') {
        // The checks above mirror the server's, so this is a rule they do
        // not know yet; its message names both fields.
        setGitNameError(t(`errors.${code}`));
      } else if (
        code === 'PROJECT_AGENT_HARNESS_INVALID' ||
        code === 'PROJECT_AGENT_STALE' ||
        code === 'PROJECT_AGENT_MODEL_INVALID' ||
        code === 'PROJECT_AGENT_INSTRUCTIONS_TOO_LONG' ||
        code === 'PROJECT_AGENT_LIMIT' ||
        code === 'PROJECT_AGENT_CREDENTIAL_UNKNOWN' ||
        code === 'PROJECT_AGENT_CREDENTIALS_FORBIDDEN' ||
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
        // How people mention the agent: made from its name, so a rename
        // changes it, which the saved agent's handle tells best.
        description={
          agent?.handle !== undefined
            ? t('agents.handleHint', { handle: agent.handle })
            : undefined
        }
        errorMessage={nameError}
        disabled={isSubmitting}
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
        disabled={isSubmitting}
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
        disabled={isSubmitting}
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
      <Stack ref={equipmentRef} gap={2}>
        <SkillsMenu
          skills={skills ?? []}
          connectors={connectors}
          catalog={catalog}
          tools={toolOptions}
          lockedTools={lockedTools}
          value={binding}
          onChange={setBinding}
          disabled={isSubmitting}
          label={t('agents.equipmentLabel')}
          // The menu is portaled outside this dialog; register it as a modal
          // layer so the dialog scroll lock does not swallow wheel events.
          modal
          // Team skills resolve against the PROJECT's teams here, not the
          // member configuring the agent — the agent runs for everyone in
          // the project.
          description={t('agents.equipmentVisibilityHint')}
        />
        {/* A settled failed read, also while its retry runs, and a refresh
            that failed: the last answer, if any, stays listed. */}
        {(catalogRead.unavailable || catalogRead.stale) && (
          <CatalogLoadError
            message={t(
              catalogRead.unavailable
                ? 'agents.equipmentLoadFailed'
                : 'agents.equipmentRefreshFailed',
            )}
            failureKey={catalogRead.failureCount}
            isRetrying={catalogRead.retrying}
            onRetry={catalogRead.retry}
            onFocusLost={focusEquipment}
          />
        )}
      </Stack>
      <AgentSecretsField
        organizationId={organizationId}
        secrets={secrets}
        selected={secretNames}
        onChange={setSecretNames}
        disabled={isSubmitting}
      />
      <AgentRepositoryAccessField
        connectors={connectors}
        equipped={binding.connectors}
        credentials={orgCredentials ?? []}
        pins={pins}
        onPinsChange={setPins}
        gitName={gitName}
        gitEmail={gitEmail}
        onGitNameChange={(value) => {
          setGitName(value);
          setGitNameError(undefined);
        }}
        onGitEmailChange={(value) => {
          setGitEmail(value);
          setGitEmailError(undefined);
        }}
        {...(gitNameError !== undefined ? { gitNameError } : {})}
        {...(gitEmailError !== undefined ? { gitEmailError } : {})}
        canChangePins={canChangePins}
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
        disabled={isSubmitting}
        onChange={(e) => setInstructions(e.target.value)}
      />
    </FormDialog>
  );
}
