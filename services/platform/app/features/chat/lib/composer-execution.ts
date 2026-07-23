/**
 * What the composer may offer for one (model, credential) pair.
 *
 * The rules live in `resolveExecution` — a credential whose auth method binds
 * it to a vendor's own tooling forces sandbox execution on one harness — and
 * they are NOT restated here. The composer asks the resolver whether a direct
 * turn is possible and turns the answer into an affordance: an unlocked
 * sandbox toggle, or one locked ON with the harness it is bound to.
 *
 * The resolver's refusal text is backend prose in one language, so it never
 * reaches the screen: the affordance carries the harness slug and the UI
 * renders a localized sentence around it.
 */

import {
  resolveExecution,
  type CredentialAuth,
} from '@/lib/shared/providers/resolve_execution';
import type { ModelCatalogEntry } from '@/lib/shared/schemas/providers';

/**
 * The direct arm of the case split never reads the harness table — it either
 * allows a direct turn or refuses one with the credential's forced harness —
 * so the composer resolves against an empty table.
 */
const NO_HARNESSES = new Map<string, never>();

export interface SandboxAffordance {
  /** The sandbox toggle is forced on and cannot be switched off. */
  readonly locked: boolean;
  /** The harness a locked sandbox runs, for the explanation shown to the user. */
  readonly harness?: string;
}

/**
 * Resolve the composer's sandbox toggle for the selected model and the
 * credential that would serve it.
 */
export function resolveSandboxAffordance(
  model: ModelCatalogEntry,
  credential: CredentialAuth,
): SandboxAffordance {
  const resolution = resolveExecution(
    { model, credential, mode: 'direct' },
    NO_HARNESSES,
  );
  if (resolution.mode !== 'refused') return { locked: false };
  return {
    locked: true,
    harness:
      credential.authMethod === 'subscription-key' ||
      credential.authMethod === 'subscription-broker'
        ? credential.constraints.harness
        : undefined,
  };
}
