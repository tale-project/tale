'use client';

import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { lazy, useCallback, useRef, useState } from 'react';

import { SuspenseBoundary } from '@/app/components/error-boundaries/core/suspense-boundary';
import { Switch } from '@/app/components/ui/forms/switch';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { mapGovernanceSaveError } from '../governance-save-errors';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import type { PiiConfigPanelValue } from './pii/pii-config-panel';

// The PII engine (which `PiiConfigPanel` transitively imports from
// `@/lib/pii`) ships 43 typed locale modules + libphonenumber-js
// metadata. Loading it eagerly on the guardrails route makes the page
// slower for every admin, even those who never touch PII. Lazy-load so
// the chunk only fetches when the user actually toggles PII on.
const PiiConfigPanel = lazy(() =>
  import('./pii/pii-config-panel').then((mod) => ({
    default: mod.PiiConfigPanel,
  })),
);

interface PiiConfigProps {
  organizationId: string;
}

const DEFAULT_VALUE: PiiConfigPanelValue = {
  mode: 'tokenize',
  enabledPatterns: [],
  customPatterns: [],
};

/**
 * Universal, org-agnostic detection patterns seeded the first time PII
 * protection is enabled (#2656) — email, phone, and the common financial /
 * government identifiers apply identically to every org, unlike the
 * content-safety word lists or the moderation endpoint, which genuinely
 * can't be guessed. Without this, the toggle persists `enabledPatterns: []`
 * and protects nothing until the admin hand-checks boxes. The admin can
 * still deselect any of these afterwards.
 */
const DEFAULT_ENABLED_PATTERNS: readonly string[] = [
  'email',
  'phone',
  'creditCard',
  'cvc',
  'iban',
  'ssn',
  'nationalId',
];

/** Matches the builtin default (`builtin-configs/governance/pii-config.json`
 *  → `mode: "mask"`) so the first-enable write doesn't silently diverge from
 *  the documented default. */
const FIRST_ENABLE_MODE: PiiConfigPanelValue['mode'] = 'mask';

type PiiPolicy = ReturnType<typeof useGovernancePolicy>['data'];

function deriveValue(policy: PiiPolicy): PiiConfigPanelValue {
  if (!policy) return DEFAULT_VALUE;
  return {
    mode: policy.config?.mode ?? 'tokenize',
    enabledPatterns: policy.config?.enabledPatterns ?? [],
    customPatterns: policy.config?.customPatterns ?? [],
  };
}

// =============================================================================
// Single editor — owns data fetching, local edit state, save/toast wiring, and
// the loading state. Renders the REAL layout once, always, wrapped in
// `<Skeletonize>`. The skeleton-aware `<Switch>` masks itself to its exact
// track height while loading; the lazy panel only mounts once PII is enabled.
//
// Local state is seeded LAZILY from the (possibly already-warm) policy so the
// very first render shows the real values — there is no post-mount
// `useEffect`/`initializedRef` swap that used to flash the skeleton (or default
// values) for one frame on a warm navigation. A one-time render-time sync still
// picks up a cold read once it lands; it runs in the same render the data
// arrives, so the committed DOM is correct with no flicker. Subsequent edits
// stay client-owned (the upsert mutation patches the `getPolicy` read
// optimistically), so the panel never flickers on each save round-trip.
// =============================================================================
export function PiiConfig({ organizationId }: PiiConfigProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'pii_config',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const [enabled, setEnabled] = useState(() => policy?.enabled ?? false);
  const [value, setValue] = useState<PiiConfigPanelValue>(() =>
    deriveValue(policy),
  );

  const cannotManage = ability.cannot('write', 'orgSettings');

  // One-time sync for the cold-load case: when `policy` first lands the lazy
  // seed above ran against `undefined`, so adopt the real values. This sets
  // state during the render the data arrives — pre-commit — so it never
  // produces a visible default→real flash. After this, edits are client-owned.
  const syncedRef = useRef(policy != null);
  if (!syncedRef.current && policy != null) {
    syncedRef.current = true;
    setEnabled(policy.enabled ?? false);
    setValue(deriveValue(policy));
  }

  const persistConfig = useCallback(
    async (overrides: { enabled?: boolean; value?: PiiConfigPanelValue }) => {
      const nextEnabled = overrides.enabled ?? enabled;
      const nextValue = overrides.value ?? value;
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'pii_config' as const,
          config: {
            enabled: nextEnabled,
            mode: nextValue.mode,
            enabledPatterns: nextValue.enabledPatterns,
            customPatterns: nextValue.customPatterns.filter(
              (p: { name: string; regex: string; replacement: string }) =>
                p.name && p.regex && p.replacement,
            ),
          },
        });
        toast({
          title: t('toastSavedTitle'),
          description: t('pii.saved'),
          variant: 'success',
        });
      } catch (error: unknown) {
        toast({
          title: t('toastSaveFailedTitle'),
          description: mapGovernanceSaveError(error, t, t('pii.saveFailed')),
          variant: 'destructive',
        });
      }
    },
    [upsertMutation, organizationId, enabled, value, toast, t],
  );

  const handleEnabledChange = useCallback(
    (checked: boolean) => {
      setEnabled(checked);
      // #2656: nothing configured yet (no patterns picked) is exactly the
      // "first enable" moment — seed the universal defaults + the
      // documented mode so the toggle protects something immediately,
      // instead of persisting an empty, inert `enabledPatterns: []`. Any
      // org that already picked patterns keeps them untouched.
      if (checked && value.enabledPatterns.length === 0) {
        const seeded: PiiConfigPanelValue = {
          ...value,
          mode: FIRST_ENABLE_MODE,
          enabledPatterns: [...DEFAULT_ENABLED_PATTERNS],
        };
        setValue(seeded);
        void persistConfig({ enabled: checked, value: seeded });
        return;
      }
      void persistConfig({ enabled: checked });
    },
    [persistConfig, value],
  );

  const handlePanelChange = useCallback(
    (next: PiiConfigPanelValue) => {
      setValue(next);
      void persistConfig({ value: next });
    },
    [persistConfig],
  );

  return (
    <Skeletonize loading={isLoading} label={t('pii.title')}>
      <SettingsSection
        id="guardrails-pii"
        title={t('pii.title')}
        description={t('pii.description')}
        action={
          <Switch
            aria-label={t('pii.enableLabel')}
            checked={enabled}
            onCheckedChange={handleEnabledChange}
            disabled={cannotManage || upsertMutation.isPending}
          />
        }
      >
        {enabled && (
          // The lazy chunk's size is genuinely unknown, so a fixed-height
          // `SkeletonBox` is the honest placeholder until it hydrates.
          <SuspenseBoundary
            fallback={
              <Skeletonize loading>
                <SkeletonBox fullWidth>
                  <div className="h-64 w-full" />
                </SkeletonBox>
              </Skeletonize>
            }
          >
            <PiiConfigPanel
              value={value}
              onChange={handlePanelChange}
              disabled={cannotManage}
            />
          </SuspenseBoundary>
        )}
      </SettingsSection>
    </Skeletonize>
  );
}
