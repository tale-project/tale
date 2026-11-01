'use client';

import {
  type PersonalKeysConfig,
  personalKeysConfigSchema,
  personalKeysWorkOf,
} from '@tale/shared/schemas/governance';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Switch } from '@tale/ui/switch';
import { useToast } from '@tale/ui/use-toast';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { withGovernancePolicyReadBoundary } from '@/app/features/settings/governance/components/policy-read-boundary';
import { createConfigParser } from '@/app/features/settings/governance/config-parser';
import { mapGovernanceSaveError } from '@/app/features/settings/governance/governance-save-errors';
import { useUpsertGovernancePolicy } from '@/app/features/settings/governance/hooks/mutations';
import { useGovernancePolicy } from '@/app/features/settings/governance/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { usePolicySettling } from '@/app/lib/backend/policy-write-order';
import { useT } from '@/lib/i18n/client';

interface PersonalKeysPolicyEditorProps {
  organizationId: string;
}

// A missing file lets the keys in — the behaviour before the policy existed —
// so the switch shows the state actually in force.
const parseConfig = createConfigParser(
  personalKeysConfigSchema,
  (): PersonalKeysConfig => ({ enabled: true }),
);

// =============================================================================
// Whether the members' own API keys — the ones they make for themselves, which
// work in every organization they belong to — work in this one. Off refuses
// them all at `/api/v1` for this organization, an Owner's or Admin's own
// included; the keys made here for a member, a team, a project or the
// organization keep working. The switch saves at once and stays disabled while
// a write of the policy, or its re-read, is in flight, so it never acts on a
// state it no longer shows.
// =============================================================================
function PersonalKeysPolicyEditorContent({
  organizationId,
}: PersonalKeysPolicyEditorProps) {
  const { t } = useT('settings');
  const { t: tGovernance } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'personal_keys',
  );
  const upsertMutation = useUpsertGovernancePolicy({ errorToast: false });
  const settling = usePolicySettling(organizationId, 'personal_keys');

  const enabled = personalKeysWorkOf(parseConfig(policy?.config));
  const cannotManage = ability.cannot('write', 'orgSettings');

  // `errorToast: false` + reporting from the call's own promise keeps a
  // failure to a single toast.
  const handleToggle = (checked: boolean) => {
    void upsertMutation
      .mutateAsync({
        organizationId,
        policyType: 'personal_keys',
        config: { enabled: checked } satisfies PersonalKeysConfig,
      })
      .then(
        () =>
          toast({
            title: tGovernance('toastSavedTitle'),
            description: t('apiKeys.personalKeys.saved'),
            variant: 'success',
          }),
        (error: unknown) => {
          console.error('[personalKeys toggle]', error);
          toast({
            title: tGovernance('toastSaveFailedTitle'),
            description: mapGovernanceSaveError(
              error,
              tGovernance,
              t('apiKeys.personalKeys.saveFailed'),
            ),
            variant: 'destructive',
          });
        },
      );
  };

  return (
    <Skeletonize loading={isLoading} label={t('apiKeys.personalKeys.title')}>
      <SettingsSection
        title={t('apiKeys.personalKeys.title')}
        description={t('apiKeys.personalKeys.description')}
        action={
          <Switch
            aria-label={t('apiKeys.personalKeys.enabledLabel')}
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={cannotManage || upsertMutation.isPending || settling}
          />
        }
      />
    </Skeletonize>
  );
}

export const PersonalKeysPolicyEditor = withGovernancePolicyReadBoundary(
  PersonalKeysPolicyEditorContent,
  'personal_keys',
);
