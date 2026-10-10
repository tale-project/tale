import { parseRunStarter } from '../../lib/shared/run-starter.ts';
import {
  AUTOMATION_WRITE_VIAS,
  type AutomationWriteVia,
} from '../../lib/shared/schemas/automation-versions.ts';
import type { RequestChannel } from './request-channel.ts';

/**
 * Who changed a definition, and through which door — the one value every
 * writer of an automation's definition takes: saving a version, restoring
 * one, deploying, setting or removing the trigger, installing it in a project
 * or removing it from one, deleting it. It is a required argument, so a
 * writer reached from a door that does not say which door it is does not
 * compile.
 *
 * One door, three records of it:
 *
 * - the origin, handed to the writer explicitly;
 * - what the store keeps of it: the door, the API key and the client on the
 *   version a save adds (`created_via`, `api_key_id`, `client_name`) and on
 *   the deployment a deploy records (`via`, `api_key_id`, `client`), in this
 *   module's vocabulary;
 * - the request channel (`request-channel.ts`) a keyed door opens around its
 *   call, which stamps every audit row the call writes, in any domain, with
 *   the door, the tool, the key and the client. A keyed door opens it from
 *   the origin it hands the writer ({@link requestChannelOf}), so the
 *   channel's stamps and the attribution a version keeps name the same door
 *   and the same key. The app's session doors open none: the audit row of a
 *   definition write names its door from the origin instead.
 *
 * The vocabulary is the one the version history publishes
 * (`AUTOMATION_WRITE_VIAS`, `lib/shared/schemas/automation-versions.ts`).
 * The audit log keeps its own word for the REST API, `api-key`, which every
 * REST writer stamps; {@link requestChannelOf} translates.
 */

/** The doors a definition write comes through: the editor, a package
 * upload, a coding agent over MCP, the REST API with a key, managed
 * configuration, and the platform itself. */
export const WRITE_VIAS = AUTOMATION_WRITE_VIAS;

export type WriteVia = AutomationWriteVia;

export interface WriteOrigin {
  /** Who: a bare user id (the app's doors), `api-key:<userId>` (MCP and the
   * REST API), or `system:<what>` (the platform) — the actor vocabulary of
   * `automations.created_by`, read through `parseRunStarter`. */
  readonly actor: string;
  readonly via: WriteVia;
  /** The API key a keyed door authenticated with, by id — never the key. */
  readonly apiKeyId?: string;
  /** The name the caller's client gave itself, already cleaned by
   * `displayClientName` (at most 80 characters). Untrusted, display only. */
  readonly clientName?: string;
}

/** A person's write in the app: the editor (`app`), a package they upload
 * (`upload`), or the managed configuration they apply (`managed`). */
export function appOrigin(
  userId: string,
  via: 'app' | 'upload' | 'managed' = 'app',
): WriteOrigin {
  return { actor: userId, via };
}

/** A coding agent's write over the MCP endpoint, made with the key holder's
 * key and named by the client the agent runs in. */
export function mcpOrigin(caller: {
  userId: string;
  apiKeyId?: string;
  clientName?: string;
}): WriteOrigin {
  return {
    actor: `api-key:${caller.userId}`,
    via: 'mcp',
    ...(caller.apiKeyId === undefined ? {} : { apiKeyId: caller.apiKeyId }),
    ...(caller.clientName === undefined
      ? {}
      : { clientName: caller.clientName }),
  };
}

/** A write made through the REST API with a key. A REST call names no
 * client. */
export function restOrigin(caller: {
  userId: string;
  apiKeyId?: string;
}): WriteOrigin {
  return {
    actor: `api-key:${caller.userId}`,
    via: 'rest',
    ...(caller.apiKeyId === undefined ? {} : { apiKeyId: caller.apiKeyId }),
  };
}

/** The platform installing the default packs every organization starts
 * with. */
export const PROVISIONING_ORIGIN: WriteOrigin = Object.freeze({
  actor: 'system:provisioning',
  via: 'system',
});

/**
 * The door of a version saved before doors were recorded, read from who
 * saved it: the platform for a `system:` writer; MCP for an API key, the
 * only door a key could save a version through then; the app for a person —
 * which an upload and managed configuration also recorded, so a reader shows
 * an inferred door as inferred.
 */
export function inferVia(createdBy: string): WriteVia {
  if (createdBy.startsWith('system:')) return 'system';
  return parseRunStarter(createdBy).kind === 'api-key' ? 'mcp' : 'app';
}

/**
 * The request channel a keyed door opens for one call: the origin's door in
 * the audit log's words, its key and client, and what only the request
 * knows (its id, the tool an agent called). Undefined for a door that opens
 * none — the app's own doors, whose definition writes name their door on
 * the audit row from the origin.
 */
export function requestChannelOf(
  origin: WriteOrigin,
  request: { requestId?: string; tool?: string },
): RequestChannel | undefined {
  const known = {
    ...(request.requestId === undefined
      ? {}
      : { requestId: request.requestId }),
    ...(origin.apiKeyId === undefined ? {} : { apiKeyId: origin.apiKeyId }),
  };
  if (origin.via === 'mcp') {
    return {
      via: 'mcp',
      ...known,
      ...(request.tool === undefined ? {} : { tool: request.tool }),
      ...(origin.clientName === undefined
        ? {}
        : { clientName: origin.clientName }),
    };
  }
  if (origin.via === 'rest') return { via: 'api-key', ...known };
  return undefined;
}
