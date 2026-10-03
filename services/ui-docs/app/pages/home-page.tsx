import { MarketingCard } from '@tale/marketing-ui/card';
import { CtaPair } from '@tale/marketing-ui/cta-group';
import { MarketingLink } from '@tale/marketing-ui/link';
import { PageSection } from '@tale/marketing-ui/page-section';
import { MarketingPanel } from '@tale/marketing-ui/panel';
import { Reveal } from '@tale/marketing-ui/reveal';
import { SectionHeading } from '@tale/marketing-ui/section-heading';
import { SiteContainer } from '@tale/marketing-ui/site-container';
import { cn } from '@tale/ui/cn';
import { CodeBlock } from '@tale/ui/code-block';
import {
  buildBreadcrumbListJsonLd,
  buildWebSiteJsonLd,
} from '@tale/ui/seo/builders/json-ld';
import { SkipLink } from '@tale/ui/skip-link';
import {
  Blocks,
  Command,
  LayoutTemplate,
  Megaphone,
  Palette,
  Rocket,
} from 'lucide-react';
import { useMemo } from 'react';

import { HomeShowcase } from '@/app/components/home/home-showcase';
import {
  SiteFooterBar,
  SiteHeaderBar,
} from '@/app/components/home/site-chrome';
import { firstNavSlug, flattenNav, navGroupPageCount } from '@/lib/content/nav';
import { docPath, SITE_URL } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';
import { TALE_REPO_URL } from '@/lib/site-url';

/** Keep this pasteable block in step with packages/ui/README.md. */
const INSTALL_SNIPPET = `{
  "dependencies": {
    "@tale/ui": "github:tale-project/tale#dist/ui",
    "react": "19.2.5",
    "react-dom": "19.2.5",
    "tailwindcss": "4.2.2"
  }
}`;

/** The featured introduction plus four equally weighted reference sections. */
const SECTION_CARDS = [
  {
    slug: 'getting-started/introduction',
    labelKey: 'gettingStarted',
    descriptionKey: 'sectionsGettingStarted',
    icon: Rocket,
  },
  {
    slug: 'foundations/colors',
    labelKey: 'foundations',
    descriptionKey: 'sectionsFoundations',
    icon: Palette,
  },
  {
    slug: 'components/button',
    labelKey: 'components',
    descriptionKey: 'sectionsComponents',
    icon: Blocks,
  },
  {
    slug: 'patterns/list-page',
    labelKey: 'patterns',
    descriptionKey: 'sectionsPatterns',
    icon: LayoutTemplate,
  },
  {
    slug: 'marketing-ui/overview',
    labelKey: 'marketingUi',
    descriptionKey: 'sectionsMarketingUi',
    icon: Megaphone,
  },
] as const;

