import { createFileRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { JsonInput } from '@/app/components/ui/forms/json-input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Grid } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
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

function ConfigurationPage() {
  const { amId } = Route.useParams();
  const workflowSlug = urlParamToSlug(amId);

  const { t: tAutomations } = useT('automations');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');

  const {
    data: readResult,
    isLoading,
    refetch,
  } = useReadWorkflow('default', workflowSlug);
  const { mutateAsync: saveWorkflow, isPending: isSaving } = useSaveWorkflow();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [timeout, setTimeoutValue] = useState(300000);
  const [maxRetries, setMaxRetries] = useState(3);
  const [backoffMs, setBackoffMs] = useState(1000);
  const [variables, setVariables] = useState(
    '{\n  "environment": "production"\n}',
  );
  const [hasChanges, setHasChanges] = useState(false);

  const config = readResult && readResult.ok ? readResult.config : undefined;

  useEffect(() => {
    if (config) {
      setName(config.name || '');
      setDescription(config.description || '');
      if (config.config) {
        setTimeoutValue(config.config.timeout || 300000);
        setMaxRetries(config.config.retryPolicy?.maxRetries || 3);
        setBackoffMs(config.config.retryPolicy?.backoffMs || 1000);
        if (config.config.variables) {
          setVariables(JSON.stringify(config.config.variables, null, 2));
        }
      }
    }
  }, [config]);

  useEffect(() => {
    if (!config) return;
    let currentVariables = {};
    try {
      currentVariables = variables.trim() ? JSON.parse(variables) : {};
    } catch {
      return;
    }

    const changed =
      name !== (config.name || '') ||
      description !== (config.description || '') ||
      timeout !== (config.config?.timeout || 300000) ||
      maxRetries !== (config.config?.retryPolicy?.maxRetries || 3) ||
      backoffMs !== (config.config?.retryPolicy?.backoffMs || 1000) ||
      JSON.stringify(currentVariables) !==
        JSON.stringify(
          config.config?.variables || { environment: 'production' },
        );

    setHasChanges(changed);
  }, [config, name, description, timeout, maxRetries, backoffMs, variables]);

  const handleSave = async () => {
    window.__taleLastSaveAt = Date.now();
    if (!config) return;

    if (!name.trim()) {
      toast({
        title: tAutomations('configuration.validation.nameRequired'),
        variant: 'destructive',
      });
      return;
    }

    if (variables.trim()) {
      try {
        JSON.parse(variables);
      } catch {
        toast({
          title: tAutomations('configuration.validation.invalidJson'),
          variant: 'destructive',
        });
        return;
      }
    }

    try {
      let parsedVariables: Record<string, unknown> | undefined;
      if (variables.trim()) {
        parsedVariables = JSON.parse(variables);
      }

      await saveWorkflow({
        orgSlug: 'default',
        workflowSlug,
        config: {
          ...config,
          name: name.trim(),
          description: description.trim() || undefined,
          config: {
            ...config.config,
            timeout,
            retryPolicy: { maxRetries, backoffMs },
            variables: parsedVariables,
          },
        },
        expectedHash: readResult && readResult.ok ? readResult.hash : undefined,
      });

      setHasChanges(false);
      await refetch();
      toast({ title: tToast('success.saved') });
    } catch (error) {
      console.error('Failed to save configuration:', error);
      toast({
        title: tToast('error.saveFailed'),
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <ContentArea variant="narrow" gap={4}>
        <FormSection>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-64" />
        </FormSection>
        <FormSection>
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-9 w-full" />
        </FormSection>
      </ContentArea>
    );
  }

  if (!config) return null;

  return (
    <ContentArea variant="narrow" gap={4}>
      <Input
        id="name"
        label={tAutomations('configuration.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={tAutomations('configuration.namePlaceholder')}
      />

      <Textarea
        id="description"
        label={tAutomations('configuration.description')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={tAutomations('configuration.descriptionPlaceholder')}
        rows={4}
      />

      <Grid cols={2} gap={4}>
        <FormSection>
          <Input
            id="timeout"
            type="number"
            label={tAutomations('configuration.timeout')}
            value={timeout}
            onChange={(e) =>
              setTimeoutValue(parseInt(e.target.value) || 300000)
            }
            min={1000}
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
            value={maxRetries}
            onChange={(e) => setMaxRetries(parseInt(e.target.value) || 3)}
            min={0}
            max={10}
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
          value={backoffMs}
          onChange={(e) => setBackoffMs(parseInt(e.target.value) || 1000)}
          min={100}
        />
        <Text variant="caption">
          {tAutomations('configuration.backoffHelp')}
        </Text>
      </FormSection>

      <JsonInput
        id="variables"
        label={tAutomations('configuration.variables')}
        value={variables}
        onChange={setVariables}
        description={tAutomations('configuration.variablesHelp')}
      />

      <div className="pt-4">
        <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
          {isSaving ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              {tCommon('actions.saving')}
            </>
          ) : (
            tAutomations('configuration.saveButton')
          )}
        </Button>
      </div>
    </ContentArea>
  );
}
