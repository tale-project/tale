import { describe, expect, it } from 'vitest';

import { buildRelayState, parseRelayState } from './relay_state';

const HASH = 'A'.repeat(43);

describe('SAML RelayState', () => {
  it('round-trips an org id and a flow hash', () => {
    expect(parseRelayState(buildRelayState('org-1', HASH))).toEqual({
      organizationId: 'org-1',
      flowHash: HASH,
    });
  });

  it('reads a bare org id (IdP-initiated) as unbound', () => {
    expect(parseRelayState('org-1')).toEqual({
      organizationId: 'org-1',
      flowHash: undefined,
    });
    expect(parseRelayState('acme.example')).toEqual({
      organizationId: 'acme.example',
      flowHash: undefined,
    });
  });

  it('reads no RelayState as no org and no binding', () => {
    expect(parseRelayState(undefined)).toEqual({
      organizationId: undefined,
      flowHash: undefined,
    });
    expect(parseRelayState('')).toEqual({
      organizationId: undefined,
      flowHash: undefined,
    });
  });
});
