import {
  CtaPair,
  MarketingStack,
  PageSection,
  SectionHeading,
} from '@/app/components/marketing';
import { CONTACT_PATH, REQUEST_DEMO_PATH } from '@/app/content/site-ctas';
import { useT } from '@/lib/i18n/client';

interface FeatureCtaProps {
  title?: string;
  description?: string;
}

/** Closing CTA band — Request demo + Contact. */
export function FeatureCta({ title, description }: FeatureCtaProps) {
  const { t } = useT('featureShared');

  return (
    <PageSection surface="soft" pad="lg" border="none">
      <MarketingStack max="sm" gap="md">
        <SectionHeading
          size="subsection"
          as="h2"
          title={title ?? t('ctaTitle')}
          description={description ?? t('ctaDescription')}
        />
        <CtaPair
          primary={{ label: t('ctaPrimary'), to: REQUEST_DEMO_PATH }}
          secondary={{ label: t('ctaSecondary'), to: CONTACT_PATH }}
        />
      </MarketingStack>
    </PageSection>
  );
}
