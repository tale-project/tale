'use client';

/**
 * The "Configuration" tab of an installed automation — where the AUTOMATION's
 * identity is edited: its manifest `name` + `description` (the automation's
 * only user-facing strings; its inline workflow carries none — the workflow
 * has just a specification, edited on the Editor tab). For a developer the
 * identity fields are one form with the workflow's runtime settings (timeout /
 * retries / variables) and save through the tab strip's shared Save cluster
 * (the active-editor pattern every settings page uses); everyone else sees the
 * identity read-only. Below: the control-panel sections — Agents (readiness
 * rows, falling back to the manifest cast) and Skills, each row linking to the
 * resource's own management surface (Integrations have their own tab). A bare
 * automation gets a localized empty state below the identity block. Workflow
 * env/secrets close the tab for developers (their own side-table, saved
 * independently of the form).
 */
import { Badge } from '@tale/ui/badge';
import { Card } from '@tale/ui/card';
import { Grid, HStack, Stack, VStack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { Bot, Sparkles } from 'lucide-react';
import { type ReactNode, useCallback, useMemo } from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';

import {
  useFormEditor,
  useRegisterActiveEditor,
} from '@/app/components/ui/editor';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { JsonInput } from '@/app/components/ui/forms/json-input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { WorkflowEnvEditor } from '@/app/features/workflows/components/workflow-env-editor';
import { useSaveWorkflow } from '@/app/features/workflows/hooks/file-mutations';
import { useReadWorkflow } from '@/app/features/workflows/hooks/file-queries';
import { useAbility } from '@/app/hooks/use-ability';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { startCase } from '@/lib/utils/string';

import { useAutomationAgentReadiness } from '../hooks/use-automation-agent-readiness';
import { useAutomationDisplay } from '../hooks/use-automation-text';
import {
  type AutomationSummary,
  useInvalidateAutomations,
} from '../hooks/use-automations';
import { useUpdateAutomationIdentity } from '../hooks/use-update-automation-identity';

/** A labelled group of resource rows; hidden entirely when it has no rows. */
function ConfigurationSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <VStack gap={2}>
      <Text className="font-medium">{title}</Text>
      <VStack gap={2}>{children}</VStack>
    </VStack>
  );
}

/**
 * One resource row — the membership-hub card anatomy: a kind icon, the name
 * as the row's link, the slug muted underneath, a status badge on the right.
 */
function ConfigurationRow({
  icon: Icon,
  link,
  slug,
  badge,
}: {
  icon: LucideIcon;
  /** The row's name, already wrapped in its `<Link>`. */
  link: ReactNode;
  slug: string;
  badge?: ReactNode;
}) {
  return (
    <Card className="py-3">
      <HStack className="items-center justify-between gap-3">
        <HStack gap={3} className="min-w-0 items-center">
          <Icon
            aria-hidden="true"
            className="text-muted-foreground size-4 shrink-0"
          />
          <VStack gap={0} className="min-w-0">
            {link}
            <Text variant="muted" className="truncate text-sm">
              {slug}
            </Text>
          </VStack>
        </HStack>
        {badge}
      </HStack>
    </Card>
  );
}

/** Name + description, read-only — for viewers without developer access. */
function IdentitySection({ automation }: { automation: AutomationSummary }) {
  const { t } = useT('automations');
  const display = useAutomationDisplay()(automation);
  return (
    <VStack gap={4}>
      <VStack gap={1}>
        <Text variant="muted" className="text-sm">
          {t('configuration.nameLabel')}
        </Text>
        <Text>{display.name}</Text>
      </VStack>
      {display.description && (
        <VStack gap={1}>
          <Text variant="muted" className="text-sm">
            {t('configuration.descriptionLabel')}
          </Text>
          <Text>{display.description}</Text>
        </VStack>
      )}
    </VStack>
  );
}

interface ConfigurationForm {
  name: string;
  description: string;
  timeout: number;
  maxRetries: number;
  backoffMs: number;
  variables: string;
}

const CONFIGURATION_FORM_ID = 'automation-configuration-form';

/**
 * The developer's combined form: automation identity (writes the manifest via
 * `updateAutomationIdentity` — editing the ENGLISH literals; stale per-locale
 * overrides of the edited fields are dropped server-side) plus, when the
 * automation has a workflow, its runtime settings (written to the inline
 * workflow definition). One controller, one Save in the tab strip.
 */
