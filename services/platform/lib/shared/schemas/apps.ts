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
    /** role token -> agent slug (the app's cast). */
    roles: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

export type AppManifest = z.infer<typeof appManifestSchema>;

/** App slug — same alphabet as skills/workflows (kebab segments). */
const APP_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidAppSlug(slug: string): boolean {
  return APP_SLUG_REGEX.test(slug) && slug.length <= 64;
}
