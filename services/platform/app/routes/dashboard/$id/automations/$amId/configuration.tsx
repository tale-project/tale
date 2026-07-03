import { Grid, Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';

import { ContentArea } from '@/app/components/layout/content-area';
import {
  useFormEditor,
  useRegisterActiveEditor,
} from '@/app/components/ui/editor';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { JsonInput } from '@/app/components/ui/forms/json-input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { WorkflowEnvEditor } from '@/app/features/automations/components/workflow-env-editor';
import { useSaveWorkflow } from '@/app/features/automations/hooks/file-mutations';
import { useReadWorkflow } from '@/app/features/automations/hooks/file-queries';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';
import { urlParamToSlug } from '@/lib/utils/workflow-slug';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$amId/configuration',
)({
  head: () => ({
    meta: seo('automationConfiguration'),
  }),
  component: ConfigurationPage,
});

interface ConfigurationForm {
  name: string;
  description: string;
  timeout: number;
  maxRetries: number;
  backoffMs: number;
  variables: string;
}

const CONFIGURATION_FORM_ID = 'automation-configuration-form';

function ConfigurationPage() {
  const { id: organizationId, amId } = Route.useParams();
  const workflowSlug = urlParamToSlug(amId);

  const { t: tAutomations } = useT('automations');
  const { t: tToast } = useT('toast');

  const {
    data: readResult,
    isLoading,
    refetch,
  } = useReadWorkflow(organizationId, workflowSlug);
  const { mutateAsync: saveWorkflow } = useSaveWorkflow();

  const config = readResult && readResult.ok ? readResult.config : undefined;

  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, tAutomations('configuration.validation.nameRequired')),
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
          { message: tAutomations('configuration.validation.invalidJson') },
        ),
      }),
    [tAutomations],
  );

  const data = useMemo<ConfigurationForm | undefined>(() => {
    if (!config) return undefined;
    return {
      name: config.name ?? '',
      description: config.description ?? '',
      timeout: config.config?.timeout ?? 300000,
      maxRetries: config.config?.retryPolicy?.maxRetries ?? 3,
      backoffMs: config.config?.retryPolicy?.backoffMs ?? 1000,
      variables: JSON.stringify(
        config.config?.variables ?? { environment: 'production' },
        null,
        2,
      ),
    };
  }, [config]);

  const save = useCallback(
    async (values: ConfigurationForm) => {
      if (!config) return;
      let parsedVariables: Record<string, unknown> | undefined;
      if (values.variables.trim()) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- schema already validated this parses
        parsedVariables = JSON.parse(values.variables) as Record<
          string,
          unknown
        >;
      }
      try {
        await saveWorkflow({
          organizationId,
          workflowSlug,
          config: {
            ...config,
            name: values.name.trim(),
            description: values.description.trim() || undefined,
            config: {
              ...config.config,
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
        await refetch();
        toast({ title: tToast('success.saved'), variant: 'success' });
      } catch (error) {
        console.error('Failed to save configuration:', error);
        toast({ title: tToast('error.saveFailed'), variant: 'destructive' });
        throw error;
      }
    },
    [
      config,
      organizationId,
      readResult,
      refetch,
      saveWorkflow,
      tToast,
      workflowSlug,
    ],
  );

  const editor = useFormEditor<ConfigurationForm>({
    data,
    schema,
    save,
  });

  useRegisterActiveEditor(editor);

  const {
    form: {
      register,
      formState: { errors },
      control,
    },
  } = editor;

  // Genuine not-found (resolved, no config): nothing to render.
  if (!isLoading && !config) return null;

  // Render the REAL form once, always. While loading, the skeleton-aware form
  // controls (Input/Textarea/JsonInput) mask themselves in place; the static
  // labels and help text stay real text.
  return (
    <Skeletonize loading={isLoading}>
      <ContentArea variant="narrow" gap={4}>
        <form id={CONFIGURATION_FORM_ID} onSubmit={editor.submit}>
          <fieldset
            disabled={isLoading || editor.isLoading || editor.isSaving}
            className="contents"
          >
            {/* The fieldset is `display:contents` (so it can disable the whole
                form without adding a box), which means `space-y` on the form
                can't reach these fields — wrap them in a Stack so every field,
                including the timeout / max-retries grid, gets consistent
                vertical spacing instead of butting together. */}
            <Stack gap={5}>
              <Input
                id="name"
                label={tAutomations('configuration.name')}
                placeholder={tAutomations('configuration.namePlaceholder')}
                errorMessage={errors.name?.message}
                {...register('name')}
              />

              <Textarea
                id="description"
                label={tAutomations('configuration.description')}
                placeholder={tAutomations(
                  'configuration.descriptionPlaceholder',
                )}
                rows={4}
                errorMessage={errors.description?.message}
                {...register('description')}
              />

              <Grid cols={2} gap={4}>
                <FormSection>
                  <Input
                    id="timeout"
                    type="number"
                    label={tAutomations('configuration.timeout')}
                    min={1000}
                    errorMessage={errors.timeout?.message}
                    {...register('timeout', { valueAsNumber: true })}
                  />
                  <Text variant="caption">
                    {tAutomations('configuration.timeoutHelp')}
                  </Text>
                </FormSection>

                <FormSection>
                  <Input
                    id="maxRetries"
                    type="number"
                    label={tAutomations('configuration.maxRetries')}
                    min={0}
                    max={10}
                    errorMessage={errors.maxRetries?.message}
                    {...register('maxRetries', { valueAsNumber: true })}
                  />
                  <Text variant="caption">
                    {tAutomations('configuration.maxRetriesHelp')}
                  </Text>
                </FormSection>
              </Grid>

              <FormSection>
                <Input
                  id="backoffMs"
                  type="number"
                  label={tAutomations('configuration.backoff')}
                  min={100}
                  errorMessage={errors.backoffMs?.message}
                  {...register('backoffMs', { valueAsNumber: true })}
                />
                <Text variant="caption">
                  {tAutomations('configuration.backoffHelp')}
                </Text>
              </FormSection>

              {/* Controlled via RHF `Controller`: the field registers itself,
                  so dirty tracking is automatic and validation runs on the
                  shared `mode: 'onTouched'` default — no `setValue(..., {
                  shouldDirty, shouldValidate })` to forget. */}
              <Controller
                control={control}
                name="variables"
                render={({ field }) => (
                  <JsonInput
                    id="variables"
                    label={tAutomations('configuration.variables')}
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    description={tAutomations('configuration.variablesHelp')}
                    errorMessage={errors.variables?.message}
                  />
                )}
              />
            </Stack>
          </fieldset>
        </form>

        {/* Workflow-level env & secrets, auto-injected into EVERY sandbox step.
            Lives outside the RHF form: it writes straight to the workflowEnv
            side-table (encrypt-on-save for secrets), independent of the file
            save above. */}
        <FormSection>
          <Text variant="label">{tAutomations('configuration.env')}</Text>
          <Text variant="caption">{tAutomations('configuration.envHelp')}</Text>
          <WorkflowEnvEditor
            organizationId={organizationId}
            workflowSlug={workflowSlug}
          />
        </FormSection>
      </ContentArea>
    </Skeletonize>
  );
}
