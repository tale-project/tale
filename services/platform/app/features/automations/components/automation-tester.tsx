'use client';

import { useQuery } from 'convex/react';
import {
  Search,
  Play,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import { useState } from 'react';

import { JsonInput } from '@/app/components/ui/forms/json-input';
import { Stack, VStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useStartWorkflow } from '../hooks/use-start-workflow';

interface AutomationTesterProps {
  organizationId: string;
  automationId: Id<'wfDefinitions'>;
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
  automationId,
  onTestComplete,
}: AutomationTesterProps) {
  const { t } = useT('automations');
  const [testInput, setTestInput] = useState('{}');
  const [isExecuting, setIsExecuting] = useState(false);
  const [isDryRunning, setIsDryRunning] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);

  const startWorkflow = useStartWorkflow();

  const parsedInput = (() => {
    try {
      return JSON.parse(testInput);
    } catch {
      return null;
    }
  })();

  const dryRunQuery = useQuery(
    api.wf_definitions.queries.dryRunWorkflow,
    isDryRunning && parsedInput
      ? { wfDefinitionId: automationId, input: parsedInput }
      : 'skip',
  );

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
  };

  if (isDryRunning && dryRunQuery && !dryRunResult) {
    setDryRunResult(dryRunQuery);
    setIsDryRunning(false);
  }

  const handleExecute = async () => {
    try {
      setIsExecuting(true);

      let input = {};
      try {
        input = JSON.parse(testInput);
      } catch {
        toast({
          title: t('tester.toast.invalidJson'),
          description: t('tester.toast.invalidJsonDescription'),
          variant: 'destructive',
        });
        setIsExecuting(false);
        return;
      }

      const executionId = await startWorkflow({
        organizationId,
        wfDefinitionId: automationId,
        input,
        triggeredBy: 'test',
        triggerData: {
          triggerType: 'manual',
          reason: 'test',
          timestamp: Date.now(),
        },
      });

      toast({
        title: t('tester.toast.executionStarted'),
        description: t('tester.toast.executionId', { id: executionId }),
      });

      setTestInput('{}');
      setDryRunResult(null);
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
    } finally {
      setIsExecuting(false);
    }
  };

  const getStepTypeColor = (stepType: string) => {
    switch (stepType) {
      case 'start':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
      case 'llm':
        return 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300';
      case 'condition':
        return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
      case 'loop':
        return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300';
      case 'action':
        return 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300';
      default:
        return 'bg-muted text-muted-foreground';
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
          }}
          label={t('tester.inputLabel')}
          description={t('tester.inputDescription')}
          disabled={isExecuting || isDryRunning}
          rows={8}
        />

        {dryRunResult && (
          <div
            className={cn(
              'rounded-lg border p-3',
              dryRunResult.success
                ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
                : 'bg-destructive/10 border-destructive/50',
            )}
          >
            <div className="mb-2 flex items-center gap-2">
              {dryRunResult.success ? (
                <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertCircle className="text-destructive size-4" />
              )}
              <span className="text-sm font-medium">
                {dryRunResult.success
                  ? t('tester.dryRun.success')
                  : t('tester.dryRun.failed')}
              </span>
            </div>

            {dryRunResult.errors.length > 0 && (
              <div className="mb-2">
                <p className="text-destructive mb-1 text-xs font-medium">
                  {t('tester.dryRun.errors')}:
                </p>
                <ul className="text-destructive space-y-0.5 text-xs">
                  {dryRunResult.errors.map((err, index) => (
                    <li key={`${err}-${index}`}>• {err}</li>
                  ))}
                </ul>
              </div>
            )}

            {dryRunResult.warnings.length > 0 && (
              <div className="mb-2">
                <p className="mb-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                  {t('tester.dryRun.warnings')}:
                </p>
                <ul className="space-y-0.5 text-xs text-amber-600 dark:text-amber-400">
                  {dryRunResult.warnings.map((warn, index) => (
                    <li key={`${warn}-${index}`}>• {warn}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="text-foreground mb-2 text-xs font-medium">
                {t('tester.dryRun.executionPath')}:
              </p>
              <div className="flex flex-wrap items-center gap-1">
                {dryRunResult.stepResults.map((step, i) => (
                  <div key={step.stepSlug} className="flex items-center gap-1">
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
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/20">
          <p className="text-xs text-blue-900 dark:text-blue-100">
            {t('tester.tip')}
          </p>
        </div>
      </Stack>

      <div className="border-border flex gap-2 border-t p-3">
        <Button
          variant="outline"
          onClick={handleDryRun}
          disabled={isExecuting || isDryRunning}
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
          disabled={isExecuting || isDryRunning}
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
      </div>
    </VStack>
  );
}
