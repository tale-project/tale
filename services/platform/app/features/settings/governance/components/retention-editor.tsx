'use client';

import { Skeleton } from '@tale/ui/skeleton';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { Switch } from '@/app/components/ui/forms/switch';
import { Stack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Text } from '@/app/components/ui/typography/text';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  retentionPolicyConfigSchema,
  type RetentionPolicyConfig,
} from '@/lib/shared/schemas/governance';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertRetentionPolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import {
  useRetentionBounds,
  type CategoryBounds,
} from '../hooks/use-retention-bounds';
import { RetentionBoundsProposalBanner } from './retention-bounds-proposal-banner';
import {
  buildPresetConfig,
  type CategoryDef,
  type CategoryGroup,
  type CategoryId,
  GROUP_ORDER,
  type Preset,
  categoriesInGroup,
  unitForCategoryId,
} from './retention-categories';
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
  return { retentionDays: 90 };
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

  // Single piece of state holds the FULL effective config. Avoids the
  // 16-pair `useState` explosion the previous editor had and keeps the
  // preset switch + per-category edits coherent.
  const initializedRef = useRef(false);
  const [config, setConfig] = useState(savedConfig);
  const [preset, setPreset] = useState<Preset>('custom');
  const [errors, setErrors] = useState(new Map<CategoryId, string>());

  if (!isLoading && !initializedRef.current) {
    initializedRef.current = true;
    setConfig(savedConfig);
  }

  const cannotManage = ability.cannot('write', 'orgSettings');
  const inputDisabled = cannotManage || upsertMutation.isPending;

  const persist = useCallback(
    async (next: RetentionPolicyConfig, errorContext?: CategoryId) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          config: next,
        });
        setErrors((prev) => {
          if (!errorContext) return prev;
          if (!prev.has(errorContext)) return prev;
          const m = new Map(prev);
          m.delete(errorContext);
          return m;
        });
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
              (errData.category as CategoryId)
            : errorContext;
        if (
          (code === 'RETENTION_BELOW_FLOOR' ||
            code === 'RETENTION_EXCEEDS_CEILING') &&
          offending
        ) {
          // Inline error: stash the message against the offending category
          // so the row's Input renders red border + helper text. No toast
          // for this — toasts are reserved for unexpected failures.
          const bound =
            typeof errData?.bound === 'number' ? errData.bound : null;
          const requested =
            typeof errData?.requested === 'number' ? errData.requested : null;
          const msg =
            code === 'RETENTION_BELOW_FLOOR'
              ? t(
                  'retentionPolicy.errors.belowFloor',
                  'Below operator floor (min {bound} {unit}).',
                  { bound: bound ?? '?', unit: '' },
                )
              : t(
                  'retentionPolicy.errors.exceedsCeiling',
                  'Exceeds operator ceiling (max {bound} {unit}).',
                  { bound: bound ?? '?', unit: '' },
                );
          void requested;
          setErrors((prev) => {
            const m = new Map(prev);
            m.set(offending, msg);
            return m;
          });
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
    [organizationId, upsertMutation, toast, t],
  );

  const onPresetChange = useCallback(
    (next: Preset) => {
      setPreset(next);
      if (next === 'custom') return;
      const patch = buildPresetConfig(next);
      const merged = { ...config, ...patch } as RetentionPolicyConfig;
      setConfig(merged);
      void persist(merged);
    },
    [config, persist],
  );

  const updateField = useCallback(
    <K extends keyof RetentionPolicyConfig>(
      field: K,
      value: RetentionPolicyConfig[K],
      categoryForError?: CategoryId,
    ) => {
      setConfig((prev) => {
        const next = { ...prev, [field]: value };
        void persist(next, categoryForError);
        return next;
      });
    },
    [persist],
  );

  if (isLoading || !initializedRef.current) {
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

      {/* Preset selector */}
      <PageSection
        title={t('retentionPolicy.preset.title', 'Retention preset')}
        description={t(
          'retentionPolicy.preset.description',
          'Pick a recommended profile or customize each category individually. Switching to Standard or Strict overwrites every per-category value below.',
        )}
      >
        <RadioGroup
          value={preset}
          onValueChange={(v) =>
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- options below are the only values the RadioGroup can emit
            onPresetChange(v as Preset)
          }
          options={[
            {
              value: 'standard',
              label: t('retentionPolicy.preset.standard', 'Standard'),
              description: t(
                'retentionPolicy.preset.standardDescription',
                'Sane defaults for most teams (90-day chat, 365-day documents, 730-day audit, 30-day grace).',
              ),
            },
            {
              value: 'strict',
              label: t('retentionPolicy.preset.strict', 'Strict'),
              description: t(
                'retentionPolicy.preset.strictDescription',
                'Halved retention windows + 7-day grace. Use when compliance or storage costs require aggressive deletion.',
              ),
            },
            {
              value: 'custom',
              label: t('retentionPolicy.preset.custom', 'Custom'),
              description: t(
                'retentionPolicy.preset.customDescription',
                'Tune each category individually below.',
              ),
            },
          ]}
          disabled={inputDisabled}
        />
      </PageSection>

      {/* Per-group sections + Deletion Behavior */}
      {GROUP_ORDER.map((group) =>
        group === 'deletionBehavior' ? (
          <PageSection
            key={group}
            title={t(
              `retentionPolicy.group.${group}.title`,
              'Deletion behavior',
            )}
            description={t(
              `retentionPolicy.group.${group}.description`,
              'How long trashed/expired rows stay restorable before they hard-delete.',
            )}
          >
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
                      deletionGraceDays: e.target.value
                        ? Number(e.target.value)
                        : 0,
                    }))
                  }
                  onBlur={() =>
                    updateField(
                      'deletionGraceDays',
                      config.deletionGraceDays ?? 30,
                    )
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
          </PageSection>
        ) : (
          <CategoryGroupSection
            key={group}
            group={group}
            config={config}
            errors={errors}
            bounds={bounds}
            inputDisabled={inputDisabled}
            updateField={updateField}
            setConfig={setConfig}
          />
        ),
      )}
    </Stack>
  );
}

