import { describe, expect, it } from 'vitest';

import { modelRelayUrlForSessions } from './model-relay-url';

/**
 * A session is handed the relay under the name every process that serves the
 * API answers in the sandbox network, in either colour of a deployment
 * (tale-project/tale#4942). Never a colour's own name: a turn goes on after
 * the colour that started it is removed, a session's NO_PROXY exempts
 * `backend-api` alone, and a connected device answers only the names it
 * joined with.
 */
describe('modelRelayUrlForSessions', () => {
  it('names the relay by the name both colours answer [RELAY-R12]', () => {
    expect(modelRelayUrlForSessions({})).toBe('http://backend-api:8080');
  });

  it('never names the colour of the process that starts the turn [RELAY-R12]', () => {
    for (const colour of ['blue', 'green']) {
      expect(modelRelayUrlForSessions({ TALE_COLOR: colour })).toBe(
        'http://backend-api:8080',
      );
    }
  });

  it('takes the address an operator names, without a trailing slash', () => {
    expect(
      modelRelayUrlForSessions({
        EXTERNAL_AGENT_GATEWAY_URL: ' http://relay.example:9000/ ',
      }),
    ).toBe('http://relay.example:9000');
  });

  it('reads a blank address as none', () => {
    expect(
      modelRelayUrlForSessions({ EXTERNAL_AGENT_GATEWAY_URL: '   ' }),
    ).toBe('http://backend-api:8080');
  });
});
