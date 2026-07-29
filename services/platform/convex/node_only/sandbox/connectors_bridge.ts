'use node';

/**
 * Server side of the in-sandbox connectors MCP bridge
 * (`tale-connectors-mcp` → `/api/connectors/{execute,status}`).
 *
 * The bridge is a thin relay: whatever these actions return is serialized
 * verbatim as the tool result the external agent reads, so every shape here is
 * written FOR THE MODEL — structured statuses with guidance it can relay,
 * never a bare error string. The dispatch itself reuses the connectors
 * dispatcher (`runConnectorAction`), so credential resolution, the audit
 * trail, and schema enforcement are the same acts as any other invocation;
 * credentials never leave the platform.
 *
 * V1 is READ-ONLY: a write action needs the approvals lane, and an async
 * external turn has no human-in-the-loop to answer an approval card yet, so a
 * write refuses with guidance instead of parking a card nobody can see.
 *
 * `'use node'` because the shipped connector catalog is filesystem work.
 */

import { ConvexError, v } from 'convex/values';

import {
  findConnector,
  loadConnectorDefinitions,
} from '../../../lib/connectors/catalog';
import { internal } from '../../_generated/api';
import { internalAction, type ActionCtx } from '../../_generated/server';

/** One reason an connector (or call) cannot run, with guidance the agent
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
  const connector = findConnector(connectorSlug);
  if (!connector) return [];
  return connector.actions
    .filter((action) => action.effects === 'read')
    .map((action) => action.name);
}

/**
 * Run one connector operation for a sandbox external turn. The caller (the
 * HTTP dispatch) has already authenticated the session token and checked the
 * grant set; this action owns catalog validation, the read-only rule, and the
 * dispatcher call as the turn's user.
 */
export const dispatchBridgeConnector = internalAction({
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
    const result = await runBridgeConnector(ctx, args);
    // Forensic trail (the sandboxConnectorCalls table the schema promised):
    // who/what/when/outcome + a sorted param-KEY fingerprint, never values. A
    // logging failure must not fail the call.
    await ctx
      .runMutation(internal.sandbox.session_mutations.recordConnectorCall, {
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
        console.warn('[connectors-bridge] audit write failed:', err),
      );
    return result;
  },
});

async function runBridgeConnector(
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
  const connector = findConnector(args.slug);
  if (!connector) {
    return {
      status: 'unavailable',
      blockers: [
        {
          code: 'unknown_connector',
          guidance: `No connector named "${args.slug}" ships on this deployment. Call connector_status to see what is available.`,
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
            `"${args.operation}" changes the outside world, and write actions are not available from the external agent yet. ` +
            'Ask the user to run it themselves (for example from chat, where approvals work).',
        },
      ],
    };
  }

  try {
    const result: unknown = await ctx.runAction(
      internal.connectors.execute_action.runConnectorAction,
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
          : 'The connector call failed.';
      const hint =
        isRecord(data) && typeof data.hint === 'string' ? ` ${data.hint}` : '';
      return { status: 'error', message: `${message}${hint}` };
    }
    console.error('[connectors-bridge] dispatch failed', error);
    return {
      status: 'error',
      message: 'The connector call failed unexpectedly.',
    };
  }
}

/**
 * What the granted connectors can do RIGHT NOW: per slug, its read
 * operations and whether a live call would run (an active default credential
 * exists) — with guidance blockers otherwise. The agent calls this before
 * relying on an connector.
 */
export const bridgeConnectorStatus = internalAction({
  args: {
    organizationId: v.string(),
    grants: v.array(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.grants.length === 0) {
      return {
        connectors: [],
        note: 'No connectors are equipped for this agent. The user can equip them in the chat composer or on the project Agents tab.',
      };
    }
    const shipped = new Map(
      loadConnectorDefinitions().map(
        (connector) => [connector.name, connector] as const,
      ),
    );
    const connectors = [];
    for (const slug of args.grants) {
      const connector = shipped.get(slug);
      if (!connector) {
        connectors.push({
          slug,
          usable: false,
          blockers: [
            {
              code: 'unknown_connector',
              guidance: `"${slug}" is equipped but does not ship on this deployment.`,
            },
          ],
        });
        continue;
      }
      const credential: unknown = await ctx.runQuery(
        internal.connector_credentials.queries.resolveCredentialRefInternal,
        { organizationId: args.organizationId, connectorSlug: slug },
      );
      const credentialActive =
        isRecord(credential) && credential.status === 'active';
      const blockers: BridgeBlocker[] = credentialActive
        ? []
        : [
            {
              code: 'no_credential',
              guidance: `"${connector.displayName}" has no active credential. The user can connect one under Settings → Connectors.`,
            },
          ];
      connectors.push({
        slug,
        name: connector.displayName,
        operations: readOperations(slug),
        usable: blockers.length === 0,
        blockers,
      });
    }
    return { connectors };
  },
});
