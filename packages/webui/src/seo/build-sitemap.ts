/**
 * sitemap.xml builder with hreflang alternates per page. Used at build
 * time by both `services/web` and `services/docs`.
 */

import type { Locale } from '../i18n/locales';

export interface SitemapPage {
  /** Absolute URL for the canonical/default-locale variant of this page. */
  url: string;
  /** ISO-8601 last-modified date. Optional. */
  lastModified?: string;
  /** 0.0–1.0. Optional; sitemap consumers ignore on most search engines. */
  priority?: number;
  /** `daily | weekly | monthly | yearly | never`. Optional. */
  changefreq?:
    | 'always'
    | 'hourly'
    | 'daily'
    | 'weekly'
    | 'monthly'
    | 'yearly'
    | 'never';
  /** Per-locale absolute URL alternates emitted as `<xhtml:link>` entries. */
  alternates?: Partial<Record<Locale | 'x-default', string>>;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildSitemap(pages: readonly SitemapPage[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ];
  for (const page of pages) {
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(page.url)}</loc>`);
    if (page.lastModified) {
      lines.push(`    <lastmod>${escapeXml(page.lastModified)}</lastmod>`);
    }
    if (page.changefreq) {
      lines.push(`    <changefreq>${page.changefreq}</changefreq>`);
    }
    if (page.priority !== undefined) {
      lines.push(`    <priority>${page.priority.toFixed(1)}</priority>`);
    }
    if (page.alternates) {
      for (const [hreflang, href] of Object.entries(page.alternates)) {
        if (!href) continue;
        lines.push(
          `    <xhtml:link rel="alternate" hreflang="${escapeXml(
            hreflang,
          )}" href="${escapeXml(href)}" />`,
        );
      }
    }
    lines.push('  </url>');
  }
  lines.push('</urlset>');
  return lines.join('\n');
}
