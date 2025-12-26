'use client';

import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useStartWorkflow, useCancelExecution } from '../hooks';
import { Id } from '@/convex/_generated/dataModel';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { JsonInput } from '@/components/ui/json-input';
import { Badge } from '@/components/ui/badge';
import { Stack, HStack, Grid } from '@/components/ui/layout';
import { toast } from '@/hooks/use-toast';
import { Play, Clock, Square, TestTube } from 'lucide-react';
import { formatDate } from '@/lib/utils/date/format';
import { useLocale, useT } from '@/lib/i18n';

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
  const locale = useLocale();
  const { t } = useT('automations');
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
  const startAutomation = useStartWorkflow();

  // Actions
  const cancelExecution = useCancelExecution();

  const handleStartAutomation = async () => {
    if (!selectedAutomation) return;

    try {
      let input = {};
      try {
        input = JSON.parse(executionInput);
      } catch {
        toast({
          title: t('execution.toast.invalidJson'),
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
        title: t('execution.toast.startedSuccess'),
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: t('execution.toast.startFailed', { error: String(error) }),
        variant: 'destructive',
      });
    }
  };

  return (
    <Stack gap={4}>
      <Grid cols={1} lg={2} gap={6}>
        {/* Execution Control */}
        <Card>
          <CardHeader>
            <CardTitle>
              <HStack gap={2}>
                <Play className="size-4" />
                {t('execution.control.title')}
              </HStack>
            </CardTitle>
            <CardDescription>
              {t('execution.control.description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedAutomation ? (
              <Stack gap={4}>
                <Stack gap={2}>
                  <span className="text-sm font-medium">{t('execution.selectedAutomation')}</span>
                  <div className="p-2 bg-muted rounded text-sm">
                    {selectedAutomationData?.name || selectedAutomation}
                  </div>
                </Stack>
                <JsonInput
                  id="execution-input"
                  label={t('execution.inputLabel')}
                  value={executionInput}
                  onChange={setExecutionInput}
                  placeholder='{"key": "value"}'
                  rows={4}
                />
                <HStack gap={2}>
                  <Button
                    onClick={handleStartAutomation}
                    disabled={selectedAutomationData?.status !== 'active'}
                    className="flex-1"
                  >
                    <Play className="size-4 mr-2" />
                    {t('execution.startButton')}
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
                            title: t('execution.toast.invalidJson'),
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
                          title: t('execution.toast.testStarted'),
                          description: t('execution.toast.executionId', { id: result }),
                        });
                        setSelectedExecution(result);
                        setPollingHandle(result);
                      } catch (error) {
                        toast({
                          title: t('execution.toast.testFailed'),
                          description: `${error}`,
                          variant: 'destructive',
                        });
                      }
                    }}
                  >
                    <TestTube className="size-4 mr-2" />
                    {t('execution.testButton')}
                  </Button>
                </HStack>
                {selectedAutomationData?.status !== 'active' && (
                  <div className="text-sm text-amber-600 bg-amber-50 p-2 rounded">
                    {t('execution.mustBeActive')}
                  </div>
                )}
              </Stack>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                {t('execution.selectToStart')}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Execution History */}
        <Card>
          <CardHeader>
            <CardTitle>
              <HStack gap={2}>
                <Clock className="size-4" />
                {t('execution.history.title')}
              </HStack>
            </CardTitle>
            <CardDescription>
              {t('execution.history.description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedAutomation ? (
              executions === undefined ? (
                <div className="text-center py-4">{t('execution.history.loading')}</div>
              ) : executions.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  {t('execution.history.noExecutions')}
                </div>
              ) : (
                <Stack gap={3}>
                  {executions.map((execution) => (
                    <div
                      key={execution._id}
                      className={`p-3 border rounded-lg cursor-pointer transition-colors ${selectedExecution === execution._id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                        }`}
                      onClick={() => setSelectedExecution(execution._id)}
                    >
                      <HStack justify="between">
                        <div className="flex-1">
                          <HStack gap={2}>
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
                              {formatDate(new Date(execution.startedAt), { preset: 'long', locale })}
                            </span>
                          </HStack>
                          <p className="text-sm mt-1">
                            {t('execution.history.triggeredBy', { source: execution.triggeredBy })}
                          </p>
                          {execution.waitingFor && (
                            <p className="text-sm text-amber-600">
                              {t('execution.history.waitingFor', { target: execution.waitingFor })}
                            </p>
                          )}
                        </div>
                        <HStack gap={1}>
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
                        </HStack>
                      </HStack>
                    </div>
                  ))}
                </Stack>
              )
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                {t('execution.history.selectToView')}
              </div>
            )}
          </CardContent>
        </Card>
      </Grid>
    </Stack>
  );
}
