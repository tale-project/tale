'use client';

import { Button } from '@tale/ui/button';
import { Skeleton } from '@tale/ui/skeleton';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  retentionPolicyConfigSchema,
  type RetentionPolicyConfig,
} from '@/lib/shared/schemas/governance';
import {
  type RetentionCategory,
  unitForCategory,
} from '@/lib/shared/schemas/retention';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertRetentionPolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { useRetentionBounds } from '../hooks/use-retention-bounds';
import { RetentionBoundsProposalBanner } from './retention-bounds-proposal-banner';
import { type CategoryWireMapping, WIRE_MAPPING } from './retention-categories';
import { RetentionForm } from './retention-form';
import { RetentionPendingBanner } from './retention-pending-banner';
import { RetentionTimeline } from './retention-timeline';

interface RetentionEditorProps {
  organizationId: string;
}

function parseRetentionConfig(policy: unknown): RetentionPolicyConfig {
  const config = isRecord(policy) ? policy : {};
  const result = retentionPolicyConfigSchema.safeParse(config);
  if (result.success) {
    return result.data;
  }
  return { documentsRetentionDays: 90 };
}

/**
 * Read structured `data` off a Convex error without `instanceof
 * ConvexError`. Vite chunk splitting can produce multiple ConvexError
 * class copies, breaking instanceof — duck-type instead.
 */
function readConvexErrorData(
  err: unknown,
): Record<string, unknown> | undefined {
  if (err == null || typeof err !== 'object') return undefined;
  if (!('data' in err)) return undefined;
  const data = (err as { data: unknown }).data;
  if (data == null || typeof data !== 'object') return undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- data is runtime-checked above
  return data as Record<string, unknown>;
}

function skeletonRow(): ReactNode {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-8 w-24 rounded-md" />
    </div>
  );
}

