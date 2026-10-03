import { DemoStage } from '@tale/marketing-ui/demo-stage';

import { HomeHeroDemo } from '@/app/components/blocks/demos/content';
import { SiteContainer } from '@/app/components/layout/site-container';
import { CtaPair, Reveal, SectionHeading } from '@/app/components/marketing';
import { REQUEST_DEMO_PATH } from '@/app/content/site-ctas';
import { getSelfHostedQuickstartUrl } from '@/lib/docs-url';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';

/**
 * Editorial lead: a headline and supporting actions share one horizon,
 * followed by the product demonstration in the same page frame.
 */
export function HeroHeadline() {
  const { t } = useT('home');
  const locale = useCurrentLocale();

  return (
    <section className="relative overflow-hidden pt-14 sm:pt-20 lg:pt-28">
      <SiteContainer className="relative">
        <div className="grid min-w-0 grid-cols-1 items-end gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-16">
          <Reveal onMount y={16} duration={0.65}>
            <SectionHeading
              bare
              size="display"
              align="start"
              eyebrow={t('hero.eyebrow')}
              title={t('hero.title')}
            />
          </Reveal>
          <Reveal
            onMount
            y={12}
            delay={0.12}
            duration={0.6}
            className="flex max-w-lg min-w-0 flex-col gap-7 lg:pb-2"
          >
            <p className="text-fg-muted text-[17px] leading-relaxed text-pretty lg:text-lg">
              {t('hero.subtitle')}
            </p>
            <CtaPair
              align="start"
              primary={{
                label: t('hero.ctaPrimary'),
                to: REQUEST_DEMO_PATH,
              }}
              secondary={{
                label: t('hero.ctaSecondary'),
                href: getSelfHostedQuickstartUrl(locale),
              }}
            />
          </Reveal>
          <Reveal onMount delay={0.2} duration={0.6} className="lg:col-span-2">
            <p className="text-fg-subtle text-sm">{t('hero.proof')}</p>
          </Reveal>
        </div>
        <Reveal
          onMount
          y={16}
          delay={0.22}
          duration={0.75}
          className="relative mt-10 w-full sm:mt-14"
        >
          <DemoStage variant="hero">
            <HomeHeroDemo />
          </DemoStage>
        </Reveal>
      </SiteContainer>
    </section>
  );
}
