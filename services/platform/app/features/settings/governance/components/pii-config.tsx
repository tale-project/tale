'use client';

import { Skeleton } from '@tale/ui/skeleton';
import { lazy, Suspense, useCallback, useRef, useState } from 'react';

import { Switch } from '@/app/components/ui/forms/switch';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

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

export function PiiConfig({ organizationId }: PiiConfigProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'pii_config',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const [enabled, setEnabled] = useState(false);
  const [value, setValue] = useState(DEFAULT_VALUE);

  const cannotManage = ability.cannot('write', 'orgSettings');
  const initializedRef = useRef(false);

  // Sync from server data once loaded (render-time to avoid flicker).
  // Subsequent edits stay client-owned so the panel doesn't flicker on
  // each save round-trip.
  if (!isLoading && !initializedRef.current) {
    initializedRef.current = true;
    if (policy) {
      setEnabled(policy.enabled ?? false);
      setValue({
        mode: policy.config?.mode ?? 'tokenize',
        enabledPatterns: policy.config?.enabledPatterns ?? [],
        customPatterns: policy.config?.customPatterns ?? [],
      });
    }
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
        const description =
          error instanceof Error ? error.message : t('pii.saveFailed');
        toast({
          title: t('toastSaveFailedTitle'),
          description,
          variant: 'destructive',
        });
      }
    },
    [upsertMutation, organizationId, enabled, value, toast, t],
  );

  const handleEnabledChange = useCallback(
    (checked: boolean) => {
      setEnabled(checked);
      void persistConfig({ enabled: checked });
    },
    [persistConfig],
  );

  const handlePanelChange = useCallback(
    (next: PiiConfigPanelValue) => {
      setValue(next);
      void persistConfig({ value: next });
    },
    [persistConfig],
  );

  if (isLoading || !initializedRef.current) {
    return (
      <div aria-busy="true" className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Skeleton className="h-3.5 w-14" />
            <Skeleton className="h-[1.15rem] w-8 rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <PageSection
      title={t('pii.title')}
      description={t('pii.description')}
      action={
        <Switch
          label={t('pii.enableLabel')}
          checked={enabled}
          onCheckedChange={handleEnabledChange}
          disabled={cannotManage || upsertMutation.isPending}
        />
      }
    >
      {enabled && (
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-md" />}>
          <PiiConfigPanel
            value={value}
            onChange={handlePanelChange}
            disabled={cannotManage}
            detectionLocales="*"
          />
        </Suspense>
      )}
    </PageSection>
  );
}
