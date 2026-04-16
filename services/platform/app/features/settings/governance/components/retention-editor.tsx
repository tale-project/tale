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

  if (!isLoading && !initializedRef.current) {
    initializedRef.current = true;
    setEnabled(savedConfig.enabled);
    setRetentionDays(savedConfig.retentionDays);
    setUserTempEnabled(savedConfig.userTempEnabled ?? false);
    setUserTempRetentionHours(savedConfig.userTempRetentionHours ?? 24);
    setAgentTempEnabled(savedConfig.agentTempEnabled ?? false);
    setAgentTempRetentionHours(savedConfig.agentTempRetentionHours ?? 24);
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
    </Stack>
  );
}
