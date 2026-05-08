import { PageActions } from '@tale/webui/ai/page-actions';
import { pageAsMarkdown } from '@tale/webui/llm/page-as-markdown';
import { mintlifyComponents } from '@tale/webui/markdown/components/registry';
import { extractToc } from '@tale/webui/markdown/extract-toc';
import { Markdown } from '@tale/webui/markdown/markdown';
import { readingTimeMinutes } from '@tale/webui/markdown/reading-time';
import { useDocumentMeta } from '@tale/webui/seo/document-meta';
import {
  buildArticleJsonLd,
  buildBreadcrumbListJsonLd,
} from '@tale/webui/seo/json-ld';
import { useMemo } from 'react';

import { DocsBreadcrumbs } from '@/app/components/docs/docs-breadcrumbs';
import { DocsPrevNext } from '@/app/components/docs/docs-prev-next';
import { DocsToc } from '@/app/components/docs/docs-toc';
import { EditOnGithub } from '@/app/components/docs/edit-on-github';
import { getDocPage } from '@/lib/content/loader';
import { flattenNav } from '@/lib/content/nav';
import { docMarkdownUrl, docPath, docUrl, SITE_URL } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import { BASE_LOCALES, type SupportedLocale } from '@/lib/i18n/locales';

interface DocsPageProps {
  locale: SupportedLocale;
  slug: string;
}

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
    return [
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
  }, [doc, url, breadcrumbs, locale]);

  useDocumentMeta({
    title: doc?.frontmatter.title ?? 'Tale documentation',
    description: doc?.frontmatter.description ?? '',
    canonicalPath: path,
    siteUrl: SITE_URL,
    noindex: doc?.frontmatter.noindex,
    hreflang: { locale, alternates },
    jsonLd,
  });

  if (!doc) {
    return (
      <div className="py-16">
        <h1 className="text-fg-base text-2xl font-semibold">Page not found</h1>
        <p className="text-fg-muted mt-3">
          We couldn't find the page you were looking for.
        </p>
      </div>
    );
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
        <Markdown
          // oxlint-disable-next-line typescript/no-explicit-any -- mintlify keys aren't HTML element tags; react-markdown's `Components` type only models built-in elements
          components={mintlifyComponents as any}
          className="mt-6"
        >
          {doc.body}
        </Markdown>
        <DocsPrevNext locale={locale} prevSlug={prev} nextSlug={next} />
        <div className="mt-4 flex justify-end">
          <EditOnGithub contentPath={contentPath} />
        </div>
      </div>
      <DocsToc entries={tocEntries} />
    </div>
  );
}
