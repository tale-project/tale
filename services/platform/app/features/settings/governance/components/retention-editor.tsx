'use client';

import { Skeleton } from '@tale/ui/skeleton';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

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
  const { t } = useT('governance');
  return (
    <PageSection
      title={title}
      description={description}
      action={
        <Switch
          label={t('retentionPolicy.enabled')}
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
        title={t('retentionPolicy.chatHistory.title')}
        description={t('retentionPolicy.chatHistory.description')}
        enabled={chatHistoryEnabled}
        toggleDisabled={toggleDisabled}
        onToggle={(checked) => {
          setChatHistoryEnabled(checked);
          void saveConfig({ chatHistoryEnabled: checked });
        }}
      >
        <div className="max-w-xs">
          <Input
            label={t('retentionPolicy.retentionDays')}
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
            placeholder={t('retentionPolicy.chatHistory.placeholder')}
            min={1}
            max={3650}
          />
          <Text className="text-muted-foreground mt-1 text-xs">
            {t('retentionPolicy.chatHistory.helper')}
          </Text>
        </div>
      </RetentionSection>

      <RetentionSection
        title={t('retentionPolicy.documents.title')}
        description={t('retentionPolicy.documents.description')}
        enabled={enabled}
        toggleDisabled={toggleDisabled}
        onToggle={(checked) => {
          setEnabled(checked);
          void saveConfig({ enabled: checked });
        }}
      >
        <div className="max-w-xs">
          <Input
            label={t('retentionPolicy.retentionDays')}
            type="number"
            value={retentionDays}
            onChange={(e) =>
              setRetentionDays(e.target.value ? Number(e.target.value) : 0)
            }
            onBlur={() => void saveConfig({ retentionDays })}
            disabled={cannotManage}
            size="sm"
            placeholder={t('retentionPolicy.documents.placeholder')}
            min={0}
          />
          <Text className="text-muted-foreground mt-1 text-xs">
            {t('retentionPolicy.documents.helper')}
          </Text>
        </div>
      </RetentionSection>

      <RetentionSection
        title={t('retentionPolicy.userTemp.title')}
        description={t('retentionPolicy.userTemp.description')}
        enabled={userTempEnabled}
        toggleDisabled={toggleDisabled}
        onToggle={(checked) => {
          setUserTempEnabled(checked);
          void saveConfig({ userTempEnabled: checked });
        }}
      >
        <div className="max-w-xs">
          <Input
            label={t('retentionPolicy.retentionHours')}
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
            placeholder={t('retentionPolicy.userTemp.placeholder')}
            min={0}
          />
          <Text className="text-muted-foreground mt-1 text-xs">
            {t('retentionPolicy.userTemp.helper')}
          </Text>
        </div>
      </RetentionSection>

      <RetentionSection
        title={t('retentionPolicy.agentTemp.title')}
        description={t('retentionPolicy.agentTemp.description')}
        enabled={agentTempEnabled}
        toggleDisabled={toggleDisabled}
        onToggle={(checked) => {
          setAgentTempEnabled(checked);
          void saveConfig({ agentTempEnabled: checked });
        }}
      >
        <div className="max-w-xs">
          <Input
            label={t('retentionPolicy.retentionHours')}
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
            placeholder={t('retentionPolicy.agentTemp.placeholder')}
            min={0}
          />
          <Text className="text-muted-foreground mt-1 text-xs">
            {t('retentionPolicy.agentTemp.helper')}
          </Text>
        </div>
      </RetentionSection>

      <RetentionSection
        title={t('retentionPolicy.workflowLogs.title')}
        description={t('retentionPolicy.workflowLogs.description')}
        enabled={workflowLogsEnabled}
        toggleDisabled={toggleDisabled}
        onToggle={(checked) => {
          setWorkflowLogsEnabled(checked);
          void saveConfig({ workflowLogsEnabled: checked });
        }}
      >
        <div className="max-w-xs">
          <Input
            label={t('retentionPolicy.retentionDays')}
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
            placeholder={t('retentionPolicy.workflowLogs.placeholder')}
            min={1}
            max={365}
          />
          <Text className="text-muted-foreground mt-1 text-xs">
            {t('retentionPolicy.workflowLogs.helper')}
          </Text>
        </div>
      </RetentionSection>

      <RetentionSection
        title={t('retentionPolicy.auditLogs.title')}
        description={t('retentionPolicy.auditLogs.description')}
        enabled={auditLogsEnabled}
        toggleDisabled={toggleDisabled}
        onToggle={(checked) => {
          setAuditLogsEnabled(checked);
          void saveConfig({ auditLogsEnabled: checked });
        }}
      >
        <div className="max-w-xs">
          <Input
            label={t('retentionPolicy.retentionDays')}
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
            placeholder={t('retentionPolicy.auditLogs.placeholder')}
            min={30}
            max={365}
          />
          <Text className="text-muted-foreground mt-1 text-xs">
            {t('retentionPolicy.auditLogs.helper')}
          </Text>
        </div>
      </RetentionSection>

      <RetentionSection
        title={t('retentionPolicy.usageLedger.title')}
        description={t('retentionPolicy.usageLedger.description')}
        enabled={usageLedgerEnabled}
        toggleDisabled={toggleDisabled}
        onToggle={(checked) => {
          setUsageLedgerEnabled(checked);
          void saveConfig({ usageLedgerEnabled: checked });
        }}
      >
        <div className="max-w-xs">
          <Input
            label={t('retentionPolicy.retentionDays')}
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
            placeholder={t('retentionPolicy.usageLedger.placeholder')}
            min={30}
            max={3650}
          />
          <Text className="text-muted-foreground mt-1 text-xs">
            {t('retentionPolicy.usageLedger.helper')}
          </Text>
        </div>
      </RetentionSection>

      <RetentionSection
        title={t('retentionPolicy.loginAttempts.title')}
        description={t('retentionPolicy.loginAttempts.description')}
        enabled={loginAttemptsEnabled}
        toggleDisabled={toggleDisabled}
        onToggle={(checked) => {
          setLoginAttemptsEnabled(checked);
          void saveConfig({ loginAttemptsEnabled: checked });
        }}
      >
        <div className="max-w-xs">
          <Input
            label={t('retentionPolicy.retentionDays')}
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
            placeholder={t('retentionPolicy.loginAttempts.placeholder')}
            min={7}
            max={365}
          />
          <Text className="text-muted-foreground mt-1 text-xs">
            {t('retentionPolicy.loginAttempts.helper')}
          </Text>
        </div>
      </RetentionSection>
    </Stack>
  );
}
