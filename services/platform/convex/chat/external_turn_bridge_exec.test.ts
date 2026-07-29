// The exec side of the connectors bridge: an external-agent exec mounts the
// in-image `tale-connectors-mcp` server exactly when the turn passes a
// bridgeUrl (i.e. the agent is equipped with at least one connector), and the
// bridge env carries the platform URL + the session key. Uses the real
// harness glue + shipped YAML, so a dialect change that drops the bridge
// fails here.

import { describe, expect, it } from 'vitest';

import {
  buildExternalTurnExec,
  connectorsBridgeUrlForSessions,
} from './external_turn_shared';

const BASE = {
  harness: 'claude-code',
  gatewayModel: 'deepseek-chat',
  serving: { kind: 'gateway' as const, token: 'sk-bf-test-token' },
  instructions: '',
  prompt: 'hello',
  execId: 'exec_1',
};

describe('connectorsBridgeUrlForSessions', () => {
  it('rides the sandbox-reachable platform origin with the route prefix', () => {
    // No env override in the test process — the documented default applies.
    expect(connectorsBridgeUrlForSessions()).toBe(
      'http://convex:3211/api/connectors',
    );
  });
});

describe('buildExternalTurnExec — connectors bridge mount', () => {
  it('mounts the bridge with URL + session key when a bridgeUrl is passed', () => {
    const exec = buildExternalTurnExec({
      ...BASE,
      bridgeUrl: 'http://convex:3211/api/connectors',
    });
    const flat = JSON.stringify(exec);
    expect(flat).toContain('tale-connectors-mcp');
    expect(flat).toContain('http://convex:3211/api/connectors');
    expect(flat).toContain('sk-bf-test-token');
  });

  it('mounts no bridge for an unequipped turn', () => {
    const exec = buildExternalTurnExec(BASE);
    expect(JSON.stringify(exec)).not.toContain('tale-connectors-mcp');
  });
});
