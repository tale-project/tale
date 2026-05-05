import { Button } from '@tale/ui/button';
import { Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Minus } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';

import {
  CompareTable,
  type CompareRow,
  type CompareTier,
} from '@/app/components/blocks/compare-table';
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

// Inline ✓ marker used inside text-cell values (e.g. "Cloud: ✓"). Same
// green Check glyph as the dedicated check cell so the table reads
// consistently regardless of whether the value is a pure check or a
// labelled one.
function InlineCheck({ label }: { label: string }) {
  return (
    <Check
      className="inline-block h-4 w-4 align-[-0.125em] text-emerald-600"
      strokeWidth={2}
      aria-label={label}
    />
  );
}

function renderTextWithChecks(value: string, yesLabel: string): ReactNode {
  if (!value.includes('✓')) return value;
  const parts = value.split('✓');
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 ? <InlineCheck label={yesLabel} /> : null}
    </Fragment>
  ));
}

function renderCell(cell: Cell, yesLabel: string, noLabel: string): ReactNode {
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
      {renderTextWithChecks(cell.value, yesLabel)}
    </span>
  );
}

export function PricingCompare() {
  const { t } = useT('pricing');
  const reduceMotion = useReducedMotion();

  const check: Cell = { kind: 'check' };
  const dash: Cell = { kind: 'dash' };
  const text = (value: string): Cell => ({ kind: 'text', value });
  const yesLabel = t('compare.cellLabels.yes');
  const noLabel = t('compare.cellLabels.no');

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
    {
      kind: 'data',
      label: t('compare.rows.piiRedaction'),
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

  const tiers: CompareTier<TierKey>[] = TIER_KEYS.map((key) => ({
    key,
    name: t(`${key}.name`),
    cta: (
      <Button
        variant={key === 'pro' ? 'primary' : 'secondary'}
        asChild
        fullWidth
        className="hidden sm:inline-flex"
      >
        <Link to="/contact">{t(`${key}.cta`)}</Link>
      </Button>
    ),
  }));

  const tableRows: CompareRow<TierKey>[] = rows.map((row) => {
    if (row.kind === 'section' || row.kind === 'span') return row;
    return {
      kind: 'data',
      label: row.label,
      cells: {
        community: renderCell(row.cells.community, yesLabel, noLabel),
        pro: renderCell(row.cells.pro, yesLabel, noLabel),
        enterprise: renderCell(row.cells.enterprise, yesLabel, noLabel),
      },
    };
  });

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

        <CompareTable
          caption={t('compare.title')}
          tiers={tiers}
          rows={tableRows}
        />
      </SiteContainer>
    </section>
  );
}
