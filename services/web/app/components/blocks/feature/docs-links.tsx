import {
  type DocsLinkItem,
  DocsLinks as DocsLinksPanel,
} from '@tale/marketing-ui/docs-links';

import { useT } from '@/lib/i18n/client';

export type { DocsLinkItem };

interface DocsLinksProps {
  heading?: string;
  links: readonly DocsLinkItem[];
}

/** Deep-links into docs, headed "Read the docs" unless a page overrides it. */
export function DocsLinks({ heading, links }: DocsLinksProps) {
  const { t } = useT('featureShared');
  return <DocsLinksPanel heading={heading ?? t('docsHeading')} links={links} />;
}
