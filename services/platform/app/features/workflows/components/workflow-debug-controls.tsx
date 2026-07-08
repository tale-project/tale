'use client';

import { BorderedSection } from '@tale/ui/bordered-section';
import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Bug, FastForward, Loader2, Square, StepForward } from 'lucide-react';

import { JsonViewer } from '@/app/components/ui/data-display/json-viewer';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import {
  useCancelExecution,
  useResumeDebugStep,
} from '../hooks/execution-mutations';

interface WorkflowDebugControlsProps {
  executionId: Id<'wfExecutions'>;
  /**
   * The execution's current `waitingFor` value (`debug:<n>:<slug>`). Part of
   * the variables query key so every new pause refetches the inspector data.
   */
  waitingFor: string;
  currentStepName?: string;
}

/**
 * Step / Continue / Stop controls plus the per-step I/O inspector, rendered
 * by the test panel while a debug run is paused before a node (#1490).
 */
export function WorkflowDebugControls({
  executionId,
  waitingFor,
  currentStepName,
}: WorkflowDebugControlsProps) {
  const { t } = useT('workflows');
  const { mutate: resumeDebugStep, isPending: isResuming } =
    useResumeDebugStep();
  const { mutate: cancelExecution, isPending: isStopping } =
    useCancelExecution();

  const {
    data: variables,
    isPending: isLoadingVariables,
    isError: variablesFailed,
  } = useActionQuery(
    ['workflow-execution-variables', executionId, waitingFor],
    api.workflow_executions.actions.getExecutionVariables,
    { executionId },
  );

  const isBusy = isResuming || isStopping;

  return (
    <BorderedSection
      className="border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20"
      role="status"
      aria-live="polite"
    >
      <Stack gap={2}>
        <HStack gap={2}>
          <Bug
            className="size-4 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <Text as="span" variant="label">
            {t('tester.debug.title')}
          </Text>
        </HStack>

        {currentStepName && (
          <Text className="text-xs text-amber-700 dark:text-amber-300">
            {t('tester.debug.pausedAt', { step: currentStepName })}
          </Text>
        )}

        <HStack gap={2} wrap>
          <Button
            onClick={() => resumeDebugStep({ executionId, action: 'step' })}
            disabled={isBusy}
          >
            <StepForward className="mr-1 size-4" />
            {t('tester.debug.step')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => resumeDebugStep({ executionId, action: 'continue' })}
            disabled={isBusy}
          >
            <FastForward className="mr-1 size-4" />
            {t('tester.debug.continue')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => cancelExecution({ executionId })}
            disabled={isBusy}
          >
            <Square className="mr-1 size-4" />
            {t('tester.debug.stop')}
          </Button>
        </HStack>

        <Stack gap={1}>
          <Text variant="label-sm">{t('tester.debug.variables')}</Text>
          {isLoadingVariables ? (
            <HStack gap={2}>
              <Loader2
                className="size-4 animate-spin text-amber-600 motion-reduce:animate-none dark:text-amber-400"
                aria-hidden="true"
              />
              <Text className="text-muted-foreground text-xs">
                {t('tester.debug.variablesLoading')}
              </Text>
            </HStack>
          ) : variablesFailed ? (
            <Text variant="error-sm">{t('tester.debug.variablesError')}</Text>
          ) : (
            <JsonViewer
              data={variables}
              collapsed={1}
              className="rounded-md border"
            />
          )}
        </Stack>
      </Stack>
    </BorderedSection>
  );
}