export function RetentionEditor({ organizationId }: RetentionEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'retention_policy',
  );
  const { bounds, retentionDisabled } = useRetentionBounds(organizationId);
  const upsertMutation = useUpsertRetentionPolicy();

  const savedConfig = useMemo(
    () => parseRetentionConfig(policy?.config),
    [policy],
  );
  const savedHash = useMemo(() => JSON.stringify(savedConfig), [savedConfig]);

  // Local working state. Initialized from `savedConfig` and re-synced
  // whenever the server pushes a new value (multi-tab edit, cooldown
  // overlay, post-Apply). Replaces the previous render-body
  // `useRef`-latched setConfig that desynced after first mount.
  const [config, setConfig] = useState(savedConfig);
  const [errors, setErrors] = useState(new Map<RetentionCategory, string>());
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    setConfig(savedConfig);
    setErrors(new Map());
  }, [savedHash, savedConfig]);

  const cannotManage = ability.cannot('write', 'orgSettings');
  const inputDisabled = cannotManage || upsertMutation.isPending;

  const dirty = useMemo(
    () => JSON.stringify(config) !== savedHash,
    [config, savedHash],
  );

  const handleResetToDefaults = useCallback(() => {
    setConfig((prev) => {
      const next: RetentionPolicyConfig = { ...prev, deletionGraceDays: 30 };
      for (const wire of WIRE_MAPPING) {
        const bound = bounds.get(wire.id);
        if (!bound) continue;
        Object.assign(next, { [wire.configKey]: bound.default });
        if (wire.enabledKey) {
          Object.assign(next, { [wire.enabledKey]: true });
        }
      }
      return next;
    });
    setErrors(new Map());
  }, [bounds]);

  const persist = useCallback(
    async (next: RetentionPolicyConfig) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          config: next,
        });
        setErrors(new Map());
        setConfirmOpen(false);
        toast({
          title: t('toastSavedTitle'),
          description: t('retentionPolicy.saved'),
          variant: 'success',
        });
      } catch (error: unknown) {
        const errData = readConvexErrorData(error);
        const code =
          typeof errData?.code === 'string' ? errData.code : undefined;
        const offending =
          typeof errData?.category === 'string'
            ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- backend RETENTION_BELOW_FLOOR/EXCEEDS_CEILING errors set category to a RetentionCategory value
              (errData.category as RetentionCategory)
            : undefined;
        if (
          (code === 'RETENTION_BELOW_FLOOR' ||
            code === 'RETENTION_EXCEEDS_CEILING') &&
          offending
        ) {
          const bound =
            typeof errData?.bound === 'number' ? errData.bound : null;
          const unit =
            bounds.get(offending)?.unit ?? unitForCategory(offending);
          const msg =
            code === 'RETENTION_BELOW_FLOOR'
              ? t(
                  'retentionPolicy.errors.belowFloor',
                  'Below operator floor (min {bound} {unit}).',
                  { bound: bound ?? '?', unit },
                )
              : t(
                  'retentionPolicy.errors.exceedsCeiling',
                  'Exceeds operator ceiling (max {bound} {unit}).',
                  { bound: bound ?? '?', unit },
                );
          setErrors((prev) => {
            const m = new Map(prev);
            m.set(offending, msg);
            return m;
          });
          setConfirmOpen(false);
          return;
        }
        const message =
          error instanceof Error ? error.message : 'Failed to save';
        toast({
          title: t('toastSaveFailedTitle'),
          description: message,
          variant: 'destructive',
        });
      }
    },
    [organizationId, upsertMutation, toast, t, bounds],
  );

  if (isLoading) {
    return (
      <div aria-busy="true" className="flex flex-col gap-6">
        {skeletonRow()}
        {skeletonRow()}
        {skeletonRow()}
      </div>
    );
  }

  return (
    <Stack gap={6}>
      {retentionDisabled && (
        <div className="border-warning bg-warning/10 rounded border p-3">
          <Text className="text-sm">
            {t(
              'retentionPolicy.envDisabled',
              'Retention is currently disabled by the operator (TALE_RETENTION_DISABLED=true). Cleanup will not run until the env flag is removed.',
            )}
          </Text>
        </div>
      )}

      <RetentionBoundsProposalBanner organizationId={organizationId} />
      <RetentionPendingBanner organizationId={organizationId} />

      <RetentionForm
        value={config}
        onChange={setConfig}
        bounds={bounds}
        errors={errors}
        inputDisabled={inputDisabled}
      />

      {/* Deletion grace period stays a standalone field — it's a runtime
          knob with no per-category bound, so it doesn't fit RetentionForm.
          The timeline next to it visualises the 2-pass lifecycle so admins
          can grok what `graceDays = 0` vs `>0` actually means without
          decoding the helper text. */}
      <Stack gap={4}>
        <div className="max-w-xs">
          <Input
            label={t(
              'retentionPolicy.deletionGrace.label',
              'Grace period (days)',
            )}
            type="number"
            value={config.deletionGraceDays ?? 30}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                deletionGraceDays: e.target.value ? Number(e.target.value) : 0,
              }))
            }
            disabled={inputDisabled}
            size="sm"
            min={0}
            max={90}
            description={t(
              'retentionPolicy.deletionGrace.helper',
              '0 = Pass A immediately hard-deletes (no trash window). >0 keeps rows visible in admin Trash for that many days before Pass B physically removes them.',
            )}
          />
        </div>
        <RetentionTimeline graceDays={config.deletionGraceDays ?? 30} />
      </Stack>

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={!dirty || inputDisabled}
          onClick={() => setConfirmOpen(true)}
        >
          {t('retentionPolicy.save', 'Save changes')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={inputDisabled}
          onClick={handleResetToDefaults}
        >
          {t('retentionPolicy.reset', 'Reset to defaults')}
        </Button>
        {dirty && (
          <Text className="text-muted-foreground text-xs">
            {t('retentionPolicy.unsavedHint', 'You have unsaved changes.')}
          </Text>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!upsertMutation.isPending) setConfirmOpen(open);
        }}
        title={t('retentionPolicy.diff.title', 'Confirm retention changes')}
        description={t(
          'retentionPolicy.diff.description',
          'Review the changes before saving. Cleanup applies the new policy on its next run.',
        )}
        confirmText={t('retentionPolicy.diff.confirmLabel', 'Save changes')}
        cancelText={t('common.actions.cancel', 'Cancel')}
        isLoading={upsertMutation.isPending}
        onConfirm={() => void persist(config)}
      >
        <DiffList from={savedConfig} to={config} bounds={bounds} />
      </ConfirmDialog>
    </Stack>
  );
}

