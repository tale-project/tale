import { HardwareCompare } from '@/app/components/blocks/hardware-compare';
import { HardwareTiers } from '@/app/components/blocks/hardware-tiers';
import { useT } from '@/lib/i18n/client';
import { localizedPath } from '@/lib/i18n/locales';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

export function HardwarePricingPage() {
  const { t: tSeo } = useT('seo');
  const locale = useCurrentLocale();

  useDocumentMeta({
    title: tSeo('hardwarePricing.title'),
    description: tSeo('hardwarePricing.description'),
    canonicalPath: localizedPath(locale, '/hardware-pricing'),
  });

  return (
    <>
      <HardwareTiers />
      <HardwareCompare />
    </>
  );
}
