import { useNavigate, useSearch } from '@tanstack/react-router';

import { PricingCompare } from '@/app/components/blocks/pricing-compare';
import { PricingTiers } from '@/app/components/blocks/pricing-tiers';
import {
  detectDefaultRegion,
  REGIONS,
  type Region,
} from '@/lib/pricing/region';
import { DEFAULT_USERS } from '@/lib/pricing/tiers';

export type Billing = 'monthly' | 'yearly';

interface PricingSearch {
  billing?: Billing;
  region?: Region;
  /** Number of users selected in the pricing slider. */
  users?: number;
}

function isBilling(value: unknown): value is Billing {
  return value === 'monthly' || value === 'yearly';
}

function isRegion(value: unknown): value is Region {
  return (
    typeof value === 'string' && (REGIONS as readonly string[]).includes(value)
  );
}

function isUsers(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value < 100_000
  );
}

export function PricingSection() {
  const search = useSearch({ strict: false }) as PricingSearch;
  const navigate = useNavigate();

  const billing: Billing = isBilling(search.billing)
    ? search.billing
    : 'yearly';
  const region: Region = isRegion(search.region)
    ? search.region
    : detectDefaultRegion();
  const users: number = isUsers(search.users) ? search.users : DEFAULT_USERS;

  const setBilling = (next: Billing) =>
    navigate({
      to: '.',
      search: (prev) => ({
        ...prev,
        billing: next === 'yearly' ? undefined : next,
      }),
      replace: true,
      resetScroll: false,
    });

  const setRegion = (next: Region) =>
    navigate({
      to: '.',
      search: (prev) => ({ ...prev, region: next }),
      replace: true,
      resetScroll: false,
    });

  const setUsers = (next: number) =>
    navigate({
      to: '.',
      search: (prev) => ({
        ...prev,
        // Strip the default from the URL to keep it clean.
        users: next === DEFAULT_USERS ? undefined : next,
      }),
      replace: true,
      resetScroll: false,
    });

  return (
    <>
      <PricingTiers
        billing={billing}
        region={region}
        users={users}
        onBillingChange={setBilling}
        onRegionChange={setRegion}
        onUsersChange={setUsers}
      />
      <PricingCompare region={region} />
    </>
  );
}
