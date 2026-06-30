/**
 * Framework-agnostic `<head>` model shared by the runtime hook and the
 * build-time prerenderer. One function — {@link resolveDocumentHead} —
 * turns a page's declared meta into an ordered list of {@link HeadTag}
 * descriptors. Two emitters consume that list:
 *
 *   - {@link applyHeadToDocument} mutates `document.head` (client, in an
 *     effect) — what the live SPA does as the user navigates.
 *   - {@link renderHeadToHtml} serialises the same descriptors to an HTML
 *     string the prerenderer injects into each route's `index.html`.
 *
 * Because both emitters consume the *same* resolved descriptors, the
 * prerendered `<head>` is — by construction — byte-for-byte the head the
 * live page would render. There is no second source of truth to drift.
 */

import { ALL_LOCALES, type SupportedLocale } from '@tale/ui/i18n/locales';

export interface DocumentHeadInput {
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
  /** Fallback OpenGraph image used when `ogImage` is unset. */
  defaultOgImage?: string;
  /** Set `noindex,nofollow` for legal-style pages. */
  noindex?: boolean;
  /** When provided, emit hreflang alternates per locale. */
  hreflang?: {
    locale: SupportedLocale;
    alternates: Partial<Record<SupportedLocale, string>>;
  };
  /** Stringified JSON-LD blocks to inject as <script type="application/ld+json">. */
  jsonLd?: string[];
}

export type HeadTag =
  | { tag: 'title'; text: string }
  | { tag: 'meta'; attr: 'name' | 'property'; key: string; content: string }
  | { tag: 'link'; rel: string; href: string; hreflang?: string }
  | { tag: 'script'; jsonLd: string };

/**
 * Resolve a page's declared meta into the ordered tag list. Pure — no DOM,
 * no React — so it runs identically on the server and the client.
 */
export function resolveDocumentHead(meta: DocumentHeadInput): HeadTag[] {
  const {
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
  } = meta;

  const fullTitle = title.includes(siteName) ? title : `${title} | ${siteName}`;
  const resolvedOgImage = ogImage ?? defaultOgImage;
  const tags: HeadTag[] = [];

  tags.push({ tag: 'title', text: fullTitle });
  const m = (attr: 'name' | 'property', key: string, content: string) =>
    tags.push({ tag: 'meta', attr, key, content });

  m('name', 'description', description);
  m('property', 'og:title', fullTitle);
  m('property', 'og:description', description);
  m('property', 'og:site_name', siteName);
  m('property', 'og:type', 'website');
  m(
    'name',
    'twitter:card',
    resolvedOgImage ? 'summary_large_image' : 'summary',
  );
  m('name', 'twitter:title', fullTitle);
  m('name', 'twitter:description', description);
  if (resolvedOgImage) {
    m('property', 'og:image', resolvedOgImage);
    m('name', 'twitter:image', resolvedOgImage);
  }
  m('name', 'robots', noindex ? 'noindex,nofollow' : 'index,follow');

  if (canonicalPath !== undefined) {
    // Strip a trailing slash unless the path is exactly `/`, so canonical and
    // og:url are stable (e.g. `/pricing/` → `/pricing`).
    const normalizedPath =
      canonicalPath !== '/' && canonicalPath.endsWith('/')
        ? canonicalPath.slice(0, -1)
        : canonicalPath;
    const canonical = `${siteUrl}${normalizedPath}`;
    tags.push({ tag: 'link', rel: 'canonical', href: canonical });
    m('property', 'og:url', canonical);
  }

  if (hreflang) {
    for (const locale of ALL_LOCALES) {
      const alt =
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- ALL_LOCALES iteration; lookups fall back to base
        hreflang.alternates[locale as SupportedLocale] ??
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- base-locale fallback may be undefined
        hreflang.alternates[locale.split('-')[0] as SupportedLocale];
      if (alt) {
        tags.push({
          tag: 'link',
          rel: 'alternate',
          href: alt,
          hreflang: locale,
        });
      }
    }
    const enUrl = hreflang.alternates.en;
    if (enUrl) {
      tags.push({
        tag: 'link',
        rel: 'alternate',
        href: enUrl,
        hreflang: 'x-default',
      });
    }
  }

  if (jsonLd) {
    for (const block of jsonLd) tags.push({ tag: 'script', jsonLd: block });
  }

  return tags;
}

