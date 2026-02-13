import { createFileRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';

import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Input } from '@/app/components/ui/forms/input';
import { JsonInput } from '@/app/components/ui/forms/json-input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import {
  Stack,
  Grid,
  NarrowContainer,
} from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { AutomationActiveToggle } from '@/app/features/automations/components/automation-active-toggle';
import { useUpdateAutomation } from '@/app/features/automations/hooks/mutations';
import { useWorkflow } from '@/app/features/automations/hooks/queries';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
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
  const { id: _organizationId, amId } = Route.useParams();
  const automationId = toId<'wfDefinitions'>(amId);
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

  const { data: workflow, isLoading: isWorkflowLoading } =
    useWorkflow(automationId);

  const { mutateAsync: updateWorkflow } = useUpdateAutomation();

  useEffect(() => {
    if (workflow) {
      setName(workflow.name || '');
      setDescription(workflow.description || '');

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex config field uses flexible schema
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

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex config field uses flexible schema
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
      let parsedVariables: Record<string, unknown> | undefined;
      if (variables.trim()) {
        parsedVariables = JSON.parse(variables);
      }

      await updateWorkflow({
        wfDefinitionId: automationId,
        updates: {
          name: name.trim(),
          description: description.trim() || undefined,
          config: {
            timeout,
            retryPolicy: {
              maxRetries,
              backoffMs,
            },
            variables: parsedVariables,
          },
        },
        updatedBy: user.userId,
      });

      setHasChanges(false);
      toast({
        title: tToast('success.saved'),
      });
    } catch (error) {
      console.error('Failed to save configuration:', error);
      toast({
        title: tToast('error.saveFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isWorkflowLoading) {
    return (
      <NarrowContainer className="py-4">
        <Stack gap={4}>
          <Stack gap={2}>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-64" />
          </Stack>
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

  if (!workflow) {
    return null;
  }

  return (
    <NarrowContainer className="py-4">
      <Stack gap={4}>
        <Stack gap={2}>
          <AutomationActiveToggle
            automation={workflow}
            label={tAutomations('configuration.active')}
          />
          <p className="text-muted-foreground text-xs">
            {tAutomations('configuration.activeHelp')}
          </p>
        </Stack>

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
            <p className="text-muted-foreground text-xs">
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
            <p className="text-muted-foreground text-xs">
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
          <p className="text-muted-foreground text-xs">
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
                <Loader2 className="mr-2 size-4 animate-spin" />
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
