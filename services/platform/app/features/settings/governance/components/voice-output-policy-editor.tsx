'use client';

import { Skeleton } from '@tale/ui/skeleton';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { z } from 'zod';

import { Switch } from '@/app/components/ui/forms/switch';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { voiceOutputConfigSchema } from '@/lib/shared/schemas/governance';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

type VoiceOutputConfig = z.infer<typeof voiceOutputConfigSchema>;

interface VoiceOutputPolicyEditorProps {
  organizationId: string;
}

// Backend default is ON when the policy row is missing (see
// `isVoiceOutputOrgEnabled` in convex/tts/queries.ts). Mirror that here so
// the toggle reflects effective state, not just persisted state.
function parseConfig(raw: unknown): VoiceOutputConfig {
  const obj = isRecord(raw) ? raw : {};
  const result = voiceOutputConfigSchema.safeParse(obj);
  if (result.success) return result.data;
  return { enabled: true };
}

export function VoiceOutputPolicyEditor({
  organizationId,
}: VoiceOutputPolicyEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'voice_output',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const savedConfig = useMemo(() => parseConfig(policy?.config), [policy]);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(savedConfig.enabled);
  }, [savedConfig]);

  const cannotManage = ability.cannot('write', 'orgSettings');

  const handleToggleEnabled = useCallback(
    async (checked: boolean) => {
      setEnabled(checked);
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'voice_output',
          config: { enabled: checked },
        });
        toast({
          title: t('toastSavedTitle'),
          description: t('voiceOutput.saved'),
          variant: 'success',
        });
      } catch {
        setEnabled(!checked);
        toast({
          title: t('toastSaveFailedTitle'),
          description: t('voiceOutput.saveFailed'),
          variant: 'destructive',
        });
      }
    },
    [organizationId, upsertMutation, toast, t],
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
      title={t('voiceOutput.title')}
      description={t('voiceOutput.description')}
      action={
        <Switch
          label={t('voiceOutput.enabledLabel')}
          checked={enabled}
          onCheckedChange={handleToggleEnabled}
          disabled={cannotManage || upsertMutation.isPending}
        />
      }
    />
  );
}