// ---------------------------------------------------------------------------
// Server emitter — serialise to HTML
// ---------------------------------------------------------------------------

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escape a JSON-LD block for safe embedding inside a `<script>` element.
 * Only `<` and `&` can prematurely close the script or be misparsed; both
 * stay valid JSON when escaped as `\uXXXX`.
 */
function escapeJsonLd(value: string): string {
  return value.replace(/</g, '\\u003c').replace(/&/g, '\\u0026');
}

/** Marks JSON-LD scripts the client hook owns, so it can dedupe on re-render. */
const JSON_LD_DATA_ATTR = 'data-tale-jsonld';

/** Serialise resolved tags to an HTML string for the prerenderer. */
export function renderHeadToHtml(tags: readonly HeadTag[]): string {
  return tags
    .map((t) => {
      let html: string;
      switch (t.tag) {
        case 'title':
          html = `<title>${escapeText(t.text)}</title>`;
          break;
        case 'meta':
          html = `<meta ${t.attr}="${t.key}" content="${escapeAttr(t.content)}" />`;
          break;
        case 'link':
          html = `<link rel="${t.rel}"${
            t.hreflang ? ` hreflang="${escapeAttr(t.hreflang)}"` : ''
          } href="${escapeAttr(t.href)}" />`;
          break;
        case 'script':
          html = `<script type="application/ld+json" ${JSON_LD_DATA_ATTR}="1">${escapeJsonLd(
            t.jsonLd,
          )}</script>`;
          break;
      }
      return html;
    })
    .join('\n    ');
}

// ---------------------------------------------------------------------------
// Client emitter — mutate document.head
// ---------------------------------------------------------------------------

function upsertMeta(
  attr: 'name' | 'property',
  key: string,
  content: string,
): void {
  const selector = `meta[${attr}="${key}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel: string, href: string, hreflang?: string): void {
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

/**
 * Apply resolved tags to `document.head`, mirroring the prerendered output.
 * Upserts singletons (title, description, canonical, og/twitter, robots);
 * clears-then-re-adds the variable-count groups (hreflang alternates,
 * JSON-LD) so stale entries from a previous route don't linger; removes
 * canonical/og:url when the new route declares no canonical.
 */
export function applyHeadToDocument(tags: readonly HeadTag[]): void {
  document.head
    .querySelectorAll('link[rel="alternate"][hreflang]')
    .forEach((el) => el.remove());
  document.head
    .querySelectorAll(
      `script[type="application/ld+json"][${JSON_LD_DATA_ATTR}]`,
    )
    .forEach((el) => el.remove());

  let hasCanonical = false;
  let hasOgUrl = false;

  for (const t of tags) {
    switch (t.tag) {
      case 'title':
        document.title = t.text;
        break;
      case 'meta':
        upsertMeta(t.attr, t.key, t.content);
        if (t.key === 'og:url') hasOgUrl = true;
        break;
      case 'link':
        if (t.rel === 'alternate') {
          upsertLink('alternate', t.href, t.hreflang);
        } else {
          upsertLink(t.rel, t.href);
          if (t.rel === 'canonical') hasCanonical = true;
        }
        break;
      case 'script': {
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.setAttribute(JSON_LD_DATA_ATTR, '1');
        script.text = t.jsonLd;
        document.head.appendChild(script);
        break;
      }
    }
  }

  if (!hasCanonical) {
    document.head.querySelector('link[rel="canonical"]')?.remove();
  }
  if (!hasOgUrl) {
    document.head.querySelector('meta[property="og:url"]')?.remove();
  }
}