function ConfigurationEditor({
  organizationId,
  automationSlug,
  automation,
  workflowSlug,
}: {
  organizationId: string;
  automationSlug: string;
  automation: AutomationSummary;
  workflowSlug?: string;
}) {
  const { t } = useT('automations');
  const { t: tWorkflows } = useT('workflows');
  const { t: tToast } = useT('toast');
  const invalidateAutomations = useInvalidateAutomations();
  const { mutateAsync: updateIdentity } = useUpdateAutomationIdentity();
  const { mutateAsync: saveWorkflow } = useSaveWorkflow();

  // `useReadWorkflow` needs a slug; a view-only automation skips the runtime
  // fields entirely (the query is disabled through the empty-slug guard the
  // hook applies to every action query).
  const hasWorkflow = workflowSlug !== undefined;
  const {
    data: readResult,
    isLoading: workflowLoading,
    refetch: refetchWorkflow,
  } = useReadWorkflow(organizationId, workflowSlug ?? '');
  const workflowConfig =
    hasWorkflow && readResult && readResult.ok ? readResult.config : undefined;

  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, t('configuration.validation.nameRequired')),
        description: z.string(),
        timeout: z.number().int().min(1000),
        maxRetries: z.number().int().min(0).max(10),
        backoffMs: z.number().int().min(100),
        variables: z.string().refine(
          (value) => {
            if (!value.trim()) return true;
            try {
              JSON.parse(value);
              return true;
            } catch {
              return false;
            }
          },
          { message: tWorkflows('configuration.validation.invalidJson') },
        ),
      }),
    [t, tWorkflows],
  );

  const data = useMemo<ConfigurationForm | undefined>(() => {
    // Wait for the workflow read before seeding the form — otherwise the
    // runtime fields would flash defaults, then dirty themselves on load.
    if (hasWorkflow && !workflowConfig && workflowLoading) return undefined;
    return {
      // The RAW manifest literals — the edit target — never the localized
      // display strings (`useAutomationDisplay`).
      name: automation.name,
      description: automation.description ?? '',
      timeout: workflowConfig?.config?.timeout ?? 300000,
      maxRetries: workflowConfig?.config?.retryPolicy?.maxRetries ?? 3,
      backoffMs: workflowConfig?.config?.retryPolicy?.backoffMs ?? 1000,
      variables: JSON.stringify(
        workflowConfig?.config?.variables ?? {},
        null,
        2,
      ),
    };
  }, [automation, hasWorkflow, workflowConfig, workflowLoading]);

  const save = useCallback(
    async (values: ConfigurationForm) => {
      try {
        await updateIdentity({
          organizationId,
          slug: automationSlug,
          name: values.name.trim(),
          ...(values.description.trim() && {
            description: values.description.trim(),
          }),
        });
        if (hasWorkflow && workflowConfig && workflowSlug !== undefined) {
          let parsedVariables: Record<string, unknown> | undefined;
          if (values.variables.trim()) {
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- schema already validated this parses
            parsedVariables = JSON.parse(values.variables) as Record<
              string,
              unknown
            >;
          }
          await saveWorkflow({
            organizationId,
            workflowSlug,
            config: {
              ...workflowConfig,
              config: {
                ...workflowConfig.config,
                timeout: values.timeout,
                retryPolicy: {
                  maxRetries: values.maxRetries,
                  backoffMs: values.backoffMs,
                },
                variables: parsedVariables,
              },
            },
            expectedHash:
              readResult && readResult.ok ? readResult.hash : undefined,
          });
          await refetchWorkflow();
        }
        await invalidateAutomations(organizationId);
        toast({
          title: tToast('success.saved.title'),
          description: tToast('success.saved.description'),
          variant: 'success',
        });
      } catch (error) {
        console.error('Failed to save automation configuration:', error);
        toast({
          title: tToast('error.saveFailed.title'),
          description: tToast('error.saveFailed.description'),
          variant: 'destructive',
        });
        throw error;
      }
    },
    [
      automationSlug,
      hasWorkflow,
      invalidateAutomations,
      organizationId,
      readResult,
      refetchWorkflow,
      saveWorkflow,
      tToast,
      updateIdentity,
      workflowConfig,
      workflowSlug,
    ],
  );

  const editor = useFormEditor<ConfigurationForm>({ data, schema, save });
  useRegisterActiveEditor(editor);

  const {
    form: {
      register,
      formState: { errors },
      control,
    },
  } = editor;

  const isLoading = data === undefined;

  return (
    <Skeletonize loading={isLoading}>
      <form id={CONFIGURATION_FORM_ID} onSubmit={editor.submit}>
        <fieldset
          disabled={isLoading || editor.isLoading || editor.isSaving}
          className="contents"
        >
          <Stack gap={5}>
            <Input
              id="name"
              label={t('configuration.nameLabel')}
              placeholder={t('configuration.namePlaceholder')}
              errorMessage={errors.name?.message}
              {...register('name')}
            />
            <Textarea
              id="description"
              label={t('configuration.descriptionLabel')}
              placeholder={t('configuration.descriptionPlaceholder')}
              rows={3}
              errorMessage={errors.description?.message}
              {...register('description')}
            />

            {hasWorkflow && (
              <>
                <Text className="font-medium">
                  {t('configuration.runtimeTitle')}
                </Text>
                <Grid cols={2} gap={4}>
                  <FormSection>
                    <Input
                      id="timeout"
                      type="number"
                      label={tWorkflows('configuration.timeout')}
                      min={1000}
                      errorMessage={errors.timeout?.message}
                      {...register('timeout', { valueAsNumber: true })}
                    />
                    <Text variant="caption">
                      {tWorkflows('configuration.timeoutHelp')}
                    </Text>
                  </FormSection>
                  <FormSection>
                    <Input
                      id="maxRetries"
                      type="number"
                      label={tWorkflows('configuration.maxRetries')}
                      min={0}
                      max={10}
                      errorMessage={errors.maxRetries?.message}
                      {...register('maxRetries', { valueAsNumber: true })}
                    />
                    <Text variant="caption">
                      {tWorkflows('configuration.maxRetriesHelp')}
                    </Text>
                  </FormSection>
                </Grid>
                <FormSection>
                  <Input
                    id="backoffMs"
                    type="number"
                    label={tWorkflows('configuration.backoff')}
                    min={100}
                    errorMessage={errors.backoffMs?.message}
                    {...register('backoffMs', { valueAsNumber: true })}
                  />
                  <Text variant="caption">
                    {tWorkflows('configuration.backoffHelp')}
                  </Text>
                </FormSection>
                <Controller
                  control={control}
                  name="variables"
                  render={({ field }) => (
                    <JsonInput
                      id="variables"
                      label={tWorkflows('configuration.variables')}
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      description={tWorkflows('configuration.variablesHelp')}
                      errorMessage={errors.variables?.message}
                    />
                  )}
                />
              </>
            )}
          </Stack>
        </fieldset>
      </form>
    </Skeletonize>
  );
}

