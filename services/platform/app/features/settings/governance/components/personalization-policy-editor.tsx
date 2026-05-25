'use client';

import { PageSection } from '@tale/ui/page-section';
import { Skeleton } from '@tale/ui/skeleton';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Switch } from '@/app/components/ui/forms/switch';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

type PolicyType = 'custom_instructions' | 'user_memories';

interface PersonalizationPolicyToggleProps {
  organizationId: string;
  policyType: PolicyType;
  titleKey: string;
  descriptionKey: string;
}

function readEnabled(raw: unknown): boolean {
  return isRecord(raw) && raw['enabled'] === true;
}

function PersonalizationPolicyToggle({
  organizationId,
  policyType,
  titleKey,
  descriptionKey,
}: PersonalizationPolicyToggleProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    policyType,
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const savedEnabled = useMemo(() => readEnabled(policy?.config), [policy]);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(savedEnabled);
  }, [savedEnabled]);

  const cannotManage = ability.cannot('write', 'orgSettings');

  const handleToggleEnabled = useCallback(
    async (checked: boolean) => {
      setEnabled(checked);
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType,
          config: { enabled: checked },
        });
        toast({
          title: t('toastSavedTitle'),
          description: t('personalization.saved'),
          variant: 'success',
        });
      } catch {
        setEnabled(!checked);
        toast({
          title: t('toastSaveFailedTitle'),
          description: t('personalization.saveFailed'),
          variant: 'destructive',
        });
      }
    },
    [organizationId, policyType, upsertMutation, toast, t],
  );

  if (isLoading) {
    return (
      <div aria-busy="true" className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Skeleton className="h-3.5 w-14" />
          <Skeleton className="h-[1.15rem] w-8 rounded-full" />
        </div>
      </div>
    );
  }

  return (
    <PageSection
      title={t(titleKey)}
      description={t(descriptionKey)}
      action={
        <Switch
          label={t('personalization.enabledLabel')}
          checked={enabled}
          onCheckedChange={handleToggleEnabled}
          disabled={cannotManage || upsertMutation.isPending}
        />
      }
    />
  );
}

interface PersonalizationPolicyEditorProps {
  organizationId: string;
}

export function PersonalizationPolicyEditor({
  organizationId,
}: PersonalizationPolicyEditorProps) {
  return (
    <>
      <PersonalizationPolicyToggle
        organizationId={organizationId}
        policyType="custom_instructions"
        titleKey="personalization.customInstructions.title"
        descriptionKey="personalization.customInstructions.description"
      />
      <PersonalizationPolicyToggle
        organizationId={organizationId}
        policyType="user_memories"
        titleKey="personalization.memories.title"
        descriptionKey="personalization.memories.description"
      />
    </>
  );
}
