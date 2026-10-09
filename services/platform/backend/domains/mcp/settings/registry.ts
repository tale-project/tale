/**
 * The settings registry: one handler per settings kind, registered beside
 * the native writer it calls, and the contract the MCP settings tools drive
 * every handler through.
 *
 * A handler reads through its kind's native read path and writes through
 * its native writer, so the role checks, locks, audit rows and side effects
 * stay where the app's own screens meet them. The registry adds only what
 * every kind shares — a resource's address, compare-and-set, masking, the
 * plan and the apply order — and never decides who may change what.
 */

import type {
  SettingsEffect,
  SettingsKind,
} from '@tale/shared/schemas/settings-kinds';
import type { Sql } from 'postgres';

import type { McpCaller } from '../caller.ts';

/** Whom a settings call acts as, and where. */
export interface SettingsContext {
  readonly sql: Sql;
  readonly caller: McpCaller;
}

/** One resource as its kind's native read answers it. */
export interface SettingsResource {
  /** Its identity within its kind; null for a kind with one resource per
   * organization or deployment. */
  readonly id: string | null;
  /** What is stored, secrets included: the registry masks every secret
   * path before anything leaves. */
  readonly config: unknown;
  /** The native revision its writer checks — what a change names as the
   * hash it expects. */
  readonly hash: string;
}

export type SettingsOperation = 'set' | 'delete' | 'act';

/** One change as a call names it. */
export interface SettingsChange {
  readonly kind: SettingsKind;
  readonly id?: string;
  readonly op: SettingsOperation;
  /** The whole config the resource holds afterwards (`set`). */
  readonly config?: unknown;
  /** The one-shot action (`act`): one of the kind's `acts`. */
  readonly act?: string;
  readonly args?: unknown;
}

/** What a kind says one change would do, before anything is written. */
export interface HandlerPlan {
  /** The config the resource would hold afterwards, as its native writer
   * would store it; left out by an act that changes no config. */
  readonly after?: unknown;
  /** The stored resource already is what the change asks for: applying it
   * writes nothing. */
  readonly unchanged?: boolean;
  /** What the change does beyond replacing a value. */
  readonly effects?: readonly SettingsEffect[];
}

/** What the caller's role lets them do with a kind, as the app's own
 * screens decide it. Advisory: the native writer stays the authority. */
export interface SettingsAccess {
  readonly read: boolean;
  readonly write: boolean;
}

/** One page of a kind's resources. */
export interface SettingsPage {
  readonly items: readonly SettingsResource[];
  /** Where the next page starts; null or absent on the last one. */
  readonly nextCursor?: string | null;
}

export interface SettingsKindHandler {
  readonly kind: SettingsKind;
  /** What the caller may do with the kind, read through the same gates
   * the kind's writers apply — some need the database (who is an admin
   * anywhere, the caller's address for an allowlist). */
  access(ctx: SettingsContext): Promise<SettingsAccess>;
  /** The id a change names — its `id`, or the one its config carries; null
   * for a kind with a single resource. Throws a coded refusal when the
   * change names none. */
  identify(change: SettingsChange): string | null;
  /** The resources the caller may read, through the native read path and
   * its gate. */
  list(
    ctx: SettingsContext,
    query: { readonly ids?: readonly string[]; readonly cursor?: string },
  ): Promise<SettingsPage>;
  /** One resource, or null when there is none. */
  read(
    ctx: SettingsContext,
    id: string | null,
  ): Promise<SettingsResource | null>;
  /** What the change would do to what is stored: the kind's own validation,
   * its effects, whether it already is so. Writes nothing; throws a coded
   * refusal. */
  plan(
    ctx: SettingsContext,
    change: SettingsChange,
    current: SettingsResource | null,
  ): Promise<HandlerPlan>;
  /** Make the change through the native writer, which checks
   * `expectedHash` under its own lock. Answers the hash afterwards (null
   * once removed); throws the writer's coded refusals. */
  apply(
    ctx: SettingsContext,
    change: SettingsChange,
    expectedHash: string | null,
  ): Promise<{ readonly hash: string | null }>;
}

/** The kinds a deployment serves over MCP, by kind (`handlers.ts`). A kind
 * the shared descriptors name without a handler here is answered as not
 * available on the deployment. */
export type SettingsRegistry = Readonly<
  Partial<Record<SettingsKind, SettingsKindHandler>>
>;

/** A resource's address in a call — the key `expected` names it by: its
 * kind, then its id when it has one, the form a declaration's resource id
 * takes. */
export function settingsKey(kind: SettingsKind, id: string | null): string {
  return id === null ? kind : `${kind}/${id}`;
}
