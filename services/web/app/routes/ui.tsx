import { createFileRoute, redirect } from '@tanstack/react-router';

import { EXTERNAL_LINKS } from '@/lib/external-links';

export const Route = createFileRoute('/ui')({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: `${EXTERNAL_LINKS.uiDocs}${location.searchStr}`,
      statusCode: 301,
    });
  },
});
