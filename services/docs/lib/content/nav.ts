/**
 * Navigation tree for the documentation site. Replaces the old Mintlify
 * `docs.json` — same structure (top-level groups, optionally nested
 * groups, page slugs as leaf entries) but typed and locale-agnostic.
 *
 * Group labels resolve through the `nav.groups.*` namespace in the docs
 * message bundles so each locale renders its own copy. Slugs match the
 * on-disk layout under `/docs/<locale>/`. The navigation-parity
 * test (`tests/navigation-parity.test.ts`) checks that every entry
 * resolves to a real markdown file in every base locale.
 */

import type { SupportedLocale } from '@/lib/i18n/locales';

export interface DocsNavPage {
  slug: string;
  /** Per-locale label override; falls back to the page frontmatter title. */
  labels?: Partial<Record<SupportedLocale, string>>;
}

export type DocsNavEntry = DocsNavPage | DocsNavGroup;

export interface DocsNavGroup {
  /** Key under the `nav.groups` namespace, e.g. `nav.groups.install`. */
  labelKey: string;
  pages: readonly DocsNavEntry[];
}

export function isNavGroup(entry: DocsNavEntry): entry is DocsNavGroup {
  return 'labelKey' in entry;
}

export const DOCS_NAV: readonly DocsNavGroup[] = [
  {
    labelKey: 'nav.groups.start',
    pages: [{ slug: 'index' }],
  },
  {
    labelKey: 'nav.groups.cloud',
    pages: [{ slug: 'cloud/index' }],
  },
  {
    labelKey: 'nav.groups.selfHosted',
    pages: [
      { slug: 'self-hosted/index' },
      { slug: 'self-hosted/overview' },
      {
        labelKey: 'nav.groups.install',
        pages: [
          { slug: 'self-hosted/install/quickstart' },
          { slug: 'self-hosted/install/linux-server' },
        ],
      },
      {
        labelKey: 'nav.groups.configuration',
        pages: [
          { slug: 'self-hosted/configuration/environment-reference' },
          { slug: 'self-hosted/configuration/providers' },
          { slug: 'self-hosted/configuration/retention' },
        ],
      },
      {
        labelKey: 'nav.groups.operate',
        pages: [
          { slug: 'self-hosted/operate/container-architecture' },
          {
            labelKey: 'nav.groups.observability',
            pages: [
              { slug: 'self-hosted/operate/observability/operations' },
              { slug: 'self-hosted/operate/observability/troubleshooting' },
            ],
          },
          {
            labelKey: 'nav.groups.security',
            pages: [{ slug: 'self-hosted/operate/security/advisories' }],
          },
          {
            labelKey: 'nav.groups.releaseNotes',
            pages: [{ slug: 'self-hosted/operate/release-notes/format' }],
          },
        ],
      },
      {
        labelKey: 'nav.groups.authentication',
        pages: [{ slug: 'self-hosted/admin/authentication' }],
      },
    ],
  },
  {
    labelKey: 'nav.groups.platform',
    pages: [
      { slug: 'platform/index' },
      {
        labelKey: 'nav.groups.chat',
        pages: [
          { slug: 'platform/chat/basics' },
          { slug: 'platform/chat/attachments' },
          { slug: 'platform/chat/agents-in-chat' },
          { slug: 'platform/chat/arena-mode' },
        ],
      },
      {
        labelKey: 'nav.groups.workspace',
        pages: [
          { slug: 'platform/workspace/knowledge-base' },
          { slug: 'platform/workspace/conversations' },
          { slug: 'platform/workspace/approvals' },
          { slug: 'platform/workspace/canvas' },
          { slug: 'platform/workspace/prompt-library' },
          { slug: 'platform/workspace/document-comparison' },
        ],
      },
      {
        labelKey: 'nav.groups.agents',
        pages: [
          { slug: 'platform/agents/concepts' },
          { slug: 'platform/agents/create' },
          { slug: 'platform/agents/image-generation' },
          { slug: 'platform/agents/versions' },
        ],
      },
      {
        labelKey: 'nav.groups.automations',
        pages: [
          { slug: 'platform/automations/concepts' },
          { slug: 'platform/automations/workflows' },
          { slug: 'platform/automations/triggers' },
          { slug: 'platform/automations/execution-logs' },
          { slug: 'platform/automations/metrics' },
        ],
      },
      {
        labelKey: 'nav.groups.knowledge',
        pages: [
          { slug: 'platform/knowledge/structured-data' },
          { slug: 'platform/knowledge/crawling' },
        ],
      },
      {
        labelKey: 'nav.groups.integrations',
        pages: [{ slug: 'platform/integrations/overview' }],
      },
      {
        labelKey: 'nav.groups.member',
        pages: [
          { slug: 'platform/member/overview' },
          { slug: 'platform/member/preferences' },
        ],
      },
      {
        labelKey: 'nav.groups.editor',
        pages: [{ slug: 'platform/editor/overview' }],
      },
      {
        labelKey: 'nav.groups.developer',
        pages: [{ slug: 'platform/developer/overview' }],
      },
      {
        labelKey: 'nav.groups.admin',
        pages: [
          { slug: 'platform/admin/overview' },
          { slug: 'platform/admin/members-and-roles' },
          { slug: 'platform/admin/teams' },
          { slug: 'platform/admin/providers' },
          { slug: 'platform/admin/branding' },
          { slug: 'platform/admin/governance' },
          { slug: 'platform/admin/two-factor-authentication' },
          { slug: 'platform/admin/usage-analytics' },
        ],
      },
    ],
  },
  {
    labelKey: 'nav.groups.tutorials',
    pages: [
      { slug: 'tutorials/overview' },
      {
        labelKey: 'nav.groups.member',
        pages: [{ slug: 'tutorials/member/chat-effectively' }],
      },
      {
        labelKey: 'nav.groups.editor',
        pages: [{ slug: 'tutorials/editor/first-agent-end-to-end' }],
      },
      {
        labelKey: 'nav.groups.developer',
        pages: [
          { slug: 'tutorials/developer/call-tale-from-a-script' },
          { slug: 'tutorials/developer/trigger-automation-via-webhook' },
        ],
      },
      {
        labelKey: 'nav.groups.admin',
        pages: [
          { slug: 'tutorials/admin/office-add-in' },
          { slug: 'tutorials/admin/meeting-transcription' },
          { slug: 'tutorials/admin/connect-local-provider' },
        ],
      },
    ],
  },
  {
    labelKey: 'nav.groups.develop',
    pages: [
      { slug: 'develop/api-reference' },
      { slug: 'develop/webhooks' },
      { slug: 'develop/ai-assisted-development' },
      { slug: 'develop/integrations' },
      { slug: 'develop/contributing-docker' },
    ],
  },
];