export function AutomationConfiguration({
  organizationId,
  automationSlug,
  automation,
}: {
  organizationId: string;
  automationSlug: string;
  automation: AutomationSummary;
}) {
  const { t } = useT('automations');
  const { t: tWorkflows } = useT('workflows');
  const ability = useAbility();
  const isDeveloper = ability.can('read', 'developerSettings');
  const workflowSlug = automation.workflows[0];
  const { agents: agentReadiness } = useAutomationAgentReadiness(
    organizationId,
    automationSlug,
  );

  // Readiness rows carry display names + per-agent status; until they load
  // (or when the action yields nothing), fall back to the manifest cast so
  // the section never blanks for an automation that declares agents.
  const agentRows =
    agentReadiness.length > 0
      ? agentReadiness.map((agent) => ({
          slug: agent.agentSlug,
          name: agent.displayName,
          badge: agent.ready ? (
            <Badge variant="green">{t('configuration.status.ready')}</Badge>
          ) : (
            <Badge variant="yellow">
              {t('configuration.status.needsSetup')}
            </Badge>
          ),
        }))
      : automation.agents.map((slug) => ({
          slug,
          name: startCase(slug),
          badge: undefined,
        }));

  return (
    <VStack gap={6}>
      {isDeveloper ? (
        <ConfigurationEditor
          organizationId={organizationId}
          automationSlug={automationSlug}
          automation={automation}
          workflowSlug={workflowSlug}
        />
      ) : (
        <IdentitySection automation={automation} />
      )}

      {agentRows.length > 0 && (
        <ConfigurationSection title={t('configuration.agentsTitle')}>
          {agentRows.map((agent) => (
            <ConfigurationRow
              key={agent.slug}
              icon={Bot}
              slug={agent.slug}
              badge={agent.badge}
              link={
                <Link
                  to="/dashboard/$id/agents/$agentId"
                  params={{ id: organizationId, agentId: agent.slug }}
                  className="min-w-0 truncate font-medium hover:underline"
                >
                  {agent.name}
                </Link>
              }
            />
          ))}
        </ConfigurationSection>
      )}

      {automation.skills.length > 0 && (
        <ConfigurationSection title={t('configuration.skillsTitle')}>
          {automation.skills.map((slug) => (
            <ConfigurationRow
              key={slug}
              icon={Sparkles}
              slug={slug}
              link={
                <Link
                  to="/dashboard/$id/settings/skills"
                  params={{ id: organizationId }}
                  search={{ slug }}
                  className="min-w-0 truncate font-medium hover:underline"
                >
                  {startCase(slug)}
                </Link>
              }
            />
          ))}
        </ConfigurationSection>
      )}

      {isDeveloper && workflowSlug !== undefined && (
        <FormSection>
          <Text variant="label">{tWorkflows('configuration.env')}</Text>
          <Text variant="caption">{tWorkflows('configuration.envHelp')}</Text>
          <WorkflowEnvEditor
            organizationId={organizationId}
            workflowSlug={workflowSlug}
          />
        </FormSection>
      )}
    </VStack>
  );
}
