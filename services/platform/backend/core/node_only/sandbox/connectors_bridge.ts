'use node';

import {
  findConnector,
  loadConnectorDefinitions,
} from '../../../../lib/connectors/catalog';
import { AppError } from '../../../../lib/shared/errors/app-error';
/** One reason a connector (or call) cannot run, with guidance the agent
 * relays to the user verbatim. */
export interface BridgeBlocker {
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
 * Whom a turn's connector calls act for, as its session token records it
 * (`connectorCaller`). The session alone cannot say: a project agent's
 * standing session serves every task the agent works, and each run was
 * started by someone else.
 *
 * `task-run`: the calls act for the starter of the task run that this exec
 * serves (the person its spend is booked under), and only while that run is
 * live. The token names the exec, never the person: the bridge reads the
 * person from the run on every call, so a token that outlives its run, or
 * that another process on the agent's shared session read, acts for nobody.
 */
export type TurnConnectorCaller = { kind: 'task-run'; execId: string };

/** A token scope's `connectorCaller`, or undefined when it carries none
 * (a token minted before the field existed, or a lane that sets none). */
export function readTurnConnectorCaller(
  value: unknown,
): TurnConnectorCaller | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.kind === 'task-run' &&
    typeof value.execId === 'string' &&
    value.execId !== ''
  ) {
    return { kind: 'task-run', execId: value.execId };
  }
  return undefined;
}

/** The refusal for a task run whose starter names no member (a run a
 * trigger started): its connector calls act for nobody. */
export function taskRunActsForNobodyBlocker(): BridgeBlocker {
  return {
    code: 'no_user_context',
    guidance:
      'This task run was not started by a member, so its connector calls act for nobody and cannot run. ' +
      "Tell the user to have a project member cancel the run (or let it finish) and start it again (Start agent on the task, or an @mention of the agent in a comment); the agent's connector calls then run for that member.",
  };
}

/** The refusal for a token that records no caller at all: an automation's
 * agent node, or a task turn minted before the field existed. It cannot
 * tell which, so it names both remedies. */
export function noConnectorCallerBlocker(): BridgeBlocker {
  return {
    code: 'no_user_context',
    guidance:
      'This turn does not act for a member, so connector calls cannot run from it. ' +
      "Tell the user: a project agent's task run acts for the member who starts it, so a member should cancel the run (or let it finish) and start it again from the task; " +
      'an automation calls a connector from a connector node, not from its agent node.',
  };
}

/** The refusal for a token whose task run is no longer live (it settled,
 * failed or was cancelled, or a steer restart moved it to a new exec). */
export function taskRunEndedBlocker(): BridgeBlocker {
  return {
    code: 'run_ended',
    guidance:
      'The task run this turn belongs to is no longer running (it finished, failed, was cancelled or was restarted), so its connector calls cannot run. ' +
      'Do not retry: a member starts a new run from the task.',
  };
}

/** The refusal for a caller who is no longer an active member of the org. */
export function connectorCallerNotAMemberBlocker(): BridgeBlocker {
  return {
    code: 'access_denied',
    guidance:
      'The member this turn acts for (the person who started its run) is no longer an active member of this organization, so connector calls cannot run for them. ' +
      'Tell the user: a current member can cancel the run (or let it finish) and start it again, and its connector calls then run for that member. Do not retry.',
  };
}

/**
 * The dispatch seam: how this host runs one connector action. 0.4 passes the
 * Convex action; the 0.5 backend passes its own door. Everything else about
 * a bridge call — catalog validation, the read-only rule, how a refusal is
 * WORDED for the model — is this module's, so both lanes answer identically.
 */
export type BridgeDispatch = (args: {
  organizationId: string;
  connector: string;
  action: string;
  input: unknown;
  userId: string;
  execSessionId: string;
}) => Promise<unknown>;

/** Whether the org has an ACTIVE credential for a connector (the status
 * face's only host dependency). */
export type BridgeCredentialProbe = (args: {
  organizationId: string;
  connectorSlug: string;
}) => Promise<boolean>;

export async function runBridgeConnectorImpl(
  dispatch: BridgeDispatch,
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
    const result: unknown = await dispatch({
      organizationId: args.organizationId,
      connector: args.slug,
      action: args.operation,
      input: args.callArgs ?? {},
      userId: args.userId,
      // The turn's own session doubles as the out-of-process runner for the
      // connector's live body (the portable sandbox-exec convention).
      execSessionId: args.sessionId,
    });
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
    // The dispatcher refuses with a coded AppError (no credential,
    // schema mismatch, vendor failure) — surface its message and hint so
    // the agent can relay something actionable.
    if (error instanceof AppError) {
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

export async function bridgeConnectorStatusImpl(
  hasActiveCredential: BridgeCredentialProbe,
  args: {
    organizationId: string;
    grants: string[];
    /** Why no connector call can run from this turn at all (it acts for no
     * member, or for one who has left): every shipped connector reports it,
     * so `usable` never promises a call `execute` refuses. */
    callerBlocker?: BridgeBlocker;
  },
): Promise<unknown> {
  {
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
      const credentialActive = await hasActiveCredential({
        organizationId: args.organizationId,
        connectorSlug: slug,
      });
      const blockers: BridgeBlocker[] = [
        ...(args.callerBlocker !== undefined ? [args.callerBlocker] : []),
        ...(credentialActive
          ? []
          : [
              {
                code: 'no_credential',
                guidance: `"${connector.displayName}" has no active credential. The user can connect one under Settings → Connectors.`,
              },
            ]),
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
  }
}
