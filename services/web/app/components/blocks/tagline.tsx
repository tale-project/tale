import { Scale, Server, ShieldCheck } from 'lucide-react';

import {
  CtaPair,
  PageSection,
  Reveal,
  SectionHeading,
} from '@/app/components/marketing';
import { getSelfHostedQuickstartUrl } from '@/lib/docs-url';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';

const PILLARS = [
  { key: 'selfHosted', Icon: Server },
  { key: 'security', Icon: ShieldCheck },
  { key: 'openSource', Icon: Scale },
] as const;

export function Tagline() {
  const { t } = useT('home');
  const { t: tNav } = useT('nav');
  const locale = useCurrentLocale();

  return (
    <PageSection surface="contrast" pad="xl" border="none">
      <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-24">
        <Reveal className="flex flex-col gap-8 lg:sticky lg:top-28">
          <SectionHeading
            bare
            align="start"
            eyebrow={t('tagline.eyebrow')}
            title={t('tagline.title')}
            description={t('tagline.subtitle')}
          />
          <CtaPair
            align="start"
            primary={{
              label: t('hero.ctaSecondary'),
              href: getSelfHostedQuickstartUrl(locale),
            }}
            secondary={{ label: tNav('pricing'), to: '/pricing' }}
          />
        </Reveal>
        <div>
          {PILLARS.map(({ key, Icon }, index) => (
            <Reveal
              key={key}
              className="border-border-base border-t py-7 first:pt-7"
            >
              <div className="mb-4 flex items-center justify-between">
                <Icon
                  aria-hidden
                  className="text-fg-base size-6"
                  strokeWidth={1.5}
                />
                <span aria-hidden className="text-fg-subtle font-mono text-xs">
                  0{index + 1}
                </span>
              </div>
              <h3 className="text-fg-base text-xl font-medium tracking-tight">
                {t(`tagline.pillars.${key}.title`)}
              </h3>
              <p className="text-fg-muted mt-3 text-[15px] leading-relaxed">
                {t(`tagline.pillars.${key}.description`)}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </PageSection>
  );
}
