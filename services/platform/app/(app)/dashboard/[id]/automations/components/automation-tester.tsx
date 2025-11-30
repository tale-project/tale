'use client';

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { JsonInput } from '@/components/ui/json-input';
import { toast } from '@/hooks/use-toast';
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
  const [testInput, setTestInput] = useState('{}');
  const [isExecuting, setIsExecuting] = useState(false);

  const startWorkflow = useMutation(api.workflow.engine.startWorkflow);

  const handleTest = async () => {
    try {
      setIsExecuting(true);

      // Validate JSON
      let input = {};
      try {
        input = JSON.parse(testInput);
      } catch {
        toast({
          title: 'Invalid JSON',
          description: 'Please provide valid JSON input',
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
        title: 'Test execution started',
        description: `Execution ID: ${executionId}`,
      });

      // Reset test input
      setTestInput('{}');

      // Call completion callback
      onTestComplete?.();
    } catch (error) {
      console.error('Test execution failed:', error);
      toast({
        title: 'Test failed',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to start test execution',
        variant: 'destructive',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden justify-between">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <JsonInput
          className="px-2"
          value={testInput}
          onChange={setTestInput}
          label="Test input (JSON)"
          description="Provide input data in JSON format for the automation execution"
          disabled={isExecuting}
          rows={10}
        />
        <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
          <p className="text-xs text-blue-900 dark:text-blue-100">
            💡 Test executions create real automation runs. Monitor progress in
            the Executions tab.
          </p>
        </div>
      </div>

      <div className="p-3 border-t border-border">
        <Button onClick={handleTest} disabled={isExecuting} className="w-full">
          {isExecuting ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              Running Test...
            </>
          ) : (
            <>
              <TestTubeDiagonal className="size-4 mr-2" />
              Run Test
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
