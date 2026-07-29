/**
 * Execution resolution — the documented case split deciding HOW a selected
 * (model, credential) pair may run. One exhaustive switch per discriminant,
 * in this one module; every caller (chat turn pipeline, sandbox session
 * setup, composer UI affordances) asks here and never re-derives the rules.
 *
 * The cases, by credential auth method × requested execution mode:
 *
 *  - `api-key` / `env` — the platform holds the secret and can mint a
 *    session-scoped gateway virtual key, so BOTH modes are allowed:
 *    `direct` runs the platform chat loop; `sandbox` runs the requested
 *    harness in managed posture (gateway VK). The harness must accept
 *    managed credentials (`credentialPolicy.managed` in its yml) — Cursor
 *    does not (its CLI cannot route through the gateway), so it refuses.
 *  - `subscription-key` / `subscription-broker` — a vendor subscription
 *    (a static coding-plan key, an OAuth blob, or a brokered rotating
 *    token) is only usable by the vendor's sanctioned CLI inside a sandbox,
 *    so `direct` is REFUSED with a reason naming the forced harness, and
 *    `sandbox` is REQUIRED to run that exact harness (requesting another
 *    refuses). The secret is injected into the session environment, i.e.
 *    bring-your-own posture — the forced harness must accept byo
 *    credentials (`credentialPolicy.byo`); OpenCode is managed-only and
 *    refuses.
 *
 * Sandbox with no harness selected is a refusal, not a guess: the caller
 * owns default-harness policy and passes a concrete slug (a subscription
 * credential is the one case that carries its own forced harness).
 *
 * Refusal reasons are user-facing API — actionable one-liners naming the
 * offending piece and the way out.
 *
 * Layer A: pure data in, pure data out — no `node:*`, no Convex imports.
 */

import type {
  ExecutionConstraints,
  HarnessDefinition,
  ModelCatalogEntry,
} from '../schemas/providers';

export type ExecutionMode = 'direct' | 'sandbox';

/**
 * The credential facts resolution needs: the auth method, plus — for the
 * subscription-flavored methods — the execution constraints their provider
 * declares. Mirrors the `auth` entry shape in `providers/<name>.yml`, keyed
 * by the credential-row field name `authMethod`.
 */
export type CredentialAuth =
  | { readonly authMethod: 'api-key' }
  | { readonly authMethod: 'env' }
  | {
      readonly authMethod: 'subscription-key';
      readonly constraints: ExecutionConstraints;
    }
  | {
      readonly authMethod: 'subscription-broker';
      readonly constraints: ExecutionConstraints;
    };

export interface ExecutionSelection {
  /** The user-picked catalog entry — never auto-selected. */
  readonly model: ModelCatalogEntry;
  readonly credential: CredentialAuth;
  readonly mode: ExecutionMode;
  /** The requested harness slug; required for sandbox mode unless the
   * credential forces one. */
  readonly harness?: string;
}

/** The loaded harness table, keyed by slug (`loadHarnesses()` output). */
export type HarnessTable = ReadonlyMap<string, HarnessDefinition>;

/** Key a loaded harness list by slug for {@link resolveExecution}. */
export function buildHarnessTable(
  harnesses: readonly HarnessDefinition[],
): HarnessTable {
  return new Map(harnesses.map((harness) => [harness.slug, harness]));
}

export type ExecutionResolution =
  | { readonly mode: 'direct' }
  | { readonly mode: 'sandbox'; readonly harness: HarnessDefinition }
  | { readonly mode: 'refused'; readonly reason: string };

function refused(reason: string): ExecutionResolution {
  return { mode: 'refused', reason };
}

/** The credential posture a sandbox harness must accept, per its yml. */
type SandboxPosture = 'managed' | 'byo';

function knownHarnessList(harnesses: HarnessTable): string {
  return [...harnesses.keys()].sort().join(', ');
}

/**
 * Validate that `slug` names a shipped harness able to run a credential of
 * the given posture; shared by both sandbox arms of the case split.
 */
function acceptSandboxHarness(
  slug: string,
  posture: SandboxPosture,
  harnesses: HarnessTable,
): ExecutionResolution {
  const harness = harnesses.get(slug);
  if (!harness) {
    return refused(
      `Unknown harness "${slug}" — available harnesses: ${knownHarnessList(harnesses)}.`,
    );
  }
  switch (posture) {
    case 'managed':
      if (!harness.credentialPolicy.managed) {
        return refused(
          `Harness "${slug}" cannot run platform-managed credentials (api-key/env): it only accepts bring-your-own credentials. Pick a different harness for this credential.`,
        );
      }
      return { mode: 'sandbox', harness };
    case 'byo':
      if (!harness.credentialPolicy.byo) {
        return refused(
          `Harness "${slug}" only runs platform-managed credentials and cannot use the subscription token this credential provides.`,
        );
      }
      return { mode: 'sandbox', harness };
    default: {
      const _exhaustive: never = posture;
      return _exhaustive;
    }
  }
}

/**
 * Resolve the execution of one selection per the case split documented
 * above. Total: every (authMethod × mode) combination returns a result;
 * unreachable arms are `never`-checked so a new auth method or mode fails
 * the build until its case is written here.
 */
export function resolveExecution(
  selection: ExecutionSelection,
  harnesses: HarnessTable,
): ExecutionResolution {
  const { model, credential, mode } = selection;
  switch (credential.authMethod) {
    case 'api-key':
    case 'env': {
      // The platform holds (or resolves) the secret and mints a session
      // gateway key, so both modes are open; sandbox runs managed.
      switch (mode) {
        case 'direct':
          return { mode: 'direct' };
        case 'sandbox': {
          if (!selection.harness) {
            return refused(
              `Sandbox execution needs a harness for model "${model.id}" — select one of: ${knownHarnessList(harnesses)}.`,
            );
          }
          return acceptSandboxHarness(selection.harness, 'managed', harnesses);
        }
        default: {
          const _exhaustive: never = mode;
          return _exhaustive;
        }
      }
    }
    case 'subscription-key':
    case 'subscription-broker': {
      // A vendor subscription — static plan key, OAuth blob, or brokered
      // rotating token — only works inside the vendor's sanctioned CLI, so
      // the credential forces sandbox execution on one harness and rides
      // the session environment (byo posture).
      const forced = credential.constraints.harness;
      switch (mode) {
        case 'direct':
          return refused(
            `Model "${model.id}" is selected with a subscription credential that cannot run in direct chat — it only works in a sandbox with the "${forced}" harness. Switch to sandbox execution, or pick an api-key or env credential.`,
          );
        case 'sandbox': {
          if (selection.harness !== undefined && selection.harness !== forced) {
            return refused(
              `This subscription credential only runs on the "${forced}" harness; "${selection.harness}" cannot use it. Select "${forced}", or pick an api-key or env credential.`,
            );
          }
          return acceptSandboxHarness(forced, 'byo', harnesses);
        }
        default: {
          const _exhaustive: never = mode;
          return _exhaustive;
        }
      }
    }
    default: {
      const _exhaustive: never = credential;
      return _exhaustive;
    }
  }
}
