import { DocsArticle } from '@tale/ui/docs/docs-article';
import { DocsHeader } from '@tale/ui/docs/docs-header';
import type { DocsCrumb } from '@tale/ui/docs/docs-nav';
import { PageActions } from '@tale/ui/docs/page-actions';
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

import { DocsImage } from '@/app/components/docs/docs-image';
import { DocsVideo } from '@/app/components/docs/docs-video';
import { docEditUrl } from '@/lib/content/edit-url';
import { getDocPage } from '@/lib/content/loader';
import { navGroupTrail } from '@/lib/content/nav';
import { navNeighbours } from '@/lib/content/nav-sections';
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

/** A page's ancestors and the page itself, below the docs home crumb. */
function buildBreadcrumbs(
  locale: SupportedLocale,
  slug: string,
  translateGroup: (key: string) => string,
): { label: string; slug?: string }[] {
  if (slug === 'index') return [];
  const parts = slug.split('/').filter((p) => p !== 'index');
  const groups = navGroupTrail(slug);
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
      label:
        sectionDoc?.frontmatter.title ??
        (groups[i] ? translateGroup(groups[i]) : humaniseSegment(part)),
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
  const { t: tNav } = useT('nav');
  const doc = getDocPage(locale, slug);
  const breadcrumbs = useMemo(
    () =>
      buildBreadcrumbs(locale, slug, (key) => tNav(key.slice('nav.'.length))),
    [locale, slug, tNav],
  );
  // The docs root is always the first crumb, so a locale landing page (which
  // contributes no crumbs of its own) still renders a trail — with "Home" as
  // its own leaf rather than a separator pointing at nothing.
  const trail = useMemo<DocsCrumb[]>(
    () => [
      { label: t('home'), href: docPath(locale, 'index') },
      ...breadcrumbs.map((crumb) => ({
        label: crumb.label,
        href: crumb.slug ? docPath(locale, crumb.slug) : undefined,
      })),
    ],
    [breadcrumbs, locale, t],
  );
  const { prev, next } = useMemo(
    () => navNeighbours(locale, slug),
    [locale, slug],
  );
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

  return (
    <>
      <DocsHeader
        crumbs={trail}
        actions={
          <PageActions markdownUrl={markdownUrl} markdown={rawMarkdown} />
        }
      />
      <DocsArticle
        title={doc.frontmatter.title}
        description={doc.frontmatter.description}
        readingTimeMinutes={readingTime}
        updatedAt={formattedUpdatedAt}
        toc={tocEntries}
        prev={prev}
        next={next}
        editHref={docEditUrl(`${doc.locale}/${doc.slug}`)}
      >
        <RoutedMarkdown
          // oxlint-disable-next-line typescript/no-explicit-any -- custom component keys aren't HTML element tags; react-markdown's `Components` type only models built-in elements
          components={docsMarkdownComponents as any}
        >
          {doc.body}
        </RoutedMarkdown>
      </DocsArticle>
    </>
  );
}
