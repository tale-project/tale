'use client';

/**
 * "Blank automation": the manual create lane, as a two-step guided wizard so a
 * user is never dropped straight onto the dense canvas editor. Step 1 defines
 * the agent — name, model, what it does, and what it is equipped with (skills,
 * connectors, platform tools, and secrets); step 2 sets when it runs (the
 * trigger). On finish it scaffolds a one-agent automation with that equipment,
 * sets the trigger, and lands on the detail page for any further refinement.
 * Guided decisions come before the full canvas editor.
 */

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Checkbox } from '@tale/ui/checkbox';
import { CopyableField } from '@tale/ui/copyable-field';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { Stack } from '@tale/ui/layout';
import { SearchableSelect } from '@tale/ui/searchable-select';
import { Textarea } from '@tale/ui/textarea';
import { toast } from '@tale/ui/use-toast';
import { useNavigate } from '@tanstack/react-router';
import { KeyRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  SkillsMenu,
  type SkillOption,
  type SkillsSelection,
} from '@/app/components/skills/skills-menu';
import { AgentSecretsField } from '@/app/features/projects/components/agent-secrets-field';
import {
  useAgentSecrets,
  useProjectHarnesses,
  useProjects,
} from '@/app/features/projects/hooks/queries';
import {
  findSelectedModel,
  toModelOptions,
} from '@/app/features/projects/lib/model-options';
import {
  AGENT_TOOL_CATALOG,
  PROJECT_AGENT_ONLY_TOOLS,
} from '@/backend/core/sandbox/tool_names';
import { blankAutomationDocument } from '@/lib/automations/blank-document';
import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';
import { localTimeZone } from '@/lib/shared/zoned-time';

import { useSaveAutomation, useSetAutomationTrigger } from '../hooks/mutations';
import { useAutomationCapabilities } from '../hooks/queries';
import { useTriggerInputCheck } from '../hooks/use-trigger-input-check';
import { automationErrorCode, automationErrorMessage } from '../lib/errors';
import {
  cronParseError,
  defaultTriggerDraft,
  toTriggerBody,
  type TriggerDraft,
  triggerDraftIssue,
} from '../lib/trigger-draft';
import { triggerIssueText } from '../lib/trigger-issue-text';
import { DEFAULT_HARNESS } from './agent-node-fields';
import { TriggerForm } from './trigger-form';
import { TriggerInputPreview } from './trigger-input-preview';
import { webhookBase } from './trigger-webhook-panel';

const NO_WARNINGS: readonly never[] = [];

const EMPTY_BINDING: SkillsSelection = {
  skills: [],
  connectors: [],
  tools: [],
};

/** Mirrors the store's `NAME_RE` — the automation identity is a kebab slug. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/^-+|-+$/g, '');
}

/** The slug a name outside the Latin script gets — `发票提醒` slugifies to
 * nothing, and the typed name lives in the presentation, not the slug. One
 * per dialog opening, so the "Saved as" line is stable while the author
 * types. */
function fallbackSlug(): string {
  return `automation-${crypto.randomUUID().slice(0, 8)}`;
}

