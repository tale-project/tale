/**
 * Retiring a documentation page, checked against the change that retires
 * it. A page address a site ever served has to keep answering: when a page
 * is deleted, renamed or merged, its old slug goes into the site's
 * `redirects.json` and its line stays in the site's `published.json`. Two
 * rules hold a change (the working tree, compared with its base commit) to
 * that:
 *
 *  - `published-line-removed` — a slug the ledger held before the change is
 *    gone. The ledger is append-only; deleting the line is how a lost
 *    address would otherwise slip past the published suites.
 *  - `retired-page-404` — a page file the change deletes or renames leaves
 *    its old address answering 404. The finding names the `redirects.json`
 *    line that fixes it (the new slug, for a rename).
 *
 * History comes through a `GitReader`, so the rules run against a real
 * repository in the CLI and against a scripted one in the tests.
 */

import type { LinkSiteModule } from '@tale/ui/docs/links';
import { parsePublished } from '@tale/ui/docs/published';

import type { Finding } from './lint';

/** One content file a change touched, relative to its base. */
export interface Change {
  /** `D` deleted, `R` renamed (to `renamedTo`); other statuses are ignored. */
  status: string;
  file: string;
  renamedTo?: string;
}

export interface GitReader {
  /** A file's content at `ref`, or null when the file did not exist there. */
  show: (ref: string, file: string) => string | null;
  /** The files under `path` a change deletes or renames, base → working tree. */
  changes: (base: string, path: string) => Change[];
}

export interface RetirementInput {
  modules: readonly LinkSiteModule[];
  /** The commit the change is compared with (a merge base, `HEAD^1` in CI). */
  base: string;
  git: GitReader;
  /** A file's text in the working tree, or null when there is none. */
  read: (file: string) => string | null;
}

function ledgerSlugs(text: string | null, file: string): string[] {
  if (text === null) return [];
  return parsePublished(JSON.parse(text), file);
}

/** Judge every page retirement in the change. */
export function lintRetirements(input: RetirementInput): Finding[] {
  const findings: Finding[] = [];
  for (const module of input.modules) {
    const before = new Set(
      ledgerSlugs(input.git.show(input.base, module.ledger), module.ledger),
    );
    const after = new Set(
      ledgerSlugs(input.read(module.ledger), module.ledger),
    );
    for (const slug of before) {
      if (after.has(slug)) continue;
      findings.push({
        file: module.ledger,
        line: 1,
        column: 1,
        rule: 'published-line-removed',
        detail: `"${slug}" was published before this change and its line is gone — the ledger is append-only: put the line back, and add "${slug}" to ${module.redirects} so the old address keeps answering`,
      });
    }

    // One finding per retired slug: a page and its German and French twins
    // share one redirect entry, so the finding names them together.
    const retired = new Map<
      string,
      { files: string[]; pathname: string; renamedTo?: string }
    >();
    for (const change of input.git.changes(input.base, module.contentRoot)) {
      if (change.status !== 'D' && change.status !== 'R') continue;
      const old = module.pageAddress(change.file);
      if (!old) continue;
      const pathname = decodeURIComponent(new URL(old.url).pathname);
      if (module.site.answer(pathname).kind !== 'missing') continue;
      const entry = retired.get(old.slug) ?? { files: [], pathname };
      entry.files.push(change.file);
      // The shortest address is the one without a locale prefix.
      if (pathname.length < entry.pathname.length) entry.pathname = pathname;
      const renamed = change.renamedTo
        ? module.pageAddress(change.renamedTo)
        : null;
      if (renamed && !entry.renamedTo) entry.renamedTo = renamed.slug;
      retired.set(old.slug, entry);
    }
    for (const [slug, { files, pathname, renamedTo }] of retired) {
      const line = `"${slug}": "${renamedTo ?? '<the page that replaced it>'}"`;
      findings.push({
        file: module.redirects,
        line: 1,
        column: 1,
        rule: 'retired-page-404',
        detail: `${files.join(', ')} ${files.length === 1 ? 'is' : 'are'} ${renamedTo ? 'renamed' : 'deleted'} in this change and ${pathname} now answers 404 — add ${line} to ${module.redirects} and keep "${slug}" in ${module.ledger}`,
      });
    }
  }
  return findings;
}
