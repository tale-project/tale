'use client';

import { useState } from 'react';
import { useQuery, useMutation, useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { JsonInput } from '@/components/ui/json-input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Play, Clock, Square, TestTube } from 'lucide-react';

interface AutomationTemplate {
  _id: Id<'wfDefinitions'>;
  name: string;
  status: 'active' | 'inactive' | 'draft';
  description?: string;
}

interface ExecutionRecord {
  _id: string;
  status: 'completed' | 'failed' | 'running' | 'pending';
  startedAt: number;
  triggeredBy: string;
  waitingFor?: string;
}

interface AutomationExecutionTabProps {
  organizationId: string;
  selectedAutomation: string | null;
  selectedExecution: string | null;
  setSelectedExecution: (id: string | null) => void;
  setPollingHandle: (handle: string | null) => void;
}

export function AutomationExecutionTab({
  organizationId,
  selectedAutomation,
  selectedExecution,
  setSelectedExecution,
  setPollingHandle,
}: AutomationExecutionTabProps) {
  const [executionInput, setExecutionInput] = useState('{}');

  // Queries
  const selectedAutomationData = useQuery(
    api.wf_definitions.getWorkflowPublic,
    selectedAutomation
      ? { wfDefinitionId: selectedAutomation as Id<'wfDefinitions'> }
      : 'skip',
  ) as AutomationTemplate | undefined;

  const executions = useQuery(
    api.wf_executions.listExecutions,
    selectedAutomation
      ? {
        wfDefinitionId: selectedAutomation as Id<'wfDefinitions'>,
        limit: 10,
      }
      : 'skip',
  ) as ExecutionRecord[] | undefined;

  // Mutations
  const startAutomation = useMutation(
    api.workflow.engine.startWorkflow,
  );

  // Actions
  const cancelExecution = useAction(api.wf_executions.cancelExecution);

  const handleStartAutomation = async () => {
    if (!selectedAutomation) return;

    try {
      let input = {};
      try {
        input = JSON.parse(executionInput);
      } catch {
        toast({
          title: 'Invalid JSON input',
          variant: 'destructive',
        });
        return;
      }

      const executionHandle = await startAutomation({
        organizationId,
        wfDefinitionId: selectedAutomation as Id<'wfDefinitions'>,
        input,
        triggeredBy: 'manual',
      });

      setPollingHandle(executionHandle);
      setSelectedExecution(executionHandle);

      toast({
        title: 'Automation started successfully',
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: `Failed to start automation: ${error}`,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Execution Control */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="size-4" />
              Execution Control
            </CardTitle>
            <CardDescription>
              Start and control automation executions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedAutomation ? (
              <>
                <div>
                  <Label>Selected automation</Label>
                  <div className="p-2 bg-muted rounded text-sm">
                    {selectedAutomationData?.name || selectedAutomation}
                  </div>
                </div>
                <JsonInput
                  id="execution-input"
                  label="Input data (JSON)"
                  value={executionInput}
                  onChange={setExecutionInput}
                  placeholder='{"key": "value"}'
                  rows={4}
                />
                <div className="flex gap-2">
                  <Button
                    onClick={handleStartAutomation}
                    disabled={selectedAutomationData?.status !== 'active'}
                    className="flex-1"
                  >
                    <Play className="size-4 mr-2" />
                    Start Execution
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      try {
                        let input = {};
                        try {
                          input = JSON.parse(executionInput);
                        } catch {
                          toast({
                            title: 'Invalid JSON input',
                            variant: 'destructive',
                          });
                          return;
                        }

                        const result = await startAutomation({
                          organizationId,
                          wfDefinitionId:
                            selectedAutomation as Id<'wfDefinitions'>,
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
                          description: `Execution ID: ${result}`,
                        });
                        setSelectedExecution(result);
                        setPollingHandle(result);
                      } catch (error) {
                        toast({
                          title: 'Test failed',
                          description: `${error}`,
                          variant: 'destructive',
                        });
                      }
                    }}
                  >
                    <TestTube className="size-4 mr-2" />
                    Test
                  </Button>
                </div>
                {selectedAutomationData?.status !== 'active' && (
                  <div className="text-sm text-amber-600 bg-amber-50 p-2 rounded">
                    ⚠️ Automation must be active to start execution
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Select a automation from the Templates tab to start execution
              </div>
            )}
          </CardContent>
        </Card>

        {/* Execution History */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4" />
              Execution History
            </CardTitle>
            <CardDescription>
              Recent executions for selected automation
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedAutomation ? (
              executions === undefined ? (
                <div className="text-center py-4">Loading executions...</div>
              ) : executions.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  No executions found for this automation
                </div>
              ) : (
                <div className="space-y-3">
                  {executions.map((execution) => (
                    <div
                      key={execution._id}
                      className={`p-3 border rounded-lg cursor-pointer transition-colors ${selectedExecution === execution._id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                        }`}
                      onClick={() => setSelectedExecution(execution._id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={
                                execution.status === 'completed'
                                  ? 'green'
                                  : execution.status === 'failed'
                                    ? 'destructive'
                                    : execution.status === 'running'
                                      ? 'blue'
                                      : 'outline'
                              }
                              className="text-xs"
                            >
                              {execution.status}
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              {new Date(execution.startedAt).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-sm mt-1">
                            Triggered by: {execution.triggeredBy}
                          </p>
                          {execution.waitingFor && (
                            <p className="text-sm text-amber-600">
                              Waiting for: {execution.waitingFor}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {execution.status === 'running' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelExecution({ handle: execution._id });
                              }}
                            >
                              <Square className="size-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Select a automation to view execution history
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
