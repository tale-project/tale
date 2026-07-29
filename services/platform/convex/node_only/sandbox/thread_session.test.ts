// armVisionLane contract: mints a vision-only gateway key for a chat run_code
// session and injects the TALE_* env triplet — best-effort (never throws into
// session creation), token row inserted BEFORE the env patch so teardown can
// always revoke. Gateway + session wire mocked at the same seams as
// session_exec.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../_generated/server';

const sessionEnvPatch = vi.fn();

vi.mock('./helpers/session_client', () => ({
  sessionCreate: vi.fn(),
  sessionDestroy: vi.fn(),
  sessionEnvPatch: (...args: unknown[]) => sessionEnvPatch(...args),
  sessionIsAlive: vi.fn(),
}));

const applyGatewayConfig = vi.fn();
const hashVirtualKey = vi.fn();
const mintVirtualKey = vi.fn();
const provisionProviders = vi.fn();

vi.mock('./llm_gateway_admin', async (importOriginal) => {
  const original = await importOriginal<typeof import('./llm_gateway_admin')>();
  return {
    // resolveGatewayRouting stays real: it is a pure mapping and the
    // env-triplet assertion should pin its actual output.
    resolveGatewayRouting: original.resolveGatewayRouting,
    applyGatewayConfig: (...args: unknown[]) => applyGatewayConfig(...args),
    hashVirtualKey: (...args: unknown[]) => hashVirtualKey(...args),
    mintVirtualKey: (...args: unknown[]) => mintVirtualKey(...args),
    provisionProviders: (...args: unknown[]) => provisionProviders(...args),
  };
});

const resolveOrgVisionModel = vi.fn();

vi.mock('../../lib/providers/resolve_vision_model', () => ({
  resolveOrgVisionModel: (...args: unknown[]) => resolveOrgVisionModel(...args),
}));

const buildProviderProvision = vi.fn();

vi.mock('./gateway_provisioning', () => ({
  buildProviderProvision: (...args: unknown[]) =>
    buildProviderProvision(...args),
}));

import { armVisionLane } from './thread_session';

const ARGS = {
  organizationId: 'org_1',
  threadId: 'thr_1',
  sessionId: 'thr-thr_1',
};

const makeCtx = () => {
  const runMutation = vi.fn().mockResolvedValue('row_1');
  const ctx = { runMutation } as unknown as ActionCtx;
  return { ctx, runMutation };
};

