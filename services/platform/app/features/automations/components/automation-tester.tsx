'use client';

import { BorderedSection } from '@tale/ui/bordered-section';
import { Button } from '@tale/ui/button';
import { HStack, Stack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import {
  Search,
  Play,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { JsonInput } from '@/app/components/ui/forms/json-input';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useStartWorkflowFromFile } from '../hooks/file-mutations';
import { useReadWorkflow } from '../hooks/file-queries';
import { useExecutionStatus } from '../hooks/queries';
import {
  buildInputTemplateFromSchema,
  getMissingRequiredFields,
  type InputSchema,
} from '../utils/input-schema-template';
import { getStepTypeColor } from '../utils/step-icons';

interface AutomationTesterProps {
  organizationId: string;
  workflowSlug: string;
  onTestComplete?: () => void;
}

interface DryRunStepResult {
  stepSlug: string;
  stepType: string;
  name: string;
  mocked: boolean;
  wouldExecute: boolean;
  simulatedOutput: unknown;
  nextStep: string | null;
  branch?: string;
}

interface DryRunResult {
  success: boolean;
  executionPath: string[];
  stepResults: DryRunStepResult[];
  errors: string[];
  warnings: string[];
}

export function AutomationTester({
  organizationId,
  workflowSlug,
  onTestComplete,
}: AutomationTesterProps) {
  const { t } = useT('automations');

  const { data: workflowRead } = useReadWorkflow(organizationId, workflowSlug);

  const inputSchema = useMemo<InputSchema | undefined>(() => {
    if (!workflowRead?.ok) return undefined;
    const startStep = workflowRead.config.steps?.find(
      (s) => s.stepType === 'start',
    );
    const startConfig = startStep?.config as
      | { inputSchema?: InputSchema }
      | undefined;
    return startConfig?.inputSchema;
  }, [workflowRead]);

  const inputTemplate = useMemo(
    () => buildInputTemplateFromSchema(inputSchema),
    [inputSchema],
  );

  // Persist per (org, workflow) so a tester reopening the panel sees the
  // last input they ran with — typical iteration is "tweak, run, tweak, run"
  // on the same payload.
  const storageKey = `tale.automation-tester.input.${organizationId}.${workflowSlug}`;
  const [testInput, setTestInput] = usePersistedState(storageKey, '{}');

  // Pre-fill from inputSchema only the very first time this workflow's
  // tester is opened. We can't gate on `testInput === '{}'` here — that
  // races with usePersistedState's own hydration effect (it would overwrite
  // the cached value with the template before hydration commits, then the
  // hook's persist effect would write the template back to storage and the
  // cache would be lost forever). Reading localStorage directly avoids the
  // race because it's the same source of truth the hook uses.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (inputTemplate === '{}') return;
    if (window.localStorage.getItem(storageKey) !== null) return;
    setTestInput(inputTemplate);
  }, [inputTemplate, storageKey, setTestInput]);

  const [isDryRunning, setIsDryRunning] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);

  // The just-started execution, subscribed reactively so the panel shows the
  // run progress to completed/failed (with the failing step + error) instead
  // of firing and forgetting (#1484).
  const [activeExecutionId, setActiveExecutionId] =
    useState<Id<'wfExecutions'> | null>(null);
  const { data: executionStatus } = useExecutionStatus(
    activeExecutionId ?? undefined,
  );

  const { mutateAsync: startWorkflow, isPending: isExecuting } =
    useStartWorkflowFromFile();

  const parsedInput = (() => {
    try {
      return JSON.parse(testInput);
    } catch {
      return null;
    }
  })();

  // Gate execution: the input must be valid JSON and every required field
  // from the start node's inputSchema must be configured. Without this, the
  // buttons fire with missing/invalid input and the run only fails downstream.
  const isJsonValid = parsedInput !== null;
  const missingRequiredFields = getMissingRequiredFields(
    inputSchema,
    parsedInput,
  );
  const canRun = isJsonValid && missingRequiredFields.length === 0;

  // TODO: Migrate dry run to file-based workflow system
  const handleDryRun = async () => {
    if (!parsedInput) {
      toast({
        title: t('tester.toast.invalidJson'),
        description: t('tester.toast.invalidJsonDescription'),
        variant: 'destructive',
      });
      return;
    }

    setIsDryRunning(true);
    setDryRunResult(null);
    setActiveExecutionId(null);

    toast({
      title: t('tester.dryRun.button'),
      description: t('tester.dryRun.fileBasedUnsupported'),
      variant: 'destructive',
    });
    setIsDryRunning(false);
  };

  const handleExecute = async () => {
    setActiveExecutionId(null);
    let input = {};
    try {
      input = JSON.parse(testInput);
    } catch {
      toast({
        title: t('tester.toast.invalidJson'),
        description: t('tester.toast.invalidJsonDescription'),
        variant: 'destructive',
      });
      return;
    }

    try {
      const executionId = await startWorkflow({
        organizationId,
        workflowSlug,
        input,
        triggeredBy: 'test',
        triggerData: {
          triggerType: 'manual',
          reason: 'test',
          timestamp: Date.now(),
        },
      });

      if (!executionId) {
        toast({
          title: t('tester.toast.testFailed'),
          description: t('tester.toast.startFailed'),
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: t('tester.toast.executionStarted'),
        description: t('tester.toast.executionId', { id: executionId }),
      });

      setDryRunResult(null);
      setActiveExecutionId(executionId);
      onTestComplete?.();
    } catch (error) {
      console.error('Test execution failed:', error);
      toast({
        title: t('tester.toast.testFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('tester.toast.startFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <VStack justify="between" className="flex-1 overflow-hidden">
      <Stack gap={3} className="flex-1 overflow-y-auto p-3">
        <JsonInput
          className="px-2"
          value={testInput}
          onChange={(value) => {
            setTestInput(value);
            setDryRunResult(null);
            setActiveExecutionId(null);
          }}
          label={t('tester.inputLabel')}
          description={t('tester.inputDescription')}
          disabled={isExecuting || isDryRunning}
          rows={8}
        />

        {dryRunResult && (
          <BorderedSection
            className={cn(
              'p-3',
              dryRunResult.success
                ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
                : 'bg-destructive/10 border-destructive/50',
            )}
          >
            <HStack gap={2} className="mb-2">
              {dryRunResult.success ? (
                <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertCircle className="text-destructive size-4" />
              )}
              <Text as="span" variant="label">
                {dryRunResult.success
                  ? t('tester.dryRun.success')
                  : t('tester.dryRun.failed')}
              </Text>
            </HStack>

            {dryRunResult.errors.length > 0 && (
              <div className="mb-2">
                <Text variant="error-sm" className="mb-1">
                  {t('tester.dryRun.errors')}:
                </Text>
                <ul className="text-destructive space-y-0.5 text-xs">
                  {dryRunResult.errors.map((err, index) => (
                    <li key={`${err}-${index}`}>• {err}</li>
                  ))}
                </ul>
              </div>
            )}

            {dryRunResult.warnings.length > 0 && (
              <div className="mb-2">
                <Text className="mb-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                  {t('tester.dryRun.warnings')}:
                </Text>
                <ul className="space-y-0.5 text-xs text-amber-600 dark:text-amber-400">
                  {dryRunResult.warnings.map((warn, index) => (
                    <li key={`${warn}-${index}`}>• {warn}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <Text variant="label-sm" className="mb-2">
                {t('tester.dryRun.executionPath')}:
              </Text>
              <HStack gap={1} wrap>
                {dryRunResult.stepResults.map((step, i) => (
                  <HStack key={step.stepSlug} gap={1}>
                    <span
                      className={cn(
                        'text-xs px-2 py-0.5 rounded',
                        getStepTypeColor(step.stepType),
                      )}
                    >
                      {step.name}
                    </span>
                    {i < dryRunResult.stepResults.length - 1 && (
                      <ArrowRight className="text-muted-foreground size-3" />
                    )}
                  </HStack>
                ))}
              </HStack>
            </div>
          </BorderedSection>
        )}

        {activeExecutionId && (
          <BorderedSection
            className={cn(
              'p-3',
              executionStatus?.status === 'completed'
                ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
                : executionStatus?.status === 'failed'
                  ? 'bg-destructive/10 border-destructive/50'
                  : 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/20',
            )}
            role="status"
            aria-live="polite"
          >
            <HStack gap={2} className="mb-1">
              {executionStatus?.status === 'completed' ? (
                <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
              ) : executionStatus?.status === 'failed' ? (
                <AlertCircle className="text-destructive size-4" />
              ) : (
                <Loader2 className="size-4 animate-spin text-blue-600 motion-reduce:animate-none dark:text-blue-400" />
              )}
              <Text as="span" variant="label">
                {executionStatus?.status === 'completed'
                  ? t('tester.result.completed')
                  : executionStatus?.status === 'failed'
                    ? t('tester.result.failed')
                    : t('tester.result.running')}
              </Text>
            </HStack>

            {executionStatus?.status === 'failed' ? (
              <Stack gap={1}>
                {executionStatus.currentStepName && (
                  <Text variant="error-sm">
                    {t('tester.result.failedAtStep', {
                      step: executionStatus.currentStepName,
                    })}
                  </Text>
                )}
                {executionStatus.error && (
                  <Text
                    variant="error-sm"
                    className="break-words whitespace-pre-line"
                  >
                    {executionStatus.error}
                  </Text>
                )}
              </Stack>
            ) : (
              executionStatus?.status !== 'completed' &&
              executionStatus?.currentStepName && (
                <Text className="text-muted-foreground text-xs">
                  {t('tester.result.runningStep', {
                    step: executionStatus.currentStepName,
                  })}
                </Text>
              )
            )}
          </BorderedSection>
        )}

        <BorderedSection className="border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/20">
          <Text className="text-xs text-blue-900 dark:text-blue-100">
            {t('tester.tip')}
          </Text>
        </BorderedSection>
      </Stack>

      <Stack gap={2} className="border-border border-t p-3">
        {!canRun && (
          <Text variant="error-sm" role="alert">
            {!isJsonValid
              ? t('tester.validation.invalidJson')
              : t('tester.validation.missingRequired', {
                  fields: missingRequiredFields.join(', '),
                })}
          </Text>
        )}
        <HStack gap={2}>
          <Button
            variant="secondary"
            onClick={handleDryRun}
            disabled={isExecuting || isDryRunning || !canRun}
            className="flex-1"
          >
            {isDryRunning ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {t('tester.dryRunning')}
              </>
            ) : (
              <>
                <Search className="mr-2 size-4" />
                {t('tester.dryRun.button')}
              </>
            )}
          </Button>
          <Button
            onClick={handleExecute}
            disabled={isExecuting || isDryRunning || !canRun}
            className="flex-1"
          >
            {isExecuting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {t('tester.executing')}
              </>
            ) : (
              <>
                <Play className="mr-2 size-4" />
                {t('tester.execute')}
              </>
            )}
          </Button>
        </HStack>
      </Stack>
    </VStack>
  );
}
