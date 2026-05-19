import { Button } from '@tale/ui/button';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import type { HardwareMode } from '@/app/pages/hardware-pricing-page';
import {
  CompareTable,
  LabelWithInfo,
  type CompareRow,
  type CompareTier,
} from '@/components/blocks/compare-table';
import { SpecValue } from '@/components/blocks/hardware-spec-value';
import {
  clusterSpec,
  nodeSpec,
  type SpecLines,
} from '@/components/blocks/hardware-specs';
import { MarketingSection } from '@/components/blocks/marketing-section';
import { LocalizedLink } from '@/components/layout/localized-link';
import { useT } from '@/lib/i18n/client';

/**
 * Detailed hardware comparison table — the lower half of the hardware
 * pricing page. The upper half is rendered by `HardwareTiers` and shows
 * the per-tier pricing cards.
 *
 * Cell content for the specs section is derived from the node/cluster
 * definitions in `hardware-specs.ts`; everything else (CTAs, span rows,
 * section dividers) is composed inline.
 */

const TIER_KEYS = ['quality', 'hybrid', 'speed'] as const;
type TierKey = (typeof TIER_KEYS)[number];

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
  },
  cluster: {
    quality: 'clusterQuality',
    hybrid: 'clusterHybrid',
    speed: 'clusterSpeed',
  },
};

interface HardwareCompareProps {
  mode: HardwareMode;
}

export function HardwareCompare({ mode }: HardwareCompareProps) {
  const { t } = useT('hardwarePricing');

  const specs: Record<TierKey, SpecLines> = {
    quality:
      mode === 'node' ? nodeSpec(t, 'quality') : clusterSpec(t, 'quality'),
    hybrid: mode === 'node' ? nodeSpec(t, 'hybrid') : clusterSpec(t, 'hybrid'),
    speed: mode === 'node' ? nodeSpec(t, 'speed') : clusterSpec(t, 'speed'),
  };

  const tiers: CompareTier<TierKey>[] = TIER_KEYS.map((key) => ({
    key,
    name: t(`tierNames.${mode}.${key}`),
    cta: (
      <Button
        asChild
        variant={key === 'hybrid' ? 'primary' : 'secondary'}
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
    cells: {
      quality: (
        <SpecValue value={t(`versions.${VERSION_KEYS[mode].quality}`)} />
      ),
      hybrid: <SpecValue value={t(`versions.${VERSION_KEYS[mode].hybrid}`)} />,
      speed: <SpecValue value={t(`versions.${VERSION_KEYS[mode].speed}`)} />,
    },
  };

  // Product numbers are only displayed in node mode — clusters are
  // billed and shipped as composed systems with no top-level SKU.
  const productNumberRow: CompareRow<TierKey> | null =
    mode === 'node'
      ? {
          kind: 'data',
          rowKey: 'productNumber',
          label: t('compare.categories.productNumber'),
          cells: {
            quality: t('productNumbers.quality'),
            hybrid: t('productNumbers.hybrid'),
            speed: t('productNumbers.speed'),
          },
        }
      : null;

  const specRows: CompareRow<TierKey>[] = SPEC_AXES.map((axis) => {
    // In node mode, the Quality tier has a single Apple Silicon SoC —
    // merge the GPU and CPU cells of that column visually (rowSpan=2 on
    // GPU, no Quality cell on CPU).
    const mergeQualityChip = mode === 'node' && axis.row === 'gpu';
    const skipQualityChip = mode === 'node' && axis.row === 'cpu';

    const cells: Partial<Record<TierKey, ReactNode>> = {
      hybrid: <SpecValue value={specs.hybrid[axis.field]} />,
      speed: <SpecValue value={specs.speed[axis.field]} />,
    };
    if (!skipQualityChip) {
      cells.quality = <SpecValue value={specs.quality[axis.field]} />;
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
    label: t('compare.categories.model'),
    cells: {
      quality: <SpecValue value={t('models.quality')} />,
      hybrid: <SpecValue value={t('models.hybrid')} />,
      speed: <SpecValue value={t('models.speed')} />,
    },
  };

  const cablesRow: CompareRow<TierKey> = {
    kind: 'data',
    rowKey: 'cables',
    label: t('compare.categories.cables'),
    cells: {
      quality: checkIcon,
      hybrid: checkIcon,
      speed: checkIcon,
    },
  };

  const confidentialComputingRow: CompareRow<TierKey> = {
    kind: 'span',
    label: t('compare.categories.confidentialComputing'),
    content: t('compare.cellLabels.onRequest'),
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
          href="https://talecorp-my.sharepoint.com/:b:/g/personal/ym_tale_dev/IQDoJBWnXoqqQLlapn6eOPEcAUkySXRa3AUSrKFwYMl0VCU?e=JWmiZc"
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
    versionRow,
    ...(productNumberRow ? [productNumberRow] : []),
    { kind: 'section', label: t('compare.sections.specifications') },
    ...specRows,
    { kind: 'section', label: t('compare.sections.other') },
    modelRow,
    cablesRow,
    confidentialComputingRow,
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
