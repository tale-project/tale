// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { moderationProviderConfigSchema } from '../../../lib/shared/schemas/governance.ts';

const { safeFetchMock, readGovernanceSecret, readGovernancePolicyForOrg } =
  vi.hoisted(() => ({
    safeFetchMock: vi.fn(),
    readGovernanceSecret: vi.fn(),
    readGovernancePolicyForOrg: vi.fn(),
  }));

// `safeFetch` is the one network edge; `SafeFetchError` stays real so the
// classifier sees the same class the module catches.
vi.mock('../../../lib/net/safe-fetch.ts', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    safeFetch: (...args: unknown[]) => safeFetchMock(...args),
  };
});
vi.mock('./settings-tail.ts', () => ({
  MODERATION_SECRET_NAME: 'moderation_auth_header',
  readGovernanceSecret,
}));
vi.mock('../../lib/org-config.ts', () => ({ readGovernancePolicyForOrg }));

import { SafeFetchError } from '../../../lib/net/safe-fetch.ts';
import {
  applyModerationSecret,
  isCircuitOpen,
  parseModerationResponse,
  resetModerationCircuitsForTesting,
  resolveModerationMappings,
  runModerationProvider,
  substituteModerationTemplate,
  testModerationProvider,
} from './moderation.ts';

const sql = {} as Sql;
const ORG = 'org_1';

