/**
 * Permanent (301) redirects for docs pages whose slug moved. The docs server
 * has no database, so moved pages live in a compile-time map from the old
 * canonical slug (locale-less, the same shape `docs/nav.json` uses) to its
 * replacement. The resolver understands the site's URL shape: English serves
 * at the canonical path, URL-prefixed locales (`de`, `fr`) carry a language
 * segment, and every page also exists as a `.md` LLM artifact — all forms
 * redirect so inbound links, bookmarks, and crawlers land on the new page.
 *
 * When a docs page moves, add its old → new slug pair here in the same PR
 * that moves the markdown and updates `docs/nav.json`.
 */

import { isUrlPrefixedLocale } from '@tale/ui/i18n/locales';

/** Old canonical slug → new canonical slug (no leading slash, no locale). */
export const MOVED_SLUGS: ReadonlyMap<string, string> = new Map([
  // 2026-07: the Automations section became Workflows. `platform/automations/concepts`
  // itself is deliberately NOT in this list any more — Apps became Automations
  // (see below) and reclaimed that exact slug for unrelated, real content; redirecting
  // it to Workflows would 301 every visitor straight off the new page.
  ['platform/automations/workflows', 'platform/workflows/workflows'],
  ['platform/automations/triggers', 'platform/workflows/triggers'],
  ['platform/automations/execution-logs', 'platform/workflows/execution-logs'],
  ['platform/automations/metrics', 'platform/workflows/metrics'],
  [
    'platform/automations/approvals-in-workflows',
    'platform/workflows/approvals-in-workflows',
  ],
  // 2026-07: Apps became Automations — the fixed Conversations page and the
  // standalone Agents catalog both retired in favour of the Automations
  // catalog (installable bundles of integrations, agents, skills, a
  // workflow, and builtin views).
  ['platform/conversations/overview', 'platform/automations/builtin'],
  ['platform/agents/catalog', 'platform/automations/concepts'],
]);

/**
 * Resolves a request pathname against the moved-slug map. Returns the
 * replacement pathname — same locale prefix, same `.md` artifact suffix,
 * trailing slash dropped — or `null` when the path is not a moved page.
 */
export function resolveMovedPath(pathname: string): string | null {
  let slug = pathname.replace(/^\/+/, '').replace(/\/+$/, '');

  let localePrefix = '';
  const slashIndex = slug.indexOf('/');
  const head = slashIndex === -1 ? slug : slug.slice(0, slashIndex);
  if (isUrlPrefixedLocale(head)) {
    localePrefix = `/${head}`;
    slug = slashIndex === -1 ? '' : slug.slice(slashIndex + 1);
  }

  let artifactSuffix = '';
  if (slug.endsWith('.md')) {
    artifactSuffix = '.md';
    slug = slug.slice(0, -'.md'.length);
  }

  const target = MOVED_SLUGS.get(slug);
  if (!target) return null;
  return `${localePrefix}/${target}${artifactSuffix}`;
}
