import { useNavigate, useSearch } from '@tanstack/react-router';

import { HardwareCompare } from '@/app/components/blocks/hardware-compare';
import { HardwareTiers } from '@/app/components/blocks/hardware-tiers';
import { useT } from '@/lib/i18n/client';
import { localizedPath } from '@/lib/i18n/locales';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

export type HardwareMode = 'node' | 'cluster';
export type HardwareBilling = 'renting' | 'buying';

function isHardwareMode(value: unknown): value is HardwareMode {
  return value === 'node' || value === 'cluster';
}

function isHardwareBilling(value: unknown): value is HardwareBilling {
  return value === 'renting' || value === 'buying';
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

  return (
    <>
      <HardwareTiers
        mode={mode}
        onModeChange={setMode}
        billing={billing}
        onBillingChange={setBilling}
      />
      <HardwareCompare mode={mode} />
    </>
  );
}
