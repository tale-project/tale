import { MarketingCard } from '@tale/marketing-ui/card';
import { CtaPair } from '@tale/marketing-ui/cta-group';
import { FeatureHero } from '@tale/marketing-ui/feature-hero';
import { MarketingLink } from '@tale/marketing-ui/link';
import { PageSection } from '@tale/marketing-ui/page-section';
import { Reveal } from '@tale/marketing-ui/reveal';
import { SectionHeading } from '@tale/marketing-ui/section-heading';
import { CodeBlock } from '@tale/ui/code-block';
import {
  buildBreadcrumbListJsonLd,
  buildWebSiteJsonLd,
} from '@tale/ui/seo/builders/json-ld';
import { SkipLink } from '@tale/ui/skip-link';
import { Tabs } from '@tale/ui/tabs';
import {
  ArrowRight,
  Blocks,
  Check,
  Code2,
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
import { flattenNav, navGroupPageCount } from '@/lib/content/nav';
import { docPath, SITE_URL } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

/** Source installs from content/getting-started/installation.md, not npm releases. */
const INSTALL_APP =
  "bun add 'github:tale-project/tale#dist/ui' react@19 react-dom@19 tailwindcss@4";
const INSTALL_MARKETING =
  "bun add 'github:tale-project/tale#dist/ui' 'github:tale-project/tale#dist/marketing-ui' react@19 react-dom@19 tailwindcss@4";

const SECTIONS = [
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

/** The component studio; /docs keeps the shared application documentation frame. */
export function HomePage() {
  const { t } = useT('home');
  const { t: tNav } = useT('nav');
  const { t: tSeo } = useT('seo');
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
        <FeatureHero
          layout="split"
          visualTreatment="plain"
          eyebrow={t('heroEyebrow')}
          title={t('heroTitle')}
          description={t('heroDescription')}
          actions={
            <CtaPair
              align="start"
              primary={{
                label: t('heroPrimary'),
                to: docPath('getting-started/installation'),
              }}
              secondary={{
                label: t('heroSecondary'),
                to: docPath('components/button'),
              }}
            />
          }
          proof={
            <div className="flex flex-col gap-3">
              <span className="text-fg-base flex items-center gap-2 font-mono text-xs">
                <Code2 aria-hidden className="text-brand-base size-4" />
                React · TypeScript · Tailwind CSS
              </span>
              <p className="text-fg-muted text-xs leading-relaxed">
                {t('heroMeta', { count: guideCount })}
              </p>
            </div>
          }
          visual={<HomeShowcase />}
        />

        <PageSection surface="site" pad="lg" border="b">
          <div className="mb-8 grid gap-5 md:grid-cols-[1fr_1fr] md:items-end md:gap-16">
            <SectionHeading
              size="section"
              align="start"
              title={t('packagesTitle')}
            />
            <p className="text-fg-muted max-w-120 text-base leading-relaxed md:ml-auto">
              {t('packagesDescription')}
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <MarketingCard
              surface="featured"
              title={t('appPackageTitle')}
              description={t('appPackageDescription')}
              to={docPath('components/button')}
              showArrow
              className="flex flex-col"
            >
              <div
                aria-hidden
                className="border-border-base bg-surface-site-raised my-6 grid min-h-36 grid-cols-[1fr_auto] items-center gap-x-6 gap-y-4 rounded-xl border p-5 font-mono text-xs"
              >
                <span className="text-fg-muted">Input</span>
                <span className="border-border-base bg-surface-site-inset text-fg-base w-28 rounded-md border px-3 py-2">
                  Aa
                </span>
                <span className="text-fg-muted">Switch</span>
                <span className="bg-brand-base justify-self-end rounded-full p-1 pl-6">
                  <span className="bg-brand-fg block size-3 rounded-full" />
                </span>
                <span className="text-fg-muted">Badge</span>
                <span className="bg-demo-mint-soft text-demo-mint flex items-center gap-1.5 justify-self-end rounded-md px-2 py-1">
                  <Check className="size-3" />
                  {t('appPackageSpecimen')}
                </span>
              </div>
              <code className="text-fg-muted mt-auto block text-xs">
                @tale/ui
              </code>
              <span className="text-fg-base mt-3 block text-sm font-medium">
                {t('appPackageLink')}
              </span>
            </MarketingCard>
            <MarketingCard
              surface="quiet"
              title={t('marketingPackageTitle')}
              description={t('marketingPackageDescription')}
              to={docPath('marketing-ui/overview')}
              showArrow
              className="flex flex-col"
            >
              <div
                aria-hidden
                className="border-border-base bg-surface-site-raised my-6 flex min-h-36 flex-col items-start justify-center gap-3 rounded-xl border p-5"
              >
                <Megaphone
                  aria-hidden
                  className="text-brand-base size-5"
                  strokeWidth={1.5}
                />
                <span className="max-w-60 text-2xl leading-tight font-medium tracking-[-0.04em]">
                  {t('marketingPackageSpecimen')}
                </span>
                <span className="bg-accent-base text-accent-fg flex items-center gap-4 rounded-lg px-3 py-2 text-[10px]">
                  {t('marketingPackageSpecimenAction')}
                  <ArrowRight className="size-3" />
                </span>
              </div>
              <code className="text-fg-muted mt-auto block text-xs">
                @tale/marketing-ui
              </code>
              <span className="text-fg-base mt-3 block text-sm font-medium">
                {t('marketingPackageLink')}
              </span>
            </MarketingCard>
          </div>
        </PageSection>

        <PageSection surface="site" pad="lg" border="b">
          <div className="grid gap-9 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
            <SectionHeading
              size="section"
              align="start"
              title={t('sectionsTitle')}
              description={t('sectionsDescription')}
            />
            <div className="border-border-base border-t">
              {SECTIONS.map(
                ({ slug, labelKey, descriptionKey, icon: Icon }) => (
                  <MarketingLink
                    key={slug}
                    to={docPath(slug)}
                    tone="plain"
                    className="group border-border-base hover:bg-surface-site-inset focus-visible:outline-fg-base flex items-start gap-4 border-b px-2 py-5 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 motion-reduce:transition-none sm:gap-5 sm:px-3"
                  >
                    <Icon
                      aria-hidden
                      className="text-fg-muted mt-1 size-5 shrink-0"
                      strokeWidth={1.5}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <span className="text-base font-medium">
                          {tNav(`groups.${labelKey}`)}
                        </span>
                        <span className="text-fg-muted font-mono text-[11px]">
                          {t('guideCount', {
                            count: navGroupPageCount(labelKey),
                          })}
                        </span>
                      </span>
                      <span className="text-fg-muted mt-1.5 block text-sm leading-relaxed">
                        {t(descriptionKey)}
                      </span>
                    </span>
                    <ArrowRight
                      aria-hidden
                      className="text-fg-muted mt-1 size-4 shrink-0 transition-transform motion-safe:group-hover:translate-x-1 motion-safe:group-focus-visible:translate-x-1 motion-reduce:transition-none"
                    />
                  </MarketingLink>
                ),
              )}
            </div>
          </div>
        </PageSection>

        <PageSection surface="wash" pad="lg" border="b">
          <div className="grid gap-9 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:gap-20">
            <div className="flex min-w-0 flex-col items-start gap-6">
              <SectionHeading
                size="section"
                align="start"
                title={t('installTitle')}
                description={t('installDescription')}
              />
              <MarketingLink
                to={docPath('getting-started/installation')}
                tone="subtle"
              >
                {t('installDocsLink')}
              </MarketingLink>
            </div>
            <div className="min-w-0">
              <Tabs
                defaultValue="app"
                listAriaLabel={t('installPackagesLabel')}
                triggerClassName="min-h-11 sm:min-h-10"
                items={[
                  {
                    value: 'app',
                    label: '@tale/ui',
                    content: (
                      <CodeBlock
                        label={t('installCodeLabel')}
                        copyValue={INSTALL_APP}
                        copyLabel={t('installAppCopyLabel')}
                        className="shadow-demo [&>p]:text-fg-muted w-full"
                      >
                        {INSTALL_APP}
                      </CodeBlock>
                    ),
                  },
                  {
                    value: 'marketing',
                    label: '@tale/marketing-ui',
                    content: (
                      <CodeBlock
                        label={t('installCodeLabel')}
                        copyValue={INSTALL_MARKETING}
                        copyLabel={t('installMarketingCopyLabel')}
                        className="shadow-demo [&>p]:text-fg-muted w-full"
                      >
                        {INSTALL_MARKETING}
                      </CodeBlock>
                    ),
                  },
                ]}
              />
              <p className="text-fg-muted mt-4 max-w-140 text-xs leading-relaxed">
                {t('installSetupNote')}
              </p>
            </div>
          </div>
        </PageSection>

        <PageSection surface="contrast" pad="compact" border="none">
          <Reveal className="flex flex-col items-start justify-between gap-7 md:flex-row md:items-center">
            <div className="max-w-140">
              <h2 className="text-2xl font-medium tracking-tight sm:text-3xl">
                {t('closingTitle')}
              </h2>
              <p className="mt-3 text-sm leading-relaxed opacity-80">
                {t('closingDescription')}
              </p>
            </div>
            <MarketingLink
              to={docPath('getting-started/introduction')}
              tone="plain"
              className="inline-flex shrink-0 items-center gap-6 rounded-xl border border-current/30 px-5 py-3 text-sm font-medium hover:bg-current/5 focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              {t('closingPrimary')}
              <ArrowRight aria-hidden className="size-4" />
            </MarketingLink>
          </Reveal>
        </PageSection>
      </main>
      <SiteFooterBar />
    </div>
  );
}
