'use node';

/**
 * Server side of the in-sandbox integrations MCP bridge
 * (`tale-integrations-mcp` → `/api/integrations/{execute,status}`).
 *
 * The bridge is a thin relay: whatever these actions return is serialized
 * verbatim as the tool result the coding agent reads, so every shape here is
 * written FOR THE MODEL — structured statuses with guidance it can relay,
 * never a bare error string. The dispatch itself reuses the integrations
 * dispatcher (`runIntegrationAction`), so credential resolution, the audit
 * trail, and schema enforcement are the same acts as any other invocation;
 * credentials never leave the platform.
 *
 * V1 is READ-ONLY: a write action needs the approvals lane, and an async
 * coding turn has no human-in-the-loop to answer an approval card yet, so a
 * write refuses with guidance instead of parking a card nobody can see.
 *
 * `'use node'` because the shipped connector catalog is filesystem work.
 */

import { ConvexError, v } from 'convex/values';

import {
  findIntegrationConnector,
  loadIntegrationConnectors,
} from '../../../lib/integrations/catalog';
import { internal } from '../../_generated/api';
import { internalAction, type ActionCtx } from '../../_generated/server';

/** One reason an integration (or call) cannot run, with guidance the agent
 * relays to the user verbatim. */
interface BridgeBlocker {
  code: string;
  guidance: string;
}

type BridgeExecuteResult =
  | { status: 'ok'; output: unknown }
  | { status: 'requires_approval'; message: string }
  | { status: 'unavailable'; blockers: BridgeBlocker[] }
  | { status: 'invalid_args'; message: string }
  | { status: 'error'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The operations of one connector the bridge offers — read actions only,
 * matching the execute path's V1 read-only rule. */
function readOperations(connectorSlug: string): string[] {
  const connector = findIntegrationConnector(connectorSlug);
  if (!connector) return [];
  return connector.actions
    .filter((action) => action.effects === 'read')
    .map((action) => action.name);
}

/**
 * Run one integration operation for a sandbox coding turn. The caller (the
 * HTTP dispatch) has already authenticated the session token and checked the
 * grant set; this action owns catalog validation, the read-only rule, and the
 * dispatcher call as the turn's user.
 */
export const dispatchBridgeIntegration = internalAction({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    userId: v.string(),
    slug: v.string(),
    operation: v.string(),
    callArgs: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<BridgeExecuteResult> => {
    const result = await runBridgeIntegration(ctx, args);
    // Forensic trail (the sandboxIntegrationCalls table the schema promised):
    // who/what/when/outcome + a sorted param-KEY fingerprint, never values. A
    // logging failure must not fail the call.
    await ctx
      .runMutation(internal.sandbox.session_mutations.recordIntegrationCall, {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        slug: args.slug,
        operation: args.operation,
        userId: args.userId,
        outcome: result.status,
        paramsFingerprint: isRecord(args.callArgs)
          ? Object.keys(args.callArgs).sort().join(',')
          : '',
      })
      .catch((err: unknown) =>
        console.warn('[integrations-bridge] audit write failed:', err),
      );
    return result;
  },
});

async function runBridgeIntegration(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    userId: string;
    slug: string;
    operation: string;
    callArgs: unknown;
  },
): Promise<BridgeExecuteResult> {
  const connector = findIntegrationConnector(args.slug);
  if (!connector) {
    return {
      status: 'unavailable',
      blockers: [
        {
          code: 'unknown_integration',
          guidance: `No integration named "${args.slug}" ships on this deployment. Call integration_status to see what is available.`,
        },
      ],
    };
  }

  const actionDef = connector.actions.find(
    (action) => action.name === args.operation,
  );
  if (!actionDef) {
    const operations = readOperations(args.slug);
    return {
      status: 'invalid_args',
      message:
        `"${args.slug}" has no operation named "${args.operation}". ` +
        (operations.length > 0
          ? `Available operations: ${operations.join(', ')}.`
          : 'It currently offers no operations to this agent.'),
    };
  }
  if (actionDef.effects !== 'read') {
    return {
      status: 'unavailable',
      blockers: [
        {
          code: 'write_not_supported',
          guidance:
            `"${args.operation}" changes the outside world, and write actions are not available from the coding agent yet. ` +
            'Ask the user to run it themselves (for example from chat, where approvals work).',
        },
      ],
    };
  }

  try {
    const result: unknown = await ctx.runAction(
      internal.integrations.execute_action.runIntegrationAction,
      {
        organizationId: args.organizationId,
        connector: args.slug,
        action: args.operation,
        input: args.callArgs ?? {},
        mode: 'live',
        caller: { kind: 'user', userId: args.userId },
        // The turn's own session doubles as the out-of-process runner for the
        // connector's live body (the portable sandbox-exec convention).
        execSessionId: args.sessionId,
      },
    );
    if (isRecord(result) && result.status === 'approval-required') {
      const message =
        typeof result.message === 'string'
          ? result.message
          : 'This action requires approval.';
      return { status: 'requires_approval', message };
    }
    const output =
      isRecord(result) && 'output' in result ? result.output : result;
    return { status: 'ok', output };
  } catch (error) {
    // The dispatcher refuses with a coded ConvexError (no credential,
    // schema mismatch, vendor failure) — surface its message and hint so
    // the agent can relay something actionable.
    if (error instanceof ConvexError) {
      const data: unknown = error.data;
      const message =
        isRecord(data) && typeof data.message === 'string'
          ? data.message
          : 'The integration call failed.';
      const hint =
        isRecord(data) && typeof data.hint === 'string' ? ` ${data.hint}` : '';
      return { status: 'error', message: `${message}${hint}` };
    }
    console.error('[integrations-bridge] dispatch failed', error);
    return {
      status: 'error',
      message: 'The integration call failed unexpectedly.',
    };
  }
}

/**
 * What the granted integrations can do RIGHT NOW: per slug, its read
 * operations and whether a live call would run (an active default credential
 * exists) — with guidance blockers otherwise. The agent calls this before
 * relying on an integration.
 */
export const bridgeIntegrationStatus = internalAction({
  args: {
    organizationId: v.string(),
    grants: v.array(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.grants.length === 0) {
      return {
        integrations: [],
        note: 'No integrations are equipped for this agent. The user can equip them in the chat composer or on the project Agents tab.',
      };
    }
    const shipped = new Map(
      loadIntegrationConnectors().map(
        (connector) => [connector.name, connector] as const,
      ),
    );
    const integrations = [];
    for (const slug of args.grants) {
      const connector = shipped.get(slug);
      if (!connector) {
        integrations.push({
          slug,
          usable: false,
          blockers: [
            {
              code: 'unknown_integration',
              guidance: `"${slug}" is equipped but does not ship on this deployment.`,
            },
          ],
        });
        continue;
      }
      const credential: unknown = await ctx.runQuery(
        internal.integration_credentials.queries.resolveCredentialRefInternal,
        { organizationId: args.organizationId, connectorSlug: slug },
      );
      const credentialActive =
        isRecord(credential) && credential.status === 'active';
      const blockers: BridgeBlocker[] = credentialActive
        ? []
        : [
            {
              code: 'no_credential',
              guidance: `"${connector.displayName}" has no active credential. The user can connect one under Settings → Integrations.`,
            },
          ];
      integrations.push({
        slug,
        name: connector.displayName,
        operations: readOperations(slug),
        usable: blockers.length === 0,
        blockers,
      });
    }
    return { integrations };
  },
});
