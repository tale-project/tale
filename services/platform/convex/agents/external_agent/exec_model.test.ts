import { describe, expect, it, vi } from 'vitest';

import { resolveExternalAgentExecModel } from './exec_model';

// Stand-in for resolveGatewayRoutingFromRef(...).gatewayModel — the real one
// lives in a 'use node' module. Shape matches (`slug:model` → `slug/model`).
const toGatewayModel = (ref: string) => ref.replace(':', '/');

describe('resolveExternalAgentExecModel', () => {
  it("REGRESSION GUARD: 'default' resolves to undefined for every auth mode", () => {
    // Env-managed agents (Cursor, supportedModels: []) send modelRef 'default'
    // on every chat turn. Routing that through the gateway mapper minted the
    // invalid `default__default/default`, which the Cursor CLI rejects with
    // exit 1 — the turn died before its first event. The sentinel must mean
    // "omit --model" regardless of mode.
    for (const [byo, gatewayRun] of [
      [false, false],
      [false, true],
      [true, false],
    ] as const) {
      const gw = vi.fn(toGatewayModel);
      expect(
        resolveExternalAgentExecModel({
          byo,
          gatewayRun,
          modelRef: 'default',
          toGatewayModel: gw,
        }),
      ).toBeUndefined();
      expect(gw).not.toHaveBeenCalled();
    }
  });

  it('resolves an empty ref to undefined', () => {
    expect(
      resolveExternalAgentExecModel({
        byo: false,
        gatewayRun: true,
        modelRef: '',
        toGatewayModel,
      }),
    ).toBeUndefined();
  });

  it('gateway-managed: maps the Tale ref to the gateway model id', () => {
    expect(
      resolveExternalAgentExecModel({
        byo: false,
        gatewayRun: true,
        modelRef: 'openrouter:anthropic/claude-sonnet-4-6',
        toGatewayModel,
      }),
    ).toBe('openrouter/anthropic/claude-sonnet-4-6');
  });

  it('env-managed: passes the raw ref through without touching the gateway mapper', () => {
    const gw = vi.fn(toGatewayModel);
    expect(
      resolveExternalAgentExecModel({
        byo: false,
        gatewayRun: false,
        modelRef: 'composer-2.5',
        toGatewayModel: gw,
      }),
    ).toBe('composer-2.5');
    expect(gw).not.toHaveBeenCalled();
  });

  it('BYO: prefers the catalog vendor-native id, falls back to the raw ref', () => {
    expect(
      resolveExternalAgentExecModel({
        byo: true,
        gatewayRun: false,
        modelRef: 'openrouter:anthropic/claude-opus-4-8',
        byoNativeModel: 'claude-opus-4-8',
        toGatewayModel,
      }),
    ).toBe('claude-opus-4-8');
    expect(
      resolveExternalAgentExecModel({
        byo: true,
        gatewayRun: false,
        modelRef: 'my-custom-model',
        toGatewayModel,
      }),
    ).toBe('my-custom-model');
  });
});
