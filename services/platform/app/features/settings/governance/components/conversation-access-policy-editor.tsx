'use client';

import { Skeletonize } from '@tale/ui/skeleton-context';

import { Switch } from '@/app/components/ui/forms/switch';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { conversationAccessConfigSchema } from '@/lib/shared/schemas/governance';

import { createConfigParser } from '../config-parser';
import { mapGovernanceSaveError } from '../governance-save-errors';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

interface ConversationAccessPolicyEditorProps {
  organizationId: string;
}

// Backend default is OFF when the policy row is missing (org-wide conversation
// visibility — today's behaviour). Mirror that here so the toggle reflects the
// effective state, not just the persisted one.
const parseConfig = createConfigParser(conversationAccessConfigSchema, () => ({
  restrictAssigned: false,
}));

/**
 * Toggle for the opt-in `conversation_access` policy. When on, an assigned
 * conversation is visible only to its assignee team / individual owner (admins
 * always see all); unassigned conversations stay an org-wide pool. Enforced in
 * the conversations RLS rules — this only writes the governance policy file.
 */
export function ConversationAccessPolicyEditor({
  organizationId,
}: ConversationAccessPolicyEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'conversation_access',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const restrictAssigned = parseConfig(policy?.config).restrictAssigned;
  const cannotManage = ability.cannot('write', 'orgSettings');

  const handleToggle = (checked: boolean) => {
    upsertMutation.mutate(
      {
        organizationId,
        policyType: 'conversation_access',
        config: { restrictAssigned: checked },
      },
      {
        onSuccess: () =>
          toast({
            title: t('toastSavedTitle'),
            description: t('conversationAccess.saved'),
            variant: 'success',
          }),
        onError: (error) =>
          toast({
            title: t('toastSaveFailedTitle'),
            description: mapGovernanceSaveError(
              error,
              t,
              t('conversationAccess.saveFailed'),
            ),
            variant: 'destructive',
          }),
      },
    );
  };

  return (
    <Skeletonize loading={isLoading} label={t('conversationAccess.title')}>
      <SettingsSection
        title={t('conversationAccess.title')}
        description={t('conversationAccess.description')}
        action={
          <Switch
            aria-label={t('conversationAccess.enabledLabel')}
            checked={restrictAssigned}
            onCheckedChange={handleToggle}
            disabled={cannotManage || upsertMutation.isPending}
          />
        }
      />
    </Skeletonize>
  );
}
