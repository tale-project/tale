import { PricingSection } from '@/app/components/blocks/pricing-section';
import { useT } from '@/lib/i18n/client';
import { localizedHref } from '@/lib/i18n/localized-paths';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

export function PricingPage() {
  const { t: tSeo } = useT('seo');
  const locale = useCurrentLocale();

  useDocumentMeta({
    title: tSeo('pricing.title'),
    description: tSeo('pricing.description'),
    canonicalPath: localizedHref(locale, '/pricing'),
  });

  return <PricingSection />;
}
