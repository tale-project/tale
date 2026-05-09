'use client';

import { useT } from '@/lib/i18n/client';
import type { RetentionPolicyConfig } from '@/lib/shared/schemas/governance';
import {
  type RetentionCategory,
  unitForCategory,
} from '@/lib/shared/schemas/retention';

import type { CategoryBounds } from '../hooks/use-retention-bounds';
import { type CategoryWireMapping, WIRE_MAPPING } from './retention-categories';
import { RetentionTimeline } from './retention-timeline';

interface RetentionPolicySummaryProps {
  config: RetentionPolicyConfig;
  bounds: Map<RetentionCategory, CategoryBounds>;
}

export function RetentionPolicySummary({
  config,
  bounds,
}: RetentionPolicySummaryProps) {
  const { t } = useT('governance');
  const graceDays = config.deletionGraceDays ?? 30;

  return (
    <div className="border-border flex flex-col gap-4 rounded-lg border p-4">
      <dl className="space-y-1 text-sm">
        {WIRE_MAPPING.map((wire) => (
          <SummaryRow
            key={wire.id}
            wire={wire}
            config={config}
            bounds={bounds}
          />
        ))}
        <div className="flex gap-2 pt-1">
          <dt className="text-muted-foreground w-44 shrink-0">
            {t('retentionPolicy.deletionGrace.label', 'Grace period (days)')}
          </dt>
          <dd>{graceDays}</dd>
        </div>
      </dl>
      <div className="border-border/50 border-t pt-4">
        <RetentionTimeline graceDays={graceDays} />
      </div>
    </div>
  );
}

interface SummaryRowProps {
  wire: CategoryWireMapping;
  config: RetentionPolicyConfig;
  bounds: Map<RetentionCategory, CategoryBounds>;
}

function SummaryRow({ wire, config, bounds }: SummaryRowProps) {
  const { t } = useT('governance');
  const { id, configKey, enabledKey, i18nKey } = wire;

  const titleText = t(`retentionPolicy.${i18nKey}.title`, id);
  const enabled = enabledKey !== undefined ? Boolean(config[enabledKey]) : true;
  const rawValue = config[configKey];
  const numericValue =
    typeof rawValue === 'number'
      ? rawValue
      : (bounds.get(id)?.default ?? undefined);
  const unit = bounds.get(id)?.unit ?? unitForCategory(id);

  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground w-44 shrink-0">{titleText}</dt>
      <dd>
        {!enabled ? (
          <span className="text-muted-foreground">
            {t('retentionPolicy.summary.disabled', 'Disabled')}
          </span>
        ) : typeof numericValue === 'number' ? (
          `${numericValue} ${unit}`
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </dd>
    </div>
  );
}
