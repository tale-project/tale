/**
 * Convex Tool: Automation Search
 *
 * Read-only discovery of the org's automations catalog — every plain
 * automation AND every BUNDLE (an ordinary automation.json declaring
 * `bundle.members`; installing it installs each member through one
 * aggregated wizard — see `lib/shared/schemas/automations.ts#automationManifestSchema`).
 * Unlike the Automations catalog, this tool also sees HIDDEN automations (a bundle's
 * members): the `write-automation` skill says list existing automations
 * FIRST, before authoring a new one — a hidden member is exactly the kind of
 * existing automation the assistant should find and extend rather than
 * duplicate.
 */
import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { requireOrganizationId } from '../tasks/helpers/context';
import type { ToolDefinition } from '../types';

/** One catalog entry as projected by `listCatalogAutomationsForAssistant`. */
interface CatalogEntry {
  slug: string;
  kind: 'automation' | 'bundle';
  name: string;
  description: string;
  hidden: boolean;
  folder?: string;
  labels: string[];
  requiredIntegrations: string[];
  workflows: string[];
  agents: string[];
  skills: string[];
  members?: string[];
}

const automationSearchArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('list'),
    query: z
      .string()
      .optional()
      .describe(
        'Optional case-insensitive substring matched against name, description, and labels.',
      ),
    kind: z
      .enum(['automation', 'bundle'])
      .optional()
      .describe(
        "Optional filter: 'automation' for a plain single automation, 'bundle' for an aggregated multi-automation install.",
      ),
  }),
  z.object({
    operation: z.literal('get'),
    slug: z.string().describe('The automation or bundle slug (see list).'),
  }),
]);

/** Substring match over name/description/labels — case-insensitive. */
function matchesQuery(entry: CatalogEntry, query: string): boolean {
  const needle = query.toLowerCase();
  const haystack = [entry.name, entry.description, ...entry.labels]
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

export const automationSearchTool: ToolDefinition = {
  name: 'automation_search',
  availability: 'any',
  tool: createTool({
    description: `Discover the org's automations catalog: every installable/installed automation AND bundle (an aggregated install of several automations behind one wizard), INCLUDING hidden automations a bundle installs internally.

OPERATIONS:
• 'list': list catalog entries, optionally filtered by a name/description/label substring (query) and/or kind ('automation' | 'bundle'). Each result carries slug, kind, name, description, hidden, folder, labels, requiredIntegrations, workflows, agents, skills, and (bundles only) members.
• 'get': fetch the full parsed automation.json manifest for one slug.

Call 'list' before authoring a new automation or workflow — reuse or extend an existing one (including a hidden bundle member) rather than creating a divergent duplicate.`,
    inputSchema: automationSearchArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);

      if (args.operation === 'get') {
        const manifest = await ctx.runAction(
          internal.automations.file_actions.getAutomationManifestForAssistant,
          { organizationId, slug: args.slug },
        );
        if (!manifest) {
          return {
            operation: 'get' as const,
            slug: args.slug,
            manifest: null,
            error: `No automation or bundle found for slug "${args.slug}".`,
          };
        }
        return { operation: 'get' as const, slug: args.slug, manifest };
      }

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- v.any() action-boundary read
      const entries = (await ctx.runAction(
        internal.automations.file_actions.listCatalogAutomationsForAssistant,
        { organizationId },
      )) as CatalogEntry[];

      const filtered = entries
        .filter((e) => (args.kind ? e.kind === args.kind : true))
        .filter((e) => (args.query ? matchesQuery(e, args.query) : true))
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        operation: 'list' as const,
        total: filtered.length,
        automations: filtered,
      };
    },
  }),
} as const;
