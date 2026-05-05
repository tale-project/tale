import { Button } from '@tale/ui/button';
import { Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Minus } from 'lucide-react';
import type { ReactNode } from 'react';

import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;
const TIER_KEYS = ['community', 'pro', 'enterprise'] as const;
type TierKey = (typeof TIER_KEYS)[number];

type Cell =
  | { kind: 'check' }
  | { kind: 'dash' }
  | { kind: 'text'; value: string };

interface DataRow {
  kind: 'data';
  label: string;
  cells: Record<TierKey, Cell>;
}

interface SpanRow {
  kind: 'span';
  label: string;
  content: ReactNode;
}

interface SectionRow {
  kind: 'section';
  label: string;
}

type Row = DataRow | SpanRow | SectionRow;

function CellContent({
  cell,
  yesLabel,
  noLabel,
}: {
  cell: Cell;
  yesLabel: string;
  noLabel: string;
}) {
  if (cell.kind === 'check') {
    return (
      <Check
        className="mx-auto h-5 w-5 text-emerald-600"
        strokeWidth={2}
        aria-label={yesLabel}
      />
    );
  }
  if (cell.kind === 'dash') {
    return (
      <Minus
        className="text-fg-muted mx-auto h-5 w-5"
        strokeWidth={2}
        aria-label={noLabel}
      />
    );
  }
  return (
    <span className="text-fg-muted block whitespace-pre-line">
      {cell.value}
    </span>
  );
}

export function PricingCompare() {
  const { t } = useT('pricing');
  const reduceMotion = useReducedMotion();

  const check: Cell = { kind: 'check' };
  const dash: Cell = { kind: 'dash' };
  const text = (value: string): Cell => ({ kind: 'text', value });

  const rows: Row[] = [
    { kind: 'section', label: t('compare.categories.deployment') },
    {
      kind: 'data',
      label: t('compare.rows.selfHosted'),
      cells: { community: check, pro: check, enterprise: check },
    },
    {
      kind: 'data',
      label: t('compare.rows.cloud'),
      cells: { community: dash, pro: check, enterprise: check },
    },

    { kind: 'section', label: t('compare.categories.compliance') },
    {
      kind: 'data',
      label: t('compare.rows.gdpr'),
      cells: { community: dash, pro: check, enterprise: check },
    },
    {
      kind: 'data',
      label: t('compare.rows.iso'),
      cells: { community: dash, pro: check, enterprise: check },
    },

    { kind: 'section', label: t('compare.categories.support') },
    {
      kind: 'data',
      label: t('compare.rows.emailSupport'),
      cells: { community: dash, pro: check, enterprise: check },
    },
    {
      kind: 'data',
      label: t('compare.rows.phoneSupport'),
      cells: { community: dash, pro: dash, enterprise: check },
    },
    {
      kind: 'data',
      label: t('compare.rows.whatsappSupport'),
      cells: { community: dash, pro: dash, enterprise: check },
    },
    {
      kind: 'data',
      label: t('compare.rows.remoteSupport'),
      cells: { community: dash, pro: dash, enterprise: check },
    },

    { kind: 'section', label: t('compare.sections.services') },
    {
      kind: 'data',
      label: t('compare.categories.installation'),
      cells: {
        community: text(t('compare.values.installationFee')),
        pro: text(t('compare.values.installationFee')),
        enterprise: check,
      },
    },
    {
      kind: 'data',
      label: t('compare.categories.maintenance'),
      cells: {
        community: text(t('compare.values.maintenanceRate')),
        pro: text(t('compare.values.proMaintenance')),
        enterprise: check,
      },
    },
    {
      kind: 'span',
      label: t('compare.categories.customDevelopment'),
      content: t('compare.values.customDevelopmentRate'),
    },
    {
      kind: 'span',
      label: t('compare.categories.consulting'),
      content: t('compare.values.consultingRate'),
    },
    {
      kind: 'data',
      label: t('compare.categories.roadmap'),
      cells: { community: dash, pro: dash, enterprise: check },
    },

    {
      kind: 'span',
      label: t('extras.training.title'),
      content: t('extras.training.description'),
    },
    {
      kind: 'span',
      label: t('extras.hardware.title'),
      content: (
        <>
          {t('extras.hardware.description').replace(/\s*$/, '')}{' '}
          <Link
            to="/hardware-pricing"
            className="text-fg-base font-medium underline underline-offset-4"
          >
            {t('extras.hardware.cta')}
          </Link>
          .
        </>
      ),
    },
    {
      kind: 'span',
      label: t('extras.cloudProviders.title'),
      content: t('extras.cloudProviders.description'),
    },
    {
      kind: 'span',
      label: t('terms.title'),
      content: (
        <>
          {t('terms.prefix')}{' '}
          <a
            href="https://talecorp-my.sharepoint.com/:b:/g/personal/ym_tale_dev/IQDMsO0J9N-4RJtStv-1_IurAV_aXuHPQB5hfWnda5wSluA?e=cfXpDs"
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
                {TIER_KEYS.map((key) => (
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
                        {t(`${key}.name`)}
                      </span>
                      <Button
                        variant={key === 'pro' ? 'primary' : 'secondary'}
                        asChild
                        fullWidth
                        className="hidden sm:inline-flex"
                      >
                        <Link to="/contact">{t(`${key}.cta`)}</Link>
                      </Button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                if (row.kind === 'section') {
                  return (
                    <tr
                      key={`section-${row.label}-${idx}`}
                      className="border-border-base border-b"
                    >
                      <th
                        colSpan={4}
                        scope="colgroup"
                        className="text-fg-muted px-3 pt-8 pb-4 text-left text-base font-medium sm:px-6"
                      >
                        {row.label}
                      </th>
                    </tr>
                  );
                }
                if (row.kind === 'span') {
                  return (
                    <tr
                      key={`span-${row.label}-${idx}`}
                      className="border-border-base border-b last:border-b-0"
                    >
                      <th
                        scope="row"
                        className="text-fg-base px-3 py-4 text-left align-top text-sm font-medium sm:px-6"
                      >
                        {row.label}
                      </th>
                      <td
                        colSpan={3}
                        className="border-border-base text-fg-muted border-l px-3 py-4 text-center align-top text-sm sm:px-6"
                      >
                        {row.content}
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr
                    key={`data-${row.label}-${idx}`}
                    className="border-border-base border-b last:border-b-0"
                  >
                    <th
                      scope="row"
                      className="text-fg-base px-3 py-4 text-left align-top text-sm font-medium sm:px-6"
                    >
                      {row.label}
                    </th>
                    {TIER_KEYS.map((key) => (
                      <td
                        key={key}
                        className="border-border-base border-l px-2 py-4 text-center align-top text-sm sm:px-6"
                      >
                        <CellContent
                          cell={row.cells[key]}
                          yesLabel={t('compare.cellLabels.yes')}
                          noLabel={t('compare.cellLabels.no')}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </motion.div>
      </SiteContainer>
    </section>
  );
}
