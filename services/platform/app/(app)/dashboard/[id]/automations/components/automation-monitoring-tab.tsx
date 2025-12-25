'use client';

import { useQuery } from 'convex/react';
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
import { Activity, RefreshCw } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface ExecutionStats {
  total: number;
  successRate: number;
  avgExecutionTime: number;
  failed: number;
}

interface AutomationMonitoringTabProps {
  selectedWorkflow: string | null;
  pollingHandle: string | null;
  setPollingHandle: (handle: string | null) => void;
}

export function AutomationMonitoringTab({
  selectedWorkflow,
  pollingHandle,
  setPollingHandle,
}: AutomationMonitoringTabProps) {
  const { t } = useT('automations');
  // Queries
  const executionStats = useQuery(
    api.wf_executions.getWorkflowExecutionStats,
    selectedWorkflow
      ? { wfDefinitionId: selectedWorkflow as Id<'wfDefinitions'> }
      : 'skip',
  ) as ExecutionStats | undefined;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Execution Stats */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4" />
              Execution Statistics
            </CardTitle>
            <CardDescription>
              Performance metrics for selected automation
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedWorkflow ? (
              executionStats === undefined ? (
                <div className="text-center py-4">Loading stats...</div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-3 bg-muted rounded">
                      <div className="text-2xl font-bold text-foreground">
                        {executionStats.total || 0}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Total Executions
                      </div>
                    </div>
                    <div className="text-center p-3 bg-muted rounded">
                      <div className="text-2xl font-bold text-foreground">
                        {executionStats.successRate || 0}%
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Success Rate
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-3 bg-muted rounded">
                      <div className="text-2xl font-bold text-foreground">
                        {executionStats.avgExecutionTime || 0}ms
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Avg Duration
                      </div>
                    </div>
                    <div className="text-center p-3 bg-muted rounded">
                      <div className="text-2xl font-bold text-foreground">
                        {executionStats.failed || 0}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Failures
                      </div>
                    </div>
                  </div>
                </div>
              )
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                {t('monitoring.selectAutomation')}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Real-time Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="size-4" />
              {t('monitoring.realtimeStatus')}
            </CardTitle>
            <CardDescription>{t('monitoring.liveMonitoring')}</CardDescription>
          </CardHeader>
          <CardContent>
            {pollingHandle ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-sm">
                    {t('monitoring.monitoringExecution', { handle: pollingHandle })}
                  </span>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setPollingHandle(null)}
                  className="w-full"
                >
                  {t('monitoring.stopMonitoring')}
                </Button>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                {t('monitoring.startAutomation')}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
