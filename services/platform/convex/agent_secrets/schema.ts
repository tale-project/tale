import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { encryptedSecretValidator } from '../connector_credentials/schema';

/**
 * Agent secrets — org-owned, named credentials handed to an agent's sandbox
 * turn as ENVIRONMENT VARIABLES. The escape hatch below the connector catalog:
 * when a service has no shipped connector (a GlitchTip token, a bespoke
 * internal API key), the operator stores a scoped token here and equips an
 * agent with it by NAME; the agent reads the vendor's own docs and calls the
 * API directly over the sandbox's egress.
 *
 * The row `name` IS the environment variable name (validated
 * `^[A-Za-z_][A-Za-z0-9_]*$`), unique per organization, so an agent's
 * `secrets: string[]` is just the list of names to inject. Secret material
 * never leaves `'use node'` code: this row exposes only a write-time
 * `maskedPreview` and the `description`; plaintext is reachable only through
 * `resolve.ts`, exactly like `connectorCredentials`. Injection is PER-EXEC
 * (merged into the turn's exec env under the harness's own keys) and audited
 * in `sandboxCredentialAccess` — it dies with the exec, so ungranting or
 * deleting a secret revokes it from the next turn with no residue.
 *
 * Deliberately NOT on the agent row and NOT per-user: the same scoped token is
 * reused across a project agent and an automation node, rotated in one place;
 * and the work lanes' sessions have no user, so a per-user store (the separate
 * `sandboxUserEnv`, for a person's own BYO box) cannot serve them.
 */
export const agentSecretsTable = defineTable({
  organizationId: v.string(),
  /** The environment variable name the value is injected as — unique per org,
   * validated `^[A-Za-z_][A-Za-z0-9_]*$`. */
  name: v.string(),
  /** Operator note on what the secret is for (shown in the manager, and — for
   * granted secrets — surfaced to the agent so it knows the env var exists and
   * its purpose). Never secret. */
  description: v.optional(v.string()),
  /** The token/key, AES-256-GCM via `lib/secret_box.ts` — the same envelope
   * connector credentials use. */
  encryptedValue: encryptedSecretValidator,
  /** Non-secret display hint computed at write time (e.g. `ghp_••••b3f`), so
   * listings never touch ciphertext. Absent when too short to mask safely. */
  maskedPreview: v.optional(v.string()),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  updatedBy: v.string(),
})
  .index('by_org', ['organizationId'])
  .index('by_org_name', ['organizationId', 'name']);
