import { Button } from '@tale/ui/button';
import { Check, Minus } from 'lucide-react';
import { type ReactNode } from 'react';

import {
  CompareTable,
  LabelWithInfo,
  type CompareRow,
  type CompareTier,
} from '@/app/components/blocks/compare-table';
import { MarketingSection } from '@/app/components/blocks/marketing-section';
import { LocalizedLink } from '@/app/components/layout/localized-link';
import { EXTERNAL_LINKS } from '@/lib/external-links';
import { useT } from '@/lib/i18n/client';
import type { Region } from '@/lib/pricing/region';

const TIER_KEYS = ['community', 'enterprise'] as const;
type TierKey = (typeof TIER_KEYS)[number];

type Cell =
  | { kind: 'check' }
  | { kind: 'dash' }
  | { kind: 'text'; value: string };

interface DataRow {
  kind: 'data';
  label: ReactNode;
  rowKey?: string;
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

function renderCell(cell: Cell, yesLabel: string, noLabel: string): ReactNode {
  if (cell.kind === 'check') {
    return (
      <Check
        className="mx-auto h-5 w-5 text-emerald-600"
        strokeWidth={2}
        role="img"
        aria-label={yesLabel}
      />
    );
  }
  if (cell.kind === 'dash') {
    return (
      <Minus
        className="text-fg-muted mx-auto h-5 w-5"
        strokeWidth={2}
        role="img"
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

interface PricingCompareProps {
  region: Region;
}

export function PricingCompare({ region }: PricingCompareProps) {
  const { t } = useT('pricing');

  const check: Cell = { kind: 'check' };
  const dash: Cell = { kind: 'dash' };
  const text = (value: string): Cell => ({ kind: 'text', value });
  const yesLabel = t('compare.cellLabels.yes');
  const noLabel = t('compare.cellLabels.no');

  const installationFee = t(`compare.values.installationFee.${region}`);
  const hourlyRate = t(`compare.values.hourlyRate.${region}`);

  const rows: Row[] = [
    { kind: 'section', label: t('compare.categories.deployment') },
    {
      kind: 'data',
      label: t('compare.rows.selfHosted'),
      cells: { community: check, enterprise: check },
    },
    {
      kind: 'data',
      label: t('compare.rows.cloud'),
      cells: { community: dash, enterprise: check },
    },
    {
      kind: 'data',
      label: t('compare.rows.localDataCenters'),
      cells: { community: dash, enterprise: check },
    },

    { kind: 'section', label: t('compare.categories.compliance') },
    {
      kind: 'data',
      label: t('compare.rows.gdpr'),
      cells: { community: dash, enterprise: check },
    },
    {
      kind: 'data',
      label: t('compare.rows.iso'),
      cells: { community: dash, enterprise: check },
    },
    {
      kind: 'data',
      label: t('compare.rows.piiRedaction'),
      cells: { community: check, enterprise: check },
    },
    {
      kind: 'data',
      rowKey: 'customDpa',
      label: (
        <LabelWithInfo
          label={t('compare.rows.customDpa')}
          info={t('compare.rows.customDpaInfo')}
        />
      ),
      cells: { community: dash, enterprise: check },
    },

    { kind: 'section', label: t('compare.categories.support') },
    {
      kind: 'data',
      label: (
        <LabelWithInfo
          label={t('compare.rows.emailSupport')}
          info={t('compare.rows.emailSupportInfo')}
        />
      ),
      cells: { community: dash, enterprise: check },
    },
    {
      kind: 'data',
      label: (
        <LabelWithInfo
          label={t('compare.rows.phoneSupport')}
          info={t('compare.rows.phoneSupportInfo')}
        />
      ),
      cells: { community: dash, enterprise: check },
    },
    {
      kind: 'data',
      label: (
        <LabelWithInfo
          label={t('compare.rows.remoteSupport')}
          info={t('compare.rows.remoteSupportInfo')}
        />
      ),
      cells: { community: dash, enterprise: check },
    },

    { kind: 'section', label: t('compare.sections.services') },
    {
      kind: 'data',
      label: t('compare.categories.installation'),
      cells: {
        community: text(installationFee),
        enterprise: check,
      },
    },
    {
      kind: 'data',
      label: t('compare.categories.maintenance'),
      cells: {
        community: text(hourlyRate),
        enterprise: check,
      },
    },
    {
      kind: 'span',
      label: t('compare.categories.customDevelopment'),
      content: hourlyRate,
    },
    {
      kind: 'span',
      label: t('compare.categories.consulting'),
      content: hourlyRate,
    },
    { kind: 'section', label: t('compare.sections.other') },
    {
      kind: 'data',
      label: t('compare.categories.roadmap'),
      cells: { community: dash, enterprise: check },
    },

    {
      kind: 'span',
      label: t('extras.training.title'),
      content: (
        <>
          {t('extras.training.description')}{' '}
          <a
            href={EXTERNAL_LINKS.aiTraining}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fg-base font-medium underline underline-offset-4"
          >
            {t('extras.training.linkLabel')}
          </a>
          {t('extras.training.suffix')}
        </>
      ),
    },
    {
      kind: 'span',
      label: t('extras.hardware.title'),
      content: (
        <>
          {t('extras.hardware.prefix')}{' '}
          <LocalizedLink
            to="/hardware-pricing"
            className="text-fg-base font-medium underline underline-offset-4"
          >
            {t('extras.hardware.linkLabel')}
          </LocalizedLink>
          {t('extras.hardware.suffix')}
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
            href={EXTERNAL_LINKS.softwareTerms}
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
    name: t(`tierNames.${key}`),
    cta: (
      <Button
        variant={key === 'enterprise' ? 'primary' : 'secondary'}
        asChild
        fullWidth
        className="hidden sm:inline-flex"
      >
        <LocalizedLink to="/contact">{t(`${key}.cta`)}</LocalizedLink>
      </Button>
    ),
  }));

  const tableRows: CompareRow<TierKey>[] = rows.map((row) => {
    if (row.kind === 'section' || row.kind === 'span') return row;
    return {
      kind: 'data',
      label: row.label,
      rowKey: row.rowKey,
      cells: {
        community: renderCell(row.cells.community, yesLabel, noLabel),
        enterprise: renderCell(row.cells.enterprise, yesLabel, noLabel),
      },
    };
  });

  return (
    <MarketingSection
      variant="subsection"
      title={t('compare.title')}
      description={t('compare.subtitle')}
    >
      <CompareTable
        caption={t('compare.title')}
        tiers={tiers}
        rows={tableRows}
      />
    </MarketingSection>
  );
}
