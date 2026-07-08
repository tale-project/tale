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
import { WorkflowEnvEditor } from '@/app/features/workflows/components/workflow-env-editor';
import { useSaveWorkflow } from '@/app/features/workflows/hooks/file-mutations';
import { useReadWorkflow } from '@/app/features/workflows/hooks/file-queries';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';
import { urlParamToSlug } from '@/lib/utils/workflow-slug';

export const Route = createFileRoute(
  '/dashboard/$id/workflows/$workflowId/configuration',
)({
  head: () => ({
    meta: seo('workflowConfiguration'),
  }),
  component: ConfigurationPage,
});

/** Runtime settings only — a workflow has no name/description; the owning
 *  automation carries every display string and the spec carries the intent. */
interface ConfigurationForm {
  timeout: number;
  maxRetries: number;
  backoffMs: number;
  variables: string;
}

const CONFIGURATION_FORM_ID = 'workflow-configuration-form';

function ConfigurationPage() {
  const { id: organizationId, workflowId } = Route.useParams();
  const workflowSlug = urlParamToSlug(workflowId);

  const { t: tWorkflows } = useT('workflows');
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
    [tWorkflows],
  );

  const data = useMemo<ConfigurationForm | undefined>(() => {
    if (!config) return undefined;
    return {
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
        toast({
          title: tToast('success.saved.title'),
          description: tToast('success.saved.description'),
          variant: 'success',
        });
      } catch (error) {
        console.error('Failed to save configuration:', error);
        toast({
          title: tToast('error.saveFailed.title'),
          description: tToast('error.saveFailed.description'),
          variant: 'destructive',
        });
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
                    label={tWorkflows('configuration.variables')}
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    description={tWorkflows('configuration.variablesHelp')}
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
          <Text variant="label">{tWorkflows('configuration.env')}</Text>
          <Text variant="caption">{tWorkflows('configuration.envHelp')}</Text>
          <WorkflowEnvEditor
            organizationId={organizationId}
            workflowSlug={workflowSlug}
          />
        </FormSection>
      </ContentArea>
    </Skeletonize>
  );
}
