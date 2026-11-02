import { createLink } from '@tanstack/react-router';
import type { ComponentProps } from 'react';

/** A navigation's link to one of its pages, the current page only when the
 * navigation says so (`current`). The router marks a link active from its
 * location, which names the next page as soon as a navigation starts, while
 * the last page still shows; a navigation that follows the page it shows
 * (`useShownPathname`) passes that instead. */
function CurrentPageAnchor({
  current = false,
  children,
  ...props
}: ComponentProps<'a'> & { current?: boolean }) {
  return (
    <a
      {...props}
      aria-current={current ? 'page' : undefined}
      data-status={undefined}
    >
      {children}
    </a>
  );
}

export const CurrentPageLink = createLink(CurrentPageAnchor);