/** The public shop window; /docs keeps the shared application documentation frame. */
export function HomePage() {
  const { t } = useT('home');
  const { t: tNav } = useT('nav');
  const { t: tSeo } = useT('seo');
  const docsHref = docPath(firstNavSlug());
  const guideCount = flattenNav().length;

  const jsonLd = useMemo(
    () => [
      buildWebSiteJsonLd({ name: tSeo('siteTitle'), url: SITE_URL }),
      buildBreadcrumbListJsonLd([{ name: tSeo('siteTitle'), url: SITE_URL }]),
    ],
    [tSeo],
  );

  useDocumentMeta({
    title: tSeo('siteTitle'),
    description: t('heroDescription'),
    canonicalPath: '/',
    jsonLd,
  });

  return (
    <div className="bg-surface-site text-fg-base relative flex min-h-screen flex-col">
      <SkipLink>{tNav('skipToMain')}</SkipLink>
      <div
        aria-hidden
        className="bg-gradient-site-hero pointer-events-none absolute inset-x-0 top-0 h-[min(80vh,48rem)]"
      />
      <SiteHeaderBar />
      <main id="main" tabIndex={-1} className="relative flex-1">
        <section className="pt-12 pb-12 sm:pt-16 sm:pb-16 lg:pt-24 lg:pb-20">
          <SiteContainer>
            <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-end lg:gap-20">
              <Reveal onMount y={16} duration={0.7}>
                <SectionHeading
                  bare
                  size="display"
                  align="start"
                  eyebrow={
                    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
                      <span>@tale/ui</span>
                      <span aria-hidden className="text-fg-subtle/60">
                        /
                      </span>
                      <span>@tale/marketing-ui</span>
                    </span>
                  }
                  title={t('heroTitle')}
                  className="max-w-170"
                />
              </Reveal>
              <Reveal
                onMount
                y={12}
                delay={0.1}
                duration={0.7}
                className="flex max-w-130 flex-col items-start gap-7 lg:pb-1"
              >
                <p className="text-fg-muted text-base leading-relaxed tracking-[-0.015em] sm:text-lg">
                  {t('heroDescription')}
                </p>
                <CtaPair
                  align="start"
                  primary={{ label: t('heroPrimary'), to: docsHref }}
                  secondary={{ label: t('heroSecondary'), href: TALE_REPO_URL }}
                />
                <p className="text-fg-subtle max-w-100 text-xs leading-relaxed">
                  {t('heroMeta', { count: guideCount })}
                </p>
              </Reveal>
            </div>
          </SiteContainer>
        </section>

        <section>
          <SiteContainer>
            <div className="border-border-base grid gap-4 border-t pt-6 pb-7 md:grid-cols-[1fr_1fr] md:items-end md:gap-16 md:pt-8 md:pb-9">
              <SectionHeading
                size="subsection"
                align="start"
                title={t('showcaseTitle')}
              />
              <Reveal>
                <p className="text-fg-muted max-w-120 text-sm leading-relaxed md:ml-auto">
                  {t('showcaseDescription')}
                </p>
              </Reveal>
            </div>
          </SiteContainer>
          <HomeShowcase />
        </section>

        <PageSection surface="site" pad="lg" border="b">
          <SectionHeading
            size="subsection"
            align="start"
            title={t('packagesTitle')}
            description={t('packagesDescription')}
            className="mb-9 max-w-3xl md:mb-12"
            descriptionClassName="max-w-160"
          />
          <Reveal>
            <MarketingPanel className="bg-border-base grid gap-px md:grid-cols-2">
              <MarketingCard
                reveal={false}
                icon={Blocks}
                title={t('appPackageTitle')}
                description={t('appPackageDescription')}
                to={docPath('components/button')}
                className="bg-surface-site-raised flex flex-col rounded-none focus-visible:-outline-offset-2"
              >
                <code className="text-fg-subtle mt-5 block text-xs">
                  @tale/ui
                </code>
                <span className="text-fg-base mt-auto block pt-7 text-sm font-medium">
                  {t('appPackageLink')}
                </span>
              </MarketingCard>
              <MarketingCard
                reveal={false}
                icon={Megaphone}
                title={t('marketingPackageTitle')}
                description={t('marketingPackageDescription')}
                to={docPath('marketing-ui/overview')}
                className="bg-surface-site-raised flex flex-col rounded-none focus-visible:-outline-offset-2"
              >
                <code className="text-fg-subtle mt-5 block text-xs">
                  @tale/marketing-ui
                </code>
                <span className="text-fg-base mt-auto block pt-7 text-sm font-medium">
                  {t('marketingPackageLink')}
                </span>
              </MarketingCard>
            </MarketingPanel>
          </Reveal>
        </PageSection>

        <PageSection surface="site" pad="lg" border="b">
          <div className="mb-9 grid gap-5 md:mb-12 md:grid-cols-[1fr_1fr] md:items-end md:gap-16">
            <SectionHeading
              size="subsection"
              align="start"
              title={t('sectionsTitle')}
            />
            <Reveal>
              <p className="text-fg-muted max-w-120 text-base leading-relaxed md:ml-auto">
                {t('sectionsDescription')}
              </p>
            </Reveal>
          </div>
          <Reveal>
            <MarketingPanel className="bg-border-base grid grid-cols-1 gap-px sm:grid-cols-2 lg:grid-cols-3">
              {SECTION_CARDS.map((card, index) => (
                <MarketingCard
                  key={card.slug}
                  reveal={false}
                  to={docPath(card.slug)}
                  icon={card.icon}
                  title={tNav(`groups.${card.labelKey}`)}
                  description={t(card.descriptionKey)}
                  className={cn(
                    'bg-surface-site-raised flex min-w-0 flex-col',
                    index === 0 &&
                      'bg-surface-site-inset sm:col-span-2 lg:col-span-1 lg:row-span-2',
                  )}
                >
                  {index === 0 ? (
                    <div
                      aria-hidden
                      className="my-8 hidden flex-1 flex-col justify-center gap-4 font-mono text-xs sm:flex lg:my-12"
                    >
                      <span className="text-fg-muted flex items-center gap-3">
                        <span className="border-border-base w-5 border-t" />
                        @tale/ui
                      </span>
                      <span className="border-border-base text-fg-muted ml-5 border-l py-2 pl-5">
                        @tale/marketing-ui
                      </span>
                      <span className="text-fg-muted flex items-center gap-3">
                        <span className="border-border-base w-5 border-t" />
                        {tNav('groups.patterns')}
                      </span>
                    </div>
                  ) : null}
                  <span className="text-fg-subtle mt-auto block pt-6 font-mono text-xs">
                    {t('guideCount', {
                      count: navGroupPageCount(card.labelKey),
                    })}
                  </span>
                </MarketingCard>
              ))}
            </MarketingPanel>
          </Reveal>
        </PageSection>

        <PageSection surface="wash" pad="lg" border="b">
          <div className="grid gap-9 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-20">
            <div className="flex min-w-0 flex-col items-start gap-7">
              <SectionHeading
                size="subsection"
                align="start"
                title={t('installTitle')}
                description={t('installDescription')}
              />
              <Reveal>
                <MarketingLink
                  to={docPath('getting-started/installation')}
                  tone="subtle"
                >
                  {t('installDocsLink')}
                </MarketingLink>
              </Reveal>
            </div>
            <Reveal className="min-w-0">
              <CodeBlock
                label={t('installCodeLabel')}
                copyValue={INSTALL_SNIPPET}
                copyLabel={t('installCodeLabel')}
                className="shadow-demo w-full"
              >
                {INSTALL_SNIPPET}
              </CodeBlock>
            </Reveal>
          </div>
        </PageSection>

        <PageSection
          surface="plain"
          pad="xl"
          border="none"
          className="bg-gradient-site-cta relative overflow-hidden"
        >
          <Reveal className="grid items-end gap-10 lg:grid-cols-[1fr_auto] lg:gap-16">
            <div className="flex max-w-170 flex-col items-start gap-7">
              <Command
                aria-hidden
                className="text-fg-muted size-8"
                strokeWidth={1.25}
              />
              <SectionHeading
                bare
                size="section"
                align="start"
                title={t('closingTitle')}
                description={t('closingDescription')}
              />
            </div>
            <CtaPair
              align="start"
              className="lg:mb-1 lg:flex-col lg:items-stretch"
              primary={{ label: t('closingPrimary'), to: docsHref }}
              secondary={{
                label: t('closingSecondary'),
                to: docPath('components/button'),
              }}
            />
          </Reveal>
        </PageSection>
      </main>
      <SiteFooterBar />
    </div>
  );
}
