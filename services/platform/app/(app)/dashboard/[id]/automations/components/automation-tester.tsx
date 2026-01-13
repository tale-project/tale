'use client';

import { useState } from 'react';
import { Id } from '@/convex/_generated/dataModel';
import { useStartWorkflow } from '../hooks/use-start-workflow';
import { Button } from '@/components/ui/primitives/button';
import { JsonInput } from '@/components/ui/forms/json-input';
import { Stack, VStack } from '@/components/ui/layout/layout';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { TestTubeDiagonal, Loader2 } from 'lucide-react';

interface AutomationTesterProps {
  organizationId: string;
  automationId: Id<'wfDefinitions'>;
  onTestComplete?: () => void;
}

export function AutomationTester({
  organizationId,
  automationId,
  onTestComplete,
}: AutomationTesterProps) {
  const { t } = useT('automations');
  const [testInput, setTestInput] = useState('{}');
  const [isExecuting, setIsExecuting] = useState(false);

  const startWorkflow = useStartWorkflow();

  const handleTest = async () => {
    try {
      setIsExecuting(true);

      // Validate JSON
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

      // Start test execution using startWorkflow (bypasses trigger type validation)
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

      // Reset test input
      setTestInput('{}');

      // Call completion callback
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

  return (
    <VStack justify="between" className="flex-1 overflow-hidden">
      <Stack gap={3} className="flex-1 overflow-y-auto p-3">
        <JsonInput
          className="px-2"
          value={testInput}
          onChange={setTestInput}
          label={t('tester.inputLabel')}
          description={t('tester.inputDescription')}
          disabled={isExecuting}
          rows={10}
        />
        <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
          <p className="text-xs text-blue-900 dark:text-blue-100">
            {t('tester.tip')}
          </p>
        </div>
      </Stack>

      <div className="p-3 border-t border-border">
        <Button onClick={handleTest} disabled={isExecuting} fullWidth>
          {isExecuting ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              {t('tester.runningTest')}
            </>
          ) : (
            <>
              <TestTubeDiagonal className="size-4 mr-2" />
              {t('tester.runTest')}
            </>
          )}
        </Button>
      </div>
    </VStack>
  );
}