interface DiffEntry {
  i18nKey: string;
  id: string;
  fromText: string;
  toText: string;
}

function DiffList({
  from,
  to,
  bounds,
}: {
  from: RetentionPolicyConfig;
  to: RetentionPolicyConfig;
  bounds: Map<
    RetentionCategory,
    import('../hooks/use-retention-bounds').CategoryBounds
  >;
}) {
  const { t } = useT('governance');
  const entries = computeDiff(from, to, bounds);
  if (entries.length === 0) {
    return (
      <Text className="text-muted-foreground text-sm">
        {t('retentionPolicy.diff.noChanges', 'No changes to save.')}
      </Text>
    );
  }
  return (
    <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
      {entries.map((e) => (
        <li
          key={`${e.id}.${e.fromText}-${e.toText}`}
          className="flex items-baseline justify-between gap-3 font-mono text-xs"
        >
          <span className="text-foreground">
            {t(`retentionPolicy.${e.i18nKey}.title`, e.id)}
          </span>
          <span className="text-muted-foreground">
            {e.fromText} → {e.toText}
          </span>
        </li>
      ))}
    </ul>
  );
}

function computeDiff(
  from: RetentionPolicyConfig,
  to: RetentionPolicyConfig,
  bounds: Map<
    RetentionCategory,
    import('../hooks/use-retention-bounds').CategoryBounds
  >,
): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const wire of WIRE_MAPPING) {
    pushDiffForWire(wire, from, to, bounds, out);
  }
  // Grace period — rendered alongside per-category rows.
  if ((from.deletionGraceDays ?? 30) !== (to.deletionGraceDays ?? 30)) {
    out.push({
      id: 'deletionGraceDays',
      i18nKey: 'deletionGrace',
      fromText: String(from.deletionGraceDays ?? 30),
      toText: String(to.deletionGraceDays ?? 30),
    });
  }
  return out;
}

function pushDiffForWire(
  wire: CategoryWireMapping,
  from: RetentionPolicyConfig,
  to: RetentionPolicyConfig,
  bounds: Map<
    RetentionCategory,
    import('../hooks/use-retention-bounds').CategoryBounds
  >,
  out: DiffEntry[],
): void {
  const bound = bounds.get(wire.id);
  const unit = bound?.unit ?? unitForCategory(wire.id);
  if (wire.enabledKey) {
    const fromEnabled = Boolean(from[wire.enabledKey]);
    const toEnabled = Boolean(to[wire.enabledKey]);
    if (fromEnabled !== toEnabled) {
      out.push({
        id: wire.id,
        i18nKey: wire.i18nKey,
        fromText: fromEnabled ? 'enabled' : 'disabled',
        toText: toEnabled ? 'enabled' : 'disabled',
      });
    }
  }
  const fromVal = from[wire.configKey];
  const toVal = to[wire.configKey];
  if (
    typeof fromVal === 'number' &&
    typeof toVal === 'number' &&
    fromVal !== toVal
  ) {
    out.push({
      id: wire.id,
      i18nKey: wire.i18nKey,
      fromText: `${fromVal} ${unit}`,
      toText: `${toVal} ${unit}`,
    });
  } else if (
    fromVal !== toVal &&
    (typeof fromVal === 'number' || typeof toVal === 'number')
  ) {
    // One side missing/undefined — render explicit "—".
    out.push({
      id: wire.id,
      i18nKey: wire.i18nKey,
      fromText: typeof fromVal === 'number' ? `${fromVal} ${unit}` : '—',
      toText: typeof toVal === 'number' ? `${toVal} ${unit}` : '—',
    });
  }
}