export function BlankAutomationDialog({
  organizationId,
  projectId,
  open,
  onOpenChange,
}: {
  organizationId: string;
  /** Install target — the first save binds the automation to this project. */
  projectId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { t: tProjects } = useT('projects');
  const { t: tRecurrence } = useT('recurrence');
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const navigate = useNavigate();
  const roster = useProjectHarnesses(organizationId);
  const capabilities = useAutomationCapabilities(
    organizationId,
    projectId,
    open,
  );
  const { data: orgSecrets } = useAgentSecrets(
    open ? organizationId : undefined,
  );
  // Created in a project, the automation is installed there: an event
  // trigger says that project's events reach it, once its name is read.
  const { projects } = useProjects(organizationId);
  const installedIn = useMemo(() => {
    if (projectId === undefined) return [];
    const project = projects.find((candidate) => candidate._id === projectId);
    return project === undefined ? undefined : [project.name];
  }, [projectId, projects]);
  const { mutateAsync: saveAutomation } = useSaveAutomation();
  const { mutateAsync: setTrigger } = useSetAutomationTrigger();

  const [step, setStep] = useState<0 | 1>(0);
  const [submitting, setSubmitting] = useState(false);
  // A synchronous latch: `submitting` state does not update until the next
  // render, so a fast double Enter/click could fire `doCreate` twice before the
  // button disables. The ref closes that window.
  const creatingRef = useRef(false);

  // Step 1 — the agent.
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [modelProvider, setModelProvider] = useState('');
  const [prompt, setPrompt] = useState('');
  const [binding, setBinding] = useState(EMPTY_BINDING);
  const [secretNames, setSecretNames] = useState<readonly string[]>([]);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [generatedSlug, setGeneratedSlug] = useState(fallbackSlug);

  // Step 2 — the trigger, in the form the General tab edits it with: a
  // daily 09:00 schedule in the author's zone, created off (the way the
  // panel does it) so nothing starts before the author has looked.
  const [viewerZone] = useState(localTimeZone);
  const [trigger, setTriggerDraft] = useState<TriggerDraft>(() =>
    defaultTriggerDraft(viewerZone),
  );
  // The webhook token the create minted — the server shows it exactly once,
  // and this dialog is the only place that sees the mint, so it stays open
  // on a copy screen until the author has taken the URL.
  const [minted, setMinted] = useState<{
    token: string;
    automationSlug: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setName('');
    setModel('');
    setModelProvider('');
    setPrompt('');
    setBinding(EMPTY_BINDING);
    setSecretNames([]);
    setNameError(undefined);
    setGeneratedSlug(fallbackSlug());
    setTriggerDraft(defaultTriggerDraft(viewerZone));
    setMinted(null);
  }, [open, viewerZone]);

  // The grantable platform tools, labelled per name with a read/write badge
  // (the same labels the project-agent dialog uses).
  const toolOptions = useMemo<SkillOption[]>(
    () =>
      // A project agent's delegation tool: an automation starts agents with
      // its `task.start_agent` step, so its agent node is never offered it.
      AGENT_TOOL_CATALOG.filter(
        (tool) => !PROJECT_AGENT_ONLY_TOOLS.includes(tool.name),
      ).map((tool) => ({
        slug: tool.name,
        label: tProjects(`agents.tool.${tool.name}`, {
          defaultValue: tool.name,
        }),
        description: tProjects(
          tool.effect === 'write'
            ? 'agents.tool.writeBadge'
            : 'agents.tool.readBadge',
        ),
        group: tProjects(`agents.tool.module.${tool.module}`),
      })),
    [tProjects],
  );

  // One option per (provider, model) pair — the shared picker vocabulary:
  // collapsing two providers serving the same id was how a pick silently
  // landed on the wrong provider's bill. The scaffolded node names no
  // harness, so the host default drives it: subscription-served entries are
  // offered only when bound to that harness.
  const offeredModels = useMemo(
    () =>
      toModelOptions(roster.data?.models ?? []).filter(
        (option) =>
          option.subscription === undefined ||
          option.subscription.harness === DEFAULT_HARNESS,
      ),
    [roster.data],
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
            : tProjects('agents.modelProviderSubscription', {
                provider: option.providerLabel,
              }),
      })),
    [offeredModels, tProjects],
  );

  // The trigger is judged here, before anything is written, by the checks
  // the bind refuses on, so the wizard never creates an automation and then
  // fails to set its trigger. The toast on a refused bind stays as the
  // fallback for whatever the server alone can see.
  const triggerIssue = triggerDraftIssue(trigger);
  // What the new trigger's runs will receive; nothing is deployed yet, so
  // there is nothing to check it against.
  const inputCheck = useTriggerInputCheck({
    draft: trigger,
    stored: null,
    inputsSchema: undefined,
    deployed: false,
    clean: false,
    saveWarnings: NO_WARNINGS,
  });

  // The slug is addressing; the typed name is what people see. A name the
  // slugifier empties (Chinese, emoji) still creates — under a generated
  // slug the "Saved as" line shows before Create.
  const typedSlug = slugify(name);
  const slug =
    name.trim() === '' ? '' : typedSlug === '' ? generatedSlug : typedSlug;
  const canSubmitStep1 =
    slug.length > 0 && model !== '' && prompt.trim() !== '';
  const canSubmitStep2 = triggerIssue === null;
  const step2DisabledReason =
    triggerIssue === null
      ? undefined
      : triggerIssueText(
          triggerIssue,
          { t, tRecurrence, locale },
          { cronReason: cronParseError(trigger.cron) },
        );

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  // Created in a project, the automation is installed there, and its
  // webhook answers on the project's door only.
  const webhookUrl = (token: string): string =>
    `${webhookBase(origin, projectId)}${token}`;

  const openAutomation = (automationSlug: string): void => {
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
  };

  const doCreate = async (): Promise<void> => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setSubmitting(true);
    // The one-agent scaffold, carrying the equipment the wizard collected.
    const automation = blankAutomationDocument({
      slug,
      model,
      modelProvider,
      prompt,
      skills: binding.skills,
      connectors: binding.connectors,
      tools: binding.tools,
      secrets: secretNames,
    });
    try {
      const saved = await saveAutomation({
        organizationId,
        automation,
        // The display name as typed — case, script and emoji intact; the
        // slug only addresses the automation.
        presentation: { name: name.trim() },
        message: t('blank.initialMessage'),
        // Create-only: refuse rather than append a version to (and rebind the
        // trigger of) a live automation that already holds this slug.
        create: true,
        ...(projectId !== undefined ? { projectId } : {}),
      });
      // Set the trigger the wizard collected. A webhook mints its token
      // HERE, and the server never shows it again — so the dialog holds it
      // on a copy screen instead of navigating past it.
      let token: string | undefined;
      try {
        const bound = await setTrigger({
          organizationId,
          name: saved.name,
          trigger: toTriggerBody(trigger, null),
        });
        token = bound?.token;
      } catch (error) {
        // The automation exists; only the trigger failed — land on the detail
        // page (where the Trigger card lets them retry) with a warning.
        toast({
          title: t('blank.triggerFailed', {
            error: automationErrorMessage(error),
          }),
          variant: 'destructive',
        });
      }
      const automationSlug = automationSlugToParam(saved.name);
      if (trigger.kind === 'webhook' && token !== undefined) {
        setMinted({ token, automationSlug });
        setSubmitting(false);
        return;
      }
      openAutomation(automationSlug);
    } catch (error) {
      // The store refuses a create whose name already has versions, or whose
      // first segment the platform keeps for its own pages, with a typed
      // code — send the author back to the name step to pick another.
      const code = automationErrorCode(error);
      if (code === 'AUTOMATION_NAME_TAKEN') {
        setStep(0);
        setNameError(t('blank.nameTaken'));
      } else if (code === 'AUTOMATION_NAME_RESERVED') {
        setStep(0);
        setNameError(t('blank.nameReserved'));
      } else {
        toast({ title: automationErrorMessage(error), variant: 'destructive' });
      }
      creatingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (minted !== null) return;
    if (step === 0) {
      if (canSubmitStep1) setStep(1);
      return;
    }
    if (!canSubmitStep2 || submitting) return;
    void doCreate();
  };

  const footer =
    minted !== null ? (
      <Button
        type="button"
        onClick={() => {
          openAutomation(minted.automationSlug);
        }}
      >
        {t('blank.openAutomation')}
      </Button>
    ) : (
      <>
        {step === 0 ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t('blank.cancel')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setStep(0)}
            disabled={submitting}
          >
            {t('blank.back')}
          </Button>
        )}
        {step === 0 ? (
          <Button type="submit" disabled={!canSubmitStep1}>
            {t('blank.next')}
          </Button>
        ) : (
          <Button
            type="submit"
            disabled={!canSubmitStep2}
            {...(step2DisabledReason !== undefined && !canSubmitStep2
              ? { disabledReason: step2DisabledReason }
              : {})}
            isLoading={submitting}
          >
            {submitting ? t('blank.submitting') : t('blank.submit')}
          </Button>
        )}
      </>
    );

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        // Closing the copy screen any other way still lands on the
        // automation — the URL is gone from the page either way.
        if (!next && minted !== null) {
          openAutomation(minted.automationSlug);
          return;
        }
        onOpenChange(next);
      }}
      title={t('blank.title')}
      description={
        minted !== null
          ? t('blank.stepWebhook')
          : step === 0
            ? t('blank.stepAgent')
            : t('blank.stepTrigger')
      }
      isSubmitting={submitting}
      isDirty={
        minted === null && (name.trim().length > 0 || prompt.trim().length > 0)
      }
      confirmDiscardOnDirty
      onSubmit={handleSubmit}
      customFooter={footer}
    >
      <div aria-live="polite" className="sr-only">
        {tCommon('stepProgress', {
          current: step + 1,
          total: 2,
          label: step === 0 ? t('blank.stepAgent') : t('blank.stepTrigger'),
        })}
      </div>
      {minted !== null ? (
        <Stack gap={4}>
          <Alert
            variant="warning"
            icon={KeyRound}
            title={t('trigger.tokenTitle')}
            description={t('trigger.tokenHint')}
          />
          <CopyableField
            label={t('trigger.webhookEndpointLabel')}
            value={webhookUrl(minted.token)}
            mono
            copyAriaLabel={t('blank.copyWebhookUrl')}
            description={t('trigger.webhook.sampleEnv')}
          />
        </Stack>
      ) : step === 0 ? (
        <Stack gap={4}>
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
            modal
          />
          <Textarea
            id="blank-automation-prompt"
            label={t('blank.promptLabel')}
            placeholder={t('blank.promptPlaceholder')}
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <SkillsMenu
            skills={capabilities.data?.skills ?? []}
            connectors={capabilities.data?.connectors ?? []}
            tools={toolOptions}
            value={binding}
            onChange={setBinding}
            label={t('blank.equipmentLabel')}
            description={tProjects('agents.equipmentHint')}
            // The menu is portaled outside this dialog; keep its wheel scroll
            // independent from the dialog's scroll lock.
            modal
          />
          <AgentSecretsField
            organizationId={organizationId}
            secrets={orgSecrets ?? []}
            selected={secretNames}
            onChange={setSecretNames}
            disabled={submitting}
          />
          {roster.isError ? (
            <Alert
              variant="destructive"
              description={automationErrorMessage(roster.error)}
            />
          ) : null}
        </Stack>
      ) : (
        <Stack gap={4}>
          <TriggerForm
            surface="wizard"
            draft={trigger}
            stored={null}
            canEdit
            viewerZone={viewerZone}
            runState={{ clean: false, deployed: false, nextRunAt: null }}
            installedIn={installedIn}
            onChange={(patch) =>
              setTriggerDraft((current) => ({ ...current, ...patch }))
            }
            after={
              <TriggerInputPreview
                surface="wizard"
                kind={trigger.kind}
                check={inputCheck}
                version={undefined}
              />
            }
          />
          <Checkbox
            id="blank-automation-enable-now"
            label={t('blank.enableNow')}
            description={t('blank.enableNowHint')}
            checked={trigger.enabled}
            onCheckedChange={(checked) =>
              setTriggerDraft((current) => ({
                ...current,
                enabled: checked === true,
              }))
            }
          />
        </Stack>
      )}
    </FormDialog>
  );
}
