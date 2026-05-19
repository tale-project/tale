import { useNavigate, useSearch } from '@tanstack/react-router';

import { HardwareCompare } from '@/components/blocks/hardware-compare';
import {
  LEASING_TERMS,
  type LeasingTerm,
} from '@/components/blocks/hardware-specs';
import { HardwareTiers } from '@/components/blocks/hardware-tiers';
import { useT } from '@/lib/i18n/client';
import { localizedPath } from '@/lib/i18n/locales';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

export type HardwareMode = 'node' | 'cluster';
export type HardwareBilling = 'leasing' | 'buying';

const DEFAULT_TERM: LeasingTerm = 36;

function isHardwareMode(value: unknown): value is HardwareMode {
  return value === 'node' || value === 'cluster';
}

function isHardwareBilling(value: unknown): value is HardwareBilling {
  return value === 'leasing' || value === 'buying';
}

function parseLeasingTerm(value: unknown): LeasingTerm | undefined {
  const num = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  return (LEASING_TERMS as readonly number[]).includes(num as number)
    ? (num as LeasingTerm)
    : undefined;
}

export function HardwarePricingPage() {
  const { t: tSeo } = useT('seo');
  const locale = useCurrentLocale();
  const search: Record<string, unknown> = useSearch({ strict: false });
  const navigate = useNavigate();

  const mode: HardwareMode = isHardwareMode(search.mode) ? search.mode : 'node';
  const billing: HardwareBilling = isHardwareBilling(search.billing)
    ? search.billing
    : 'buying';
  const term: LeasingTerm = parseLeasingTerm(search.term) ?? DEFAULT_TERM;

  useDocumentMeta({
    title: tSeo('hardwarePricing.title'),
    description: tSeo('hardwarePricing.description'),
    canonicalPath: localizedPath(locale, '/hardware-pricing'),
  });

  const setMode = (next: HardwareMode) =>
    navigate({
      to: '.',
      search: (prev) => ({ ...prev, mode: next === 'node' ? undefined : next }),
      replace: true,
      resetScroll: false,
    });

  const setBilling = (next: HardwareBilling) =>
    navigate({
      to: '.',
      search: (prev) => ({
        ...prev,
        billing: next === 'buying' ? undefined : next,
      }),
      replace: true,
      resetScroll: false,
    });

  const setTerm = (next: LeasingTerm) =>
    navigate({
      to: '.',
      search: (prev) => ({
        ...prev,
        term: next === DEFAULT_TERM ? undefined : next,
      }),
      replace: true,
      resetScroll: false,
    });

  return (
    <>
      <HardwareTiers
        mode={mode}
        onModeChange={setMode}
        billing={billing}
        onBillingChange={setBilling}
        term={term}
        onTermChange={setTerm}
      />
      <HardwareCompare mode={mode} />
    </>
  );
}
