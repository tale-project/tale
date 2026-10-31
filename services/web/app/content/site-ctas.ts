/**
 * Canonical marketing CTA destinations. Header, footer, hero, feature pages,
 * and pricing all read from here so a path change lands once.
 */

import { getStartedUrl } from '@/lib/docs-url';
import type { SupportedLocale } from '@/lib/i18n/locales';
import type { LocalizedRoutePath } from '@/lib/seo/route-paths';

const ABOUT_PATH = '/about' satisfies LocalizedRoutePath;
export const CONTACT_PATH = '/contact' satisfies LocalizedRoutePath;
export const REQUEST_DEMO_PATH = '/request-demo' satisfies LocalizedRoutePath;

/** i18n keys under `nav.*` for chrome CTAs. */
type NavCtaLabelKey = 'getStarted' | 'requestDemo' | 'contactUs' | 'aboutUs';

interface SiteCtaInternal {
  kind: 'internal';
  id: string;
  path: LocalizedRoutePath;
  labelKey: NavCtaLabelKey;
}

interface SiteCtaExternal {
  kind: 'external';
  id: string;
  /** The destination in the page's language; not a LocalizedRoutePath. */
  href: (locale: SupportedLocale) => string;
  labelKey: NavCtaLabelKey;
}

type SiteCta = SiteCtaInternal | SiteCtaExternal;

/** Header primary button (Get started → docs). */
export const HEADER_PRIMARY_CTA = {
  kind: 'external',
  id: 'getStarted',
  href: getStartedUrl,
  labelKey: 'getStarted',
} as const satisfies SiteCtaExternal;

/** Header trailing actions in render order (desktop + mobile drawer). */
export const HEADER_CTAS: readonly SiteCta[] = [HEADER_PRIMARY_CTA];

/** Footer Company column. */
export const FOOTER_COMPANY_CTAS: readonly SiteCtaInternal[] = [
  {
    kind: 'internal',
    id: 'about',
    path: ABOUT_PATH,
    labelKey: 'aboutUs',
  },
  {
    kind: 'internal',
    id: 'contact',
    path: CONTACT_PATH,
    labelKey: 'contactUs',
  },
  {
    kind: 'internal',
    id: 'requestDemo',
    path: REQUEST_DEMO_PATH,
    labelKey: 'requestDemo',
  },
];