const armHappyMocks = () => {
  resolveOrgVisionModel.mockResolvedValue({
    providerSlug: 'openrouter',
    modelId: 'qwen/qwen-vl-max',
  });
  buildProviderProvision.mockResolvedValue({
    name: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiFormat: 'openai',
    apiKey: 'sk-live',
    models: ['qwen/qwen-vl-max'],
  });
  provisionProviders.mockResolvedValue(undefined);
  applyGatewayConfig.mockResolvedValue(undefined);
  mintVirtualKey.mockResolvedValue({ key: 'sk-bf-test-key', keyId: 'vk_1' });
  hashVirtualKey.mockReturnValue('hash-of-key');
  sessionEnvPatch.mockResolvedValue([]);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('armVisionLane', () => {
  it('mints a vision-only key, inserts the token row, then patches env', async () => {
    armHappyMocks();
    const { ctx, runMutation } = makeCtx();

    await armVisionLane(ctx, ARGS);

    // Provisioning ran before the mint (mint fails closed without it).
    expect(buildProviderProvision).toHaveBeenCalledWith(ctx, {
      organizationId: 'org_1',
      providerSlug: 'openrouter',
    });
    expect(provisionProviders).toHaveBeenCalledWith('org_1', [
      expect.objectContaining({ name: 'openrouter' }),
    ]);
    expect(applyGatewayConfig).toHaveBeenCalledTimes(1);

    // The key allows exactly the resolved vision model, on the small budget.
    expect(mintVirtualKey).toHaveBeenCalledWith({
      budgetCents: 200,
      allowedModels: [
        { providerSlug: 'openrouter', modelId: 'qwen/qwen-vl-max' },
      ],
      organizationId: 'org_1',
      sessionId: 'thr-thr_1',
    });

    // Token row: hash only, gateway key id for teardown revoke, scoped shape.
    // (Which mutation the ref points at is typechecked; Convex api refs are
    // per-access proxies, so identity assertions are meaningless here.)
    expect(runMutation).toHaveBeenCalledTimes(1);
    const [, mutationArgs] = runMutation.mock.calls[0] as [
      unknown,
      {
        organizationId: string;
        sessionId: string;
        tokenHash: string;
        llmGatewayKeyId: string;
        scope: {
          agentKind: string;
          allowedModels: string[];
          connectorGrants: string[];
          toolGrants: string[];
          budgetCents: number;
          threadId: string;
        };
        expiresAt: number;
      },
    ];
    expect(mutationArgs.tokenHash).toBe('hash-of-key');
    expect(mutationArgs.llmGatewayKeyId).toBe('vk_1');
    expect(mutationArgs.scope.agentKind).toBe('run_code_vision');
    expect(mutationArgs.scope.allowedModels).toEqual([
      'openrouter/qwen/qwen-vl-max',
    ]);
    expect(mutationArgs.scope.connectorGrants).toEqual([]);
    expect(mutationArgs.scope.toolGrants).toEqual([]);
    expect(mutationArgs.scope.budgetCents).toBe(200);
    expect(mutationArgs.scope.threadId).toBe('thr_1');
    expect(mutationArgs.expiresAt).toBeGreaterThan(Date.now());

    // Env triplet lands in the session store; the row insert came FIRST so a
    // crash between the two can never leave an untracked live key.
    expect(sessionEnvPatch).toHaveBeenCalledWith('thr-thr_1', {
      set: {
        TALE_GATEWAY_URL: 'http://sandbox-llm-gateway:8080',
        TALE_GATEWAY_TOKEN: 'sk-bf-test-key',
        TALE_VISION_MODEL: 'openrouter/qwen/qwen-vl-max',
      },
    });
    const insertOrder = runMutation.mock.invocationCallOrder[0] ?? Infinity;
    const patchOrder = sessionEnvPatch.mock.invocationCallOrder[0] ?? 0;
    expect(insertOrder).toBeLessThan(patchOrder);
  });

  it('no vision-capable model → skips silently (no mint, no patch, no throw)', async () => {
    armHappyMocks();
    resolveOrgVisionModel.mockResolvedValue(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ctx, runMutation } = makeCtx();

    await expect(armVisionLane(ctx, ARGS)).resolves.toBeUndefined();
    expect(mintVirtualKey).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    expect(sessionEnvPatch).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no gateway-servable vision-capable model'),
    );
    warn.mockRestore();
  });

  it('skips the provider push when no provision could be built, but still mints (fails closed downstream)', async () => {
    armHappyMocks();
    buildProviderProvision.mockResolvedValue(null);
    const { ctx } = makeCtx();

    await armVisionLane(ctx, ARGS);
    expect(provisionProviders).not.toHaveBeenCalled();
    expect(mintVirtualKey).toHaveBeenCalledTimes(1);
  });

  it('mint failure → no token row, no env patch, no throw', async () => {
    armHappyMocks();
    mintVirtualKey.mockRejectedValue(new Error('mint down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ctx, runMutation } = makeCtx();

    await expect(armVisionLane(ctx, ARGS)).resolves.toBeUndefined();
    expect(runMutation).not.toHaveBeenCalled();
    expect(sessionEnvPatch).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('env patch failure → no throw; the row exists so teardown still revokes', async () => {
    armHappyMocks();
    sessionEnvPatch.mockRejectedValue(new Error('runnerd down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ctx, runMutation } = makeCtx();

    await expect(armVisionLane(ctx, ARGS)).resolves.toBeUndefined();
    expect(runMutation).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('gateway auth-posture failure → skips the lane (never a fail-open key)', async () => {
    armHappyMocks();
    applyGatewayConfig.mockRejectedValue(new Error('config PUT failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ctx, runMutation } = makeCtx();

    await expect(armVisionLane(ctx, ARGS)).resolves.toBeUndefined();
    expect(mintVirtualKey).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    expect(sessionEnvPatch).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a vision-resolution crash is contained (no throw into session create)', async () => {
    armHappyMocks();
    resolveOrgVisionModel.mockRejectedValue(new Error('catalog exploded'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ctx, runMutation } = makeCtx();

    await expect(armVisionLane(ctx, ARGS)).resolves.toBeUndefined();
    expect(runMutation).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
