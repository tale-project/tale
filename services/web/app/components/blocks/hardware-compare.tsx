import { Button } from '@tale/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@tale/ui/tooltip';
import { motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';

import {
  CompareTable,
  LabelWithInfo,
  type CompareRow,
  type CompareTier,
} from '@/app/components/blocks/compare-table';
import { LocalizedLink } from '@/app/components/layout/localized-link';
import { SiteContainer } from '@/app/components/layout/site-container';
import type { HardwareMode } from '@/app/pages/hardware-pricing-page';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

const TIER_KEYS = ['quality', 'hybrid', 'speed'] as const;
type TierKey = (typeof TIER_KEYS)[number];

const SPEC_AXES = [
  { row: 'ram', values: ['qualityRam', 'hybridRam', 'speedRam'] },
  {
    row: 'systemRam',
    values: ['qualitySystemRam', 'hybridSystemRam', 'speedSystemRam'],
  },
  { row: 'gpu', values: ['qualityGpu', 'hybridGpu', 'speedGpu'] },
  { row: 'cpu', values: ['qualityCpu', 'hybridCpu', 'speedCpu'] },
  { row: 'ssd', values: ['qualitySsd', 'hybridSsd', 'speedSsd'] },
  { row: 'hdd', values: ['qualityHdd', 'hybridHdd', 'speedHdd'] },
  { row: 'size', values: ['qualitySize', 'hybridSize', 'speedSize'] },
] as const;

interface HardwareCompareProps {
  mode: HardwareMode;
}

const VERSION_KEYS = {
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
} as const;

/**
 * Map from a bracketed token (case-sensitive, as printed) to the
 * `compare.categories.*` info key whose translation explains it.
 */
const SPEC_TOOLTIPS: Record<string, string> = {
  UMA: 'umaInfo',
  VRAM: 'vramInfo',
  DDR5: 'ddr5Info',
  'DDR5 ECC': 'ddr5EccInfo',
  'Zen 5': 'zen5Info',
};

const SPEC_TOKEN_REGEX = /\(([^)]+)\)/g;

/**
 * Renders a spec cell value, wrapping every bracketed token that has an
 * entry in `SPEC_TOOLTIPS` (UMA, VRAM, DDR5, DDR5 ECC, Zen 5) with a
 * tooltip-equipped trigger. Multi-line values (`\n`) stack vertically.
 */
function SpecValue({ value }: { value: string }): ReactNode {
  const { t } = useT('hardwarePricing');
  if (!value || value === '-') return value || null;

  const lines = value.split('\n');
  return (
    <TooltipProvider delayDuration={150}>
      {lines.map((line, lineIdx) => {
        const parts: ReactNode[] = [];
        let lastIndex = 0;
        for (const match of line.matchAll(SPEC_TOKEN_REGEX)) {
          const inner = match[1];
          const tooltipKey = SPEC_TOOLTIPS[inner];
          if (!tooltipKey) continue;
          const start = match.index ?? 0;
          if (start > lastIndex) parts.push(line.slice(lastIndex, start));
          parts.push(
            <Tooltip key={`${lineIdx}-${start}`}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="cursor-help underline decoration-dotted underline-offset-2"
                >
                  ({inner})
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-center">
                {t(`compare.categories.${tooltipKey}`)}
              </TooltipContent>
            </Tooltip>,
          );
          lastIndex = start + match[0].length;
        }
        if (lastIndex < line.length) parts.push(line.slice(lastIndex));
        return (
          <span key={lineIdx} className="block">
            {parts.map((part, i) => (
              <Fragment key={i}>{part}</Fragment>
            ))}
          </span>
        );
      })}
    </TooltipProvider>
  );
}

export function HardwareCompare({ mode }: HardwareCompareProps) {
  const { t } = useT('hardwarePricing');
  const reduceMotion = useReducedMotion();
  const versionKeys = VERSION_KEYS[mode];

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

  const rows: CompareRow<TierKey>[] = [
    {
      kind: 'data',
      rowKey: 'version',
      label: t('compare.categories.version'),
      cells: {
        quality: t(`versions.${versionKeys.quality}`),
        hybrid: t(`versions.${versionKeys.hybrid}`),
        speed: t(`versions.${versionKeys.speed}`),
      },
    },
    ...(mode === 'node'
      ? [
          {
            kind: 'data',
            rowKey: 'productNumber',
            label: t('compare.categories.productNumber'),
            cells: {
              quality: t('productNumbers.quality'),
              hybrid: t('productNumbers.hybrid'),
              speed: t('productNumbers.speed'),
            },
          } satisfies CompareRow<TierKey>,
        ]
      : []),
    { kind: 'section', label: t('compare.sections.specifications') },
    ...SPEC_AXES.map((axis) => {
      // In node mode, Quality has a single Apple Silicon SoC — merge the
      // GPU and CPU cells of that column into one (rowSpan=2 on GPU, no
      // Quality cell on CPU).
      const mergeQualityChip = mode === 'node' && axis.row === 'gpu';
      const skipQualityChip = mode === 'node' && axis.row === 'cpu';

      // Every spec value gets routed through `SpecValue` — it wraps any
      // bracketed token that has an entry in `SPEC_TOOLTIPS` with a
      // tooltip trigger, and is a no-op for values without one.
      const cells: Partial<Record<TierKey, ReactNode>> = {
        hybrid: <SpecValue value={t(`specs.${mode}.${axis.values[1]}`)} />,
        speed: <SpecValue value={t(`specs.${mode}.${axis.values[2]}`)} />,
      };
      if (!skipQualityChip) {
        cells.quality = (
          <SpecValue value={t(`specs.${mode}.${axis.values[0]}`)} />
        );
      }

      const row: CompareRow<TierKey> = {
        kind: 'data',
        rowKey: axis.row,
        label:
          axis.row === 'ram' ? (
            <LabelWithInfo
              label={t('compare.categories.ram')}
              info={t('compare.categories.ramInfo')}
            />
          ) : (
            t(`compare.categories.${axis.row}`)
          ),
        cells,
      };
      if (mergeQualityChip) row.cellSpans = { quality: 2 };
      return row;
    }),
    {
      kind: 'data',
      rowKey: 'cables',
      label: t('compare.categories.cables'),
      cells: {
        quality: checkIcon,
        hybrid: checkIcon,
        speed: checkIcon,
      },
    },
    {
      kind: 'span',
      label: t('compare.categories.confidentialComputing'),
      content: t('compare.cellLabels.onRequest'),
    },
    { kind: 'section', label: t('compare.sections.other') },
    {
      kind: 'data',
      rowKey: 'model',
      label: t('compare.categories.model'),
      cells: {
        quality: t('models.quality'),
        hybrid: t('models.hybrid'),
        speed: t('models.speed'),
      },
    },
    {
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
    },
    {
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
    },
  ];

  return (
    <section className="border-border-base border-b py-20">
      <SiteContainer>
        <motion.header
          initial={reduceMotion ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.6, ease: easeOut }
          }
          className="mx-auto flex max-w-[1120px] flex-col items-center gap-3 text-center"
        >
          <h2
            className="text-fg-base text-3xl font-medium md:text-[48px]"
            style={{ letterSpacing: '-2.14px', lineHeight: 1.083 }}
          >
            {t('compare.title')}
          </h2>
          <p
            className="text-fg-muted text-base md:text-lg"
            style={{ letterSpacing: '-0.27px', lineHeight: 1.556 }}
          >
            {t('compare.subtitle')}
          </p>
        </motion.header>

        <CompareTable caption={t('compare.title')} tiers={tiers} rows={rows} />
      </SiteContainer>
    </section>
  );
}
