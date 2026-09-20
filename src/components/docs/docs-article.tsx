import { Heading } from '@tale/ui/heading';
import { useT } from '@tale/ui/i18n/client';
import type { TocEntry } from '@tale/ui/markdown/extract-toc';
import { Text } from '@tale/ui/text';
import type { ReactNode } from 'react';

import type { DocsNavPage } from './docs-nav';
import { DocsPrevNext } from './docs-prev-next';
import { DocsToc, DocsTocOutline } from './docs-toc';
import { EditOnGithub } from './edit-on-github';

export interface DocsArticleProps {
  /** The page title — the page's only `h1`. */
  title: string;
  description?: string;
  /** Estimated reading time in whole minutes. */
  readingTimeMinutes: number;
  /** The last-updated date, already formatted for the reader's locale. */
  updatedAt?: string | null;
  /** The page outline, for the rail and the narrow-viewport disclosure. */
  toc: readonly TocEntry[];
  prev?: DocsNavPage | null;
  next?: DocsNavPage | null;
  /** GitHub editor URL of the page's source; omit to hide the link. */
  editHref?: string;
  /** The rendered page body. */
  children: ReactNode;
}

/**
 * One documentation page below its header strip: the article column — title,
 * description and reading metadata, then the body, the neighbour cards and
 * the edit link — beside the "On this page" rail. Below `xl` the outline
 * folds into a disclosure above the title instead.
 */
export function DocsArticle({
  title,
  description,
  readingTimeMinutes,
  updatedAt,
  toc,
  prev,
  next,
  editHref,
  children,
}: DocsArticleProps) {
  const { t } = useT('docs');

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 justify-between gap-8 px-4 py-8 lg:px-6 xl:gap-10">
      <article className="w-full max-w-3xl min-w-0 flex-1">
        <DocsTocOutline entries={toc} />
        <header className="min-w-0 [overflow-wrap:anywhere]">
          <Heading level={1} tracking="tight" className="text-3xl md:text-4xl">
            {title}
          </Heading>
          {description ? (
            <Text variant="muted" className="mt-3 text-base leading-relaxed">
              {description}
            </Text>
          ) : null}
          <Text
            variant="caption"
            className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1"
          >
            <span>{t('readingTime', { minutes: readingTimeMinutes })}</span>
            {updatedAt ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{t('lastUpdated', { date: updatedAt })}</span>
              </>
            ) : null}
          </Text>
        </header>
        <div className="mt-8">{children}</div>
        <DocsPrevNext prev={prev} next={next} />
        {editHref ? (
          <div className="mt-4 flex justify-end print:hidden">
            <EditOnGithub href={editHref} />
          </div>
        ) : null}
      </article>
      <DocsToc entries={toc} />
    </div>
  );
}
