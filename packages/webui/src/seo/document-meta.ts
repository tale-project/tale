import { ALL_LOCALES, type SupportedLocale } from '@tale/ui/i18n/locales';
import { useEffect } from 'react';

interface DocumentMeta {
  title: string;
  description: string;
  /** Path on the current host, e.g. `/pricing`, `/de/legal/privacy-policy`. */
  canonicalPath?: string;
  /** Override the site title suffix. Defaults to `Tale`. */
  siteName?: string;
  /** Origin without trailing slash, e.g. `https://example.com`. */
  siteUrl: string;
  /** Optional OpenGraph image URL. */
  ogImage?: string;
  /**
   * Optional fallback OpenGraph image URL used when `ogImage` is not set.
   * Should be an absolute URL (or a path resolved against `siteUrl`) pointing
   * to a 1200×630 PNG so crawlers always have a social card to render.
   * Example: `${siteUrl}/images/og-default.png`.
   */
  defaultOgImage?: string;
  /** Set `noindex,nofollow` for legal-style pages. */
  noindex?: boolean;
  /** When provided, emit hreflang alternates per locale. */
  hreflang?: {
    locale: SupportedLocale;
    /** Map from each base locale to the absolute URL of that locale's variant. */
    alternates: Partial<Record<SupportedLocale, string>>;
  };
  /** Stringified JSON-LD blocks to inject as <script type="application/ld+json">. */
  jsonLd?: string[];
}

function setMeta(
  selector: string,
  attr: 'name' | 'property',
  key: string,
  content: string,
) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setLink(rel: string, href: string, hreflang?: string) {
  const selector = hreflang
    ? `link[rel="${rel}"][hreflang="${hreflang}"]`
    : `link[rel="${rel}"]`;
  let el = document.head.querySelector<HTMLLinkElement>(selector);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    if (hreflang) el.setAttribute('hreflang', hreflang);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function clearAlternates() {
  document.head
    .querySelectorAll('link[rel="alternate"][hreflang]')
    .forEach((el) => el.remove());
}

const JSON_LD_DATA_ATTR = 'data-tale-jsonld';

function clearJsonLd() {
  document.head
    .querySelectorAll(
      `script[type="application/ld+json"][${JSON_LD_DATA_ATTR}]`,
    )
    .forEach((el) => el.remove());
}

function appendJsonLd(blocks: readonly string[]) {
  for (const block of blocks) {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute(JSON_LD_DATA_ATTR, '1');
    script.text = block;
    document.head.appendChild(script);
  }
}

/**
 * Mutate `<head>` in an effect to mirror SSR-injected meta tags. Covers
 * <title>, description, canonical, OpenGraph + Twitter cards, hreflang
 * alternates, JSON-LD, and noindex. The SSR-rendered HTML already carries
 * placeholder versions of these tags so crawlers see them immediately;
 * this hook keeps them in sync as the user navigates client-side.
 */
export function useDocumentMeta({
  title,
  description,
  canonicalPath,
  siteName = 'Tale',
  siteUrl,
  ogImage,
  defaultOgImage,
  noindex,
  hreflang,
  jsonLd,
}: DocumentMeta) {
  useEffect(() => {
    const fullTitle = title.includes(siteName)
      ? title
      : `${title} | ${siteName}`;
    document.title = fullTitle;
    const resolvedOgImage = ogImage ?? defaultOgImage;

    setMeta('meta[name="description"]', 'name', 'description', description);
    setMeta('meta[property="og:title"]', 'property', 'og:title', fullTitle);
    setMeta(
      'meta[property="og:description"]',
      'property',
      'og:description',
      description,
    );
    setMeta(
      'meta[property="og:site_name"]',
      'property',
      'og:site_name',
      siteName,
    );
    setMeta('meta[property="og:type"]', 'property', 'og:type', 'website');
    setMeta(
      'meta[name="twitter:card"]',
      'name',
      'twitter:card',
      resolvedOgImage ? 'summary_large_image' : 'summary',
    );
    setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', fullTitle);
    setMeta(
      'meta[name="twitter:description"]',
      'name',
      'twitter:description',
      description,
    );
    if (resolvedOgImage) {
      setMeta(
        'meta[property="og:image"]',
        'property',
        'og:image',
        resolvedOgImage,
      );
      setMeta(
        'meta[name="twitter:image"]',
        'name',
        'twitter:image',
        resolvedOgImage,
      );
    }

    if (noindex) {
      setMeta('meta[name="robots"]', 'name', 'robots', 'noindex,nofollow');
    } else {
      setMeta('meta[name="robots"]', 'name', 'robots', 'index,follow');
    }

    if (canonicalPath !== undefined) {
      // Strip a trailing slash unless the path is exactly `/` so canonical
      // and og:url are stable (e.g. `/pricing/` → `/pricing`).
      const normalizedPath =
        canonicalPath !== '/' && canonicalPath.endsWith('/')
          ? canonicalPath.slice(0, -1)
          : canonicalPath;
      const canonical = `${siteUrl}${normalizedPath}`;
      setLink('canonical', canonical);
      setMeta('meta[property="og:url"]', 'property', 'og:url', canonical);
    } else {
      document.head.querySelector('link[rel="canonical"]')?.remove();
      document.head.querySelector('meta[property="og:url"]')?.remove();
    }

    clearAlternates();
    if (hreflang) {
      for (const locale of ALL_LOCALES) {
        const alt =
          hreflang.alternates[locale as SupportedLocale] ??
          hreflang.alternates[locale.split('-')[0] as SupportedLocale];
        if (alt) setLink('alternate', alt, locale);
      }
      const enUrl = hreflang.alternates.en;
      if (enUrl) setLink('alternate', enUrl, 'x-default');
    }

    clearJsonLd();
    if (jsonLd && jsonLd.length > 0) appendJsonLd(jsonLd);
  }, [
    title,
    description,
    canonicalPath,
    siteName,
    siteUrl,
    ogImage,
    defaultOgImage,
    noindex,
    hreflang,
    jsonLd,
  ]);
}
