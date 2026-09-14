import { MarketingCard } from '@tale/marketing-ui/card';
import { CtaPair } from '@tale/marketing-ui/cta-group';
import { MarketingLink } from '@tale/marketing-ui/link';
import { PageSection } from '@tale/marketing-ui/page-section';
import { MarketingPanel } from '@tale/marketing-ui/panel';
import { SectionHeading } from '@tale/marketing-ui/section-heading';
import { MarketingStack } from '@tale/marketing-ui/stack';
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
import { firstNavSlug } from '@/lib/content/nav';
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

/**
 * The front page, in the MARKETING design language: `@tale/marketing-ui`
 * chrome, sections and demo frames. Everything under `/docs` switches to the
 * app language — the two are deliberately different, and the seam is here.
 */
export function HomePage() {
  const { t } = useT('home');
  const { t: tNav } = useT('nav');
  const { t: tSeo } = useT('seo');
  const docsHref = docPath(firstNavSlug());

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
    <div className="bg-surface-site text-fg-base flex min-h-screen flex-col">
      <SkipLink>{tNav('skipToMain')}</SkipLink>
      <div className="bg-gradient-site-hero">
        <SiteHeaderBar />
      </div>
      <main id="main" tabIndex={-1} className="flex-1">
        <PageSection surface="transparent" pad="xl" border="none">
          <MarketingStack gap="lg" max="xl">
            <SectionHeading
              size="display"
              title={t('heroTitle')}
              description={t('heroDescription')}
            />
            <CtaPair
              primary={{ label: t('heroPrimary'), to: docsHref }}
              secondary={{ label: t('heroSecondary'), href: TALE_REPO_URL }}
            />
          </MarketingStack>
        </PageSection>

        <PageSection surface="site" pad="lg" border="t">
          <MarketingStack gap="md" max="lg">
            <SectionHeading
              size="subsection"
              title={t('showcaseTitle')}
              description={t('showcaseDescription')}
            />
          </MarketingStack>
        </PageSection>

        <PageSection surface="transparent" pad="md" border="b" bare>
          <HomeShowcase />
        </PageSection>

        <PageSection surface="plain" pad="lg" border="b">
          <MarketingStack gap="lg" max="full">
            <SectionHeading
              size="section"
              title={t('sectionsTitle')}
              description={t('sectionsDescription')}
            />
            <MarketingPanel className="grid grid-cols-1 divide-y divide-[color:var(--color-border-base)] sm:grid-cols-2 sm:divide-x lg:grid-cols-3">
              {SECTION_CARDS.map((card) => (
                <MarketingCard
                  key={card.slug}
                  to={docPath(card.slug)}
                  icon={card.icon}
                  title={tNav(`groups.${card.labelKey}`)}
                  description={t(card.descriptionKey)}
                />
              ))}
            </MarketingPanel>
          </MarketingStack>
        </PageSection>

        <PageSection surface="wash" pad="lg" border="b">
          <MarketingStack gap="md" max="md" align="start">
            <SectionHeading
              size="subsection"
              align="start"
              title={t('installTitle')}
              description={t('installDescription')}
            />
            <CodeBlock
              label={t('installCodeLabel')}
              copyValue={INSTALL_SNIPPET}
              copyLabel={t('installCodeLabel')}
              className="w-full"
            >
              {INSTALL_SNIPPET}
            </CodeBlock>
            <MarketingLink
              to={docPath('getting-started/installation')}
              tone="subtle"
            >
              {t('installDocsLink')}
            </MarketingLink>
          </MarketingStack>
        </PageSection>

        <PageSection surface="soft" pad="xl" border="none">
          <MarketingStack gap="lg" max="lg">
            <SectionHeading
              size="section"
              title={t('closingTitle')}
              description={t('closingDescription')}
            />
            <CtaPair
              primary={{
                label: t('closingPrimary'),
                to: docPath('getting-started/introduction'),
              }}
              secondary={{
                label: t('closingSecondary'),
                to: docPath('components/button'),
              }}
            />
          </MarketingStack>
        </PageSection>
      </main>
      <SiteFooterBar />
    </div>
  );
}
