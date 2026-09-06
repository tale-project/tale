/**
 * RelayState on the SP-initiated SAML flow: the org whose connection
 * validates the response, plus the flow-cookie hash that binds the response
 * to the browser that started it (`login/flow_cookie.ts`). An IdP-initiated
 * POST carries whatever the IdP admin configured — an org id at most — and
 * no binding.
 */

/** sha256 in base64url is always 43 characters. */
const FLOW_HASH = /^[A-Za-z0-9_-]{43}$/;

export function buildRelayState(
  organizationId: string,
  flowHash: string,
): string {
  return `${organizationId}.${flowHash}`;
}

export function parseRelayState(relayState: string | undefined): {
  organizationId: string | undefined;
  flowHash: string | undefined;
} {
  if (relayState === undefined || relayState === '') {
    return { organizationId: undefined, flowHash: undefined };
  }
  const dot = relayState.lastIndexOf('.');
  if (dot > 0) {
    const suffix = relayState.slice(dot + 1);
    if (FLOW_HASH.test(suffix)) {
      return { organizationId: relayState.slice(0, dot), flowHash: suffix };
    }
  }
  return { organizationId: relayState, flowHash: undefined };
}
