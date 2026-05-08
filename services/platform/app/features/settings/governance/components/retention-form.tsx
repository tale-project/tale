'use client';

import { Input } from '@/app/components/ui/forms/input';
import { Switch } from '@/app/components/ui/forms/switch';
import { Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import type { RetentionPolicyConfig } from '@/lib/shared/schemas/governance';
import {
  type RetentionCategory,
  unitForCategory,
} from '@/lib/shared/schemas/retention';

import type { CategoryBounds } from '../hooks/use-retention-bounds';
import { type CategoryWireMapping, WIRE_MAPPING } from './retention-categories';

interface RetentionFormProps {
  value: RetentionPolicyConfig;
  onChange: (next: RetentionPolicyConfig) => void;
  bounds: Map<RetentionCategory, CategoryBounds>;
  errors: Map<RetentionCategory, string>;
  inputDisabled: boolean;
}

/**
 * Declarative retention form. Iterates `WIRE_MAPPING` (the TS
 * descriptor), looks up each category's bounds from the bounds Map
 * (loaded from the per-org JSON file's instance values), and renders
 * a uniform row.
 *
 * No preset, no grouping, no timeline — local state edits don't
 * autosave. The parent owns the Save button and the diff confirm
 * flow; this form is purely controlled.
 */
export function RetentionForm({
  value,
  onChange,
  bounds,
  errors,
  inputDisabled,
}: RetentionFormProps) {
  return (
    <Stack gap={4}>
      {WIRE_MAPPING.map((wire) => (
        <CategoryRow
          key={wire.id}
          wire={wire}
          value={value}
          onChange={onChange}
          bound={bounds.get(wire.id)}
          error={errors.get(wire.id)}
          inputDisabled={inputDisabled}
        />
      ))}
    </Stack>
  );
}

interface CategoryRowProps {
  wire: CategoryWireMapping;
  value: RetentionPolicyConfig;
  onChange: (next: RetentionPolicyConfig) => void;
  bound: CategoryBounds | undefined;
  error: string | undefined;
  inputDisabled: boolean;
}

function CategoryRow({
  wire,
  value,
  onChange,
  bound,
  error,
  inputDisabled,
}: CategoryRowProps) {
  const { t } = useT('governance');
  const { id, configKey, enabledKey, i18nKey } = wire;

  const enabled = enabledKey !== undefined ? Boolean(value[enabledKey]) : true;
  const rawValue = value[configKey];
  const numericValue =
    typeof rawValue === 'number' ? rawValue : (bound?.default ?? 0);

  // Backend JSON is the SoT for `unit`; the FE falls back to a
  // synchronous derivation (id-suffix convention) only while bounds
  // load.
  const unit = bound?.unit ?? unitForCategory(id);
  const unitLabel =
    unit === 'hours'
      ? t('retentionPolicy.retentionHours', 'Retention (hours)')
      : t('retentionPolicy.retentionDays', 'Retention (days)');

  const titleText = t(`retentionPolicy.${i18nKey}.title`, id);
  const descriptionText = t(`retentionPolicy.${i18nKey}.description`, '');

  const helper =
    bound && bound.source === 'env'
      ? t(
          'retentionPolicy.boundHelper',
          'Operator caps this at {min}-{max} {unit}.',
          { min: bound.min, max: bound.max, unit },
        )
      : t(`retentionPolicy.${i18nKey}.helper`, '');

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
            onCheckedChange={(checked) =>
              onChange({
                ...value,
                [enabledKey]: checked,
              } as RetentionPolicyConfig)
            }
            disabled={inputDisabled}
          />
        ) : null}
      </div>
      {enabled && (
        <div className="max-w-xs">
          <Input
            label={unitLabel}
            type="number"
            value={numericValue}
            min={bound?.min}
            max={bound?.max}
            onChange={(e) =>
              onChange({
                ...value,
                [configKey]: e.target.value ? Number(e.target.value) : 0,
              } as RetentionPolicyConfig)
            }
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
