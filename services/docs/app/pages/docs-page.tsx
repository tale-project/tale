import { markdownComponents } from '@tale/ui/markdown/components/registry';
import { extractToc } from '@tale/ui/markdown/extract-toc';
import { readingTimeMinutes } from '@tale/ui/markdown/reading-time';
import { RoutedMarkdown } from '@tale/ui/markdown/routed-markdown';
import {
  buildArticleJsonLd,
  buildBreadcrumbListJsonLd,
  buildWebSiteJsonLd,
} from '@tale/ui/seo/builders/json-ld';
import { pageAsMarkdown } from '@tale/ui/seo/builders/page-as-markdown';
import { resolveFullTitle } from '@tale/ui/seo/document-meta';
import { useMemo } from 'react';

import { DocsBreadcrumbs } from '@/app/components/docs/docs-breadcrumbs';
import { DocsImage } from '@/app/components/docs/docs-image';
import { DocsPrevNext } from '@/app/components/docs/docs-prev-next';
import { DocsToc } from '@/app/components/docs/docs-toc';
import { DocsVideo } from '@/app/components/docs/docs-video';
import { EditOnGithub } from '@/app/components/docs/edit-on-github';
import { PageActions } from '@/app/features/page-actions/page-actions';
import { getDocPage } from '@/lib/content/loader';
import { flattenNav } from '@/lib/content/nav';
import { docMarkdownUrl, docPath, docUrl, SITE_URL } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import { BASE_LOCALES, type SupportedLocale } from '@/lib/i18n/locales';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

interface DocsPageProps {
  locale: SupportedLocale;
  slug: string;
}

// The shared registry plus `img`/`video` overrides that rebase root-absolute
// asset srcs onto the deploy base (see DocsImage / DocsVideo) — the router
// only rebases links, not media srcs.
const docsMarkdownComponents = {
  ...markdownComponents,
  img: DocsImage,
  video: DocsVideo,
};

function humaniseSegment(part: string): string {
  return part.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function buildBreadcrumbs(
  locale: SupportedLocale,
  slug: string,
): { label: string; slug?: string }[] {
  if (slug === 'index') return [];
  const parts = slug.split('/').filter((p) => p !== 'index');
  return parts.map((part, i) => {
    const fullSlug = parts.slice(0, i + 1).join('/');
    const isLast = i === parts.length - 1;
    if (isLast) {
      // The last segment is the current page — pass the page title if we
      // can find it so the breadcrumb shows the same name as the H1.
      const doc = getDocPage(locale, fullSlug);
      return {
        label: doc?.frontmatter.title ?? humaniseSegment(part),
      };
    }
    // Intermediate segments only get a link when the section root exists
    // on disk (e.g. `platform/index.md`); otherwise render as plain text.
    const sectionDoc = getDocPage(locale, fullSlug);
    return {
      label: sectionDoc?.frontmatter.title ?? humaniseSegment(part),
      slug: sectionDoc ? fullSlug : undefined,
    };
  });
}

/**
 * The `<title>` a crawler sees, before `resolveFullTitle` appends `| Tale`.
 *
 * A bare page name is often both too short and not unique: "Chat", "Admin",
 * "Teams" and "Overview" each name several pages in different sections, so
 * they render identical titles. Trailing the top-level section disambiguates
 * them and lifts the shortest ones out of the range Ahrefs reports as
 * "Title too short".
 *
 * The section is dropped when the page name already contains it, so
 * `self-hosted/install/quickstart` stays "Self-hosted quickstart" instead of
 * repeating itself. A section landing page has no section to add, so it takes
 * the localized site title.
 */
/** Longest rendered `<title>` a search result will show in full. */
const TITLE_MAX = 60;

export function buildMetaTitle(
  breadcrumbs: readonly { label: string }[],
  siteTitle: string,
): string {
  if (breadcrumbs.length === 0) return siteTitle;
  const page = breadcrumbs[breadcrumbs.length - 1].label;
  const section = breadcrumbs.length > 1 ? breadcrumbs[0].label : null;
  // Adding context is only worth it while the result still fits. A page name
  // long enough to overflow already describes itself.
  const withinBudget = (candidate: string) =>
    resolveFullTitle(candidate).length <= TITLE_MAX ? candidate : page;
  // A section landing page ("Cloud", "Platform") has no section above it, or
  // repeats its own name as one. Neither has anything to disambiguate with,
  // so those take the site title instead.
  if (section === null || section.toLowerCase() === page.toLowerCase()) {
    return withinBudget(`${page} | ${siteTitle}`);
  }
  // The page name already carries the section ("Self-hosted quickstart");
  // appending it again would only repeat.
  if (page.toLowerCase().includes(section.toLowerCase())) return page;
  return withinBudget(`${page} | ${section}`);
}

function findPrevNext(slug: string): {
  prev: string | null;
  next: string | null;
} {
  const flat = flattenNav();
  const idx = flat.findIndex((entry) => entry.slug === slug);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? flat[idx - 1].slug : null,
    next: idx < flat.length - 1 ? flat[idx + 1].slug : null,
  };
}

