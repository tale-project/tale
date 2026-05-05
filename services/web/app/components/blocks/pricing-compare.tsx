import { motion, useReducedMotion } from 'framer-motion';

import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

type TierKey = 'community' | 'pro' | 'enterprise';

interface Row {
  category: string;
  values: Record<TierKey, string>;
}

export function PricingCompare() {
  const { t } = useT('pricing');
  const reduceMotion = useReducedMotion();

  const dash = t('compare.values.dash');

  const rows: Row[] = [
    {
      category: t('compare.categories.deployment'),
      values: {
        community: t('compare.values.communityDeployment'),
        pro: t('compare.values.paidDeployment'),
        enterprise: t('compare.values.paidDeployment'),
      },
    },
    {
      category: t('compare.categories.compliance'),
      values: {
        community: dash,
        pro: t('compare.values.paidCompliance'),
        enterprise: t('compare.values.paidCompliance'),
      },
    },
    {
      category: t('compare.categories.support'),
      values: {
        community: dash,
        pro: t('compare.values.proSupport'),
        enterprise: t('compare.values.enterpriseSupport'),
      },
    },
    {
      category: t('compare.categories.installation'),
      values: {
        community: dash,
        pro: t('compare.values.installationFee'),
        enterprise: t('compare.values.installationFee'),
      },
    },
    {
      category: t('compare.categories.maintenance'),
      values: {
        community: dash,
        pro: t('compare.values.maintenanceRate'),
        enterprise: t('compare.values.maintenanceRate'),
      },
    },
    {
      category: t('compare.categories.customDevelopment'),
      values: {
        community: dash,
        pro: t('compare.values.customDevelopmentRate'),
        enterprise: t('compare.values.customDevelopmentRate'),
      },
    },
    {
      category: t('compare.categories.consulting'),
      values: {
        community: dash,
        pro: t('compare.values.consultingRate'),
        enterprise: t('compare.values.consultingRate'),
      },
    },
    {
      category: t('compare.categories.roadmap'),
      values: {
        community: dash,
        pro: dash,
        enterprise: t('compare.values.yes'),
      },
    },
  ];

  const tierKeys: TierKey[] = ['community', 'pro', 'enterprise'];

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
          className="mx-auto flex max-w-[1120px] flex-col gap-3"
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
          className="border-border-base mx-auto mt-12 max-w-[1120px] overflow-x-auto border"
        >
          <table className="w-full min-w-[720px] table-fixed border-collapse">
            <thead>
              <tr className="border-border-base border-b">
                <th
                  scope="col"
                  className="text-fg-muted w-1/4 px-6 py-4 text-left text-xs font-medium tracking-wider uppercase"
                >
                  <span className="sr-only">{t('compare.title')}</span>
                </th>
                {tierKeys.map((key) => (
                  <th
                    key={key}
                    scope="col"
                    className="text-fg-base border-border-base w-1/4 border-l px-6 py-4 text-left text-base font-medium"
                  >
                    {t(`${key}.name`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.category}
                  className="border-border-base border-b last:border-b-0"
                >
                  <th
                    scope="row"
                    className="text-fg-base px-6 py-4 text-left align-top text-sm font-medium"
                    style={{ letterSpacing: '-0.21px', lineHeight: 1.5 }}
                  >
                    {row.category}
                  </th>
                  {tierKeys.map((key) => (
                    <td
                      key={key}
                      className="border-border-base text-fg-muted border-l px-6 py-4 align-top text-sm"
                      style={{ letterSpacing: '-0.21px', lineHeight: 1.5 }}
                    >
                      {row.values[key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      </SiteContainer>
    </section>
  );
}
