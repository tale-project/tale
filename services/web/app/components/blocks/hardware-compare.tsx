import { Button } from '@tale/ui/button';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  CompareTable,
  LabelWithInfo,
  type CompareRow,
  type CompareTier,
} from '@/app/components/blocks/compare-table';
import { SpecValue } from '@/app/components/blocks/hardware-spec-value';
import {
  multiNodeComposition,
  multiNodeSpec,
  nodeSpec,
  rackSpec,
  type SpecLines,
} from '@/app/components/blocks/hardware-specs';
import { MarketingSection } from '@/app/components/blocks/marketing-section';
import { LocalizedLink } from '@/app/components/layout/localized-link';
import type { HardwareMode } from '@/app/pages/hardware-pricing-page';
import { EXTERNAL_LINKS } from '@/lib/external-links';
import { useT } from '@/lib/i18n/client';

/**
 * Detailed hardware comparison table — the lower half of the hardware
 * pricing page. The upper half is rendered by `HardwareTiers` and shows
 * the per-tier pricing cards.
 *
 * Cell content for the specs section is derived from the node/multi-node
 * definitions in `hardware-specs.ts`; everything else (CTAs, span rows,
 * section dividers) is composed inline.
 */

const STANDARD_TIER_KEYS = ['quality', 'hybrid', 'speed'] as const;
type StandardTierKey = (typeof STANDARD_TIER_KEYS)[number];
type TierKey = StandardTierKey | 'rack';

const TIER_KEYS_BY_MODE: Record<HardwareMode, readonly TierKey[]> = {
  node: STANDARD_TIER_KEYS,
  multinode: STANDARD_TIER_KEYS,
  rack: ['rack'],
};

/**
 * Compare-table specifications axes. Each axis maps a translation row
 * key (`compare.categories.{row}`) to a {@link SpecLines} field. Axes
 * marked `withInfo: true` render a `(?)` tooltip on the row label,
 * sourced from `compare.categories.{row}Info`.
 */
interface SpecAxis {
  row: 'ram' | 'systemRam' | 'gpu' | 'cpu' | 'ssd' | 'hdd' | 'size';
  field: keyof SpecLines;
  withInfo?: boolean;
}
const SPEC_AXES: readonly SpecAxis[] = [
  { row: 'ram', field: 'aiRam', withInfo: true },
  { row: 'systemRam', field: 'systemRam' },
  { row: 'gpu', field: 'gpu' },
  { row: 'cpu', field: 'cpu' },
  { row: 'ssd', field: 'ssd' },
  { row: 'hdd', field: 'hdd' },
  { row: 'size', field: 'size', withInfo: true },
];

const VERSION_KEYS: Record<HardwareMode, Record<TierKey, string>> = {
  node: {
    quality: 'nodeQuality',
    hybrid: 'nodeApplication',
    speed: 'nodeSpeed',
    rack: '',
  },
  multinode: {
    quality: 'multinodeQuality',
    hybrid: 'multinodeHybrid',
    speed: 'multinodeSpeed',
    rack: '',
  },
  rack: {
    quality: '',
    hybrid: '',
    speed: '',
    rack: 'rack',
  },
};

interface HardwareCompareProps {
  mode: HardwareMode;
}

