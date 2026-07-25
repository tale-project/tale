// The exec side of the integrations bridge: an external-agent exec mounts the
// in-image `tale-integrations-mcp` server exactly when the turn passes a
// bridgeUrl (i.e. the agent is equipped with at least one connector), and the
// bridge env carries the platform URL + the session key. Uses the real
// harness glue + shipped YAML, so a dialect change that drops the bridge
// fails here.

import { describe, expect, it } from 'vitest';

import {
  buildExternalTurnExec,
  integrationsBridgeUrlForSessions,
} from './external_turn_shared';

const BASE = {
  harness: 'claude-code',
  gatewayModel: 'deepseek-chat',
  gatewayToken: 'sk-bf-test-token',
  instructions: '',
  prompt: 'hello',
  execId: 'exec_1',
};

describe('integrationsBridgeUrlForSessions', () => {
  it('rides the sandbox-reachable platform origin with the route prefix', () => {
    // No env override in the test process — the documented default applies.
    expect(integrationsBridgeUrlForSessions()).toBe(
      'http://convex:3211/api/integrations',
    );
  });
});

describe('buildExternalTurnExec — integrations bridge mount', () => {
  it('mounts the bridge with URL + session key when a bridgeUrl is passed', () => {
    const exec = buildExternalTurnExec({
      ...BASE,
      bridgeUrl: 'http://convex:3211/api/integrations',
    });
    const flat = JSON.stringify(exec);
    expect(flat).toContain('tale-integrations-mcp');
    expect(flat).toContain('http://convex:3211/api/integrations');
    expect(flat).toContain('sk-bf-test-token');
  });

  it('mounts no bridge for an unequipped turn', () => {
    const exec = buildExternalTurnExec(BASE);
    expect(JSON.stringify(exec)).not.toContain('tale-integrations-mcp');
  });
});
