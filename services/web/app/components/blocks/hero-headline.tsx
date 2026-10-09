import { FeatureHero } from '@tale/marketing-ui/feature-hero';
import { Check } from 'lucide-react';

import { ProductScreenshot } from '@/app/components/blocks/product-screenshot';
import { CtaPair } from '@/app/components/marketing';
import { REQUEST_DEMO_PATH } from '@/app/content/site-ctas';
import { getSelfHostedQuickstartUrl } from '@/lib/docs-url';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';

/** Product and promise share the first viewport. */
export function HeroHeadline() {
  const { t } = useT('home');
  const locale = useCurrentLocale();

  return (
    <FeatureHero
      layout="split"
      visualTreatment="plain"
      eyebrow={t('hero.eyebrow')}
      title={t('hero.title')}
      description={t('hero.subtitle')}
      visual={<ProductScreenshot page="home" />}
      actions={
        <CtaPair
          align="start"
          primary={{ label: t('hero.ctaPrimary'), to: REQUEST_DEMO_PATH }}
          secondary={{
            label: t('hero.ctaSecondary'),
            href: getSelfHostedQuickstartUrl(locale),
          }}
        />
      }
      proof={
        <p className="text-fg-muted flex max-w-sm items-start gap-2 text-xs leading-relaxed">
          <Check
            aria-hidden
            className="text-brand-base mt-0.5 size-3.5 shrink-0"
          />
          {t('hero.proof')}
        </p>
      }
    />
  );
}
