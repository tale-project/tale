'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Input } from '@/app/components/ui/forms/input';
import { Switch } from '@/app/components/ui/forms/switch';
import { Stack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Text } from '@/app/components/ui/typography/text';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  retentionPolicyConfigSchema,
  type RetentionPolicyConfig,
} from '@/lib/shared/schemas/governance';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

interface RetentionEditorProps {
  organizationId: string;
}

function parseRetentionConfig(policy: unknown): RetentionPolicyConfig {
  const config = isRecord(policy) ? policy : {};
  const result = retentionPolicyConfigSchema.safeParse(config);
  if (result.success) {
    return result.data;
  }
  return { enabled: false, retentionDays: 90 };
}

export function RetentionEditor({ organizationId }: RetentionEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'retention_policy',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const savedConfig = useMemo(
    () => parseRetentionConfig(policy?.config),
    [policy],
  );

  const initializedRef = useRef(false);
  const [enabled, setEnabled] = useState(false);
  const [retentionDays, setRetentionDays] = useState(0);
  const [userTempEnabled, setUserTempEnabled] = useState(false);
  const [userTempRetentionHours, setUserTempRetentionHours] = useState(0);
  const [agentTempEnabled, setAgentTempEnabled] = useState(false);
  const [agentTempRetentionHours, setAgentTempRetentionHours] = useState(0);
  const [chatHistoryEnabled, setChatHistoryEnabled] = useState(false);
  const [chatHistoryRetentionDays, setChatHistoryRetentionDays] = useState(0);
  const [auditLogsEnabled, setAuditLogsEnabled] = useState(false);
  const [auditLogRetentionDays, setAuditLogRetentionDays] = useState(0);
  const [workflowLogsEnabled, setWorkflowLogsEnabled] = useState(false);
  const [workflowLogRetentionDays, setWorkflowLogRetentionDays] = useState(0);
  const [usageLedgerEnabled, setUsageLedgerEnabled] = useState(false);
  const [usageLedgerRetentionDays, setUsageLedgerRetentionDays] = useState(0);
  const [loginAttemptsEnabled, setLoginAttemptsEnabled] = useState(false);
  const [loginAttemptRetentionDays, setLoginAttemptRetentionDays] = useState(0);

  if (!isLoading && !initializedRef.current) {
    initializedRef.current = true;
    setEnabled(savedConfig.enabled);
    setRetentionDays(savedConfig.retentionDays);
    setUserTempEnabled(savedConfig.userTempEnabled ?? false);
    setUserTempRetentionHours(savedConfig.userTempRetentionHours ?? 24);
    setAgentTempEnabled(savedConfig.agentTempEnabled ?? false);
    setAgentTempRetentionHours(savedConfig.agentTempRetentionHours ?? 24);
    setChatHistoryEnabled(savedConfig.chatHistoryEnabled ?? false);
    setChatHistoryRetentionDays(savedConfig.chatHistoryRetentionDays ?? 90);
    setAuditLogsEnabled(savedConfig.auditLogsEnabled ?? false);
    setAuditLogRetentionDays(savedConfig.auditLogRetentionDays ?? 90);
    setWorkflowLogsEnabled(savedConfig.workflowLogsEnabled ?? false);
    setWorkflowLogRetentionDays(savedConfig.workflowLogRetentionDays ?? 30);
    setUsageLedgerEnabled(savedConfig.usageLedgerEnabled ?? false);
    setUsageLedgerRetentionDays(savedConfig.usageLedgerRetentionDays ?? 365);
    setLoginAttemptsEnabled(savedConfig.loginAttemptsEnabled ?? false);
    setLoginAttemptRetentionDays(savedConfig.loginAttemptRetentionDays ?? 90);
  }

  const cannotManage = ability.cannot('write', 'orgSettings');

  const saveConfig = useCallback(
    async (patch: Partial<RetentionPolicyConfig>) => {
      const fullConfig: RetentionPolicyConfig = {
        enabled,
        retentionDays,
        userTempEnabled,
        userTempRetentionHours,
        agentTempEnabled,
        agentTempRetentionHours,
        chatHistoryEnabled,
        chatHistoryRetentionDays,
        auditLogsEnabled,
        auditLogRetentionDays,
        workflowLogsEnabled,
        workflowLogRetentionDays,
        usageLedgerEnabled,
        usageLedgerRetentionDays,
        loginAttemptsEnabled,
        loginAttemptRetentionDays,
        ...patch,
      };
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'retention_policy',
          config: fullConfig,
        });
        toast({ title: t('retentionPolicy.saved'), variant: 'success' });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Failed to save';
        toast({ title: message, variant: 'destructive' });
      }
    },
    [
      organizationId,
      upsertMutation,
      toast,
      t,
      enabled,
      retentionDays,
      userTempEnabled,
      userTempRetentionHours,
      agentTempEnabled,
      agentTempRetentionHours,
      chatHistoryEnabled,
      chatHistoryRetentionDays,
      auditLogsEnabled,
      auditLogRetentionDays,
      workflowLogsEnabled,
      workflowLogRetentionDays,
      usageLedgerEnabled,
      usageLedgerRetentionDays,
      loginAttemptsEnabled,
      loginAttemptRetentionDays,
    ],
  );

  if (isLoading || !initializedRef.current) {
    return (
      <div aria-busy="true" className="space-y-3 py-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <Stack gap={6}>
      <PageSection
        title="Chat History"
        description="Automatically delete chat threads (conversations with agents) older than the retention period. Message contents in the agent component are archived. Deletion is irreversible."
        action={
          <Switch
            label="Enabled"
            checked={chatHistoryEnabled}
            onCheckedChange={(checked) => {
              setChatHistoryEnabled(checked);
              void saveConfig({ chatHistoryEnabled: checked });
            }}
            disabled={cannotManage || upsertMutation.isPending}
          />
        }
      >
        <div
          className={cn(
            'transition-opacity duration-200',
            !chatHistoryEnabled && 'pointer-events-none opacity-50',
          )}
        >
          <div className="max-w-xs">
            <Input
              label="Retention Days"
              type="number"
              value={chatHistoryRetentionDays}
              onChange={(e) =>
                setChatHistoryRetentionDays(
                  e.target.value ? Number(e.target.value) : 0,
                )
              }
              onBlur={() => void saveConfig({ chatHistoryRetentionDays })}
              disabled={cannotManage || !chatHistoryEnabled}
              size="sm"
              placeholder="e.g. 90"
              min={1}
              max={3650}
            />
            <Text className="text-muted-foreground mt-1 text-xs">
              Chat threads older than this (by last-updated time) will be
              deleted.
            </Text>
          </div>
        </div>
      </PageSection>

      <PageSection
        title="Document Retention"
        description="Automatically delete documents that exceed the retention period. Use with caution — deleted documents cannot be recovered."
        action={
          <Switch
            label="Enabled"
            checked={enabled}
            onCheckedChange={(checked) => {
              setEnabled(checked);
              void saveConfig({ enabled: checked });
            }}
            disabled={cannotManage || upsertMutation.isPending}
          />
        }
      >
        <div
          className={cn(
            'transition-opacity duration-200',
            !enabled && 'pointer-events-none opacity-50',
          )}
        >
          <div className="max-w-xs">
            <Input
              label="Retention Days"
              type="number"
              value={retentionDays}
              onChange={(e) =>
                setRetentionDays(e.target.value ? Number(e.target.value) : 0)
              }
              onBlur={() => void saveConfig({ retentionDays })}
              disabled={cannotManage || !enabled}
              size="sm"
              placeholder="e.g. 90"
              min={0}
            />
            <Text className="text-muted-foreground mt-1 text-xs">
              Documents older than this will be deleted.
            </Text>
          </div>
        </div>
      </PageSection>

      <PageSection
        title="User Temporary File Cleanup"
        description="Automatically delete files uploaded by users but never saved to a document (e.g. chat attachments, aborted uploads)."
        action={
          <Switch
            label="Enabled"
            checked={userTempEnabled}
            onCheckedChange={(checked) => {
              setUserTempEnabled(checked);
              void saveConfig({ userTempEnabled: checked });
            }}
            disabled={cannotManage || upsertMutation.isPending}
          />
        }
      >
        <div
          className={cn(
            'transition-opacity duration-200',
            !userTempEnabled && 'pointer-events-none opacity-50',
          )}
        >
          <div className="max-w-xs">
            <Input
              label="Retention Hours"
              type="number"
              value={userTempRetentionHours}
              onChange={(e) =>
                setUserTempRetentionHours(
                  e.target.value ? Number(e.target.value) : 0,
                )
              }
              onBlur={() => void saveConfig({ userTempRetentionHours })}
              disabled={cannotManage || !userTempEnabled}
              size="sm"
              placeholder="e.g. 24"
              min={0}
            />
            <Text className="text-muted-foreground mt-1 text-xs">
              Temporary files older than this will be deleted.
            </Text>
          </div>
        </div>
      </PageSection>

      <PageSection
        title="Agent Temporary File Cleanup"
        description="Automatically delete files generated by agents but never saved to a document (e.g. intermediate outputs, knowledge files)."
        action={
          <Switch
            label="Enabled"
            checked={agentTempEnabled}
            onCheckedChange={(checked) => {
              setAgentTempEnabled(checked);
              void saveConfig({ agentTempEnabled: checked });
            }}
            disabled={cannotManage || upsertMutation.isPending}
          />
        }
      >
        <div
          className={cn(
            'transition-opacity duration-200',
            !agentTempEnabled && 'pointer-events-none opacity-50',
          )}
        >
          <div className="max-w-xs">
            <Input
              label="Retention Hours"
              type="number"
              value={agentTempRetentionHours}
              onChange={(e) =>
                setAgentTempRetentionHours(
                  e.target.value ? Number(e.target.value) : 0,
                )
              }
              onBlur={() => void saveConfig({ agentTempRetentionHours })}
              disabled={cannotManage || !agentTempEnabled}
              size="sm"
              placeholder="e.g. 24"
              min={0}
            />
            <Text className="text-muted-foreground mt-1 text-xs">
              Temporary files older than this will be deleted.
            </Text>
          </div>
        </div>
      </PageSection>

      <PageSection
        title="Workflow Execution Logs"
        description="Automatically delete workflow execution records and trigger logs older than the retention period. Includes per-execution variable/output storage blobs."
        action={
          <Switch
            label="Enabled"
            checked={workflowLogsEnabled}
            onCheckedChange={(checked) => {
              setWorkflowLogsEnabled(checked);
              void saveConfig({ workflowLogsEnabled: checked });
            }}
            disabled={cannotManage || upsertMutation.isPending}
          />
        }
      >
        <div
          className={cn(
            'transition-opacity duration-200',
            !workflowLogsEnabled && 'pointer-events-none opacity-50',
          )}
        >
          <div className="max-w-xs">
            <Input
              label="Retention Days"
              type="number"
              value={workflowLogRetentionDays}
              onChange={(e) =>
                setWorkflowLogRetentionDays(
                  e.target.value ? Number(e.target.value) : 0,
                )
              }
              onBlur={() => void saveConfig({ workflowLogRetentionDays })}
              disabled={cannotManage || !workflowLogsEnabled}
              size="sm"
              placeholder="e.g. 30"
              min={1}
              max={365}
            />
            <Text className="text-muted-foreground mt-1 text-xs">
              Workflow runs older than this will be deleted (1–365 days).
            </Text>
          </div>
        </div>
      </PageSection>

      <PageSection
        title="Audit Logs"
        description="Automatically delete audit log entries older than the retention period. Note: audit logs are immutable historical records used for compliance; keep retention long enough to satisfy your audit/compliance requirements."
        action={
          <Switch
            label="Enabled"
            checked={auditLogsEnabled}
            onCheckedChange={(checked) => {
              setAuditLogsEnabled(checked);
              void saveConfig({ auditLogsEnabled: checked });
            }}
            disabled={cannotManage || upsertMutation.isPending}
          />
        }
      >
        <div
          className={cn(
            'transition-opacity duration-200',
            !auditLogsEnabled && 'pointer-events-none opacity-50',
          )}
        >
          <div className="max-w-xs">
            <Input
              label="Retention Days"
              type="number"
              value={auditLogRetentionDays}
              onChange={(e) =>
                setAuditLogRetentionDays(
                  e.target.value ? Number(e.target.value) : 0,
                )
              }
              onBlur={() => void saveConfig({ auditLogRetentionDays })}
              disabled={cannotManage || !auditLogsEnabled}
              size="sm"
              placeholder="e.g. 90"
              min={30}
              max={365}
            />
            <Text className="text-muted-foreground mt-1 text-xs">
              Audit log entries older than this will be deleted (30–365 days).
            </Text>
          </div>
        </div>
      </PageSection>

      <PageSection
        title="Usage Ledger"
        description="Automatically delete token-usage ledger rows older than the retention period. Warning: shortening this retention truncates historical analytics (budgets/reports rely on ledger rows)."
        action={
          <Switch
            label="Enabled"
            checked={usageLedgerEnabled}
            onCheckedChange={(checked) => {
              setUsageLedgerEnabled(checked);
              void saveConfig({ usageLedgerEnabled: checked });
            }}
            disabled={cannotManage || upsertMutation.isPending}
          />
        }
      >
        <div
          className={cn(
            'transition-opacity duration-200',
            !usageLedgerEnabled && 'pointer-events-none opacity-50',
          )}
        >
          <div className="max-w-xs">
            <Input
              label="Retention Days"
              type="number"
              value={usageLedgerRetentionDays}
              onChange={(e) =>
                setUsageLedgerRetentionDays(
                  e.target.value ? Number(e.target.value) : 0,
                )
              }
              onBlur={() => void saveConfig({ usageLedgerRetentionDays })}
              disabled={cannotManage || !usageLedgerEnabled}
              size="sm"
              placeholder="e.g. 365"
              min={30}
              max={3650}
            />
            <Text className="text-muted-foreground mt-1 text-xs">
              Usage ledger rows older than this will be deleted (30–3650 days).
            </Text>
          </div>
        </div>
      </PageSection>

      <PageSection
        title="Login Attempts"
        description="Automatically delete failed-login tracking records (loginAttempts, per-hour block counters) older than the retention period. Note: these tables are deployment-wide — the strictest (shortest) value across all orgs is used."
        action={
          <Switch
            label="Enabled"
            checked={loginAttemptsEnabled}
            onCheckedChange={(checked) => {
              setLoginAttemptsEnabled(checked);
              void saveConfig({ loginAttemptsEnabled: checked });
            }}
            disabled={cannotManage || upsertMutation.isPending}
          />
        }
      >
        <div
          className={cn(
            'transition-opacity duration-200',
            !loginAttemptsEnabled && 'pointer-events-none opacity-50',
          )}
        >
          <div className="max-w-xs">
            <Input
              label="Retention Days"
              type="number"
              value={loginAttemptRetentionDays}
              onChange={(e) =>
                setLoginAttemptRetentionDays(
                  e.target.value ? Number(e.target.value) : 0,
                )
              }
              onBlur={() => void saveConfig({ loginAttemptRetentionDays })}
              disabled={cannotManage || !loginAttemptsEnabled}
              size="sm"
              placeholder="e.g. 90"
              min={7}
              max={365}
            />
            <Text className="text-muted-foreground mt-1 text-xs">
              Login attempt records older than this will be deleted (7–365
              days).
            </Text>
          </div>
        </div>
      </PageSection>
    </Stack>
  );
}
