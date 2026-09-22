'use client';

import { Skeletonize } from '@tale/ui/skeleton-context';
import { Switch } from '@tale/ui/switch';
import { useToast } from '@tale/ui/use-toast';
import { useCallback, useState } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

// The org default for the one personalization feature the app offers. The
// `user_memories` policy still exists in the governance schema (a policy file
// an org may carry), but no switch reads it while chat memories stay an open
// product decision — offering a default for a feature nobody can turn on
// would be a promise the app cannot keep.
type PolicyType = 'custom_instructions';

interface PersonalizationPolicyToggleProps {
  organizationId: string;
  policyType: PolicyType;
  titleKey: string;
  descriptionKey: string;
}

function readEnabled(raw: unknown): boolean {
  return isRecord(raw) && raw['enabled'] === true;
}

// =============================================================================
// Single toggle — owns data fetching, the local toggle state, save/toast
// wiring, and the loading state. Renders the REAL `SettingsSection` +
// skeleton-aware `Switch` once, always, wrapped in `<Skeletonize>`. The
// skeleton-aware `<Switch>` masks itself to its exact track size while loading.
// =============================================================================
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

  // Read the server value directly each render — no `useState` mirror copied in
  // via `useEffect`, so the real value is present on the first render after
  // `isLoading` flips (no stale `false` flash). `pending` holds only the
  // optimistic value while a save is in flight; `null` means "show the server
  // value", which lets later server changes flow through once the save settles.
  const savedEnabled = readEnabled(policy?.config);
  const [pending, setPending] = useState<boolean | null>(null);
  const enabled = pending ?? savedEnabled;

  const cannotManage = ability.cannot('write', 'orgSettings');

  const handleToggleEnabled = useCallback(
    async (checked: boolean) => {
      setPending(checked);
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
      } catch (error) {
        console.error('[personalization_policy] save failed', error);
        toast({
          title: t('toastSaveFailedTitle'),
          description: t('personalization.saveFailed'),
          variant: 'destructive',
        });
      } finally {
        // Drop the optimistic override; the reactive `getPolicy` query now
        // reflects the saved value (success) or still holds the old one (error).
        setPending(null);
      }
    },
    [organizationId, policyType, upsertMutation, toast, t],
  );

  return (
    <Skeletonize loading={isLoading} label={t(titleKey)}>
      <SettingsSection
        // Always a later chapter on Policies & limits (after Budgets / Upload /
        // Retention / Feature flags) — the toggle gets the shared divider.
        title={t(titleKey)}
        description={t(descriptionKey)}
        action={
          <Switch
            aria-label={t('personalization.enabledLabel')}
            checked={enabled}
            onCheckedChange={handleToggleEnabled}
            disabled={cannotManage || upsertMutation.isPending}
          />
        }
      />
    </Skeletonize>
  );
}

interface PersonalizationPolicyEditorProps {
  organizationId: string;
}

export function PersonalizationPolicyEditor({
  organizationId,
}: PersonalizationPolicyEditorProps) {
  return (
    <PersonalizationPolicyToggle
      organizationId={organizationId}
      policyType="custom_instructions"
      titleKey="personalization.customInstructions.title"
      descriptionKey="personalization.customInstructions.description"
    />
  );
}
