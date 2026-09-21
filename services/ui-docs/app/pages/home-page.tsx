import { MarketingCard } from '@tale/marketing-ui/card';
import { CtaPair } from '@tale/marketing-ui/cta-group';
import { MarketingLink } from '@tale/marketing-ui/link';
import { PageSection } from '@tale/marketing-ui/page-section';
import { MarketingPanel } from '@tale/marketing-ui/panel';
import { Reveal } from '@tale/marketing-ui/reveal';
import { SectionHeading } from '@tale/marketing-ui/section-heading';
import { SiteContainer } from '@tale/marketing-ui/site-container';
import { MarketingStack } from '@tale/marketing-ui/stack';
import { cn } from '@tale/ui/cn';
import { CodeBlock } from '@tale/ui/code-block';
import {
  buildBreadcrumbListJsonLd,
  buildWebSiteJsonLd,
} from '@tale/ui/seo/builders/json-ld';
import { SkipLink } from '@tale/ui/skip-link';
import {
  Blocks,
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

/**
 * The exact dependency block from `packages/ui/README.md`. Kept verbatim so a
 * reader can paste it; `getting-started/installation` carries the same block
 * with the surrounding requirements.
 */
const INSTALL_SNIPPET = `{
  "dependencies": {
    "@tale/ui": "github:tale-project/tale#dist/ui",
    "react": "19.2.5",
    "react-dom": "19.2.5",
    "tailwindcss": "4.2.2"
  }
}`;

/**
 * The five documentation sections, in rail order. `span` fills the divider
 * panel at every breakpoint — five cards in an even grid would leave a sixth
 * cell empty, which reads as a missing section rather than a layout.
 * 2 columns: 2+2+1×2. 6 columns: 3×2 over 2×3.
 */
const SECTION_CARDS = [
  {
    slug: 'getting-started/introduction',
    labelKey: 'gettingStarted',
    descriptionKey: 'sectionsGettingStarted',
    icon: Rocket,
    span: 'lg:col-span-2',
  },
  {
    slug: 'foundations/colors',
    labelKey: 'foundations',
    descriptionKey: 'sectionsFoundations',
    icon: Palette,
    span: 'lg:col-span-2',
  },
  {
    slug: 'components/button',
    labelKey: 'components',
    descriptionKey: 'sectionsComponents',
    icon: Blocks,
    span: 'lg:col-span-2',
  },
  {
    slug: 'patterns/list-page',
    labelKey: 'patterns',
    descriptionKey: 'sectionsPatterns',
    icon: LayoutTemplate,
    span: 'lg:col-span-3',
  },
  {
    slug: 'marketing-ui/overview',
    labelKey: 'marketingUi',
    descriptionKey: 'sectionsMarketingUi',
    icon: Megaphone,
    span: 'sm:col-span-2 lg:col-span-3',
  },
] as const;

/**
 * The front page, in the MARKETING design language: `@tale/marketing-ui`
 * chrome, sections and demo frames. Everything under `/docs` switches to the
 * app language — the two are deliberately different, and the seam is here.
 *
 * The composition is tale.dev's, because this page is the design language's
 * own shop window: one top wash under a transparent header, a left-aligned
 * display hero, then the product stage — never a heading marooned on its own
 * band above the picture it introduces.
 */
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
      {/* One continuous top wash behind the transparent header and the hero.
          Painting it on the header alone ends it in a hard seam under the
          nav — `PageSection` documents the shell as its home. */}
      <div
        aria-hidden
        className="bg-gradient-site-hero pointer-events-none absolute inset-x-0 top-0 h-[min(72vh,40rem)]"
      />
      <SiteHeaderBar />
      <main id="main" tabIndex={-1} className="relative flex-1">
        <section className="pt-14 md:pt-24">
          <SiteContainer>
            <MarketingStack
              gap="md"
              max="xl"
              align="start"
              className="mx-0 max-w-4xl"
            >
              <Reveal onMount y={16} duration={0.65}>
                <SectionHeading
                  bare
                  size="display"
                  align="start"
                  title={t('heroTitle')}
                  description={t('heroDescription')}
                />
              </Reveal>
              <Reveal onMount y={16} delay={0.1} duration={0.6}>
                <CtaPair
                  align="start"
                  primary={{ label: t('heroPrimary'), to: docsHref }}
                  secondary={{
                    label: t('heroSecondary'),
                    href: TALE_REPO_URL,
                  }}
                />
              </Reveal>
              <Reveal onMount y={12} delay={0.18} duration={0.6}>
                <p className="text-fg-subtle text-xs tracking-[0.02em]">
                  {t('heroMeta', { count: guideCount })}
                </p>
              </Reveal>
            </MarketingStack>
          </SiteContainer>
        </section>

        <section className="pt-20 md:pt-28">
          <SiteContainer>
            <SectionHeading
              size="subsection"
              align="start"
              title={t('showcaseTitle')}
              description={t('showcaseDescription')}
              descriptionClassName="max-w-160"
            />
          </SiteContainer>
          {/* The stage draws its own rules, so it closes the band itself —
              no `PageSection` padding around it, or the picture floats
              between two empty strips. */}
          <Reveal className="mt-8 md:mt-12">
            <HomeShowcase />
          </Reveal>
        </section>

        <PageSection surface="site" pad="lg" border="b">
          <MarketingStack gap="lg" max="full" align="stretch">
            <SectionHeading
              size="subsection"
              align="start"
              title={t('sectionsTitle')}
              description={t('sectionsDescription')}
              descriptionClassName="max-w-160"
            />
            {/* One reveal for the panel, and `reveal={false}` per card: a
                card that wraps itself puts a motion div between the grid and
                the link, and the column spans land on the wrong element. */}
            <Reveal>
              <MarketingPanel className="bg-border-base grid grid-cols-1 gap-px sm:grid-cols-2 lg:grid-cols-6">
                {SECTION_CARDS.map((card) => (
                  <MarketingCard
                    key={card.slug}
                    reveal={false}
                    to={docPath(card.slug)}
                    icon={card.icon}
                    title={tNav(`groups.${card.labelKey}`)}
                    description={t(card.descriptionKey)}
                    className={cn('bg-surface-site-raised', card.span)}
                  >
                    <span className="text-fg-subtle mt-3 block text-xs">
                      {t('guideCount', {
                        count: navGroupPageCount(card.labelKey),
                      })}
                    </span>
                  </MarketingCard>
                ))}
              </MarketingPanel>
            </Reveal>
          </MarketingStack>
        </PageSection>

        <PageSection surface="wash" pad="lg" border="b">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
            <MarketingStack gap="md" max="full" align="start">
              <SectionHeading
                size="subsection"
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
            </MarketingStack>
            <Reveal>
              <CodeBlock
                label={t('installCodeLabel')}
                copyValue={INSTALL_SNIPPET}
                copyLabel={t('installCodeLabel')}
                className="w-full"
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
          <Reveal className="flex max-w-150 flex-col items-start gap-8 text-left md:gap-10">
            <SectionHeading
              bare
              size="subsection"
              align="start"
              title={t('closingTitle')}
              description={t('closingDescription')}
            />
            <CtaPair
              align="start"
              primary={{
                label: t('closingPrimary'),
                to: docPath('getting-started/introduction'),
              }}
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