function buildAlternates(
  slug: string,
): Partial<Record<SupportedLocale, string>> {
  const out: Partial<Record<SupportedLocale, string>> = {};
  for (const code of BASE_LOCALES) {
    if (getDocPage(code, slug)) out[code] = docUrl(code, slug);
  }
  return out;
}

export function DocsPage({ locale, slug }: DocsPageProps) {
  const { t } = useT('docs');
  const { t: tSeo } = useT('seo');
  const doc = getDocPage(locale, slug);
  const breadcrumbs = useMemo(
    () => buildBreadcrumbs(locale, slug),
    [locale, slug],
  );
  const { prev, next } = useMemo(() => findPrevNext(slug), [slug]);
  const tocEntries = useMemo(() => (doc ? extractToc(doc.body) : []), [doc]);
  const alternates = useMemo(() => buildAlternates(slug), [slug]);
  const path = docPath(locale, slug);
  const url = docUrl(locale, slug);
  const markdownUrl = docMarkdownUrl(locale, slug);
  const readingTime = useMemo(
    () => (doc ? readingTimeMinutes(doc.body) : 0),
    [doc],
  );
  // `updatedAt` isn't part of the typed `DocFrontmatter` shape yet, but pages
  // can opt-in by adding an ISO-8601 string in their YAML front matter. We
  // surface the date when present and otherwise hide that meta entry so the
  // bar stays compact.
  const updatedAtRaw = (doc?.frontmatter as { updatedAt?: unknown } | undefined)
    ?.updatedAt;
  const updatedAtIso =
    typeof updatedAtRaw === 'string' && updatedAtRaw.length > 0
      ? updatedAtRaw
      : null;
  const formattedUpdatedAt = useMemo(() => {
    if (!updatedAtIso) return null;
    const parsed = new Date(updatedAtIso);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
      parsed,
    );
  }, [locale, updatedAtIso]);
  const rawMarkdown = doc
    ? pageAsMarkdown({
        frontmatter: {
          title: doc.frontmatter.title,
          description: doc.frontmatter.description,
        },
        body: doc.body,
        siteUrl: SITE_URL,
      })
    : null;

  const jsonLd = useMemo(() => {
    if (!doc) return [];
    const nodes = [
      buildArticleJsonLd({
        headline: doc.frontmatter.title,
        description: doc.frontmatter.description,
        url,
        publisherName: 'Tale',
        inLanguage: locale,
      }),
      buildBreadcrumbListJsonLd([
        { name: 'Docs', url: docUrl(locale, 'index') },
        ...breadcrumbs.map((c) => ({
          name: c.label,
          url: c.slug ? docUrl(locale, c.slug) : url,
        })),
      ]),
    ];
    if (slug === 'index') {
      nodes.push(
        buildWebSiteJsonLd({
          name: doc.frontmatter.title,
          url,
        }),
      );
    }
    return nodes;
  }, [doc, url, breadcrumbs, locale, slug]);

  useDocumentMeta({
    title: buildMetaTitle(breadcrumbs, tSeo('siteTitle')),
    description: doc?.frontmatter.description ?? '',
    canonicalPath: path,
    locale,
    alternates,
    noindex: doc?.frontmatter.noindex,
    jsonLd,
  });

  if (!doc) {
    return null;
  }

  const contentPath = `${doc.locale}/${doc.slug}.mdx`;

  return (
    <div className="flex gap-10">
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <DocsBreadcrumbs locale={locale} crumbs={breadcrumbs} />
          </div>
          <PageActions
            pageUrl={url}
            markdownUrl={markdownUrl}
            markdown={rawMarkdown}
            className="ml-auto shrink-0"
            labels={{
              copyPage: t('pageActions.copyPage'),
              copied: t('pageActions.copied'),
              viewMarkdown: t('pageActions.viewMarkdown'),
              openIn: t('pageActions.openIn'),
              openChatGpt: t('pageActions.openChatGpt'),
              openClaude: t('pageActions.openClaude'),
              openCursor: t('pageActions.openCursor'),
            }}
          />
        </div>
        <header className="min-w-0">
          <h1
            className="text-fg-base text-3xl font-semibold tracking-tight md:text-4xl"
            style={{ letterSpacing: '-0.4px', lineHeight: 1.15 }}
          >
            {doc.frontmatter.title}
          </h1>
          {doc.frontmatter.description ? (
            <p className="text-fg-muted mt-2 text-base leading-relaxed">
              {doc.frontmatter.description}
            </p>
          ) : null}
          <p className="text-fg-subtle mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span>{t('readingTime', { minutes: readingTime })}</span>
            {formattedUpdatedAt ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{t('lastUpdated', { date: formattedUpdatedAt })}</span>
              </>
            ) : null}
          </p>
        </header>
        <RoutedMarkdown
          // oxlint-disable-next-line typescript/no-explicit-any -- custom component keys aren't HTML element tags; react-markdown's `Components` type only models built-in elements
          components={docsMarkdownComponents as any}
          className="mt-6"
        >
          {doc.body}
        </RoutedMarkdown>
        <DocsPrevNext locale={locale} prevSlug={prev} nextSlug={next} />
        <div className="mt-4 flex justify-end">
          <EditOnGithub contentPath={contentPath} />
        </div>
      </div>
      <DocsToc entries={tocEntries} />
    </div>
  );
}
