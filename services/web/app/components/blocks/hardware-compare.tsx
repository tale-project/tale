import { Button } from '@tale/ui/button';
import { Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'framer-motion';

import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

type TierKey = 'quality' | 'hybrid' | 'speed';

interface Row {
  category: string;
  values: Record<TierKey, string>;
}

const tierKeys: TierKey[] = ['quality', 'hybrid', 'speed'];

export function HardwareCompare() {
  const { t } = useT('hardwarePricing');
  const reduceMotion = useReducedMotion();

  const rows: Row[] = [
    {
      category: t('compare.categories.model'),
      values: {
        quality: t('compare.values.qualityModel'),
        hybrid: t('compare.values.hybridModel'),
        speed: t('compare.values.speedModel'),
      },
    },
    {
      category: t('compare.categories.size'),
      values: {
        quality: t('compare.values.qualitySize'),
        hybrid: t('compare.values.hybridSize'),
        speed: t('compare.values.speedSize'),
      },
    },
    {
      category: t('compare.categories.gpu'),
      values: {
        quality: t('compare.values.qualityGpu'),
        hybrid: t('compare.values.hybridGpu'),
        speed: t('compare.values.speedGpu'),
      },
    },
    {
      category: t('compare.categories.cpu'),
      values: {
        quality: t('compare.values.qualityCpu'),
        hybrid: t('compare.values.hybridCpu'),
        speed: t('compare.values.speedCpu'),
      },
    },
    {
      category: t('compare.categories.ram'),
      values: {
        quality: t('compare.values.qualityRam'),
        hybrid: t('compare.values.hybridRam'),
        speed: t('compare.values.speedRam'),
      },
    },
    {
      category: t('compare.categories.ssd'),
      values: {
        quality: t('compare.values.ssd'),
        hybrid: t('compare.values.ssd'),
        speed: t('compare.values.ssd'),
      },
    },
    {
      category: t('compare.categories.hdd'),
      values: {
        quality: t('compare.values.hdd'),
        hybrid: t('compare.values.hdd'),
        speed: t('compare.values.hdd'),
      },
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

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-10%' }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { delay: 0.08, duration: 0.6, ease: easeOut }
          }
          className="border-border-base mx-auto mt-12 max-w-[1120px] border"
        >
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col className="w-[34%] sm:w-[28%]" />
              <col className="w-[22%] sm:w-[24%]" />
              <col className="w-[22%] sm:w-[24%]" />
              <col className="w-[22%] sm:w-[24%]" />
            </colgroup>
            <thead>
              <tr className="border-border-base border-b">
                <th
                  scope="col"
                  className="text-fg-muted px-3 py-4 text-left text-xs font-medium tracking-wider uppercase sm:px-6"
                >
                  <span className="sr-only">{t('compare.title')}</span>
                </th>
                {tierKeys.map((key) => (
                  <th
                    key={key}
                    scope="col"
                    className="text-fg-base border-border-base border-l px-2 py-4 text-center align-top sm:px-6 sm:py-6"
                  >
                    <div className="flex flex-col items-stretch gap-4">
                      <span
                        className="text-fg-muted text-base font-medium sm:text-lg"
                        style={{ letterSpacing: '-0.18px' }}
                      >
                        {t(`tiers.${key}.name`)}
                      </span>
                      <Button
                        asChild
                        variant={key === 'hybrid' ? 'primary' : 'secondary'}
                        fullWidth
                        className="hidden sm:inline-flex"
                      >
                        <Link to="/request-demo">{t(`tiers.${key}.cta`)}</Link>
                      </Button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.category} className="border-border-base border-b">
                  <th
                    scope="row"
                    className="text-fg-base px-3 py-4 text-left align-top text-sm font-medium sm:px-6"
                    style={{ letterSpacing: '-0.21px', lineHeight: 1.5 }}
                  >
                    {row.category}
                  </th>
                  {tierKeys.map((key) => (
                    <td
                      key={key}
                      className="border-border-base text-fg-muted border-l px-2 py-4 text-center align-top text-sm sm:px-6"
                      style={{ letterSpacing: '-0.21px', lineHeight: 1.5 }}
                    >
                      {row.values[key]}
                    </td>
                  ))}
                </tr>
              ))}

              <tr className="border-border-base border-b">
                <th
                  scope="row"
                  className="text-fg-base px-3 py-4 text-left align-top text-sm font-medium sm:px-6"
                >
                  {t('extras.software.title')}
                </th>
                <td
                  colSpan={3}
                  className="border-border-base text-fg-muted border-l px-3 py-4 text-center align-top text-sm sm:px-6"
                >
                  {t('extras.software.description')}{' '}
                  <a
                    href="/pricing"
                    className="text-fg-base font-medium underline underline-offset-4"
                  >
                    {t('extras.software.linkLabel')}
                  </a>
                  {t('extras.software.suffix')}
                </td>
              </tr>
              <tr className="border-border-base border-b last:border-b-0">
                <th
                  scope="row"
                  className="text-fg-base px-3 py-4 text-left align-top text-sm font-medium sm:px-6"
                >
                  {t('terms.title')}
                </th>
                <td
                  colSpan={3}
                  className="border-border-base text-fg-muted border-l px-3 py-4 text-center align-top text-sm sm:px-6"
                >
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
                </td>
              </tr>
            </tbody>
          </table>
        </motion.div>
      </SiteContainer>
    </section>
  );
}
