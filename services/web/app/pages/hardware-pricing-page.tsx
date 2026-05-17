import { useNavigate, useSearch } from '@tanstack/react-router';

import { HardwareCompare } from '@/app/components/blocks/hardware-compare';
import { HardwareTiers } from '@/app/components/blocks/hardware-tiers';
import { useT } from '@/lib/i18n/client';
import { localizedPath } from '@/lib/i18n/locales';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

export type HardwareMode = 'node' | 'cluster';
export type HardwareBilling = 'renting' | 'buying';

interface HardwarePricingSearch {
  mode?: HardwareMode;
  billing?: HardwareBilling;
}

export function HardwarePricingPage() {
  const { t: tSeo } = useT('seo');
  const locale = useCurrentLocale();
  const search = useSearch({ strict: false }) as HardwarePricingSearch;
  const navigate = useNavigate();

  const mode: HardwareMode = search.mode ?? 'node';
  const billing: HardwareBilling = search.billing ?? 'buying';

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
