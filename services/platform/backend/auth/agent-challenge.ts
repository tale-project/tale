import { MCP_RESOURCE_SCOPES } from '../../lib/shared/agent-access.ts';
import { mcpResourceFor, protectedResourceMetadataUrl } from './agent-oauth.ts';

/**
 * The `WWW-Authenticate` challenge the MCP endpoint answers with when it
 * lets coding agents sign in: where the endpoint's metadata is (RFC 9728,
 * which tells an agent which server to sign in with) and the scopes to ask
 * for, so an agent that arrives with nothing — or with something refused —
 * learns how to get in. The scope list is every scope the endpoint takes,
 * on purpose: the consent page narrows it to what the person allows.
 */

export interface McpChallengeOptions {
  /** Why a credential that was presented is refused (RFC 6750 §3):
   * `invalid_token`, or `insufficient_scope` when it is good but holds too
   * little. Left out for a request that presented nothing. */
  readonly error?: 'invalid_token' | 'insufficient_scope';
  /** A sentence for a person to read; fixed text, never a caller's. */
  readonly description?: string;
  /** The scopes to ask for, when not every scope the endpoint takes. */
  readonly scope?: readonly string[];
}

/** A value fit for a quoted challenge parameter: printable ASCII with no
 * quote and no backslash (RFC 6750 §3), so nothing a caller chose can break
 * out of the header. */
function quotable(value: string): string {
  return value.replaceAll(/[^\x20\x21\x23-\x5b\x5d-\x7e]/g, '');
}

export function mcpChallenge(
  request: Request,
  options: McpChallengeOptions = {},
): string {
  const parts = [
    ...(options.error === undefined ? [] : [`error="${options.error}"`]),
    ...(options.description === undefined
      ? []
      : [`error_description="${quotable(options.description)}"`]),
    `resource_metadata="${protectedResourceMetadataUrl(mcpResourceFor(request))}"`,
    `scope="${(options.scope ?? MCP_RESOURCE_SCOPES).join(' ')}"`,
  ];
  return `Bearer ${parts.join(', ')}`;
}
