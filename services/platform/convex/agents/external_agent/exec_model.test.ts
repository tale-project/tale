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

  it("REGRESSION GUARD: BYO hermes ('catalog' dialect) requests the OpenRouter id, never the vendor-native one", () => {
    // Hermes BYO authenticates with OPENROUTER_API_KEY, and OpenRouter speaks
    // the catalog's vendor-prefixed ids. The slug-agnostic resolution used to
    // return the Anthropic-native `claude-sonnet-4-6`, which OpenRouter
    // rejects — the turn died on the first model call.
    expect(
      resolveExternalAgentExecModel({
        byo: true,
        gatewayRun: false,
        modelRef: 'openrouter:anthropic/claude-sonnet-4.6',
        byoModelIdSource: 'catalog',
        byoNativeModel: 'claude-sonnet-4-6',
        byoCatalogModel: 'anthropic/claude-sonnet-4.6',
        toGatewayModel,
      }),
    ).toBe('anthropic/claude-sonnet-4.6');
  });

  it("BYO 'catalog' dialect: a raw user-typed id (no catalog match) passes through unchanged", () => {
    expect(
      resolveExternalAgentExecModel({
        byo: true,
        gatewayRun: false,
        modelRef: 'nousresearch/hermes-4-405b',
        byoModelIdSource: 'catalog',
        toGatewayModel,
      }),
    ).toBe('nousresearch/hermes-4-405b');
  });

  it("BYO gemini ('vendor-native' dialect) requests the Google-native id for a catalog-shaped ref", () => {
    // Gemini BYO authenticates with GEMINI_API_KEY against Google's own API,
    // which knows `gemini-3.1-pro-preview` — not the shipped catalog ref's
    // gateway spelling. Guards the catalog entries' `nativeModelId`.
    expect(
      resolveExternalAgentExecModel({
        byo: true,
        gatewayRun: false,
        modelRef: 'openrouter:google/gemini-3.1-pro-preview',
        byoModelIdSource: 'vendor-native',
        byoNativeModel: 'gemini-3.1-pro-preview',
        byoCatalogModel: 'google/gemini-3.1-pro-preview',
        toGatewayModel,
      }),
    ).toBe('gemini-3.1-pro-preview');
  });

  it("BYO openclaw ('catalog' dialect) requests the catalog id for a catalog-shaped ref", () => {
    // OpenClaw's own refs are `vendor/model` — the catalog id's exact grammar
    // — so a catalog-shaped BYO ref maps to the catalog id; a raw user-typed
    // ref (the normal BYO case) passes through unchanged.
    expect(
      resolveExternalAgentExecModel({
        byo: true,
        gatewayRun: false,
        modelRef: 'openrouter:anthropic/claude-sonnet-4.6',
        byoModelIdSource: 'catalog',
        byoNativeModel: 'claude-sonnet-4-6',
        byoCatalogModel: 'anthropic/claude-sonnet-4.6',
        toGatewayModel,
      }),
    ).toBe('anthropic/claude-sonnet-4.6');
  });
});
