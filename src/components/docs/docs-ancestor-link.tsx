import { createLink } from '@tanstack/react-router';
import type { ComponentProps } from 'react';

/** Home and breadcrumb ancestors can lead to the first guide too. Only
 * the guide's rail row and breadcrumb leaf identify the current page. */
function AncestorAnchor({ children, ...props }: ComponentProps<'a'>) {
  return (
    <a {...props} aria-current={undefined}>
      {children}
    </a>
  );
}

export const DocsAncestorLink = createLink(AncestorAnchor);
