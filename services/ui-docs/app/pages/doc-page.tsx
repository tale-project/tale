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
} from '@tale/ui/seo/builders/json-ld';
import { pageAsMarkdown } from '@tale/ui/seo/builders/page-as-markdown';
import { useMemo } from 'react';

import { Demo } from '@/app/components/demo/demo';
import { expandDemoTags } from '@/app/components/demo/expand-demo-tags';
import { UiDocsLayout } from '@/app/components/docs/ui-docs-layout';
import { docEditUrl } from '@/lib/content/edit-url';
import { getDocPage } from '@/lib/content/loader';
import { firstNavSlug, navGroupTrail } from '@/lib/content/nav';
import { navNeighbours } from '@/lib/content/nav-sections';
import { docMarkdownUrl, docPath, docUrl, SITE_URL } from '@/lib/content/paths';
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

/**
 * One documentation page inside the shared docs frame: the header strip with
 * the trail and the page actions, then the article — its title, the body
 * through the shared markdown pipeline, the neighbours — and the SEO head this
 * route is responsible for.
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
  // section — a plain label, since a section has no page of its own — and
  // ends at the page itself.
  const title = doc?.frontmatter.title ?? '';
  const crumbs = useMemo<DocsCrumb[]>(
    () => [
      { label: t('home'), href: docPath(firstNavSlug()) },
      ...groupLabels.map((label) => ({ label })),
      { label: title },
    ],
    [groupLabels, t, title],
  );
  const toc = useMemo(() => (doc ? extractToc(doc.body) : []), [doc]);
  const { prev, next } = useMemo(() => navNeighbours(slug), [slug]);
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
    <UiDocsLayout activeHref={path}>
      <DocsHeader
        crumbs={crumbs}
        actions={
          <PageActions markdownUrl={markdownUrl} markdown={rawMarkdown} />
        }
      />
      <DocsArticle
        title={title}
        description={doc.frontmatter.description}
        readingTimeMinutes={readingTime}
        toc={toc}
        prev={prev}
        next={next}
        editHref={docEditUrl(slug)}
      >
        <RoutedMarkdown
          // oxlint-disable-next-line typescript/no-explicit-any -- custom component keys aren't HTML element tags; react-markdown's `Components` type only models built-in elements
          components={uiDocsMarkdownComponents as any}
        >
          {renderedBody}
        </RoutedMarkdown>
      </DocsArticle>
    </UiDocsLayout>
  );
}
