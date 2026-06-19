/**
 * App manifest (`apps/<slug>/app.json`) — a first-class composition unit.
 *
 * An APP is the end-user product: it COMPOSES platform building blocks
 * (workflows + agents, referenced by slug) and OWNS its UI (`views/*.json`),
 * its Tier-2 i18n (`messages/`), its bundled assets (`scripts/`), and its
 * role→agent map. It is deliberately NOT a skill — skills are agent
 * capabilities spliced into agent prompts; an app may reference a skill as one
 * ingredient, but isn't one. The Apps hub lists apps; `pack://<app>/...` asset
 * refs (e.g. a workflow's sandbox script) resolve against the app's bundle.
 */
import { z } from 'zod';

export const appManifestSchema = z
  .object({
    /** Friendly display name shown in the Apps hub (the slug is the dir name). */
    name: z.string(),
    description: z.string().optional(),
    /** Optional lucide icon name for the app card. */
    icon: z.string().optional(),
    /** i18n namespace for the app's Tier-2 message catalog. */
    messageNamespace: z.string().optional(),
    /** Workflow slugs this app owns / drives (referenced, they live in workflows/). */
    workflows: z.array(z.string()).optional(),
    /** Agent slugs this app composes (referenced, they live in agents/). */
    agents: z.array(z.string()).optional(),
    /**
     * Integration slugs this app provides — their DEFINITIONS (connector +
     * config, never secrets) are copied into the org on install. The per-org
     * credential (e.g. a GitHub token) is collected by the readiness wizard, not
     * copied. Listed in `requires.integrations` if the app can't run without it.
     */
    integrations: z.array(z.string()).optional(),
    /** role token -> agent slug (the app's cast). */
    roles: z.record(z.string(), z.string()).optional(),
    /**
     * Readiness contract — what must be provided per-org before the app works.
     * Drives the non-blocking setup checklist on app entry. `integrations` =
     * slugs whose credential must be connected (checked via `computeAvailability`);
     * `config` = app-level non-secret inputs the wizard collects (e.g. a repo).
     */
    requires: z
      .object({
        integrations: z.array(z.string()).optional(),
        config: z
          .array(
            z.object({
              key: z.string(),
              type: z.enum(['string', 'number', 'boolean']),
              labelKey: z.string(),
            }),
          )
          .optional(),
      })
      .optional(),
    /**
     * Capability allowlist — the app's declared surface of platform powers its
     * views may DO (the Forge/Slack manifest model). An action can never act
     * beyond this: `trigger_workflow` targets must be in `workflows`, `assign`
     * targets in `roles`. Enforced at dispatch + checked at publish.
     */
    capabilities: z
      .object({
        workflows: z.array(z.string()).optional(),
        roles: z.array(z.string()).optional(),
        queues: z.array(z.string()).optional(),
        /**
         * The allowlist of public Convex functions the app's views may call —
         * the "data freedom" surface. A bound component / action may only invoke
         * a `path` listed here (validated at publish, gated client-side, audited).
         * `path` is the `makeFunctionReference` form `<dir>/<file>:<export>`.
         */
        functions: z
          .array(
            z.object({
              path: z.string(),
              mode: z.enum(['query', 'mutation', 'action']),
            }),
          )
          .optional(),
      })
      .optional(),
  })
  .passthrough();

export type AppManifest = z.infer<typeof appManifestSchema>;

/** App slug — same alphabet as skills/workflows (kebab segments). */
const APP_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidAppSlug(slug: string): boolean {
  return APP_SLUG_REGEX.test(slug) && slug.length <= 64;
}
