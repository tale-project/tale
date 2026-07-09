import { formatCurrency } from '@tale/ui/format';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { MarketingSection } from '@/app/components/blocks/marketing-section';
import type { Billing } from '@/app/components/blocks/pricing-section';
import { SegmentedRadio } from '@/app/components/blocks/segmented-radio';
import { TierCard } from '@/app/components/blocks/tier-card';
import { UserCountControl } from '@/app/components/blocks/user-count-control';
import {
  MarketingButton,
  MarketingExternalLink,
  MarketingLink,
} from '@/app/components/marketing';
import { GET_STARTED_HREF, REQUEST_DEMO_PATH } from '@/app/content/site-ctas';
import { useT } from '@/lib/i18n/client';
import {
  REGION_CURRENCY,
  REGION_FORMAT_LOCALE,
  REGIONS,
  type Region,
} from '@/lib/pricing/region';
import {
  PER_USER_MONTHLY,
  STORAGE_PER_TB_MONTHLY,
  enterpriseMonthlyTotal,
} from '@/lib/pricing/tiers';

const BILLINGS: readonly Billing[] = ['yearly', 'monthly'] as const;

const COMMUNITY_FEATURE_KEYS = [
  'community.feature1',
  'community.feature2',
  'community.feature3',
  'community.feature4',
] as const;

const ENTERPRISE_FEATURE_KEYS = [
  'enterprise.feature1',
  'enterprise.feature2',
  'enterprise.feature3',
  'enterprise.feature4',
  'enterprise.feature5',
  'enterprise.feature7',
] as const;

interface PricingTiersProps {
  billing: Billing;
  region: Region;
  users: number;
  onBillingChange: (next: Billing) => void;
  onRegionChange: (next: Region) => void;
  onUsersChange: (next: number) => void;
}

function formatMoney(amount: number, region: Region): string {
  return formatCurrency(amount, {
    currency: REGION_CURRENCY[region],
    locale: REGION_FORMAT_LOCALE[region],
    maximumFractionDigits: 0,
  });
}

function formatUserCount(count: number, region: Region): string {
  return new Intl.NumberFormat(REGION_FORMAT_LOCALE[region]).format(count);
}

interface TierNameProps {
  name: string;
  deploymentLabel: string;
}

function TierName({ name, deploymentLabel }: TierNameProps) {
  return (
    <span className="flex flex-col gap-1">
      <span className="text-fg-base">{name}</span>
      <span className="text-fg-muted text-sm font-normal tracking-tight">
        {deploymentLabel}
      </span>
    </span>
  );
}

function TierFeatureList({
  heading,
  features,
  footer,
}: {
  heading: string;
  features: readonly string[];
  footer?: ReactNode;
}) {
  return (
    <div className="border-border-base/40 flex flex-col gap-3 border-t pt-5">
      <p className="text-fg-muted text-xs leading-normal font-medium tracking-wider uppercase">
        {heading}
      </p>
      <ul role="list" className="flex flex-col gap-2.5">
        {features.map((feature) => (
          <li
            key={feature}
            className="text-fg-base flex items-start gap-2.5 text-sm leading-normal tracking-tight"
          >
            <Check
              className="text-success mt-0.5 h-4 w-4 shrink-0"
              strokeWidth={2}
              aria-hidden
            />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      {footer}
    </div>
  );
}

export function PricingTiers({
  billing,
  region,
  users,
  onBillingChange,
  onRegionChange,
  onUsersChange,
}: PricingTiersProps) {
  const { t } = useT('pricing');

  // Pass `billing` through so the displayed per-month figure reflects
  // the yearly discount that the `billingNote.yearly` footnote promises
  // ("2 months free" → 10/12 of the monthly rate). Audit finding
  // R2-B12: previously the toggle moved the footnote but not the price.
  const enterprisePrice = formatMoney(
    enterpriseMonthlyTotal(region, users, billing),
    region,
  );
  const perUserPrice = formatMoney(PER_USER_MONTHLY[region], region);
  const storagePrice = formatMoney(STORAGE_PER_TB_MONTHLY[region], region);

  return (
    <MarketingSection
      title={t('title')}
      description={t('description')}
      controls={
        <>
          <SegmentedRadio
            ariaLabel={t('billing.ariaLabel')}
            value={billing}
            options={BILLINGS}
            onChange={onBillingChange}
            renderLabel={(opt) => t(`billing.${opt}`)}
          />
          <SegmentedRadio
            ariaLabel={t('region.ariaLabel')}
            value={region}
            options={REGIONS}
            onChange={onRegionChange}
            renderLabel={(opt) => t(`region.${opt}`)}
          />
        </>
      }
      footer={t('note')}
    >
      <div className="border-border-base/40 bg-surface-site-raised mx-auto mt-10 w-full max-w-120 rounded-2xl border p-5 sm:p-6">
        <UserCountControl
          value={users}
          onChange={onUsersChange}
          region={region}
        />
      </div>

      <div className="mx-auto mt-10 grid max-w-[840px] grid-cols-1 items-stretch gap-4 lg:grid-cols-2 lg:gap-5">
        <TierCard
          name={
            <TierName
              name={t('tierNames.community')}
              deploymentLabel={t('community.deployment')}
            />
          }
          price={t('community.price')}
          priceSuffix={t('community.priceSuffix')}
          priceFootnote=" "
          tagline={t('community.tagline')}
          animationDelay={0}
        >
          <TierFeatureList
            heading={t('planIncludes')}
            features={COMMUNITY_FEATURE_KEYS.map((key) => t(key))}
          />

          <div className="mt-auto pt-2">
            <MarketingButton asChild tone="secondary" fullWidth>
              <MarketingExternalLink
                href={GET_STARTED_HREF}
                tone="plain"
                showIcon={false}
              >
                {t('community.cta')}
              </MarketingExternalLink>
            </MarketingButton>
          </div>
        </TierCard>

        <TierCard
          popular
          popularLabel={t('popular')}
          name={
            <TierName
              name={t('tierNames.enterprise')}
              deploymentLabel={t('enterprise.deployment')}
            />
          }
          price={enterprisePrice}
          priceSuffix={t('enterprise.priceSuffix')}
          priceFootnote={t(`billingNote.${billing}`)}
          tagline={t('enterprise.tagline')}
          animationDelay={0.06}
        >
          <TierFeatureList
            heading={t('planIncludes')}
            features={ENTERPRISE_FEATURE_KEYS.map((key) => t(key))}
            footer={
              <>
                <p className="text-fg-muted mt-1 text-xs leading-normal tracking-tight">
                  {t('enterprise.userBreakdown', {
                    count: formatUserCount(users, region),
                    perUser: perUserPrice,
                  })}
                </p>
                <p className="text-fg-muted text-xs leading-normal tracking-tight">
                  {t('enterprise.storageAddOn', { price: storagePrice })}
                </p>
              </>
            }
          />

          <div className="mt-auto pt-2">
            <MarketingButton asChild tone="primary" fullWidth>
              <MarketingLink to={REQUEST_DEMO_PATH} tone="plain">
                {t('enterprise.cta')}
              </MarketingLink>
            </MarketingButton>
          </div>
        </TierCard>
      </div>
    </MarketingSection>
  );
}
