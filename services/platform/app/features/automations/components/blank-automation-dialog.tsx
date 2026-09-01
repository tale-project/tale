'use client';

/**
 * "Blank automation": the manual create lane, as a two-step guided wizard so a
 * user is never dropped straight onto the dense canvas editor. Step 1 defines
 * the agent — name, model, what it does, and what it is equipped with (skills,
 * connectors, platform tools, and secrets); step 2 sets when it runs (the
 * trigger). On finish it scaffolds a one-agent automation with that equipment,
 * sets the trigger, and lands on the detail page for any further refinement.
 * The counterpart to the AI builder: guided decisions up front instead of a
 * full editor at once.
 */

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';

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
import { AgentSecretsField } from '@/app/features/projects/components/agent-secrets-field';
import {
  useAgentSecrets,
  useProjectHarnesses,
} from '@/app/features/projects/hooks/queries';
import {
  findSelectedModel,
  toModelOptions,
} from '@/app/features/projects/lib/model-options';
import { toast } from '@/app/hooks/use-toast';
import { EVENT_TYPES } from '@/backend/core/events/emit';
import { AGENT_TOOL_CATALOG } from '@/backend/core/sandbox/tool_names';
import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';

import { useSaveAutomation, useSetAutomationTrigger } from '../hooks/mutations';
import { useAutomationCapabilities } from '../hooks/queries';
import { automationErrorCode, automationErrorMessage } from '../lib/errors';
import { DEFAULT_HARNESS } from './agent-node-fields';

const EMPTY_BINDING: SkillsSelection = {
  skills: [],
  connectors: [],
  tools: [],
};

const TRIGGER_KINDS = ['schedule', 'webhook', 'event'] as const;
type TriggerKind = (typeof TRIGGER_KINDS)[number];

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
  projectId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { t: tProjects } = useT('projects');
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

  // Step 2 — the trigger.
  const [triggerKind, setTriggerKind] = useState<TriggerKind>('schedule');
  const [cron, setCron] = useState('0 */6 * * *');
  const [timezone, setTimezone] = useState('UTC');
  const [eventName, setEventName] = useState('');

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
    setTriggerKind('schedule');
    setCron('0 */6 * * *');
    setTimezone('UTC');
    setEventName('');
  }, [open]);

  // The grantable platform tools, labelled per name with a read/write badge
  // (the same labels the project-agent dialog uses).
  const toolOptions = useMemo<SkillOption[]>(
    () =>
      AGENT_TOOL_CATALOG.map((tool) => ({
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

  const slug = slugify(name);
  const canSubmitStep1 =
    slug.length > 0 && model !== '' && prompt.trim() !== '';
  const canSubmitStep2 =
    triggerKind === 'webhook' ||
    (triggerKind === 'schedule' ? cron.trim() !== '' : eventName.trim() !== '');

  const doCreate = async (): Promise<void> => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setSubmitting(true);
    // The one-agent scaffold: a valid v1 document carrying the equipment the
    // wizard collected. The harness and anything else are refined on the
    // canvas afterward. The model pick stores the PAIR (`model` +
    // `modelProvider`), so the run is served — and billed — by exactly the
    // provider on screen instead of whichever connector a walk reaches first.
    const automation = {
      version: 1,
      name: slug,
      nodes: [
        {
          id: 'agent',
          type: 'agent',
          model,
          ...(modelProvider !== '' ? { modelProvider } : {}),
          prompt: prompt.trim(),
          ...(binding.skills.length > 0 ? { skills: [...binding.skills] } : {}),
          ...(binding.connectors.length > 0
            ? { connectors: [...binding.connectors] }
            : {}),
          ...(binding.tools.length > 0 ? { tools: [...binding.tools] } : {}),
          ...(secretNames.length > 0 ? { secrets: [...secretNames] } : {}),
        },
      ],
      output: '{{ nodes.agent.output.text }}',
    };
    try {
      const saved = await saveAutomation({
        organizationId,
        automation,
        message: t('blank.initialMessage'),
        // Create-only: refuse rather than append a version to (and rebind the
        // trigger of) a live automation that already holds this slug.
        create: true,
        ...(projectId !== undefined ? { projectId } : {}),
      });
      // Set the trigger the wizard collected. A webhook mints a token shown
      // once on the detail page's Trigger card, so it is not surfaced here.
      try {
        await setTrigger({
          organizationId,
          name: saved.name,
          trigger: {
            kind: triggerKind,
            enabled: true,
            ...(triggerKind === 'schedule'
              ? { cron: cron.trim(), timezone: timezone.trim() || 'UTC' }
              : {}),
            ...(triggerKind === 'event' ? { event: eventName.trim() } : {}),
          },
        });
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
      // The store refuses a create whose name already has versions with a
      // typed code — send the author back to the name step to pick another.
      if (automationErrorCode(error) === 'AUTOMATION_NAME_TAKEN') {
        setStep(0);
        setNameError(t('blank.nameTaken'));
      } else {
        toast({ title: automationErrorMessage(error), variant: 'destructive' });
      }
      creatingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (step === 0) {
      if (canSubmitStep1) setStep(1);
      return;
    }
    if (!canSubmitStep2 || submitting) return;
    void doCreate();
  };

  const footer = (
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
        <Button type="submit" disabled={!canSubmitStep2 || submitting}>
          {submitting ? t('blank.submitting') : t('blank.submit')}
        </Button>
      )}
    </>
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('blank.title')}
      description={step === 0 ? t('blank.stepAgent') : t('blank.stepTrigger')}
      isSubmitting={submitting}
      isDirty={name.trim().length > 0 || prompt.trim().length > 0}
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
      {step === 0 ? (
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
          <Select
            id="blank-automation-trigger-kind"
            label={t('trigger.kindLabel')}
            options={TRIGGER_KINDS.map((value) => ({
              value,
              label: t(`trigger.kinds.${value}`),
            }))}
            value={triggerKind}
            onValueChange={(value) => {
              if (
                value === 'schedule' ||
                value === 'webhook' ||
                value === 'event'
              ) {
                setTriggerKind(value);
              }
            }}
          />
          {triggerKind === 'schedule' ? (
            <>
              <Input
                id="blank-automation-cron"
                label={t('trigger.cronLabel')}
                placeholder="0 */6 * * *"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
              />
              <Input
                id="blank-automation-timezone"
                label={t('trigger.timezoneLabel')}
                placeholder="UTC"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </>
          ) : null}
          {triggerKind === 'event' ? (
            <Select
              id="blank-automation-event"
              label={t('trigger.eventLabel')}
              placeholder={t('trigger.eventPlaceholder')}
              options={EVENT_TYPES.map((value) => ({ value, label: value }))}
              value={eventName}
              onValueChange={(value) => {
                if (value !== '') setEventName(value);
              }}
            />
          ) : null}
          {triggerKind === 'webhook' ? (
            <Alert variant="info" description={t('blank.webhookHint')} />
          ) : null}
        </Stack>
      )}
    </FormDialog>
  );
}
