/**
 * Tale-branded document-meta binding shared by the marketing site and the
 * docs site. Both services used to hand-roll the same Open Graph card +
 * `og:locale` fields; this module is the single source of truth so they
 * cannot drift.
 *
 * Service wrappers still own route/hreflang conventions (web derives them
 * from an unlocalized `path`; docs passes pre-localized paths). They call
 * {@link useTaleDocumentMeta} instead of the bare {@link useDocumentMeta}.
 */

import { useMemo } from 'react';

import { useDocumentMeta } from './document-meta';
import { TALE_OG_IMAGE, TALE_OG_LOCALES, TALE_SITE_URL } from './globals';
import type { DocumentHeadInput } from './head-tags';

export interface TaleDocumentMetaInput extends Omit<
  DocumentHeadInput,
  | 'defaultOgImage'
  | 'ogImageWidth'
  | 'ogImageHeight'
  | 'ogImageType'
  | 'ogLocale'
  | 'ogLocaleAlternates'
> {
  /**
   * URL locale code (`en` | `de` | `fr`). Maps to the OpenGraph territory
   * tag via {@link TALE_OG_LOCALES}.
   */
  locale: string;
  /**
   * Other locales that have this page — drives `og:locale:alternate`.
   * When omitted or empty, no alternate locale tags are emitted.
   */
  alternateLocales?: readonly string[];
  /** Localized accessible description of the shared brand OG card. */
  ogImageAlt: string;
}

/**
 * Pure binder: page meta + locale → full {@link DocumentHeadInput} with
 * Tale's shared OG card and locale tags filled in. Used by the hook and
 * by unit tests.
 */
export function resolveTaleDocumentMeta(
  meta: TaleDocumentMetaInput,
): DocumentHeadInput {
  const { locale, alternateLocales, ogImageAlt, ...rest } = meta;
  const ogLocaleAlternates =
    alternateLocales === undefined || alternateLocales.length === 0
      ? undefined
      : alternateLocales
          .filter((code) => code !== locale)
          .map((code) => TALE_OG_LOCALES[code] ?? TALE_OG_LOCALES.en);

  return {
    ...rest,
    defaultOgImage: `${TALE_SITE_URL}${TALE_OG_IMAGE.path}`,
    ogImageAlt,
    ogImageWidth: TALE_OG_IMAGE.width,
    ogImageHeight: TALE_OG_IMAGE.height,
    ogImageType: TALE_OG_IMAGE.type,
    ogLocale: TALE_OG_LOCALES[locale] ?? TALE_OG_LOCALES.en,
    ogLocaleAlternates,
  };
}

/**
 * Drop-in for service pages: binds the shared Tale OG payload, then
 * delegates to {@link useDocumentMeta}.
 */
export function useTaleDocumentMeta(meta: TaleDocumentMetaInput): void {
  const {
    locale,
    alternateLocales,
    ogImageAlt,
    title,
    description,
    canonicalPath,
    siteName,
    siteUrl,
    ogImage,
    noindex,
    hreflang,
    jsonLd,
  } = meta;

  // Memoize the resolved input so the head effect's deps stay stable when
  // callers pass a fresh `alternateLocales` array identity each render.
  const resolved = useMemo(
    () =>
      resolveTaleDocumentMeta({
        locale,
        alternateLocales,
        ogImageAlt,
        title,
        description,
        canonicalPath,
        siteName,
        siteUrl,
        ogImage,
        noindex,
        hreflang,
        jsonLd,
      }),
    [
      locale,
      alternateLocales,
      ogImageAlt,
      title,
      description,
      canonicalPath,
      siteName,
      siteUrl,
      ogImage,
      noindex,
      hreflang,
      jsonLd,
    ],
  );

  useDocumentMeta(resolved);
}