export function HardwareCompare({ mode }: HardwareCompareProps) {
  const { t } = useT('hardwarePricing');

  const activeTierKeys = TIER_KEYS_BY_MODE[mode];

  const specFor = (key: TierKey): SpecLines => {
    if (key === 'rack') return rackSpec(t);
    return mode === 'node' ? nodeSpec(t, key) : multiNodeSpec(t, key);
  };

  const specs = activeTierKeys.reduce<Partial<Record<TierKey, SpecLines>>>(
    (acc, key) => {
      acc[key] = specFor(key);
      return acc;
    },
    {},
  );

  const tiers: CompareTier<TierKey>[] = activeTierKeys.map((key) => ({
    key,
    name: t(`tierNames.${mode}.${key}`),
    cta: (
      <Button
        asChild
        variant={key === 'hybrid' || key === 'rack' ? 'primary' : 'secondary'}
        fullWidth
        className="hidden lg:inline-flex"
      >
        <LocalizedLink to="/request-demo">
          {t(`tiers.${key}.cta`)}
        </LocalizedLink>
      </Button>
    ),
  }));

  const checkIcon = (
    <Check
      className="mx-auto h-5 w-5 text-emerald-600"
      strokeWidth={2}
      role="img"
      aria-label={t('compare.cellLabels.yes')}
    />
  );

  const rowLabel = (axis: SpecAxis): ReactNode =>
    axis.withInfo ? (
      <LabelWithInfo
        label={t(`compare.categories.${axis.row}`)}
        info={t(`compare.categories.${axis.row}Info`)}
      />
    ) : (
      t(`compare.categories.${axis.row}`)
    );

  const versionRow: CompareRow<TierKey> = {
    kind: 'data',
    rowKey: 'version',
    label: t('compare.categories.version'),
    cells: Object.fromEntries(
      activeTierKeys.map((key) => [
        key,
        <SpecValue
          key={key}
          value={t(`versions.${VERSION_KEYS[mode][key]}`)}
        />,
      ]),
    ) as Partial<Record<TierKey, ReactNode>>,
  };

  // Product numbers ship for single-product configurations (single node
  // and server rack). Multi-node setups are billed and shipped as composed
  // systems with no top-level SKU.
  const productNumberRow: CompareRow<TierKey> | null =
    mode === 'node' || mode === 'rack'
      ? {
          kind: 'data',
          rowKey: 'productNumber',
          label: t('compare.categories.productNumber'),
          cells: Object.fromEntries(
            activeTierKeys.map((key) => [key, t(`productNumbers.${key}`)]),
          ) as Partial<Record<TierKey, ReactNode>>,
        }
      : null;

  // Multi-node mode has no per-tier SKU or version. Replace the version
  // row with the per-tier node composition (one line per node type).
  const compositionRow: CompareRow<TierKey> | null =
    mode === 'multinode'
      ? {
          kind: 'data',
          rowKey: 'composition',
          label: t('compare.categories.composition'),
          cells: Object.fromEntries(
            activeTierKeys.map((key) => [
              key,
              <SpecValue
                key={key}
                value={multiNodeComposition(
                  t,
                  key as 'quality' | 'hybrid' | 'speed',
                )}
              />,
            ]),
          ) as Partial<Record<TierKey, ReactNode>>,
        }
      : null;

  const specRows: CompareRow<TierKey>[] = SPEC_AXES.map((axis) => {
    // In node mode, the Quality tier has a single Apple Silicon SoC —
    // merge the GPU and CPU cells of that column visually (rowSpan=2 on
    // GPU, no Quality cell on CPU).
    const mergeQualityChip = mode === 'node' && axis.row === 'gpu';
    const skipQualityChip = mode === 'node' && axis.row === 'cpu';

    const cells: Partial<Record<TierKey, ReactNode>> = {};
    for (const key of activeTierKeys) {
      if (key === 'quality' && skipQualityChip) continue;
      const spec = specs[key];
      if (spec) cells[key] = <SpecValue value={spec[axis.field]} />;
    }

    const row: CompareRow<TierKey> = {
      kind: 'data',
      rowKey: axis.row,
      label: rowLabel(axis),
      cells,
    };
    if (mergeQualityChip) row.cellSpans = { quality: 2 };
    return row;
  });

  const modelRow: CompareRow<TierKey> = {
    kind: 'data',
    rowKey: 'model',
    label: (
      <LabelWithInfo
        label={t('compare.categories.model')}
        info={t('compare.categories.modelInfo')}
      />
    ),
    cells: Object.fromEntries(
      activeTierKeys.map((key) => [
        key,
        <SpecValue key={key} value={t(`models.${key}`)} />,
      ]),
    ) as Partial<Record<TierKey, ReactNode>>,
  };

  const cablesRow: CompareRow<TierKey> = {
    kind: 'data',
    rowKey: 'cables',
    label: t('compare.categories.cables'),
    cells: Object.fromEntries(
      activeTierKeys.map((key) => [key, checkIcon]),
    ) as Partial<Record<TierKey, ReactNode>>,
  };

  const confidentialComputingRow: CompareRow<TierKey> =
    mode === 'rack'
      ? {
          kind: 'data',
          rowKey: 'confidentialComputing',
          label: t('compare.categories.confidentialComputing'),
          cells: Object.fromEntries(
            activeTierKeys.map((key) => [key, checkIcon]),
          ) as Partial<Record<TierKey, ReactNode>>,
        }
      : {
          kind: 'span',
          label: t('compare.categories.confidentialComputing'),
          content: t('compare.cellLabels.onRequest'),
        };

  const warrantyRow: CompareRow<TierKey> = {
    kind: 'span',
    label: t('warranty.title'),
    content: t('warranty.content'),
  };

  const softwareRow: CompareRow<TierKey> = {
    kind: 'span',
    label: t('extras.software.title'),
    content: (
      <>
        {t('extras.software.prefix')}{' '}
        <LocalizedLink
          to="/pricing"
          className="text-fg-base font-medium underline underline-offset-4"
        >
          {t('extras.software.linkLabel')}
        </LocalizedLink>
        {t('extras.software.suffix')}
      </>
    ),
  };

  const termsRow: CompareRow<TierKey> = {
    kind: 'span',
    label: t('terms.title'),
    content: (
      <>
        {t('terms.prefix')}{' '}
        <a
          href={EXTERNAL_LINKS.hardwareTerms}
          target="_blank"
          rel="noopener noreferrer"
          className="text-fg-base font-medium underline underline-offset-4"
        >
          {t('terms.linkLabel')}
        </a>
        {t('terms.suffix')}
      </>
    ),
  };

  const rows: CompareRow<TierKey>[] = [
    ...(mode === 'multinode' ? [] : [versionRow]),
    ...(productNumberRow ? [productNumberRow] : []),
    ...(compositionRow ? [compositionRow] : []),
    { kind: 'section', label: t('compare.sections.specifications') },
    ...specRows,
    { kind: 'section', label: t('compare.sections.other') },
    modelRow,
    cablesRow,
    confidentialComputingRow,
    warrantyRow,
    softwareRow,
    termsRow,
  ];

  return (
    <MarketingSection
      variant="subsection"
      title={t('compare.title')}
      description={t('compare.subtitle')}
    >
      <CompareTable caption={t('compare.title')} tiers={tiers} rows={rows} />
    </MarketingSection>
  );
}
