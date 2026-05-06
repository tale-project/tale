import { Button } from '@tale/ui/button';
import { motion, useReducedMotion } from 'framer-motion';

import {
  CompareTable,
  type CompareRow,
  type CompareTier,
} from '@/app/components/blocks/compare-table';
import { LocalizedLink } from '@/app/components/layout/localized-link';
import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

const TIER_KEYS = ['quality', 'hybrid', 'speed'] as const;
type TierKey = (typeof TIER_KEYS)[number];

const SPEC_AXES = [
  { row: 'model', values: ['qualityModel', 'hybridModel', 'speedModel'] },
  { row: 'size', values: ['qualitySize', 'hybridSize', 'speedSize'] },
  { row: 'gpu', values: ['qualityGpu', 'hybridGpu', 'speedGpu'] },
  { row: 'cpu', values: ['qualityCpu', 'hybridCpu', 'speedCpu'] },
  { row: 'ram', values: ['qualityRam', 'hybridRam', 'speedRam'] },
  { row: 'ssd', values: ['ssd', 'ssd', 'ssd'] },
  { row: 'hdd', values: ['hdd', 'hdd', 'hdd'] },
] as const;

export function HardwareCompare() {
  const { t } = useT('hardwarePricing');
  const reduceMotion = useReducedMotion();

  const tiers: CompareTier<TierKey>[] = TIER_KEYS.map((key) => ({
    key,
    name: t(`tiers.${key}.name`),
    cta: (
      <Button
        asChild
        variant={key === 'hybrid' ? 'primary' : 'secondary'}
        fullWidth
        className="hidden sm:inline-flex"
      >
        <LocalizedLink to="/request-demo">
          {t(`tiers.${key}.cta`)}
        </LocalizedLink>
      </Button>
    ),
  }));

  const rows: CompareRow<TierKey>[] = [
    ...SPEC_AXES.map(
      (axis) =>
        ({
          kind: 'data',
          label: t(`compare.categories.${axis.row}`),
          cells: {
            quality: t(`compare.values.${axis.values[0]}`),
            hybrid: t(`compare.values.${axis.values[1]}`),
            speed: t(`compare.values.${axis.values[2]}`),
          },
        }) satisfies CompareRow<TierKey>,
    ),
    {
      kind: 'span',
      label: t('extras.software.title'),
      content: (
        <>
          {t('extras.software.description')}{' '}
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
