import { i18n } from '@/lib/i18n/i18n';

/**
 * The text of a browser tab: the page's name, then the app's, joined with a
 * hyphen as the platform's `documentTitle` (`services/platform/lib/utils/seo.ts`)
 * does. A page with no name of its own is titled by the app alone. The open
 * session names its tab through `useDocumentTitle` with this, so every title
 * reads the same.
 */
export function documentTitle(pageName?: string): string {
  const app = i18n.t('common:appName');
  return pageName ? `${pageName} - ${app}` : app;
}

/** What a route puts in the head of the document: its page's title. */
export function pageHead(pageName?: string) {
  return { meta: [{ title: documentTitle(pageName) }] };
}