interface GroupSectionProps {
  group: CategoryGroup;
  config: RetentionPolicyConfig;
  errors: Map<CategoryId, string>;
  bounds: Map<CategoryId, CategoryBounds>;
  inputDisabled: boolean;
  updateField: <K extends keyof RetentionPolicyConfig>(
    field: K,
    value: RetentionPolicyConfig[K],
    categoryForError?: CategoryId,
  ) => void;
  setConfig: React.Dispatch<React.SetStateAction<RetentionPolicyConfig>>;
}

function CategoryGroupSection({
  group,
  config,
  errors,
  bounds,
  inputDisabled,
  updateField,
  setConfig,
}: GroupSectionProps) {
  const { t } = useT('governance');
  const cats = categoriesInGroup(group);
  if (cats.length === 0) return null;
  // Honor `_meta.order` from the per-org JSON file: categories with an
  // explicit `order` sort first (ascending); categories without sort
  // after, preserving the platform `categoriesInGroup` order. Stable
  // sort so ties between platform-default categories don't shuffle.
  const sortedCats = [...cats].sort((a, b) => {
    const oa = bounds.get(a.id)?.metadata?.order;
    const ob = bounds.get(b.id)?.metadata?.order;
    if (oa !== undefined && ob !== undefined) return oa - ob;
    if (oa !== undefined) return -1;
    if (ob !== undefined) return 1;
    return 0;
  });
  // If every category in the group is `_meta.hidden`, skip the section
  // entirely so the operator's hidden choice doesn't leave an empty
  // PageSection rendering a header with no content.
  const allHidden = sortedCats.every(
    (cat) => bounds.get(cat.id)?.metadata?.hidden,
  );
  if (allHidden) return null;
  return (
    <PageSection
      title={t(`retentionPolicy.group.${group}.title`, group)}
      description={t(`retentionPolicy.group.${group}.description`, '')}
    >
      <Stack gap={4}>
        {sortedCats.map((cat) => (
          <CategoryRow
            key={cat.id}
            cat={cat}
            config={config}
            error={errors.get(cat.id)}
            bound={bounds.get(cat.id)}
            inputDisabled={inputDisabled}
            updateField={updateField}
            setConfig={setConfig}
          />
        ))}
      </Stack>
    </PageSection>
  );
}

