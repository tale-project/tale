import { FeatureHero as FeatureHeroFrame } from '@tale/marketing-ui/feature-hero';
import type { ComponentProps, ReactNode } from 'react';

import { CtaPair } from '@/app/components/marketing';
import { REQUEST_DEMO_PATH } from '@/app/content/site-ctas';
import { getStartedUrl } from '@/lib/docs-url';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';

interface FeatureHeroProps {
  eyebrow?: string;
  title: string;
  description: string;
  /** Product visual rendered below the heading. */
  visual?: ReactNode;
  visualTreatment?: ComponentProps<typeof FeatureHeroFrame>['visualTreatment'];
  showCtas?: boolean;
}

/**
 * Feature-page lead — the `@tale/marketing-ui` frame fed this site's
 * standard CTA pair (Get started → docs, Request a demo).
 */
export function FeatureHero({
  eyebrow,
  title,
  description,
  visual,
  visualTreatment,
  showCtas = true,
}: FeatureHeroProps) {
  const { t } = useT('featureShared');
  const locale = useCurrentLocale();

  return (
    <FeatureHeroFrame
      eyebrow={eyebrow}
      title={title}
      description={description}
      visual={visual}
      visualTreatment={visualTreatment}
      actions={
        showCtas ? (
          <CtaPair
            primary={{ label: t('ctaGetStarted'), href: getStartedUrl(locale) }}
            secondary={{ label: t('ctaPrimary'), to: REQUEST_DEMO_PATH }}
          />
        ) : null
      }
    />
  );
}
