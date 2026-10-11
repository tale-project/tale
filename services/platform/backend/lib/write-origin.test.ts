// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { channelAuditMetadata } from './request-channel.ts';
import {
  appOrigin,
  inferVia,
  mcpOrigin,
  PROVISIONING_ORIGIN,
  requestChannelOf,
  restOrigin,
  WRITE_VIAS,
} from './write-origin.ts';

describe('the doors a definition write comes through', () => {
  it('are the six the version history publishes', () => {
    expect([...WRITE_VIAS]).toEqual([
      'app',
      'upload',
      'mcp',
      'rest',
      'managed',
      'system',
    ]);
  });

  it('name a person in the app by their id, through the door they used', () => {
    expect(appOrigin('user_ada')).toEqual({ actor: 'user_ada', via: 'app' });
    expect(appOrigin('user_ada', 'upload')).toEqual({
      actor: 'user_ada',
      via: 'upload',
    });
    expect(appOrigin('user_ada', 'managed')).toEqual({
      actor: 'user_ada',
      via: 'managed',
    });
  });

  it('name a keyed write as the key holder through their key, with the client an agent named', () => {
    expect(
      mcpOrigin({
        userId: 'user_ada',
        apiKeyId: 'key_1',
        clientName: 'Claude Code',
      }),
    ).toEqual({
      actor: 'api-key:user_ada',
      via: 'mcp',
      apiKeyId: 'key_1',
      clientName: 'Claude Code',
    });
    expect(mcpOrigin({ userId: 'user_ada' })).toEqual({
      actor: 'api-key:user_ada',
      via: 'mcp',
    });
    expect(restOrigin({ userId: 'user_ada', apiKeyId: 'key_1' })).toEqual({
      actor: 'api-key:user_ada',
      via: 'rest',
      apiKeyId: 'key_1',
    });
  });

  it('name the default packs as the platform', () => {
    expect(PROVISIONING_ORIGIN).toEqual({
      actor: 'system:provisioning',
      via: 'system',
    });
  });

  it.each([
    ['user_ada', 'app'],
    ['user:user_ada', 'app'],
    ['api-key:user_ada', 'mcp'],
    ['system:provisioning', 'system'],
  ] as const)(
    'read the door of a version saved before doors were recorded from its writer %s',
    (createdBy, via) => {
      expect(inferVia(createdBy)).toBe(via);
    },
  );
});

describe('the request channel a keyed door opens', () => {
  it('is the MCP door with the tool, the key and the client the version keeps', () => {
    const origin = mcpOrigin({
      userId: 'user_ada',
      apiKeyId: 'key_1',
      clientName: 'Claude Code',
    });
    const channel = requestChannelOf(origin, {
      requestId: 'req_1',
      tool: 'save_automation',
    });
    expect(channel).toEqual({
      via: 'mcp',
      requestId: 'req_1',
      tool: 'save_automation',
      apiKeyId: 'key_1',
      clientName: 'Claude Code',
    });
    // What the channel stamps on the call's audit rows names the key and
    // the client the version records.
    expect(channel && channelAuditMetadata(channel)).toEqual({
      via: 'mcp',
      tool: 'save_automation',
      apiKeyId: origin.apiKeyId,
      clientName: origin.clientName,
    });
  });

  it("is the REST door in the audit log's own word, with the key and the request", () => {
    expect(
      requestChannelOf(restOrigin({ userId: 'user_ada', apiKeyId: 'key_1' }), {
        requestId: 'req_2',
      }),
    ).toEqual({ via: 'api-key', requestId: 'req_2', apiKeyId: 'key_1' });
  });

  it.each([
    appOrigin('user_ada'),
    appOrigin('user_ada', 'upload'),
    appOrigin('user_ada', 'managed'),
    PROVISIONING_ORIGIN,
  ])('is not opened for the $via door', (origin) => {
    expect(requestChannelOf(origin, { requestId: 'req_3' })).toBeUndefined();
  });
});
