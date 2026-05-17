import { Button } from '@tale/ui/button';
import { formatCurrency } from '@tale/ui/format';
import { motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';

import type { Billing } from '@/app/components/blocks/pricing-section';
import { TierCard } from '@/app/components/blocks/tier-card';
import { UserCountControl } from '@/app/components/blocks/user-count-control';
import { LocalizedLink } from '@/app/components/layout/localized-link';
import { SiteContainer } from '@/app/components/layout/site-container';
import { DOCS_URL } from '@/lib/docs-url';
import { useT } from '@/lib/i18n/client';
import {
  REGION_CURRENCY,
  REGION_FORMAT_LOCALE,
  REGIONS,
  type Region,
} from '@/lib/pricing/region';

const easeOut = [0.22, 1, 0.36, 1] as const;

const PER_USER_MONTHLY: Record<Region, number> = { CH: 12, DE: 14 };
const STORAGE_PER_TB_MONTHLY: Record<Region, number> = { CH: 10, DE: 12 };

export const DEFAULT_USERS = 25;

const BILLINGS: readonly Billing[] = ['yearly', 'monthly'] as const;

const COMMUNITY_FEATURES = [
  'community.feature1',
  'community.feature2',
  'community.feature3',
  'community.feature4',
] as const;

const ENTERPRISE_FEATURES = [
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

interface SegmentedControlProps<T extends string> {
  ariaLabel: string;
  value: T;
  options: readonly T[];
  onChange: (next: T) => void;
  renderLabel: (option: T) => string;
}

function SegmentedControl<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  renderLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="bg-bg-elevated flex w-fit items-center gap-1 rounded-md p-0.5"
    >
      {options.map((option) => {
        const isActive = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(option)}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-bg-base text-fg-base shadow-sm'
                : 'text-fg-muted hover:text-fg-base cursor-pointer'
            }`}
          >
            {renderLabel(option)}
          </button>
        );
      })}
    </div>
  );
}

interface TierNameProps {
  name: string;
  deploymentLabel: string;
}

function TierName({ name, deploymentLabel }: TierNameProps) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0">
      <span>{name}</span>
      <span className="text-fg-muted text-sm font-normal">
        ({deploymentLabel})
      </span>
    </span>
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
  const reduceMotion = useReducedMotion();
  const fadeInitial = reduceMotion ? false : { opacity: 0, y: 24 };

  const perUserMonthly = PER_USER_MONTHLY[region];
  const totalMonthly = perUserMonthly * users;
  const enterprisePrice = formatMoney(totalMonthly, region);
  const perUserPrice = formatMoney(perUserMonthly, region);
  const storagePrice = formatMoney(STORAGE_PER_TB_MONTHLY[region], region);

  return (
    <section className="border-border-base scroll-mt-16 border-b py-20">
      <SiteContainer>
        <motion.header
          initial={fadeInitial}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.6, ease: easeOut }
          }
          className="mx-auto flex max-w-[720px] flex-col items-center gap-3 text-center"
        >
          <h1
            className="text-fg-base text-3xl font-medium md:text-[52px]"
            style={{ letterSpacing: '-2.14px', lineHeight: 1.077 }}
          >
            {t('title')}
          </h1>
          <p
            className="text-fg-muted max-w-[600px] text-base md:text-lg"
            style={{ letterSpacing: '-0.27px', lineHeight: 1.556 }}
          >
            {t('description')}
          </p>
        </motion.header>

        <div className="mx-auto mt-10 flex flex-col items-center gap-3 md:flex-row md:justify-center md:gap-4">
          <SegmentedControl
            ariaLabel={t('billing.ariaLabel')}
            value={billing}
            options={BILLINGS}
            onChange={onBillingChange}
            renderLabel={(opt) => t(`billing.${opt}`)}
          />
          <SegmentedControl
            ariaLabel={t('region.ariaLabel')}
            value={region}
            options={REGIONS}
            onChange={onRegionChange}
            renderLabel={(opt) => t(`region.${opt}`)}
          />
        </div>

        <UserCountControl
          value={users}
          onChange={onUsersChange}
          region={region}
        />

        <div className="border-border-base mx-auto mt-12 grid max-w-[800px] grid-cols-1 items-stretch overflow-hidden border lg:grid-cols-2">
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
            <div className="border-border-base flex flex-col gap-3 border-t pt-6">
              <p
                className="text-fg-base text-sm font-medium"
                style={{ letterSpacing: '-0.21px', lineHeight: 1.5 }}
              >
                {t('planIncludes')}
              </p>
              <ul role="list" className="flex flex-col gap-3">
                {COMMUNITY_FEATURES.map((featureKey) => (
                  <li
                    key={featureKey}
                    className="text-fg-base flex items-start gap-2 text-sm"
                    style={{ letterSpacing: '-0.21px', lineHeight: 1.5 }}
                  >
                    <Check
                      className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                      strokeWidth={2}
                      aria-hidden
                    />
                    <span>{t(featureKey)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-auto pt-2">
              <Button asChild variant="secondary" fullWidth>
                <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
                  {t('community.cta')}
                </a>
              </Button>
            </div>
          </TierCard>

          <TierCard
            popular
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
            <div className="border-border-base flex flex-col gap-3 border-t pt-6">
              <p
                className="text-fg-base text-sm font-medium"
                style={{ letterSpacing: '-0.21px', lineHeight: 1.5 }}
              >
                {t('planIncludes')}
              </p>
              <ul role="list" className="flex flex-col gap-3">
                {ENTERPRISE_FEATURES.map((featureKey) => (
                  <li
                    key={featureKey}
                    className="text-fg-base flex items-start gap-2 text-sm"
                    style={{ letterSpacing: '-0.21px', lineHeight: 1.5 }}
                  >
                    <Check
                      className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                      strokeWidth={2}
                      aria-hidden
                    />
                    <span>{t(featureKey)}</span>
                  </li>
                ))}
              </ul>
              <p
                className="text-fg-muted mt-1 text-xs"
                style={{ letterSpacing: '-0.18px', lineHeight: 1.5 }}
              >
                {t('enterprise.userBreakdown', {
                  count: formatUserCount(users, region),
                  perUser: perUserPrice,
                })}
              </p>
              <p
                className="text-fg-muted text-xs"
                style={{ letterSpacing: '-0.18px', lineHeight: 1.5 }}
              >
                {t('enterprise.storageAddOn', { price: storagePrice })}
              </p>
            </div>

            <div className="mt-auto pt-2">
              <Button asChild fullWidth>
                <LocalizedLink to="/request-demo">
                  {t('enterprise.cta')}
                </LocalizedLink>
              </Button>
            </div>
          </TierCard>
        </div>

        <p
          className="text-fg-muted mx-auto mt-10 max-w-[720px] text-center text-sm"
          style={{ letterSpacing: '-0.21px', lineHeight: 1.5 }}
        >
          {t('note')}
        </p>
      </SiteContainer>
    </section>
  );
}
