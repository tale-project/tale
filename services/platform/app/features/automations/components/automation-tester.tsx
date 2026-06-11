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
  Bug,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { JsonInput } from '@/app/components/ui/forms/json-input';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { toast } from '@/app/hooks/use-toast';
import { useUrlState } from '@/app/hooks/use-url-state';
import type { Id } from '@/convex/_generated/dataModel';
import { parseDebugWaitingFor } from '@/convex/workflow_engine/helpers/engine/debug_gate';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useStartWorkflowFromFile } from '../hooks/file-mutations';
import { useReadWorkflow } from '../hooks/file-queries';
import { useExecutionStatus, useExecutionStepStatuses } from '../hooks/queries';
import { EXECUTION_STATUS_ICONS } from '../utils/execution-status-icons';
import {
  buildInputTemplateFromSchema,
  getMissingRequiredFields,
  type InputSchema,
} from '../utils/input-schema-template';
import { getStepTypeColor } from '../utils/step-icons';
import { AutomationDebugControls } from './automation-debug-controls';
import { AUTOMATION_PANEL_URL_DEFINITIONS } from './automation-steps';
import { AUTOMATION_EXECUTION_URL_DEFINITIONS } from './execution-status-context';

/**
 * Run-level failure codes the backend persists (ExecutionErrorCode). The
 * schema stores a plain string, so unknown codes simply render no reason line.
 */
