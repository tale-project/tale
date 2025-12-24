'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { JsonInput } from '@/components/ui/json-input';
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
  const _updateWorkflow = useMutation(api.wf_definitions.updateWorkflowMetadata);

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
    let parsedVariables: Record<string, unknown> = {};
    if (variables.trim()) {
      try {
        parsedVariables = JSON.parse(variables);
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
      <div className="py-4 px-6 max-w-xl mx-auto w-full">
        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-10 w-full" />
          </div>
          {/* Description */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-24 w-full" />
          </div>
          {/* Grid fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-3 w-48" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
          {/* Backoff */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-3 w-56" />
          </div>
          {/* Variables JSON */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-3 w-72" />
          </div>
          {/* Button */}
          <div className="pt-4">
            <Skeleton className="h-10 w-36" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="py-4 px-6 max-w-xl mx-auto w-full">
      <div className="space-y-4">
        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="name">{tAutomations('configuration.name')}</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tAutomations('configuration.namePlaceholder')}
          />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="description">{tAutomations('configuration.description')}</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={tAutomations('configuration.descriptionPlaceholder')}
            rows={4}
          />
        </div>

        {/* Timeout and Max Retries */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="timeout">{tAutomations('configuration.timeout')}</Label>
            <Input
              id="timeout"
              type="number"
              value={timeout}
              onChange={(e) => setTimeout(parseInt(e.target.value) || 300000)}
              placeholder={tAutomations('configuration.timeoutPlaceholder')}
              min={1000}
            />
            <p className="text-xs text-muted-foreground">
              {tAutomations('configuration.timeoutHelp')}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxRetries">{tAutomations('configuration.maxRetries')}</Label>
            <Input
              id="maxRetries"
              type="number"
              value={maxRetries}
              onChange={(e) => setMaxRetries(parseInt(e.target.value) || 3)}
              placeholder={tAutomations('configuration.maxRetriesPlaceholder')}
              min={0}
              max={10}
            />
            <p className="text-xs text-muted-foreground">
              {tAutomations('configuration.maxRetriesHelp')}
            </p>
          </div>
        </div>

        {/* Backoff */}
        <div className="space-y-2">
          <Label htmlFor="backoffMs">{tAutomations('configuration.backoff')}</Label>
          <Input
            id="backoffMs"
            type="number"
            value={backoffMs}
            onChange={(e) => setBackoffMs(parseInt(e.target.value) || 1000)}
            placeholder={tAutomations('configuration.backoffPlaceholder')}
            min={100}
          />
          <p className="text-xs text-muted-foreground">
            {tAutomations('configuration.backoffHelp')}
          </p>
        </div>

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
      </div>
    </div>
  );
}
