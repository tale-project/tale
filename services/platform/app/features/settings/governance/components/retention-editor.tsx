'use client';

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

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

/** Per-section skeleton: matches SectionHeader(items-center, gap-4) + Switch(label + h-[1.15rem] w-8 pill) + optional body. */
function retentionSectionSkeleton(withBody: boolean): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Skeleton className="h-3.5 w-14" />
          <Skeleton className="h-[1.15rem] w-8 rounded-full" />
        </div>
      </div>
      {withBody && (
        <div className="flex max-w-xs flex-col gap-1.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="mt-0.5 h-3 w-48 max-w-full" />
        </div>
      )}
    </div>
  );
}

interface RetentionSectionProps {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (checked: boolean) => void;
  toggleDisabled: boolean;
  /** Body is hidden entirely when `enabled` is false. */
  children: ReactNode;
}

function RetentionSection({
  title,
  description,
  enabled,
  onToggle,
  toggleDisabled,
  children,
}: RetentionSectionProps) {
  return (
    <PageSection
      title={title}
      description={description}
      action={
        <Switch
          label="Enabled"
          checked={enabled}
          onCheckedChange={onToggle}
          disabled={toggleDisabled}
        />
      }
    >
      {enabled && children}
    </PageSection>
  );
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
  const toggleDisabled = cannotManage || upsertMutation.isPending;

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
        toast({
          title: t('toastSavedTitle'),
          description: t('retentionPolicy.saved'),
          variant: 'success',
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Failed to save';
        toast({
          title: t('toastSaveFailedTitle'),
          description: message,
          variant: 'destructive',
        });
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
      <div aria-busy="true" className="flex flex-col gap-6">
        {retentionSectionSkeleton(true)}
        {retentionSectionSkeleton(false)}
        {retentionSectionSkeleton(true)}
      </div>
    );
  }

  return (
    <Stack gap={6}>
      <RetentionSection
        title="Chat History"
        description="Automatically delete chat threads (conversations with agents) older than the retention period. Message contents in the agent component are archived. Deletion is irreversible."
        enabled={chatHistoryEnabled}
        toggleDisabled={toggleDisabled}
        onToggle={(checked) => {
          setChatHistoryEnabled(checked);
          void saveConfig({ chatHistoryEnabled: checked });
        }}
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
            disabled={cannotManage}
            size="sm"
            placeholder="e.g. 90"
            min={1}
            max={3650}
          />
          <Text className="text-muted-foreground mt-1 text-xs">
            Chat threads older than this (by last-updated time) will be deleted.
          </Text>
        </div>
      </RetentionSection>

      <RetentionSection
        title="Document Retention"
        description="Automatically delete documents that exceed the retention period. Use with caution — deleted documents cannot be recovered."
        enabled={enabled}
        toggleDisabled={toggleDisabled}
        onToggle={(checked) => {
          setEnabled(checked);
          void saveConfig({ enabled: checked });
        }}
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
            disabled={cannotManage}
            size="sm"
            placeholder="e.g. 90"
            min={0}
          />
          <Text className="text-muted-foreground mt-1 text-xs">
            Documents older than this will be deleted.
          </Text>
        </div>
      </RetentionSection>

      <RetentionSection
        title="User Temporary File Cleanup"
        description="Automatically delete files uploaded by users but never saved to a document (e.g. chat attachments, aborted uploads)."
        enabled={userTempEnabled}
        toggleDisabled={toggleDisabled}
        onToggle={(checked) => {
          setUserTempEnabled(checked);
          void saveConfig({ userTempEnabled: checked });
        }}
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
            disabled={cannotManage}
            size="sm"
            placeholder="e.g. 24"
            min={0}
          />
          <Text className="text-muted-foreground mt-1 text-xs">
            Temporary files older than this will be deleted.
          </Text>
        </div>
      </RetentionSection>

      <RetentionSection
        title="Agent Temporary File Cleanup"
        description="Automatically delete files generated by agents but never saved to a document (e.g. intermediate outputs, knowledge files)."
        enabled={agentTempEnabled}
        toggleDisabled={toggleDisabled}
        onToggle={(checked) => {
          setAgentTempEnabled(checked);
          void saveConfig({ agentTempEnabled: checked });
        }}
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
            disabled={cannotManage}
            size="sm"
            placeholder="e.g. 24"
            min={0}
          />
          <Text className="text-muted-foreground mt-1 text-xs">
            Temporary files older than this will be deleted.
          </Text>
        </div>
      </RetentionSection>

      <RetentionSection
        title="Workflow Execution Logs"
        description="Automatically delete workflow execution records and trigger logs older than the retention period. Includes per-execution variable/output storage blobs."
        enabled={workflowLogsEnabled}
        toggleDisabled={toggleDisabled}
        onToggle={(checked) => {
          setWorkflowLogsEnabled(checked);
          void saveConfig({ workflowLogsEnabled: checked });
        }}
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
            disabled={cannotManage}
            size="sm"
            placeholder="e.g. 30"
            min={1}
            max={365}
          />
          <Text className="text-muted-foreground mt-1 text-xs">
            Workflow runs older than this will be deleted (1–365 days).
          </Text>
        </div>
      </RetentionSection>

      <RetentionSection
        title="Audit Logs"
        description="Automatically delete audit log entries older than the retention period. Note: audit logs are immutable historical records used for compliance; keep retention long enough to satisfy your audit/compliance requirements."
        enabled={auditLogsEnabled}
        toggleDisabled={toggleDisabled}
        onToggle={(checked) => {
          setAuditLogsEnabled(checked);
          void saveConfig({ auditLogsEnabled: checked });
        }}
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
            disabled={cannotManage}
            size="sm"
            placeholder="e.g. 90"
            min={30}
            max={365}
          />
          <Text className="text-muted-foreground mt-1 text-xs">
            Audit log entries older than this will be deleted (30–365 days).
          </Text>
        </div>
      </RetentionSection>

      <RetentionSection
        title="Usage Ledger"
        description="Automatically delete token-usage ledger rows older than the retention period. Warning: shortening this retention truncates historical analytics (budgets/reports rely on ledger rows)."
        enabled={usageLedgerEnabled}
        toggleDisabled={toggleDisabled}
        onToggle={(checked) => {
          setUsageLedgerEnabled(checked);
          void saveConfig({ usageLedgerEnabled: checked });
        }}
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
            disabled={cannotManage}
            size="sm"
            placeholder="e.g. 365"
            min={30}
            max={3650}
          />
          <Text className="text-muted-foreground mt-1 text-xs">
            Usage ledger rows older than this will be deleted (30–3650 days).
          </Text>
        </div>
      </RetentionSection>

      <RetentionSection
        title="Login Attempts"
        description="Automatically delete failed-login tracking records (loginAttempts, per-hour block counters) older than the retention period. Note: these tables are deployment-wide — the strictest (shortest) value across all orgs is used."
        enabled={loginAttemptsEnabled}
        toggleDisabled={toggleDisabled}
        onToggle={(checked) => {
          setLoginAttemptsEnabled(checked);
          void saveConfig({ loginAttemptsEnabled: checked });
        }}
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
            disabled={cannotManage}
            size="sm"
            placeholder="e.g. 90"
            min={7}
            max={365}
          />
          <Text className="text-muted-foreground mt-1 text-xs">
            Login attempt records older than this will be deleted (7–365 days).
          </Text>
        </div>
      </RetentionSection>
    </Stack>
  );
}