/** Flatten every page in nav order — used for prev/next + sitemap iteration. */
export function flattenNav(): { slug: string }[] {
  const out: { slug: string }[] = [];
  const walk = (entries: readonly DocsNavEntry[]) => {
    for (const entry of entries) {
      if (isNavGroup(entry)) {
        walk(entry.pages);
      } else {
        out.push({ slug: entry.slug });
      }
    }
  };
  for (const group of DOCS_NAV) {
    walk(group.pages);
  }
  return out;
}

/**
 * Resolve the slug that comes before `slug` in the flattened nav order.
 *
 * Returns `null` if `slug` is the first page in the nav, or if `slug`
 * is not present in the nav at all (e.g. an orphan markdown file).
 *
 * @example
 * getPrevSlug('self-hosted/install/linux-server')
 * // => 'self-hosted/install/quickstart'
 *
 * @example
 * getPrevSlug('index')
 * // => null  (first page)
 */
export function getPrevSlug(slug: string): string | null {
  const flat = flattenNav();
  const idx = flat.findIndex((p) => p.slug === slug);
  if (idx <= 0) return null;
  return flat[idx - 1]?.slug ?? null;
}

/**
 * Resolve the slug that comes after `slug` in the flattened nav order.
 *
 * Returns `null` if `slug` is the last page in the nav, or if `slug`
 * is not present in the nav at all (e.g. an orphan markdown file).
 *
 * @example
 * getNextSlug('self-hosted/install/quickstart')
 * // => 'self-hosted/install/linux-server'
 *
 * @example
 * getNextSlug('develop/contributing-docker')
 * // => null  (last page)
 */
export function getNextSlug(slug: string): string | null {
  const flat = flattenNav();
  const idx = flat.findIndex((p) => p.slug === slug);
  if (idx === -1 || idx >= flat.length - 1) return null;
  return flat[idx + 1]?.slug ?? null;
}
