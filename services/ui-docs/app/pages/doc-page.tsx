import {
  HEADER_CRUMB_LINK_CLASS,
  type HeaderBreadcrumbCrumb,
} from '@tale/ui/header-breadcrumbs';
import { markdownComponents } from '@tale/ui/markdown/components/registry';
import { extractToc } from '@tale/ui/markdown/extract-toc';
import { readingTimeMinutes } from '@tale/ui/markdown/reading-time';
import { RoutedMarkdown } from '@tale/ui/markdown/routed-markdown';
import {
  buildArticleJsonLd,
  buildBreadcrumbListJsonLd,
} from '@tale/ui/seo/builders/json-ld';
import { pageAsMarkdown } from '@tale/ui/seo/builders/page-as-markdown';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import { Demo } from '@/app/components/demo/demo';
import { expandDemoTags } from '@/app/components/demo/expand-demo-tags';
import { DocsPrevNext } from '@/app/components/docs/docs-prev-next';
import { DocsShell } from '@/app/components/docs/docs-shell';
import { EditOnGithub } from '@/app/components/docs/edit-on-github';
import { PageActions } from '@/app/features/page-actions/page-actions';
import { getDocPage } from '@/lib/content/loader';
import { firstNavSlug, flattenNav, navGroupTrail } from '@/lib/content/nav';
import {
  contentFilePath,
  docMarkdownUrl,
  docPath,
  docUrl,
  SITE_URL,
} from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

import { NotFoundPage } from './not-found-page';

interface DocPageProps {
  /** Slug relative to `/docs`, e.g. `components/button`. */
  slug: string;
}

// The shared registry plus the one tag this site adds: `<Demo name="…" />`.
// `rehype-raw` lowercases authored tag names, so the key is `demo`; the
// PascalCase alias keeps direct JSX usage working too.
const uiDocsMarkdownComponents = {
  ...markdownComponents,
  demo: Demo,
  Demo,
};

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

/**
 * One documentation page: the chrome from `DocsShell`, the body through the
 * shared markdown pipeline, and the SEO head this route is responsible for.
 */
export function DocPage({ slug }: DocPageProps) {
  const { t } = useT('docs');
  const { t: tNav } = useT('nav');
  const { t: tSeo } = useT('seo');
  const doc = getDocPage(slug);

  const groupLabels = useMemo(
    () => navGroupTrail(slug).map((key) => tNav(key.slice('nav.'.length))),
    [slug, tNav],
  );
  // The trail starts at the documentation's front door (a link), then the
  // section — a plain label, since a section has no page of its own.
  const crumbs = useMemo<HeaderBreadcrumbCrumb[]>(
    () => [
      {
        key: 'docs',
        content: (
          <Link
            to={docPath(firstNavSlug())}
            className={HEADER_CRUMB_LINK_CLASS}
          >
            {t('home')}
          </Link>
        ),
      },
      ...groupLabels.map((label) => ({ key: label, content: label })),
    ],
    [groupLabels, t],
  );
  const toc = useMemo(() => (doc ? extractToc(doc.body) : []), [doc]);
  const { prev, next } = useMemo(() => findPrevNext(slug), [slug]);
  const readingTime = useMemo(
    () => (doc ? readingTimeMinutes(doc.body) : 0),
    [doc],
  );
  // The rendered body: `<Demo … />` expanded to a pair so the HTML parser
  // does not swallow the rest of the page into the first example.
  const renderedBody = useMemo(
    () => (doc ? expandDemoTags(doc.body) : ''),
    [doc],
  );

  const title = doc?.frontmatter.title ?? '';
  const path = docPath(slug);
  const url = docUrl(slug);
  const markdownUrl = docMarkdownUrl(slug);

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
        inLanguage: 'en',
      }),
      buildBreadcrumbListJsonLd([
        { name: tSeo('siteTitle'), url: SITE_URL },
        ...groupLabels.map((label) => ({ name: label, url })),
        { name: doc.frontmatter.title, url },
      ]),
    ];
  }, [doc, groupLabels, tSeo, url]);

  useDocumentMeta({
    title: title ? `${title} | ${tSeo('siteTitle')}` : tSeo('siteTitle'),
    description: doc?.frontmatter.description ?? '',
    canonicalPath: path,
    noindex: doc?.frontmatter.noindex,
    jsonLd,
  });

  if (!doc) return <NotFoundPage />;

  return (
    <DocsShell activeSlug={slug} crumbs={crumbs} title={title} toc={toc}>
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          {doc.frontmatter.description ? (
            <p className="text-muted-foreground text-base leading-relaxed">
              {doc.frontmatter.description}
            </p>
          ) : null}
          <p className="text-muted-foreground mt-2 text-xs">
            {t('readingTime', { minutes: readingTime })}
          </p>
        </div>
        <PageActions
          pageUrl={url}
          markdownUrl={markdownUrl}
          markdown={rawMarkdown}
          className="shrink-0"
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
      <RoutedMarkdown
        // oxlint-disable-next-line typescript/no-explicit-any -- custom component keys aren't HTML element tags; react-markdown's `Components` type only models built-in elements
        components={uiDocsMarkdownComponents as any}
      >
        {renderedBody}
      </RoutedMarkdown>
      <DocsPrevNext prevSlug={prev} nextSlug={next} />
      <div className="mt-6 flex justify-end">
        <EditOnGithub contentPath={contentFilePath(slug)} />
      </div>
    </DocsShell>
  );
}
