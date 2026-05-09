import { Button } from '@tale/ui/button';
import { Download } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Children, isValidElement } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { getLegalDocument } from '@/lib/legal/content';
import type { LegalSlug } from '@/lib/legal/slugs';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

interface LegalPageProps {
  slug: LegalSlug;
}

function legalPath(locale: string, slug: LegalSlug): string {
  const base = locale === 'en' ? '' : `/${locale}`;
  return `${base}/legal/${slug}`;
}

function pdfHref(locale: string, slug: LegalSlug): string {
  return `${legalPath(locale, slug)}.pdf`;
}

interface ChildrenContainer {
  children?: ReactNode;
}

/** Concatenate the visible text inside a React node tree. */
function nodeText(node: ReactNode): string {
  let out = '';
  Children.forEach(node, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      out += String(child);
    } else if (isValidElement<ChildrenContainer>(child)) {
      out += nodeText(child.props.children);
    }
  });
  return out;
}

/** GitHub-style heading slug: lower-case, alphanumerics + hyphens. */
function slugifyHeading(node: ReactNode): string {
  return nodeText(node)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

interface AnchoredHeadingProps {
  level: 'h2' | 'h3' | 'h4';
  className: string;
  children?: ReactNode;
}

function AnchoredHeading({ level, className, children }: AnchoredHeadingProps) {
  const id = slugifyHeading(children);
  const Tag = level;
  return (
    <Tag id={id} className={`group scroll-mt-24 ${className}`}>
      <a
        href={`#${id}`}
        aria-label="Link to this section"
        className="text-fg-base no-underline"
      >
        {children}
        <span
          aria-hidden
          className="text-fg-muted ml-2 inline-block opacity-0 transition-opacity group-hover:opacity-100 print:hidden"
        >
          #
        </span>
      </a>
    </Tag>
  );
}

const markdownComponents: Components = {
  h1: ({ children }: { children?: ReactNode }) => (
    <AnchoredHeading
      level="h2"
      className="text-fg-base mt-12 mb-4 text-2xl font-semibold first:mt-0"
    >
      {children}
    </AnchoredHeading>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <AnchoredHeading
      level="h2"
      className="text-fg-base mt-10 mb-3 text-xl font-semibold"
    >
      {children}
    </AnchoredHeading>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <AnchoredHeading
      level="h3"
      className="text-fg-base mt-6 mb-2 text-lg font-semibold"
    >
      {children}
    </AnchoredHeading>
  ),
  h4: ({ children }: { children?: ReactNode }) => (
    <AnchoredHeading
      level="h4"
      className="text-fg-base mt-4 mb-2 text-base font-semibold"
    >
      {children}
    </AnchoredHeading>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="text-fg-muted my-4 leading-relaxed">{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="text-fg-muted my-4 list-disc space-y-1.5 pl-6">
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="text-fg-muted my-4 list-decimal space-y-1.5 pl-6">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  a: ({ href, children }: ComponentPropsWithoutRef<'a'>) => (
    <a
      href={href}
      target={href?.startsWith('http') ? '_blank' : undefined}
      rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
      className="text-fg-base underline underline-offset-4 hover:no-underline"
    >
      {children}
    </a>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="text-fg-base font-semibold">{children}</strong>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="border-accent-base bg-bg-elevated/40 text-fg-base [&_p]:text-fg-base my-6 border-l-4 px-5 py-2">
      {children}
    </blockquote>
  ),
  code: ({ children, className }: ComponentPropsWithoutRef<'code'>) => {
    const isBlock =
      typeof className === 'string' && className.includes('language-');
    if (isBlock) {
      return <code className={`${className} text-sm`}>{children}</code>;
    }
    return (
      <code className="bg-bg-elevated text-fg-base rounded px-1.5 py-0.5 font-mono text-[0.875em]">
        {children}
      </code>
    );
  },
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="bg-bg-elevated my-6 overflow-x-auto rounded-md p-4">
      {children}
    </pre>
  ),
  hr: () => <hr className="border-border-base my-10" />,
  table: ({ children }: { children?: ReactNode }) => (
    <div className="my-6 overflow-x-auto">
      <table className="border-border-base w-full border-collapse border text-sm">
        {children}
      </table>
    </div>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="border-border-base bg-bg-elevated text-fg-base border px-3 py-2 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="border-border-base text-fg-muted border px-3 py-2 align-top">
      {children}
    </td>
  ),
};

export function LegalPage({ slug }: LegalPageProps) {
  const { t } = useT('legal');
  const locale = useCurrentLocale();
  const doc = getLegalDocument(locale, slug);

  const title = doc?.frontmatter.title ?? '';
  const description = doc?.frontmatter.description ?? '';

  useDocumentMeta({
    title,
    description,
    canonicalPath: legalPath(locale, slug),
    // Legal docs declare `noindex: true` in YAML frontmatter; pre-fix
    // this was parsed but never forwarded to the meta hook, so all
    // legal pages shipped indexable. Round-2 review CRITICAL #26.
    noindex: doc?.frontmatter.noindex,
  });

  if (!doc) {
    return (
      <section className="py-20">
        <SiteContainer>
          <p className="text-fg-muted">{t('notFound')}</p>
        </SiteContainer>
      </section>
    );
  }

  return (
    <article className="py-16">
      <SiteContainer>
        <div className="mx-auto max-w-[760px]">
          <header className="border-border-base flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-2">
              <h1
                className="text-fg-base text-3xl font-semibold md:text-4xl"
                style={{ letterSpacing: '-0.8px', lineHeight: 1.15 }}
              >
                {title}
              </h1>
              {description ? (
                <p className="text-fg-muted text-base">{description}</p>
              ) : null}
            </div>
            <Button asChild variant="secondary" className="shrink-0">
              <a
                href={pdfHref(locale, slug)}
                download
                aria-label={t('downloadPdfAria', { title })}
                className="gap-2 print:hidden"
              >
                <Download className="h-4 w-4" aria-hidden />
                {t('downloadPdf')}
              </a>
            </Button>
          </header>
          <div className="mt-8 text-base">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {doc.content}
            </ReactMarkdown>
          </div>
        </div>
      </SiteContainer>
    </article>
  );
}