const KNOWN_ERROR_CODES = new Set([
  'start_failure',
  'step_failure',
  'timeout',
  'canceled',
  'invalid_input',
]);

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

  // Per-step statuses derived server-side from the step journal — the same
  // query the canvas node badges subscribe to (#1487), rendered here as a
  // step list with the failing step's error inline.
  const { data: stepStatuses } = useExecutionStepStatuses(
    activeExecutionId ?? undefined,
  );

  // Convex normalizes object key order, so the `nodes` record cannot be
  // trusted to arrive in journal order — sort by start time instead
  // (not-yet-started steps sink to the bottom).
  const stepRows = useMemo(() => {
    if (!stepStatuses) return [];
    return Object.entries(stepStatuses.nodes)
      .map(([stepSlug, node]) => ({ stepSlug, node }))
      .sort(
        (a, b) =>
          (a.node.startedAt ?? Number.MAX_SAFE_INTEGER) -
          (b.node.startedAt ?? Number.MAX_SAFE_INTEGER),
      );
  }, [stepStatuses]);

  const failedStepRow = stepRows.find((row) => row.node.status === 'failed');

  // Coarse run-level failure reason (start failure / timeout / canceled …),
  // shown when no journal step carries the error (e.g. the run never started).
  const runErrorCode = executionStatus?.errorCode;
  const errorCodeLabel =
    executionStatus?.status === 'failed' &&
    runErrorCode &&
    KNOWN_ERROR_CODES.has(runErrorCode)
      ? t(`tester.result.errorCode.${runErrorCode}`)
      : undefined;

  // Mirror the started run into the `execution` URL param so the canvas
  // (via ExecutionStatusProvider) shows live per-node badges for it (#1487).
  const { state: executionUrlState, setState: setExecutionUrlState } =
    useUrlState({ definitions: AUTOMATION_EXECUTION_URL_DEFINITIONS });

  // Deep link from a failing step row to its editor panel — the same URL
  // mechanism the canvas node click uses, so the side panel swaps from the
  // tester to that step's settings.
  const { setStates: setPanelStates } = useUrlState({
    definitions: AUTOMATION_PANEL_URL_DEFINITIONS,
  });

  const {
    mutateAsync: startWorkflow,
    isPending: isExecuting,
    variables: startVariables,
  } = useStartWorkflowFromFile();

  // Which start button is in flight (the mutation's variables are only set
  // while it is pending) — keeps the spinner on the button that was clicked.
  const isDebugStarting = isExecuting && startVariables?.debugMode === true;
  const isExecuteStarting = isExecuting && !isDebugStarting;

  // Debug-mode pause: the engine sets waitingFor='debug:<n>:<slug>' while it
  // waits for a Step/Continue event (status stays 'running').
  const debugPause =
    executionStatus?.status === 'running'
      ? parseDebugWaitingFor(executionStatus.waitingFor)
      : null;

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

  const handleExecute = async (debugMode: boolean) => {
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
        // Debug runs carry their own trigger source so the Executions tab can
        // filter them apart from plain test runs.
        triggeredBy: debugMode ? 'debug' : 'test',
        triggerData: {
          triggerType: 'manual',
          reason: debugMode ? 'debug' : 'test',
          timestamp: Date.now(),
        },
        ...(debugMode ? { debugMode: true } : {}),
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
      setExecutionUrlState('execution', executionId);
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
            // Guard: writing URL state navigates — only clear when a run is
            // actually being viewed, not on every keystroke.
            if (executionUrlState.execution) {
              setExecutionUrlState('execution', null);
            }
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

            {stepRows.length > 0 && (
              <ul
                aria-label={t('tester.result.stepsHeading')}
                className="mt-2 space-y-1.5"
              >
                {stepRows.map((row) => {
                  const { Icon, className: iconClassName } =
                    EXECUTION_STATUS_ICONS[row.node.status];
                  const stepName = row.node.stepName ?? row.stepSlug;
                  return (
                    <li key={row.stepSlug} className="flex items-start gap-2">
                      <Icon
                        className={cn(
                          'mt-0.5 size-3.5 shrink-0',
                          iconClassName,
                        )}
                        aria-hidden="true"
                      />
                      <Stack gap={1} className="min-w-0 flex-1">
                        <HStack gap={2} className="items-baseline">
                          {row.node.status === 'failed' ? (
                            <button
                              type="button"
                              onClick={() =>
                                setPanelStates({
                                  panel: 'step',
                                  step: row.stepSlug,
                                })
                              }
                              aria-label={t('tester.result.openStep', {
                                step: stepName,
                              })}
                              className="cursor-pointer text-left text-xs font-medium underline-offset-2 hover:underline focus-visible:underline"
                            >
                              {stepName}
                            </button>
                          ) : (
                            <Text as="span" className="text-xs font-medium">
                              {stepName}
                            </Text>
                          )}
                          {row.node.attempts > 1 && (
                            <Text
                              as="span"
                              className="text-muted-foreground text-xs"
                            >
                              {t('steps.execution.attempts', {
                                count: row.node.attempts,
                              })}
                            </Text>
                          )}
                        </HStack>
                        {row.node.status === 'failed' && row.node.error && (
                          <Text
                            variant="error-sm"
                            className="break-words whitespace-pre-line"
                          >
                            {row.node.error}
                          </Text>
                        )}
                      </Stack>
                    </li>
                  );
                })}
              </ul>
            )}

            {executionStatus?.status === 'failed' ? (
              <Stack
                gap={1}
                className={stepRows.length > 0 ? 'mt-2' : undefined}
              >
                {errorCodeLabel && !failedStepRow && (
                  <Text variant="error-sm" className="font-medium">
                    {errorCodeLabel}
                  </Text>
                )}
                {!failedStepRow && executionStatus.currentStepName && (
                  <Text variant="error-sm">
                    {t('tester.result.failedAtStep', {
                      step: executionStatus.currentStepName,
                    })}
                  </Text>
                )}
                {!failedStepRow && executionStatus.error && (
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
              stepRows.length === 0 &&
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

        {activeExecutionId && debugPause && executionStatus?.waitingFor && (
          <AutomationDebugControls
            executionId={activeExecutionId}
            waitingFor={executionStatus.waitingFor}
            currentStepName={executionStatus.currentStepName}
          />
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
            variant="secondary"
            onClick={() => handleExecute(true)}
            disabled={isExecuting || isDryRunning || !canRun}
            className="flex-1"
          >
            {isDebugStarting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {t('tester.executing')}
              </>
            ) : (
              <>
                <Bug className="mr-2 size-4" />
                {t('tester.debug.button')}
              </>
            )}
          </Button>
          <Button
            onClick={() => handleExecute(false)}
            disabled={isExecuting || isDryRunning || !canRun}
            className="flex-1"
          >
            {isExecuteStarting ? (
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
