import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useUpdateAutomationMetadata } from '@/app/features/automations/hooks/use-update-automation-metadata';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Button } from '@/app/components/ui/primitives/button';
import { JsonInput } from '@/app/components/ui/forms/json-input';
import { Stack, Grid, NarrowContainer } from '@/app/components/ui/layout/layout';
import { toast } from '@/app/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { useT } from '@/lib/i18n/client';

interface WorkflowConfig {
  timeout?: number;
  retryPolicy?: {
    maxRetries: number;
    backoffMs: number;
  };
  variables?: Record<string, unknown>;
}

export const Route = createFileRoute(
  '/dashboard/$id/automations/$amId/configuration',
)({
  component: ConfigurationPage,
});

function ConfigurationPage() {
  const { amId } = Route.useParams();
  const automationId = amId as Id<'wfDefinitions'>;
  const { user } = useAuth();

  const { t: tAutomations } = useT('automations');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [timeout, setTimeoutValue] = useState(300000);
  const [maxRetries, setMaxRetries] = useState(3);
  const [backoffMs, setBackoffMs] = useState(1000);
  const [variables, setVariables] = useState(
    '{\n  "environment": "production"\n}',
  );
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const workflow = useQuery(api.wf_definitions.queries.getWorkflow.getWorkflowPublic, {
    wfDefinitionId: automationId,
  });

  const _updateWorkflow = useUpdateAutomationMetadata();

  useEffect(() => {
    if (workflow) {
      setName(workflow.name || '');
      setDescription(workflow.description || '');

      const config = workflow.config as WorkflowConfig;
      if (config) {
        setTimeoutValue(config.timeout || 300000);
        setMaxRetries(config.retryPolicy?.maxRetries || 3);
        setBackoffMs(config.retryPolicy?.backoffMs || 1000);

        if (config.variables) {
          setVariables(JSON.stringify(config.variables, null, 2));
        }
      }
    }
  }, [workflow]);

  useEffect(() => {
    if (!workflow) return;

    const config = workflow.config as WorkflowConfig;
    let currentVariables = {};
    try {
      currentVariables = variables.trim() ? JSON.parse(variables) : {};
    } catch {
      return;
    }

    const changed =
      name !== (workflow.name || '') ||
      description !== (workflow.description || '') ||
      timeout !== (config?.timeout || 300000) ||
      maxRetries !== (config?.retryPolicy?.maxRetries || 3) ||
      backoffMs !== (config?.retryPolicy?.backoffMs || 1000) ||
      JSON.stringify(currentVariables) !==
        JSON.stringify(config?.variables || { environment: 'production' });

    setHasChanges(changed);
  }, [workflow, name, description, timeout, maxRetries, backoffMs, variables]);

  const handleSave = async () => {
    if (!workflow) return;

    if (!user?.userId) {
      toast({
        title: tCommon('errors.generic'),
        variant: 'destructive',
      });
      return;
    }

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

    setIsSaving(true);
    try {
      toast({
        title: tAutomations('configuration.notAvailable.title'),
        description: tAutomations('configuration.notAvailable.message'),
        variant: 'destructive',
      });
      return;
    } catch (error) {
      console.error('Failed to save configuration:', error);
      toast({
        title:
          error instanceof Error ? error.message : tToast('error.saveFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!workflow) {
    return (
      <NarrowContainer className="py-4">
        <Stack gap={4}>
          <Stack gap={2}>
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-9 w-full" />
          </Stack>
          <Stack gap={2}>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-24 w-full" />
          </Stack>
          <Grid cols={2} gap={4}>
            <Stack gap={2}>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-3 w-48" />
            </Stack>
            <Stack gap={2}>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-3 w-40" />
            </Stack>
          </Grid>
          <Stack gap={2}>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-3 w-56" />
          </Stack>
          <Stack gap={2}>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-3 w-72" />
          </Stack>
          <div className="pt-4">
            <Skeleton className="h-9 w-36" />
          </div>
        </Stack>
      </NarrowContainer>
    );
  }

  return (
    <NarrowContainer className="py-4">
      <Stack gap={4}>
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
          <Stack gap={2}>
            <Input
              id="timeout"
              type="number"
              label={tAutomations('configuration.timeout')}
              value={timeout}
              onChange={(e) =>
                setTimeoutValue(parseInt(e.target.value) || 300000)
              }
              placeholder={tAutomations('configuration.timeoutPlaceholder')}
              min={1000}
            />
            <p className="text-xs text-muted-foreground">
              {tAutomations('configuration.timeoutHelp')}
            </p>
          </Stack>

          <Stack gap={2}>
            <Input
              id="maxRetries"
              type="number"
              label={tAutomations('configuration.maxRetries')}
              value={maxRetries}
              onChange={(e) => setMaxRetries(parseInt(e.target.value) || 3)}
              placeholder={tAutomations('configuration.maxRetriesPlaceholder')}
              min={0}
              max={10}
            />
            <p className="text-xs text-muted-foreground">
              {tAutomations('configuration.maxRetriesHelp')}
            </p>
          </Stack>
        </Grid>

        <Stack gap={2}>
          <Input
            id="backoffMs"
            type="number"
            label={tAutomations('configuration.backoff')}
            value={backoffMs}
            onChange={(e) => setBackoffMs(parseInt(e.target.value) || 1000)}
            placeholder={tAutomations('configuration.backoffPlaceholder')}
            min={100}
          />
          <p className="text-xs text-muted-foreground">
            {tAutomations('configuration.backoffHelp')}
          </p>
        </Stack>

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
                <Loader2 className="size-4 mr-2 animate-spin" />
                {tCommon('actions.saving')}
              </>
            ) : (
              tAutomations('configuration.saveButton')
            )}
          </Button>
        </div>
      </Stack>
    </NarrowContainer>
  );
}
