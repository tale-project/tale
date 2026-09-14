import { FeatureHero as FeatureHeroFrame } from '@tale/marketing-ui/feature-hero';
import type { ReactNode } from 'react';

import { CtaPair } from '@/app/components/marketing';
import { GET_STARTED_HREF, REQUEST_DEMO_PATH } from '@/app/content/site-ctas';
import { useT } from '@/lib/i18n/client';

interface FeatureHeroProps {
  eyebrow?: string;
  title: string;
  description: string;
  /** Product demo rendered under the heading on an inset DemoStage. */
  visual?: ReactNode;
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
  showCtas = true,
}: FeatureHeroProps) {
  const { t } = useT('featureShared');

  return (
    <FeatureHeroFrame
      eyebrow={eyebrow}
      title={title}
      description={description}
      visual={visual}
      actions={
        showCtas ? (
          <CtaPair
            primary={{ label: t('ctaGetStarted'), href: GET_STARTED_HREF }}
            secondary={{ label: t('ctaPrimary'), to: REQUEST_DEMO_PATH }}
          />
        ) : null
      }
    />
  );
}
