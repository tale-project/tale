'use client';

import { PageSection } from '@tale/ui/page-section';
import { Skeletonize } from '@tale/ui/skeleton-context';
import type { z } from 'zod';

import { Switch } from '@/app/components/ui/forms/switch';
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

// =============================================================================
// Single editor — owns data fetching, save/toast wiring, and the loading
// state. Renders the REAL `PageSection` + skeleton-aware `Switch` once, always,
// wrapped in `<Skeletonize>`. The skeleton-aware `<Switch>` masks itself to its
// exact track size while loading.
// =============================================================================
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

  // Derived straight from the query: the optimistic update flips it the instant
  // the switch is toggled and Convex rolls it back on failure, so no local
  // mirror state (and no manual rollback) is needed.
  const enabled = parseConfig(policy?.config).enabled;

  const cannotManage = ability.cannot('write', 'orgSettings');

  const handleToggleEnabled = (checked: boolean) => {
    upsertMutation.mutate(
      {
        organizationId,
        policyType: 'voice_output',
        config: { enabled: checked },
      },
      {
        onSuccess: () =>
          toast({
            title: t('toastSavedTitle'),
            description: t('voiceOutput.saved'),
            variant: 'success',
          }),
      },
    );
  };

  return (
    <Skeletonize loading={isLoading} label={t('voiceOutput.title')}>
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
    </Skeletonize>
  );
}
