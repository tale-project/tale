'use client';

import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useCallback, useMemo, useRef, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Switch } from '@/app/components/ui/forms/switch';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SettingsToggleRow } from '@/app/features/settings/components/settings-toggle-row';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  DEFAULT_TWO_FACTOR_POLICY,
  twoFactorPolicyConfigSchema,
  type TwoFactorPolicyConfig,
} from '@/lib/shared/schemas/governance';
import { cn } from '@/lib/utils/cn';

import { createConfigParser } from '../config-parser';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

interface TwoFactorPolicyEditorProps {
  organizationId: string;
}

const parseConfig = createConfigParser(twoFactorPolicyConfigSchema, () => ({
  ...DEFAULT_TWO_FACTOR_POLICY,
}));

// =============================================================================
// Single editor — owns data fetching, the local state mirrors, instant-save
// handlers, and the loading state. Renders the REAL layout once, always,
// wrapped in `<Skeletonize>` while `isLoading` (or before the state has been
// seeded from the loaded config). The skeleton-aware header `<Switch>`, the
// grace-period `<Input>`, and the exempt-SSO `<Switch>` mask themselves to
// their exact size while loading. The disabled-policy hint and field hints stay
// real text (read better than gray bars and are known at load time).
// =============================================================================
export function TwoFactorPolicyEditor({
  organizationId,
}: TwoFactorPolicyEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'two_factor_policy',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const savedConfig = useMemo(() => parseConfig(policy?.config), [policy]);

  const initializedRef = useRef(false);
  const [enforced, setEnforced] = useState(false);
  const [confirmEnforceOpen, setConfirmEnforceOpen] = useState(false);
  const [gracePeriodDays, setGracePeriodDays] = useState('');
  const [exemptSsoUsers, setExemptSsoUsers] = useState(true);

  if (!isLoading && !initializedRef.current) {
    initializedRef.current = true;
    setEnforced(savedConfig.enforced);
    setGracePeriodDays(String(savedConfig.gracePeriodDays));
    setExemptSsoUsers(savedConfig.exemptSsoUsers);
  }

  const cannotManage = ability.cannot('write', 'orgSettings');

  const persist = useCallback(
    async (config: TwoFactorPolicyConfig) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'two_factor_policy',
          config,
        });
        toast({ title: t('twoFactorPolicy.saved'), variant: 'success' });
        return true;
      } catch {
        toast({
          title: t('twoFactorPolicy.saveFailed'),
          variant: 'destructive',
        });
        return false;
      }
    },
    [organizationId, upsertMutation, toast, t],
  );

  const persistEnforced = useCallback(
    async (next: boolean) => {
      setEnforced(next);
      const ok = await persist({
        enforced: next,
        gracePeriodDays: savedConfig.gracePeriodDays,
        exemptSsoUsers: savedConfig.exemptSsoUsers,
      });
      if (!ok) setEnforced(!next);
    },
    [persist, savedConfig.gracePeriodDays, savedConfig.exemptSsoUsers],
  );

  // Enabling enforcement redirects every non-exempt member into 2FA
  // enrollment — far too heavy for a single header-switch click (one stray
  // QA click enforced a whole org). Confirm first; switching OFF stays
  // instant since it only relaxes.
  const handleEnforcedChange = useCallback(
    (next: boolean) => {
      if (next) {
        setConfirmEnforceOpen(true);
        return;
      }
      void persistEnforced(false);
    },
    [persistEnforced],
  );

  const handleExemptSsoChange = useCallback(
    async (next: boolean) => {
      setExemptSsoUsers(next);
      const days = Number(gracePeriodDays);
      const gracePeriodToPersist =
        Number.isInteger(days) && days >= 0 && days <= 30
          ? days
          : savedConfig.gracePeriodDays;
      const ok = await persist({
        enforced,
        gracePeriodDays: gracePeriodToPersist,
        exemptSsoUsers: next,
      });
      if (!ok) setExemptSsoUsers(!next);
    },
    [persist, enforced, gracePeriodDays, savedConfig.gracePeriodDays],
  );

  const handleGraceBlur = useCallback(async () => {
    if (gracePeriodDays === String(savedConfig.gracePeriodDays)) return;
    const days = Number(gracePeriodDays);
    if (!Number.isInteger(days) || days < 0 || days > 30) {
      setGracePeriodDays(String(savedConfig.gracePeriodDays));
      toast({
        title: t('twoFactorPolicy.invalidGrace'),
        variant: 'destructive',
      });
      return;
    }
    const ok = await persist({
      enforced,
      gracePeriodDays: days,
      exemptSsoUsers,
    });
    if (!ok) setGracePeriodDays(String(savedConfig.gracePeriodDays));
  }, [
    persist,
    enforced,
    gracePeriodDays,
    exemptSsoUsers,
    savedConfig.gracePeriodDays,
    toast,
    t,
  ]);

  // Mask until the network read resolves AND the local mirrors have been
  // seeded from it — the leaves would otherwise flash their `useState`
  // defaults (enforced=false, empty grace period) for a frame.
  const loading = isLoading || !initializedRef.current;
  const canEdit = !cannotManage;
  const isSaving = upsertMutation.isPending;

  return (
    <Skeletonize loading={loading} label={t('twoFactorPolicy.title')}>
      <SettingsSection
        title={t('twoFactorPolicy.title')}
        description={t('twoFactorPolicy.description')}
        action={
          <Switch
            aria-label={t('twoFactorPolicy.enforced')}
            checked={enforced}
            onCheckedChange={handleEnforcedChange}
            disabled={!canEdit || isSaving}
          />
        }
      >
        {/* Full section width (not max-w-2xl): matches header toggle edge.
            Short numeric grace field stays max-w-xs. */}
        <Stack gap={6}>
          {!enforced && (
            <Text variant="muted" className="text-sm">
              {t('twoFactorPolicy.policyDisabledHint')}
            </Text>
          )}

          <div
            className={cn(
              'flex flex-col gap-6 transition-opacity duration-200',
              !enforced && 'pointer-events-none opacity-50',
            )}
          >
            <Stack gap={4}>
              <Input
                label={t('twoFactorPolicy.gracePeriodDays')}
                type="number"
                value={gracePeriodDays}
                onChange={(e) => setGracePeriodDays(e.target.value)}
                onBlur={handleGraceBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                disabled={!canEdit || !enforced || isSaving}
                min={0}
                max={30}
                step={1}
                wrapperClassName="max-w-xs"
              />
              <Text variant="muted" className="text-xs">
                {t('twoFactorPolicy.gracePeriodDaysHint')}
              </Text>

              <SettingsToggleRow
                label={t('twoFactorPolicy.exemptSsoUsers')}
                description={t('twoFactorPolicy.exemptSsoUsersHint')}
                checked={exemptSsoUsers}
                onCheckedChange={handleExemptSsoChange}
                disabled={!canEdit || !enforced || isSaving}
              />
            </Stack>
          </div>
        </Stack>

        <ConfirmDialog
          open={confirmEnforceOpen}
          onOpenChange={setConfirmEnforceOpen}
          title={t('twoFactorPolicy.confirmEnforceTitle')}
          description={t('twoFactorPolicy.confirmEnforceDescription')}
          confirmText={t('twoFactorPolicy.confirmEnforceCta')}
          onConfirm={() => {
            setConfirmEnforceOpen(false);
            void persistEnforced(true);
          }}
        />
      </SettingsSection>
    </Skeletonize>
  );
}