interface CategoryRowProps {
  cat: CategoryDef;
  config: RetentionPolicyConfig;
  error?: string;
  bound: CategoryBounds | undefined;
  inputDisabled: boolean;
  updateField: GroupSectionProps['updateField'];
  setConfig: GroupSectionProps['setConfig'];
}

function CategoryRow({
  cat,
  config,
  error,
  bound,
  inputDisabled,
  updateField,
  setConfig,
}: CategoryRowProps) {
  const { t } = useT('governance');
  const { enabledKey, configKey } = cat;

  // `_meta.hidden`: operator opted to hide this category from the
  // editor entirely. Skip render. Cleanup behavior is unchanged
  // (the category still has bounds and gets cleaned up); the row
  // is just not visible to the org admin.
  if (bound?.metadata?.hidden) {
    return null;
  }

  const enabled = enabledKey !== undefined ? Boolean(config[enabledKey]) : true;
  const rawValue = config[configKey];
  const value = typeof rawValue === 'number' ? rawValue : cat.standardDefault;

  // Backend JSON is the SoT for `unit`; the FE falls back to a
  // synchronous derivation (id-suffix convention) only while bounds
  // load. Schema refine guarantees the two agree.
  const unit = bound?.unit ?? unitForCategoryId(cat.id);

  const unitLabel =
    unit === 'hours'
      ? t('retentionPolicy.retentionHours', 'Retention (hours)')
      : t('retentionPolicy.retentionDays', 'Retention (days)');

  // Operator's `_meta.label` / `_meta.help` shadow the platform i18n
  // strings when present.
  const titleText =
    bound?.metadata?.label ?? t(`retentionPolicy.${cat.i18nKey}.title`, cat.id);
  const descriptionText =
    bound?.metadata?.help ??
    t(`retentionPolicy.${cat.i18nKey}.description`, '');

  const helper =
    bound && bound.source === 'env'
      ? t(
          'retentionPolicy.boundHelper',
          'Operator caps this at {min}-{max} {unit}.',
          { min: bound.min, max: bound.max, unit },
        )
      : t(`retentionPolicy.${cat.i18nKey}.helper`, '');

  return (
    <div className="border-border/50 flex flex-col gap-3 border-b border-dashed pb-4 last:border-b-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Text className="text-sm font-medium">{titleText}</Text>
          <Text className="text-muted-foreground text-xs">
            {descriptionText}
          </Text>
          {(bound?.minEnv?.applied || bound?.maxEnv?.applied) && (
            <Text className="text-muted-foreground font-mono text-[10px]">
              {t(
                'retentionPolicy.envBoundHint',
                'env-bound: {min}{minApplied} / {max}{maxApplied}',
                {
                  min: bound.minEnv.envName,
                  minApplied: bound.minEnv.applied ? ' ✓' : '',
                  max: bound.maxEnv.envName,
                  maxApplied: bound.maxEnv.applied ? ' ✓' : '',
                },
              )}
            </Text>
          )}
        </div>
        {enabledKey ? (
          <Switch
            label={t('retentionPolicy.enabled', 'Enabled')}
            checked={enabled}
            onCheckedChange={(checked) => {
              setConfig((prev) => ({
                ...prev,
                [enabledKey]: checked,
              }));
              updateField(
                enabledKey,
                checked as RetentionPolicyConfig[keyof RetentionPolicyConfig],
              );
            }}
            disabled={inputDisabled}
          />
        ) : null}
      </div>
      {enabled && (
        <div className="max-w-xs">
          <Input
            label={unitLabel}
            type="number"
            value={value}
            min={bound?.min}
            max={bound?.max}
            onChange={(e) => {
              const next = e.target.value ? Number(e.target.value) : 0;
              setConfig((prev) => ({ ...prev, [configKey]: next }));
            }}
            onBlur={() => updateField(configKey, value, cat.id)}
            disabled={inputDisabled}
            size="sm"
            errorMessage={error}
            isInvalid={Boolean(error)}
            description={helper && helper.trim() !== '' ? helper : undefined}
          />
        </div>
      )}
    </div>
  );
}
