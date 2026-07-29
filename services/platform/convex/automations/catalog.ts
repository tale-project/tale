'use node';

/**
 * The node-type catalog the automations editor works against.
 *
 * The engine's registry is the authority on what a node may be and which
 * fields each type takes. Core types (`transform`, `llm`, `subautomation`, …)
 * are registered at module scope in `lib/engine/core/slots.ts`; connector
 * types (`<connector>.<action>`) are registered from
 * `configs/platform/system/connectors/<slug>/connector.yml` by
 * `registerConnector`. This action loads every shipped connector, registers
 * its actions, and reads the CONNECTOR entries back out of the engine
 * registry — so the catalog is exactly what the executor validates against,
 * never a hand-written copy that could drift. The editor supplies the core
 * types itself (from the same registry) and merges the two.
 *
 * Reading the connector catalog needs the filesystem, so this is a node action;
 * it is org-scoped and gated like the rest of the automations surface (the
 * editor fronting it is developer-gated).
 */

import { type Infer, v } from 'convex/values';

import { loadConnectorDefinitions } from '../../lib/connectors/catalog';
import { registerConnector } from '../../lib/connectors/registry';
import { nodeTypes } from '../../lib/engine/core/slots';
import { action } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';

/** One node type as the editor needs it. Mirrors `NodeTypeSummary` in the
 * app's `automations/hooks/backend.ts`. */
const nodeTypeSummaryValidator = v.object({
  type: v.string(),
  kind: v.union(v.literal('core'), v.literal('connector')),
  description: v.string(),
  allowedFields: v.array(v.string()),
  requiredFields: v.array(v.string()),
  outputKind: v.union(v.literal('structured'), v.literal('unstructured')),
  hasEffect: v.optional(v.boolean()),
});

type NodeTypeSummary = Infer<typeof nodeTypeSummaryValidator>;

/**
 * Every connector node type the engine knows — one per shipped connector
 * action, with the exact field grammar the executor enforces. Core types are
 * added by the editor from the same registry, so this returns the connector
 * set only.
 */
export const listNodeTypes = action({
  args: { organizationId: v.string() },
  returns: v.array(nodeTypeSummaryValidator),
  handler: async (ctx, args) => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    for (const connector of loadConnectorDefinitions()) {
      registerConnector(connector);
    }
    const summaries: NodeTypeSummary[] = [];
    for (const def of nodeTypes().values()) {
      if (def.kind !== 'connector') continue;
      summaries.push({
        type: def.type,
        kind: def.kind,
        description: def.description,
        allowedFields: [...def.allowedFields],
        requiredFields: [...def.requiredFields],
        outputKind: def.outputKind,
        hasEffect: def.connector?.hasEffect ?? false,
      });
    }
    summaries.sort((a, b) => a.type.localeCompare(b.type));
    return summaries;
  },
});
