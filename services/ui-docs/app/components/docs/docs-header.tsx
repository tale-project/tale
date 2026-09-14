import { Button } from '@tale/ui/button';
import {
  HeaderBreadcrumbs,
  type HeaderBreadcrumbCrumb,
} from '@tale/ui/header-breadcrumbs';
import { GithubIcon } from '@tale/ui/icons/github';
import { ThemeSwitcher } from '@tale/ui/theme-switcher';

import { DocsSearchTrigger } from '@/app/components/docs/docs-search-trigger';
import { useT } from '@/lib/i18n/client';
import { TALE_REPO_URL } from '@/lib/site-url';

interface DocsHeaderProps {
  /** Ancestor trail — the section this page sits in. */
  crumbs: readonly HeaderBreadcrumbCrumb[];
  /** The page title; rendered as the page's only `h1`. */
  title: string;
  /** Open the search palette. */
  onOpenSearch: () => void;
}

/**
 * The article's header strip — the app's `h-13` title row, one border line
 * across the viewport with the rail's logo row. Left: the breadcrumb trail
 * whose leaf is the page's `h1`. Right: the search trigger, the theme
 * switcher and a link to the repository.
 *
 * Rendered at every width: below `md` it sits under the phone bar
 * (`DocsMobileNav`), which owns the menu and the search there, so the strip
 * keeps only the title and the theme switcher — the page's `h1` must never be
 * `display:none` on a phone. A `div`, not a second `<header>`: the phone bar
 * is the banner, and the trail's `nav` carries the semantics here.
 */
export function DocsHeader({ crumbs, title, onOpenSearch }: DocsHeaderProps) {
  const { t } = useT('nav');
  const { t: tDocs } = useT('docs');

  return (
    <div className="border-border bg-background flex h-13 shrink-0 items-center gap-3 border-b px-4 md:sticky md:top-0 md:z-30">
      <HeaderBreadcrumbs
        ariaLabel={tDocs('breadcrumbs')}
        crumbs={crumbs}
        leaf={title}
        className="min-w-0 flex-1"
      />
      <DocsSearchTrigger
        onClick={onOpenSearch}
        className="hidden w-56 lg:flex"
      />
      <ThemeSwitcher />
      {/* A plain `Button asChild` rather than `IconButton asChild`: the
          IconButton slot path clones the anchor and injects the icon, which
          leaves an empty `<a>` at the call site for jsx-a11y to flag. The
          label sits on the anchor as well as the button so the merged element
          keeps its accessible name. */}
      <Button
        asChild
        variant="ghost"
        size="icon"
        aria-label={t('github')}
        className="focus-visible:ring-border-strong hidden md:inline-flex"
      >
        <a
          href={TALE_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('github')}
        >
          <GithubIcon className="text-muted-foreground size-4" aria-hidden />
        </a>
      </Button>
    </div>
  );
}
