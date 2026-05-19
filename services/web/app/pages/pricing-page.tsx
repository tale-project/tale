import { PricingSection } from '@/components/blocks/pricing-section';
import { useT } from '@/lib/i18n/client';
import { localizedPath } from '@/lib/i18n/locales';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

export function PricingPage() {
  const { t: tSeo } = useT('seo');
  const locale = useCurrentLocale();

  useDocumentMeta({
    title: tSeo('pricing.title'),
    description: tSeo('pricing.description'),
    canonicalPath: localizedPath(locale, '/pricing'),
  });

  return <PricingSection />;
}