function config(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof moderationProviderConfigSchema.parse> {
  return moderationProviderConfigSchema.parse({
    enabled: true,
    appliesTo: ['input'],
    endpoint: {
      url: 'https://moderation.example.com/v1/moderations',
      headers: { Authorization: 'Bearer {{secret}}' },
      requestTemplate: '{"input": {{text}}, "direction": {{direction}}}',
    },
    responseShape: { type: 'openai_moderation' },
    categoryMappings: [
      {
        providerCategory: 'hate',
        internalLabel: 'Hate',
        enabled: true,
        mode: 'block',
      },
      {
        providerCategory: 'violence',
        internalLabel: 'Violence',
        enabled: true,
        mode: 'flag',
        scoreThreshold: 0.5,
      },
    ],
    ...overrides,
  });
}

function openAiBody(
  categories: Record<string, boolean>,
  scores: Record<string, number> = {},
): string {
  return JSON.stringify({
    results: [
      {
        flagged: Object.values(categories).some(Boolean),
        categories,
        category_scores: scores,
      },
    ],
  });
}

function ok(body: string, status = 200): { status: number; body: string } {
  return { status, body };
}

beforeEach(() => {
  safeFetchMock.mockReset();
  readGovernanceSecret.mockReset();
  readGovernancePolicyForOrg.mockReset();
  resetModerationCircuitsForTesting();
  readGovernanceSecret.mockResolvedValue('sk-live');
});

describe('substituteModerationTemplate', () => {
  it('keeps the body valid JSON whatever the text contains', () => {
    const body = substituteModerationTemplate(
      '{"input": {{text}}, "dir": {{direction}}}',
      'say "hi"\nand {{text}} again',
      'output',
    );
    expect(JSON.parse(body)).toEqual({
      input: 'say "hi"\nand {{text}} again',
      dir: 'output',
    });
  });
});

describe('applyModerationSecret', () => {
  it('splices the stored header into every {{secret}} value only', () => {
    expect(
      applyModerationSecret(
        { Authorization: 'Bearer {{secret}}', Accept: 'application/json' },
        'sk-1',
      ),
    ).toEqual({ Authorization: 'Bearer sk-1', Accept: 'application/json' });
  });

  it('refuses a template that needs a secret nobody stored', () => {
    expect(() =>
      applyModerationSecret({ 'X-Key': '{{secret}}' }, null),
    ).toThrow(/no moderation auth header/);
  });
});

describe('parseModerationResponse', () => {
  it('reads the OpenAI shape with scores', () => {
    expect(
      parseModerationResponse(
        JSON.parse(openAiBody({ hate: true, sexual: false }, { hate: 0.9 })),
        { type: 'openai_moderation' },
      ),
    ).toEqual({
      flagged: true,
      categories: {
        hate: { flagged: true, score: 0.9 },
        sexual: { flagged: false },
      },
    });
  });

  it('normalizes Azure severity onto 0..1', () => {
    expect(
      parseModerationResponse(
        { categoriesAnalysis: [{ category: 'Hate', severity: 3 }] },
        { type: 'azure_content_safety' },
      ),
    ).toEqual({
      flagged: true,
      categories: { Hate: { flagged: true, score: 0.5 } },
    });
  });

  it('reads Perspective summary scores', () => {
    expect(
      parseModerationResponse(
        { attributeScores: { TOXICITY: { summaryScore: { value: 0.2 } } } },
        { type: 'perspective' },
      ),
    ).toEqual({
      flagged: true,
      categories: { TOXICITY: { flagged: true, score: 0.2 } },
    });
  });

  it('walks a custom JSONPath shape and rejects the wrong container', () => {
    const shape = {
      type: 'custom_jsonpath' as const,
      categoriesPath: '$.result.labels',
      categoryShape: 'array' as const,
    };
    expect(
      parseModerationResponse({ result: { labels: ['spam', 7] } }, shape),
    ).toEqual({ flagged: true, categories: { spam: { flagged: true } } });
    expect(() =>
      parseModerationResponse({ result: { labels: 'spam' } }, shape),
    ).toThrow(/did not resolve to an array/);
  });
});

describe('resolveModerationMappings', () => {
  it('reads the flag without a threshold and the score with one', () => {
    expect(
      resolveModerationMappings(
        {
          hate: { flagged: true, score: 0.1 },
          violence: { flagged: true, score: 0.4 },
          spam: { flagged: true },
        },
        config().categoryMappings,
      ),
    ).toEqual({ block: ['Hate'], mask: [], flag: [] });
  });
});

describe('runModerationProvider', () => {
  it('blocks on a block-mapped category and reports the round facts', async () => {
    safeFetchMock.mockResolvedValueOnce(ok(openAiBody({ hate: true })));

    const run = await runModerationProvider(sql, {
      organizationId: ORG,
      direction: 'input',
      text: 'some text',
      config: config(),
    });

    expect(run.outcome).toEqual({
      kind: 'blocked',
      categoryIds: ['Hate'],
      matchCount: 1,
    });
    expect(run.extras).toMatchObject({ httpStatus: 200, attempts: 1 });
    // The stored header reached the wire; the text rode the template.
    const [url, options] = safeFetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://moderation.example.com/v1/moderations');
    expect(options.headers.Authorization).toBe('Bearer sk-live');
    expect(JSON.parse(options.body)).toEqual({
      input: 'some text',
      direction: 'input',
    });
  });

  it('flags a thresholded category only above its score', async () => {
    safeFetchMock.mockResolvedValueOnce(
      ok(openAiBody({ violence: true }, { violence: 0.7 })),
    );
    const run = await runModerationProvider(sql, {
      organizationId: ORG,
      direction: 'input',
      text: 'x',
      config: config(),
    });
    expect(run.outcome).toEqual({
      kind: 'flagged',
      categoryIds: ['Violence'],
      matchCount: 1,
    });
  });

  it('retries once on a 5xx and succeeds', async () => {
    safeFetchMock
      .mockResolvedValueOnce(ok('upstream down', 503))
      .mockResolvedValueOnce(ok(openAiBody({})));
    const run = await runModerationProvider(sql, {
      organizationId: ORG,
      direction: 'input',
      text: 'x',
      config: config(),
    });
    expect(run.outcome).toEqual({ kind: 'pass' });
    expect(run.extras.attempts).toBe(2);
  });

  it('answers a 4xx as a classified step error without retrying', async () => {
    safeFetchMock.mockResolvedValueOnce(ok('nope', 401));
    const run = await runModerationProvider(sql, {
      organizationId: ORG,
      direction: 'output',
      text: 'x',
      config: config(),
    });
    expect(run.outcome).toEqual({
      kind: 'step_error',
      filterName: 'moderation_provider',
      reason: 'http_4xx',
    });
    expect(run.extras).toMatchObject({ httpStatus: 401, attempts: 1 });
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it('classifies a safeFetch refusal as config and a missing secret likewise', async () => {
    safeFetchMock.mockRejectedValueOnce(
      new SafeFetchError('private_ip', 'Host resolves to private'),
    );
    const refused = await runModerationProvider(sql, {
      organizationId: ORG,
      direction: 'input',
      text: 'x',
      config: config(),
    });
    expect(refused.outcome).toMatchObject({
      kind: 'step_error',
      reason: 'config',
    });

    readGovernanceSecret.mockResolvedValueOnce(null);
    const noSecret = await runModerationProvider(sql, {
      organizationId: ORG,
      direction: 'input',
      text: 'x',
      config: config(),
    });
    expect(noSecret.outcome).toMatchObject({
      kind: 'step_error',
      reason: 'config',
    });
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it('never opens the circuit on a misconfiguration — nothing reached the provider', async () => {
    readGovernanceSecret.mockResolvedValue(null);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const run = await runModerationProvider(sql, {
        organizationId: ORG,
        direction: 'input',
        text: 'x',
        config: config(),
      });
      expect(run.outcome).toMatchObject({
        kind: 'step_error',
        reason: 'config',
      });
      expect(run.extras.circuitOpened).toBeUndefined();
    }
    expect(isCircuitOpen(ORG, 'input')).toBe(false);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it('opens the circuit after repeated failures and stops calling out', async () => {
    safeFetchMock.mockResolvedValue(ok('nope', 400));
    let opened = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const run = await runModerationProvider(sql, {
        organizationId: ORG,
        direction: 'input',
        text: 'x',
        config: config(),
      });
      opened ||= run.extras.circuitOpened === true;
    }
    expect(opened).toBe(true);
    expect(isCircuitOpen(ORG, 'input')).toBe(true);
    expect(isCircuitOpen(ORG, 'output')).toBe(false);

    const calls = safeFetchMock.mock.calls.length;
    const shortCircuited = await runModerationProvider(sql, {
      organizationId: ORG,
      direction: 'input',
      text: 'x',
      config: config(),
    });
    expect(shortCircuited.outcome.kind).toBe('step_error');
    expect(shortCircuited.extras.circuitOpen).toBe(true);
    expect(safeFetchMock.mock.calls.length).toBe(calls);
  });
});

describe('testModerationProvider', () => {
  it('reports not_configured without a policy or with a disabled one', async () => {
    readGovernancePolicyForOrg.mockResolvedValueOnce(null);
    await expect(
      testModerationProvider(sql, ORG, { text: 'probe' }),
    ).resolves.toMatchObject({ ok: false, kind: 'not_configured' });

    readGovernancePolicyForOrg.mockResolvedValueOnce(
      config({ enabled: false }),
    );
    await expect(
      testModerationProvider(sql, ORG, { text: 'probe' }),
    ).resolves.toMatchObject({ ok: false, kind: 'not_configured' });
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it('round-trips the text through the real provider path', async () => {
    readGovernancePolicyForOrg.mockResolvedValueOnce(config());
    safeFetchMock.mockResolvedValueOnce(ok(openAiBody({ hate: true })));
    await expect(
      testModerationProvider(sql, ORG, { text: 'probe' }),
    ).resolves.toEqual({
      ok: true,
      kind: 'blocked',
      categoryIds: ['Hate'],
      matchCount: 1,
      httpStatus: 200,
      durationMs: expect.any(Number),
    });
  });

  it('surfaces a provider fault with its class', async () => {
    readGovernancePolicyForOrg.mockResolvedValueOnce(config());
    safeFetchMock.mockResolvedValueOnce(ok('not json'));
    await expect(
      testModerationProvider(sql, ORG, { text: 'probe' }),
    ).resolves.toMatchObject({
      ok: false,
      kind: 'step_error',
      errorClass: 'parse',
      httpStatus: 200,
    });
  });
});
