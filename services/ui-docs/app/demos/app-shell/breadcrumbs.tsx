import {
  HEADER_CRUMB_LINK_CLASS,
  HeaderBreadcrumbs,
} from '@tale/ui/header-breadcrumbs';

/**
 * The trail renders the page's `h1` as its leaf, so — like every chrome demo
 * on this site — it is framed as one labelled illustration rather than a
 * second heading inside the article.
 */
export default function AppShellBreadcrumbs() {
  return (
    <div
      role="img"
      aria-label="A breadcrumb trail: Projects, then Northwind, then the current page Invoices."
      className="border-border bg-background w-full rounded-lg border px-4 py-3"
    >
      <div aria-hidden="true" inert>
        <HeaderBreadcrumbs
          ariaLabel="Breadcrumb"
          crumbs={[
            {
              key: 'projects',
              content: (
                <span className={HEADER_CRUMB_LINK_CLASS}>Projects</span>
              ),
            },
            {
              key: 'northwind',
              content: (
                <span className={HEADER_CRUMB_LINK_CLASS}>Northwind</span>
              ),
            },
          ]}
          leaf="Invoices"
        />
      </div>
    </div>
  );
}
