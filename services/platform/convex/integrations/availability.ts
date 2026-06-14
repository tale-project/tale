/**
 * Canonical integration-availability contract.
 *
 * Two ORTHOGONAL conditions gate whether the sandbox agent can use an
 * integration, and they can be false SIMULTANEOUSLY (an integration can be
 * both not-bound-to-the-agent AND not-configured at once):
 *
 *   - boundToAgent    — slug ∈ the agent's integrationBindings (the session grant set)
 *   - credentialActive — a credential row exists with isActive && status==='active'
 *
 * `computeAvailability` never short-circuits on the first failing condition: it
 * returns EVERY blocker so the model can tell the user all the fixes in one
 * message (e.g. "enable it for this agent AND connect a credential") rather than
 * one round-trip at a time.
 *
 * This module is intentionally pure (no Convex / Node / auth imports) so it is
 * the single source of truth shared by the dispatch httpAction and the
 * `integration_status` tool — the two surfaces compute blockers identically and
 * cannot drift — and so it is unit-testable in isolation.
 */

/** Why an integration cannot be used right now. */
export type IntegrationBlockerReason =
  | 'unknown' // no integration with this slug exists for the org
  | 'not_bound' // exists, but not in the agent's integrationBindings
  | 'not_configured' // bound, but no credential connected
  | 'credential_invalid'; // bound + a credential row exists, but it is not active

export interface IntegrationBlocker {
  reason: IntegrationBlockerReason;
  /** Human-relayable instruction the model passes to the user verbatim. */
  guidance: string;
  /** Where the user connects the credential (omitted for `not_bound`/`unknown`). */
  connectUrl?: string;
}

/** The canonical per-integration availability model. `blockers` empty ⇒ usable. */
export interface IntegrationAvailability {
  slug: string;
  title: string;
  exists: boolean;
  boundToAgent: boolean;
  credentialActive: boolean;
  blockers: IntegrationBlocker[];
  connectUrl: string;
}

export type CredentialStatus = 'active' | 'inactive' | 'error' | 'testing';

/** The credential row's gate-relevant fields, or `null` when no row exists. */
export interface CredentialStatusInput {
  isActive: boolean;
  status: CredentialStatus;
}

export interface ComputeAvailabilityInput {
  slug: string;
  organizationId: string;
  /** Integration config title; falls back to slug when unknown. */
  title?: string;
  /** Whether the integration definition (config.json) exists for the org. */
  exists: boolean;
  /** Whether slug is in the agent's integrationBindings (the session grant set). */
  boundToAgent: boolean;
  /** The credential row's status, or `null` if no row exists. */
  credential: CredentialStatusInput | null;
}

/**
 * Canonical client-route deep-link to connect/manage an integration's
 * credential. Mirrors `openIntegrations()` in composer-mode-menu.tsx; there is
 * no shared server-side route builder, so this is the canonical one.
 */
export function buildConnectUrl(organizationId: string, slug: string): string {
  const params = new URLSearchParams({ tab: 'all', slug });
  return `/dashboard/${organizationId}/settings/integrations?${params.toString()}`;
}

/**
 * Compute the canonical availability of one integration from raw inputs.
 * Reports ALL applicable blockers (never short-circuits) so co-occurring
 * states (not_bound + not_configured) both surface.
 */
export function computeAvailability(
  input: ComputeAvailabilityInput,
): IntegrationAvailability {
  const { slug, organizationId, exists, boundToAgent, credential } = input;
  const title = input.title ?? slug;
  const connectUrl = buildConnectUrl(organizationId, slug);
  const credentialActive =
    credential !== null &&
    credential.isActive &&
    credential.status === 'active';

  const blockers: IntegrationBlocker[] = [];

  // Unknown integration: nothing else is actionable, so report only this.
  if (!exists) {
    blockers.push({
      reason: 'unknown',
      guidance: `No integration named "${slug}" exists for this organization. Call integration_status to see the available integrations.`,
    });
    return {
      slug,
      title,
      exists,
      boundToAgent,
      credentialActive,
      blockers,
      connectUrl,
    };
  }

  // The two conditions are orthogonal and may both fail — report both.
  if (!boundToAgent) {
    blockers.push({
      reason: 'not_bound',
      guidance: `"${title}" is not enabled for this agent. Ask the user to add "${slug}" to this agent's integrations in the agent settings.`,
    });
  }
  if (!credentialActive) {
    const reason: IntegrationBlockerReason =
      credential === null ? 'not_configured' : 'credential_invalid';
    const guidance =
      credential === null
        ? `"${title}" has no connected credential. Ask the user to connect it at the integrations settings page.`
        : `"${title}"'s credential is not active (status: ${credential.status}). Ask the user to reconnect it.`;
    blockers.push({ reason, guidance, connectUrl });
  }

  return {
    slug,
    title,
    exists,
    boundToAgent,
    credentialActive,
    blockers,
    connectUrl,
  };
}

/** An integration is usable iff it has no blockers. */
export function isUsable(availability: IntegrationAvailability): boolean {
  return availability.blockers.length === 0;
}
