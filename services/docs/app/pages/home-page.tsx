import { MarketingCard } from '@tale/marketing-ui/card';
import { CtaPair } from '@tale/marketing-ui/cta-group';
import { MarketingExternalLink } from '@tale/marketing-ui/external-link';
import { FeatureHero } from '@tale/marketing-ui/feature-hero';
import { MarketingLink } from '@tale/marketing-ui/link';
import { PageSection } from '@tale/marketing-ui/page-section';
import { MarketingPanel } from '@tale/marketing-ui/panel';
import { Reveal } from '@tale/marketing-ui/reveal';
import { SectionHeading } from '@tale/marketing-ui/section-heading';
import { SiteFooter } from '@tale/marketing-ui/site-footer';
import { SiteHeader } from '@tale/marketing-ui/site-header';
import { DocsSearchTrigger } from '@tale/ui/docs/docs-search-trigger';
import { useDocsSearch } from '@tale/ui/docs/use-docs-search';
import { IconButton } from '@tale/ui/icon-button';
import { TaleLogo } from '@tale/ui/logo';
import {
  buildBreadcrumbListJsonLd,
  buildWebSiteJsonLd,
} from '@tale/ui/seo/builders/json-ld';
import { TALE_GITHUB_URL, TALE_SITE_URL } from '@tale/ui/seo/globals';
import { SkipLink } from '@tale/ui/skip-link';
import { ThemeSwitcher } from '@tale/ui/theme-switcher';
import {
  ArrowRight,
  BookOpen,
  Bot,
  CheckCheck,
  Code2,
  ListTodo,
  Play,
  Search,
  Server,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { lazy, Suspense, useMemo } from 'react';

import { HOME_GUIDES } from '@/lib/content/home-guides';
import { getDocPage } from '@/lib/content/loader';
import { docPath, docUrl } from '@/lib/content/paths';
import { useDocsSearchConfig } from '@/lib/content/use-docs-search-config';
import { useT } from '@/lib/i18n/client';
import { BASE_LOCALES, type SupportedLocale } from '@/lib/i18n/locales';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

const DocsSearchDialog = lazy(() =>
  import('@tale/ui/docs/docs-search-dialog').then((module) => ({
    default: module.DocsSearchDialog,
  })),
);
const PATH_ICONS = [Users, ShieldCheck, Code2];
const TUTORIAL_ICONS = [Users, Bot, CheckCheck];
const REFERENCE_ICONS = [BookOpen, Code2, Server, ShieldCheck];
const PROGRESSION = [
  { key: 'define', slug: 'platform/projects/tasks', icon: ListTodo },
  { key: 'delegate', slug: 'get-started/editors', icon: Bot },
  {
    key: 'review',
    slug: 'platform/projects/task-automation',
    icon: CheckCheck,
  },
] as const;

/** The locale roots are discovery pages; the guides keep the shared article frame. */
export function HomePage({ locale }: { locale: SupportedLocale }) {
  const { t } = useT('home');
  const { t: tNav } = useT('nav');
  const { t: tDocs } = useT('docs');
  const { t: tSeo } = useT('seo');
  const { t: tFooter } = useT('footer');
  const { t: tTheme } = useT('themeSwitcher');
  const search = useDocsSearchConfig(locale);
  const { searchOpen, searchMounted, setSearchOpen, openSearch } =
    useDocsSearch();
  const doc = getDocPage(locale, 'index');
  const homePath = docPath(locale, 'index');
  const homeUrl = docUrl(locale, 'index');
  const alternates = useMemo(
    () =>
      Object.fromEntries(
        BASE_LOCALES.map((code) => [code, docUrl(code, 'index')]),
      ),
    [],
  );
  const jsonLd = useMemo(
    () => [
      buildWebSiteJsonLd({ name: tSeo('siteTitle'), url: homeUrl }),
      buildBreadcrumbListJsonLd([{ name: tSeo('siteTitle'), url: homeUrl }]),
    ],
    [homeUrl, tSeo],
  );

  useDocumentMeta({
    title: tSeo('siteTitle'),
    description: doc?.frontmatter.description ?? '',
    canonicalPath: homePath,
    locale,
    alternates,
    jsonLd,
  });

  const navigation = [
    { slug: 'get-started/quickstart', label: tNav('groups.start') },
    { slug: 'tutorials/overview', label: tNav('groups.tutorials') },
    { slug: 'develop/overview', label: tNav('groups.develop') },
  ];
  const firstAgent = getDocPage(locale, HOME_GUIDES.featured);

  return (
    <div className="marketing-surface bg-surface-site text-fg-base relative flex min-h-screen flex-col">
      <SkipLink>{tDocs('skipToMain')}</SkipLink>
      <div
        aria-hidden
        className="bg-gradient-site-hero pointer-events-none absolute inset-x-0 top-0 h-[min(90vh,52rem)]"
      />
      <SiteHeader
        surface="site"
        openMenuLabel={tDocs('openMenu')}
        closeMenuLabel={tDocs('closeMenu')}
        logo={
          <MarketingLink
            to={homePath}
            tone="plain"
            aria-label={tNav('homeAriaLabel')}
            className="inline-flex items-center gap-3"
          >
            <TaleLogo />
            <span className="text-fg-muted border-border-base border-l pl-3 text-sm">
              {t('docsLabel')}
            </span>
          </MarketingLink>
        }
        desktopNav={navigation.map(({ slug, label }) => (
          <MarketingLink key={slug} to={docPath(locale, slug)} tone="nav">
            {label}
          </MarketingLink>
        ))}
        desktopActions={
          <>
            <DocsSearchTrigger onClick={openSearch} className="w-42" />
            <ThemeSwitcher variant="segmented" />
          </>
        }
        mobileActions={
          <IconButton
            icon={Search}
            aria-label={tDocs('openSearch')}
            onClick={openSearch}
            className="border-border-base/70 size-11 rounded-full border"
          />
        }
        mobileNav={
          <>
            {navigation.map(({ slug, label }) => (
              <MarketingLink
                key={slug}
                to={docPath(locale, slug)}
                tone="navMobile"
              >
                {label}
              </MarketingLink>
            ))}
            <div className="border-border-base mt-5 border-t pt-5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-fg-muted text-sm">
                  {tTheme('ariaLabel')}
                </span>
                <ThemeSwitcher variant="segmented" />
              </div>
            </div>
          </>
        }
      />
      <main id="main" tabIndex={-1} className="relative flex-1">
        <FeatureHero
          layout="split"
          visualTreatment="plain"
          eyebrow={tSeo('siteTitle')}
          title={t('heroTitle')}
          description={t('heroDescription')}
          actions={
            <div className="flex w-full max-w-xl flex-col gap-5">
              <DocsSearchTrigger
                onClick={openSearch}
                className="bg-surface-site-raised border-border-strong shadow-site-card h-14 rounded-xl px-4 text-base md:h-14 [&_svg]:size-5"
              />
              <CtaPair
                align="start"
                primary={{
                  label: t('heroPrimary'),
                  to: docPath(locale, 'get-started/quickstart'),
                }}
                secondary={{
                  label: t('heroSecondary'),
                  to: docPath(locale, 'self-hosted/install/quickstart'),
                }}
              />
            </div>
          }
          proof={<p className="text-fg-subtle text-sm">{t('heroNote')}</p>}
          visual={<GuideMap locale={locale} />}
        />
        <PageSection surface="site" pad="lg" border="b">
          <SectionHeading
            align="start"
            eyebrow={t('pathsEyebrow')}
            title={t('pathsTitle')}
            description={t('pathsDescription')}
            className="mb-9 max-w-3xl md:mb-12"
          />
          <Reveal>
            <MarketingPanel className="bg-border-base grid gap-px lg:grid-cols-[1.1fr_1fr]">
              <MarketingCard
                reveal={false}
                icon={Bot}
                title={<h3>{firstAgent?.frontmatter.title}</h3>}
                description={t('featuredDetail')}
                to={docPath(locale, HOME_GUIDES.featured)}
                surface="featured"
                className="flex flex-col justify-center rounded-none border-0 p-7 md:p-10 lg:p-12"
              >
                <span className="text-fg-base mt-8 block text-sm font-medium">
                  {t('readGuide')}
                </span>
              </MarketingCard>
              <div className="divide-border-base grid divide-y lg:grid-rows-3">
                {HOME_GUIDES.paths.map((slug, index) => (
                  <GuideRow
                    key={slug}
                    locale={locale}
                    slug={slug}
                    icon={PATH_ICONS[index]}
                  />
                ))}
              </div>
            </MarketingPanel>
          </Reveal>
        </PageSection>
        <PageSection surface="soft" pad="lg" border="b">
          <div className="mb-9 flex flex-col gap-6 md:mb-12 md:flex-row md:items-end md:justify-between">
            <SectionHeading
              align="start"
              eyebrow={t('tutorialsEyebrow')}
              title={t('tutorialsTitle')}
              description={t('tutorialsDescription')}
              className="max-w-2xl"
            />
            <MarketingLink
              to={docPath(locale, 'tutorials/overview')}
              className="inline-flex shrink-0 items-center gap-2 text-sm font-medium"
            >
              {t('allTutorials')}
              <ArrowRight aria-hidden className="size-4" />
            </MarketingLink>
          </div>
          <Reveal>
            <MarketingPanel className="bg-border-base grid gap-px md:grid-cols-3">
              {HOME_GUIDES.tutorials.map((slug, index) => {
                const guide = getDocPage(locale, slug);
                return (
                  <MarketingCard
                    key={slug}
                    reveal={false}
                    icon={TUTORIAL_ICONS[index]}
                    title={<h3>{guide?.frontmatter.title}</h3>}
                    description={guide?.frontmatter.description}
                    to={docPath(locale, slug)}
                    className="bg-surface-site-raised flex flex-col"
                  >
                    <span className="text-fg-subtle mt-auto inline-flex items-center gap-2 pt-8 text-xs">
                      <Play aria-hidden className="size-3.5" />
                      {t('tutorialLabel')}
                    </span>
                  </MarketingCard>
                );
              })}
            </MarketingPanel>
          </Reveal>
        </PageSection>
        <PageSection surface="site" pad="lg" border="none">
          <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:gap-20">
            <SectionHeading
              align="start"
              eyebrow={t('referenceEyebrow')}
              title={t('referenceTitle')}
              description={t('referenceDescription')}
            />
            <div className="border-border-base divide-border-base divide-y border-t">
              {HOME_GUIDES.reference.map((slug, index) => (
                <GuideRow
                  key={slug}
                  locale={locale}
                  slug={slug}
                  icon={REFERENCE_ICONS[index]}
                />
              ))}
            </div>
          </div>
        </PageSection>
      </main>
      <SiteFooter
        copyrightLines={[
          tFooter('copyrightLine1', { year: new Date().getFullYear() }),
          tFooter('copyrightLine2'),
        ]}
        llmsTxtUrl={`${import.meta.env.BASE_URL ?? '/'}llms.txt`}
        llmsFullTxtUrl={`${import.meta.env.BASE_URL ?? '/'}llms-full.txt`}
        themeSwitcherVariant="segmented"
        languageSwitcherShowFlag={false}
        bottomTrailing={
          <>
            <MarketingExternalLink
              href={TALE_SITE_URL}
              tone="footer"
              showIcon={false}
            >
              {t('productLink')}
            </MarketingExternalLink>
            <MarketingExternalLink
              href={TALE_GITHUB_URL}
              tone="footer"
              showIcon={false}
            >
              GitHub
            </MarketingExternalLink>
          </>
        }
      />
      {searchMounted ? (
        <Suspense fallback={null}>
          <DocsSearchDialog
            {...search}
            open={searchOpen}
            onOpenChange={setSearchOpen}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

function GuideMap({ locale }: { locale: SupportedLocale }) {
  const { t } = useT('home');
  return (
    <MarketingPanel className="bg-surface-site-raised shadow-site-card relative p-6 sm:p-8 lg:p-9">
      <div className="mb-8 flex items-center gap-3">
        <span className="bg-demo-mint-soft text-demo-mint flex size-10 items-center justify-center rounded-xl">
          <Bot aria-hidden className="size-5" />
        </span>
        <p className="text-fg-base max-w-xs text-lg font-medium tracking-tight">
          {t('mapTitle')}
        </p>
      </div>
      <ol className="space-y-3">
        {PROGRESSION.map(({ key, slug, icon: Icon }, index) => (
          <li key={key}>
            <MarketingLink
              to={docPath(locale, slug)}
              tone="plain"
              className="group border-border-base bg-surface-site hover:bg-surface-site-inset flex items-start gap-4 rounded-xl border p-4 transition-colors motion-reduce:transition-none sm:p-5"
            >
              <span className="text-fg-subtle mt-1 font-mono text-xs">
                0{index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="mb-1 flex items-center gap-2 text-sm font-medium">
                  <Icon aria-hidden className="size-4 shrink-0" />
                  {t(`map.${key}.title`)}
                </span>
                <span className="text-fg-muted block text-sm leading-relaxed">
                  {t(`map.${key}.description`)}
                </span>
              </span>
              <ArrowRight
                aria-hidden
                className="text-fg-subtle mt-1 size-4 shrink-0 transition-transform motion-safe:group-hover:translate-x-1 motion-reduce:transition-none"
              />
            </MarketingLink>
          </li>
        ))}
      </ol>
      <p className="text-fg-subtle mt-6 text-xs leading-relaxed">
        {t('mapNote')}
      </p>
    </MarketingPanel>
  );
}

function GuideRow({
  locale,
  slug,
  icon: Icon,
}: {
  locale: SupportedLocale;
  slug: string;
  icon: typeof Users;
}) {
  const guide = getDocPage(locale, slug);
  return (
    <MarketingLink
      to={docPath(locale, slug)}
      tone="plain"
      className="group bg-surface-site-raised hover:bg-surface-site-inset flex items-start gap-4 rounded-none px-6 py-6 transition-colors motion-reduce:transition-none md:px-8"
    >
      <Icon
        aria-hidden
        className="text-fg-muted mt-1 size-5 shrink-0"
        strokeWidth={1.5}
      />
      <div className="min-w-0 flex-1">
        <h3 className="text-fg-base text-base font-medium tracking-tight">
          {guide?.frontmatter.title}
        </h3>
        <span className="text-fg-muted mt-1 block text-sm leading-relaxed">
          {guide?.frontmatter.description}
        </span>
      </div>
      <ArrowRight
        aria-hidden
        className="text-fg-subtle mt-1 size-4 shrink-0 transition-transform motion-safe:group-hover:translate-x-1 motion-reduce:transition-none"
      />
    </MarketingLink>
  );
}
