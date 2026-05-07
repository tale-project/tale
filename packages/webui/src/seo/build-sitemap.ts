/**
 * sitemap.xml builder with hreflang alternates per page. Used at build
 * time by both `services/web` and `services/docs`.
 */

import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

import type { Locale } from '../i18n/locales';

/**
 * Returns the ISO-8601 commit time of the most recent git commit that
 * touched `filePath`, suitable for use as a sitemap `<lastmod>` value.
 *
 * Pass `repoRoot` (an absolute path to the repository root) so the helper
 * does not depend on `process.cwd()` — build scripts in different services
 * may be invoked from different working directories.
 *
 * `filePath` may be absolute or relative; it is resolved against `repoRoot`
 * before being passed to `git`. Falls back to the current time when:
 *   - `.git/` is unavailable (e.g. CI shallow clones without history),
 *   - the file is untracked / has no commits yet,
 *   - the `git` binary is missing or fails for any other reason.
 *
 * Uses `node:child_process` which is supported in both Node and Bun.
 */
export function gitMtimeIso(filePath: string, repoRoot: string): string {
  const absolute = path.isAbsolute(filePath)
    ? filePath
    : path.join(repoRoot, filePath);
  try {
    const out = execFileSync(
      'git',
      ['log', '-1', '--format=%cI', '--', absolute],
      { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .toString()
      .trim();
    return out || new Date().toISOString();
  } catch (error) {
    console.warn(
      `[build-sitemap] gitMtimeIso fallback for ${filePath}:`,
      error instanceof Error ? error.message : error,
    );
    return new Date().toISOString();
  }
}

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
