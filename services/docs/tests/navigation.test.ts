import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DOCS_NAV,
  flattenNav,
  isNavGroup,
  type DocsNavGroup,
  type DocsNavPage,
} from '@/lib/content/nav';

import { assertNoFindings, type Finding } from './lib/findings';
import { parseFrontmatter, stripFences } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { BASE_LOCALES, walkDocs } from './lib/walk';

/**
 * Every entry in the navigation tree (`docs/nav.json` consumed via
 * `@/lib/content/nav`) must resolve to a real `.md` or `.mdx` file under
 * every base locale.
 *
 * The most common bug this catches: a page renamed in `en/` but not in
 * `nav.json`, leaving the sidebar pointing at a 404.
 */

function fileExistsForSlug(locale: string, slug: string): boolean {
  return (
    fs.existsSync(path.join(CONTENT_ROOT, locale, `${slug}.md`)) ||
    fs.existsSync(path.join(CONTENT_ROOT, locale, `${slug}.mdx`))
  );
}

describe('navigation', () => {
  it('DOCS_NAV declares at least one tab', () => {
    expect(DOCS_NAV.length).toBeGreaterThan(0);
  });

  it.each(BASE_LOCALES)(
    'every navigation slug resolves to a real .md or .mdx file under %s/',
    (locale) => {
      const findings: Finding[] = flattenNav()
        .filter((entry) => !fileExistsForSlug(locale, entry.slug))
        .map((entry) => ({
          file: `${locale}/${entry.slug}`,
          line: 0,
          rule: 'nav-slug-unresolved',
          detail: `nav slug "${entry.slug}" has no .md or .mdx file under docs/${locale}/`,
        }));
      assertNoFindings(findings, `Navigation entries missing under ${locale}/`);
    },
  );
});

/**
 * Episode listings stay in episode order. Series pages carry their number in
 * the frontmatter title ("Episode 7 — …" / "Épisode 7 — …"); wherever a nav
 * group or a page's Card list enumerates them, those numbers must ascend.
 * `nav.json` also drives prev/next links (`flattenNav`), so a swapped entry
 * breaks the reading path, not just the sidebar.
 *
 * Regression: the tutorial-video series shipped with episodes 7 and 8 swapped
 * in the tutorials nav group and on all three `tutorials/videos/index.md`
 * card lists.
 */

const EPISODE_TITLE = /^(?:Episode|Épisode)\s+(\d+)\b/;

function pageTitle(locale: string, slug: string): string | null {
  for (const ext of ['.md', '.mdx']) {
    const file = path.join(CONTENT_ROOT, locale, `${slug}${ext}`);
    if (!fs.existsSync(file)) continue;
    const { frontmatter } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    const match = /^title:\s*(.+)\s*$/m.exec(frontmatter);
    return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
  }
  return null;
}

function episodeNumberOf(title: string | null): number | null {
  if (!title) return null;
  const match = EPISODE_TITLE.exec(title);
  return match ? Number(match[1]) : null;
}

describe('episode order', () => {
  it.each(BASE_LOCALES)(
    'episode-numbered pages ascend within every nav group (titles under %s/)',
    (locale) => {
      const findings: Finding[] = [];
      const walk = (group: DocsNavGroup) => {
        const numbered = group.pages
          .filter((entry): entry is DocsNavPage => !isNavGroup(entry))
          .flatMap((page) => {
            const episode = episodeNumberOf(pageTitle(locale, page.slug));
            return episode === null ? [] : [{ slug: page.slug, episode }];
          });
        for (let i = 1; i < numbered.length; i++) {
          if (numbered[i].episode <= numbered[i - 1].episode) {
            findings.push({
              file: 'nav.json',
              line: 0,
              rule: 'nav-episode-order',
              detail: `"${numbered[i].slug}" (episode ${numbered[i].episode}) is listed after "${numbered[i - 1].slug}" (episode ${numbered[i - 1].episode}) in group ${group.labelKey}`,
            });
          }
        }
        for (const entry of group.pages) {
          if (isNavGroup(entry)) walk(entry);
        }
      };
      for (const group of DOCS_NAV) walk(group);
      assertNoFindings(findings, `Nav episode order broken (${locale} titles)`);
    },
  );

  it('episode-numbered Card listings ascend on every page', () => {
    const findings: Finding[] = [];
    const cardTitle = /<Card\s+title="(?:Episode|Épisode)\s+(\d+)\b[^"]*"/g;
    for (const rel of walkDocs()) {
      const content = fs.readFileSync(path.join(CONTENT_ROOT, rel), 'utf8');
      const { frontmatter, body } = parseFrontmatter(content);
      const fmOffset = frontmatter ? frontmatter.split('\n').length + 2 : 0;
      const lines = stripFences(body).split('\n');
      const seen: { episode: number; line: number }[] = [];
      for (let i = 0; i < lines.length; i++) {
        cardTitle.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = cardTitle.exec(lines[i])) !== null) {
          seen.push({ episode: Number(match[1]), line: fmOffset + i + 1 });
        }
      }
      for (let i = 1; i < seen.length; i++) {
        if (seen[i].episode <= seen[i - 1].episode) {
          findings.push({
            file: rel,
            line: seen[i].line,
            rule: 'card-episode-order',
            detail: `episode ${seen[i].episode} card listed after episode ${seen[i - 1].episode}`,
          });
        }
      }
    }
    assertNoFindings(findings, 'Episode card listings out of order');
  });
});
