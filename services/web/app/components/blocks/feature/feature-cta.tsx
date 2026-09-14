import { FeatureCta as FeatureCtaBand } from '@tale/marketing-ui/feature-cta';

import { CONTACT_PATH, REQUEST_DEMO_PATH } from '@/app/content/site-ctas';
import { useT } from '@/lib/i18n/client';

interface FeatureCtaProps {
  title?: string;
  description?: string;
}

/** Closing CTA band — Request demo + Contact, with the shared feature copy as defaults. */
export function FeatureCta({ title, description }: FeatureCtaProps) {
  const { t } = useT('featureShared');

  return (
    <FeatureCtaBand
      title={title ?? t('ctaTitle')}
      description={description ?? t('ctaDescription')}
      primary={{ label: t('ctaPrimary'), to: REQUEST_DEMO_PATH }}
      secondary={{ label: t('ctaSecondary'), to: CONTACT_PATH }}
    />
  );
}
