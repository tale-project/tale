'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useUpdateAutomationMetadata } from '../../hooks/use-update-automation-metadata';
import { Id } from '@/convex/_generated/dataModel';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { JsonInput } from '@/components/ui/json-input';
import { Stack, Grid, NarrowContainer } from '@/components/ui/layout';
import { toast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-convex-auth';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/lib/i18n';

interface WorkflowConfig {
  timeout?: number;
  retryPolicy?: {
    maxRetries: number;
    backoffMs: number;
  };
  variables?: Record<string, unknown>;
}

export default function ConfigurationPage() {
  const params = useParams();
  const router = useRouter();
  const amId = params?.amId as Id<'wfDefinitions'>;
  const { user } = useAuth();

  const { t: tAutomations } = useT('automations');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [timeout, setTimeout] = useState(300000);
  const [maxRetries, setMaxRetries] = useState(3);
  const [backoffMs, setBackoffMs] = useState(1000);
  const [variables, setVariables] = useState(
    '{\n  "environment": "production"\n}',
  );
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch workflow data (public API)
  const workflow = useQuery(api.wf_definitions.getWorkflowPublic, {
    wfDefinitionId: amId,
  });

  // Only metadata updates are allowed from the client today.
  // This mutation is currently unused but kept here as a placeholder
  // in case we later expose a public update endpoint.
  const _updateWorkflow = useUpdateAutomationMetadata();

  // Load workflow data into form
  useEffect(() => {
    if (workflow) {
      setName(workflow.name || '');
      setDescription(workflow.description || '');

      const config = workflow.config as WorkflowConfig;
      if (config) {
        setTimeout(config.timeout || 300000);
        setMaxRetries(config.retryPolicy?.maxRetries || 3);
        setBackoffMs(config.retryPolicy?.backoffMs || 1000);

        if (config.variables) {
          setVariables(JSON.stringify(config.variables, null, 2));
        }
      }
    }
  }, [workflow]);

  // Track changes
  useEffect(() => {
    if (!workflow) return;

    const config = workflow.config as WorkflowConfig;
    const currentVariables = variables.trim() ? JSON.parse(variables) : {};

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

    if (!user?._id) {
      toast({
        title: tCommon('errors.generic'),
        variant: 'destructive',
      });
      return;
    }

    // Validate name
    if (!name.trim()) {
      toast({
        title: tAutomations('configuration.validation.nameRequired'),
        variant: 'destructive',
      });
      return;
    }

    // Validate and parse variables JSON
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
      // NOTE: There is currently no public Convex mutation that allows
      // updating workflow config from the client. The existing internal
      // mutations (updateWorkflow / updateDraft) are intentionally not
      // exposed via the public `api` object.
      //
      // To avoid calling non-existent client APIs (and breaking `npm run build`),
      // we temporarily disable the actual save call here. The UI validation
      // still runs and we show a clear error to the user.
      toast({
        title: tAutomations('configuration.notAvailable.title'),
        description: tAutomations('configuration.notAvailable.message'),
        variant: 'destructive',
      });

      // When a public mutation is introduced (e.g. api.wf_definitions.updateWorkflowConfigPublic),
      // replace the above block with a real call similar to:
      // await updateWorkflow({ wfDefinitionId: amId, name, description, config: { timeout, retryPolicy, variables } });

      return;

      toast({
        title: tToast('success.saved'),
        variant: 'success',
      });

      setHasChanges(false);
      router.refresh();
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

  const _handleCancel = () => {
    if (workflow) {
      setName(workflow.name || '');
      setDescription(workflow.description || '');

      const config = workflow.config as WorkflowConfig;
      if (config) {
        setTimeout(config.timeout || 300000);
        setMaxRetries(config.retryPolicy?.maxRetries || 3);
        setBackoffMs(config.retryPolicy?.backoffMs || 1000);

        if (config.variables) {
          setVariables(JSON.stringify(config.variables, null, 2));
        } else {
          setVariables('{\n  "environment": "production"\n}');
        }
      }
    }
    setHasChanges(false);
  };

  // Show skeleton while loading - matches form layout to prevent CLS
  if (!workflow) {
    return (
      <NarrowContainer className="py-4">
        <Stack gap={4}>
          {/* Name */}
          <Stack gap={2}>
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-10 w-full" />
          </Stack>
          {/* Description */}
          <Stack gap={2}>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-24 w-full" />
          </Stack>
          {/* Grid fields */}
          <Grid cols={2} gap={4}>
            <Stack gap={2}>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-3 w-48" />
            </Stack>
            <Stack gap={2}>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-3 w-40" />
            </Stack>
          </Grid>
          {/* Backoff */}
          <Stack gap={2}>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-3 w-56" />
          </Stack>
          {/* Variables JSON */}
          <Stack gap={2}>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-3 w-72" />
          </Stack>
          {/* Button */}
          <div className="pt-4">
            <Skeleton className="h-10 w-36" />
          </div>
        </Stack>
      </NarrowContainer>
    );
  }

  return (
    <NarrowContainer className="py-4">
      <Stack gap={4}>
        {/* Name */}
        <Input
          id="name"
          label={tAutomations('configuration.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={tAutomations('configuration.namePlaceholder')}
        />

        {/* Description */}
        <Textarea
          id="description"
          label={tAutomations('configuration.description')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={tAutomations('configuration.descriptionPlaceholder')}
          rows={4}
        />

        {/* Timeout and Max Retries */}
        <Grid cols={2} gap={4}>
          <Stack gap={2}>
            <Input
              id="timeout"
              type="number"
              label={tAutomations('configuration.timeout')}
              value={timeout}
              onChange={(e) => setTimeout(parseInt(e.target.value) || 300000)}
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

        {/* Backoff */}
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

        {/* Variables */}
        <JsonInput
          id="variables"
          label={tAutomations('configuration.variables')}
          value={variables}
          onChange={setVariables}
          description={tAutomations('configuration.variablesHelp')}
        />

        {/* Actions */}
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
