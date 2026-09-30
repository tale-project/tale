/**
 * A model-endpoint request's spend through the managed-turn machinery: the
 * worst case it holds (whole or not at all, the key holder measured with the
 * key, the op stamped with the person, `__direct_api__` and the key), the
 * refusals in the chat lane's words — naming what would fit — and the
 * concurrency cap, the gateway key minted for this one model (and revoked if
 * it cannot be recorded), and the settlement: the gateway's figure and the
 * relay's counts booked under the person and the key, a whole answer that
 * may still be generating read only after its lifetime, a stream that ended
 * early booked at least at what the relay counted, a priced answer the
 * gateway has not booked yet retried rather than booked at nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reserve = vi.hoisted(() => ({ reserveTurnBudget: vi.fn() }));
vi.mock('../sandbox/turn-budget.ts', () => reserve);

const provisioning = vi.hoisted(() => ({
  provisionSessionGatewayKey: vi.fn(),
  gatewayProvisioningFailureStage: vi.fn(() => 'gateway'),
}));
vi.mock(
  '../../core/node_only/sandbox/gateway_provisioning.ts',
  () => provisioning,
);

const gatewayAdmin = vi.hoisted(() => ({
  readVirtualKeySpend: vi.fn(),
  revokeVirtualKey: vi.fn(),
  gatewayRequestTimeoutSeconds: vi.fn(() => 600),
  gatewayStreamIdleTimeoutSeconds: vi.fn(() => 600),
}));
vi.mock(
  '../../core/node_only/sandbox/llm_gateway_admin.ts',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../../core/node_only/sandbox/llm_gateway_admin.ts')
    >()),
    ...gatewayAdmin,
  }),
);

const jobs = vi.hoisted(() => ({ addJobInTx: vi.fn(async () => 'job-1') }));
vi.mock('../../jobs/enqueue.ts', () => jobs);

const budget = vi.hoisted(() => ({
  findBudgetViolation: vi.fn(),
  loadBudgetSubject: vi.fn(async (_sql: unknown, subject: unknown) => ({
    ...(subject as object),
    userTeamIds: [],
  })),
}));
vi.mock('../governance/budget-gate.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../governance/budget-gate.ts')>()),
  ...budget,
}));
vi.mock('../governance/budget-reservations.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../governance/budget-reservations.ts')
  >()),
  readInFlightReservations: vi.fn(async () => ({})),
}));

const {
  assertModelApiBudgetRoom,
  closeModelApiLease,
  closeStaleModelApiOps,
  MODEL_API_CONCURRENCY_LIMIT,
  MODEL_API_OP_STALE_MS,
  modelApiWorstCase,
  openModelApiLease,
  settleModelApiOp,
  spendFactsOf,
} = await import('./metering.ts');
const { ModelApiRefusal } = await import('./wire.ts');

interface Statement {
  text: string;
  values: unknown[];
}

type Answer =
  | { match: string; rows: unknown[] }
  | { match: string; fail: Error };

function fakeSql(answers: Answer[] = []) {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    const hit = answers.find((answer) => text.includes(answer.match));
    if (hit !== undefined && 'fail' in hit) return Promise.reject(hit.fail);
    return Promise.resolve(hit?.rows ?? []);
  };
  const sql = Object.assign(run, {
    begin: async (fn: (tx: unknown) => Promise<unknown>) => fn(sql),
  });
  return { sql: sql as never, statements };
}

const MODEL = {
  id: 'deepseek/deepseek-v4-flash',
  providerSlug: 'deepseek',
  modelId: 'deepseek-v4-flash',
  label: 'DeepSeek V4 Flash',
  vision: false,
  tools: true,
  contextWindow: 128_000,
  maxOutputTokens: 8_000,
  pricing: { inputCentsPerMillion: 30, outputCentsPerMillion: 120 },
  connector: {
    name: 'deepseek',
    harnessEndpoint: {
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiFormat: 'anthropic' as const,
    },
  },
};

const WORST_CASE = modelApiWorstCase(MODEL, 100_000, 1_000);

const LEASE_ARGS = {
  organizationId: 'org-1',
  userId: 'user-1',
  apiKeyId: 'key-1',
  requestId: 'req-1',
  wire: 'openai' as const,
  model: MODEL,
  worstCase: WORST_CASE,
};

const LEASE = {
  organizationId: 'org-1',
  sessionId: 'model-api:key-1',
  execId: 'req-1',
  token: 'sk-bf-1',
  keyId: 'vk-1',
  gatewayModel: 'org-1__deepseek__deepseek-v4-flash/deepseek-v4-flash',
  startedAtMs: 1_700_000_000_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  provisioning.provisionSessionGatewayKey.mockResolvedValue({
    token: 'sk-bf-1',
    keyId: 'vk-1',
    keyHash: 'h',
  });
  provisioning.gatewayProvisioningFailureStage.mockReturnValue('gateway');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('modelApiWorstCase', () => {
  it('holds the prompt plus the output cap at the catalog price, rounded up, with those tokens', () => {
    // 100k in at 30c/M = 3c, 8k out (the model's own cap) at 120c/M = 0.96c.
    expect(modelApiWorstCase(MODEL, 100_000, 50_000)).toEqual({
      promptTokens: 100_000,
      outputCap: 8_000,
      choiceCount: 1,
      cents: 4,
      tokens: 108_000,
    });
    expect(modelApiWorstCase(MODEL, 100_000, 1_000).cents).toBe(4);
  });

  it('holds the catalog maximum when the request names no cap, and 4,096 when the catalog names none either', () => {
    expect(modelApiWorstCase(MODEL, 10, undefined).outputCap).toBe(8_000);
    const { maxOutputTokens: _max, ...open } = MODEL;
    expect(modelApiWorstCase(open, 10, undefined).outputCap).toBe(4_096);
    expect(modelApiWorstCase(open, 10, 20_000).outputCap).toBe(20_000);
  });

  it('holds the output cap once for every answer the request asks for', () => {
    // 100k in at 30c/M = 3c, 3 × 8k out at 120c/M = 2.88c.
    const worst = modelApiWorstCase(MODEL, 100_000, undefined, 3);
    expect(worst.cents).toBe(6);
    expect(worst.tokens).toBe(124_000);
  });

  it('holds a cent for a model the catalog prices at nothing', () => {
    const { pricing: _pricing, ...unpriced } = MODEL;
    expect(modelApiWorstCase(unpriced, 1_000_000, 4_096).cents).toBe(1);
  });
});

describe('openModelApiLease', () => {
  it('reserves the whole worst case under the key holder with the key, capped in concurrency, and mints a key for this model and this request', async () => {
    reserve.reserveTurnBudget.mockResolvedValue({
      allowed: true,
      budgetCents: 4,
    });
    const { sql, statements } = fakeSql();

    const lease = await openModelApiLease(sql, LEASE_ARGS);

    expect(reserve.reserveTurnBudget).toHaveBeenCalledWith(sql, {
      organizationId: 'org-1',
      sessionId: 'model-api:key-1',
      execId: 'req-1',
      kind: 'model-api',
      defaultBudgetCents: 4,
      modelRef: 'deepseek/org-1__deepseek__deepseek-v4-flash/deepseek-v4-flash',
      subject: {
        userId: 'user-1',
        agentSlug: '__direct_api__',
        apiKeyId: 'key-1',
      },
      whole: { prospectiveTokens: WORST_CASE.tokens },
      concurrencyLimit: MODEL_API_CONCURRENCY_LIMIT,
    });
    expect(provisioning.provisionSessionGatewayKey).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: 'org-1',
        sessionId: 'model-api:key-1',
        allowedModels: [
          {
            providerSlug: 'deepseek',
            modelId: 'deepseek-v4-flash',
            anthropicHarnessLane: false,
          },
        ],
        budgetCents: 4,
        requestScoped: true,
        requestId: 'req-1',
      },
    );
    const stamp = statements.find((s) => s.text.includes('minted_key_id ='));
    expect(stamp?.values).toEqual(['vk-1', 'model-api:key-1', 'req-1']);
    expect(lease).toEqual({
      organizationId: 'org-1',
      sessionId: 'model-api:key-1',
      execId: 'req-1',
      token: 'sk-bf-1',
      keyId: 'vk-1',
      gatewayModel: 'org-1__deepseek__deepseek-v4-flash/deepseek-v4-flash',
      startedAtMs: expect.any(Number),
    });
  });

  it('rides the connector’s native Anthropic endpoint on the Anthropic wire', async () => {
    reserve.reserveTurnBudget.mockResolvedValue({
      allowed: true,
      budgetCents: 4,
    });
    const lease = await openModelApiLease(fakeSql().sql, {
      ...LEASE_ARGS,
      wire: 'anthropic',
    });
    expect(lease.gatewayModel).toBe(
      'org-1__deepseek__deepseek-v4-flash__anthropic/deepseek-v4-flash',
    );
  });

  it('answers a reached cap with the chat lane’s coded 429 and its wait, holding nothing', async () => {
    const resetsAt = Date.now() + 3_600_000;
    reserve.reserveTurnBudget.mockResolvedValue({
      allowed: false,
      reason: 'Cost limit reached for this daily period ($1.00 / $1.00)',
      violation: {
        scope: 'apiKey',
        code: 'COST_LIMIT',
        period: 'daily',
        used: 100,
        limit: 100,
        reason: 'Cost limit reached',
        resetsAt,
      },
    });
    const error = await openModelApiLease(fakeSql().sql, LEASE_ARGS).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ModelApiRefusal);
    const refusal = error as InstanceType<typeof ModelApiRefusal>;
    expect(refusal.status).toBe(429);
    expect(refusal.code).toBe('BUDGET_EXCEEDED');
    expect(refusal.message).toMatch(
      /^Usage limit reached\. This API key's daily cost limit is used up until /,
    );
    expect(Number(refusal.headers['retry-after'])).toBeGreaterThan(3_500);
    expect(provisioning.provisionSessionGatewayKey).not.toHaveBeenCalled();
  });

  it('refuses a worst case that does not fit, naming the output cap that would', async () => {
    const resetsAt = Date.now() + 3_600_000;
    reserve.reserveTurnBudget.mockResolvedValue({
      allowed: false,
      reason: 'The organization’s monthly spend cap leaves too little.',
      violation: {
        scope: 'org',
        code: 'COST_LIMIT',
        period: 'monthly',
        used: 996.5,
        limit: 1_000,
        reason: 'x',
        resetsAt,
      },
      // 3.5 cents left, 3 whole: the prompt alone costs 3 cents.
      room: { cents: 3.5 },
    });
    const small = await openModelApiLease(fakeSql().sql, LEASE_ARGS).catch(
      (caught: unknown) => caught,
    );
    expect(small).toMatchObject({ status: 429, code: 'BUDGET_EXCEEDED' });
    expect((small as Error).message).toContain(
      "The organization's monthly cost limit leaves too little for this request — its prompt of about 100,000 tokens and any output",
    );

    reserve.reserveTurnBudget.mockResolvedValue({
      allowed: false,
      reason: 'x',
      violation: {
        scope: 'apiKey',
        code: 'COST_LIMIT',
        period: 'monthly',
        used: 990,
        limit: 1_000,
        reason: 'x',
        resetsAt,
      },
      // 10 cents left, the prompt 3: 7 cents buy 58,333 output tokens at
      // 120c/M.
      room: { cents: 10 },
    });
    const refusal = await openModelApiLease(fakeSql().sql, {
      ...LEASE_ARGS,
      worstCase: modelApiWorstCase(MODEL, 100_000, 8_000),
    }).catch((caught: unknown) => caught);
    expect(refusal).toMatchObject({ status: 429, code: 'BUDGET_EXCEEDED' });
    expect((refusal as Error).message).toMatch(
      /^Usage limit reached for this request: with 8,000 output tokens it could use up to \$0\.04, more than This API key's monthly cost limit leaves until .+\. Set max_completion_tokens to 58,333 or less/,
    );
  });

  it('names what fits under a token cap on the Anthropic wire', async () => {
    reserve.reserveTurnBudget.mockResolvedValue({
      allowed: false,
      reason: 'x',
      violation: {
        scope: 'user',
        code: 'TOKEN_LIMIT',
        period: 'daily',
        used: 950_000,
        limit: 1_000_000,
        reason: 'x',
        resetsAt: Date.now() + 60_000,
      },
      room: { tokens: 50_000 },
    });
    const refusal = await openModelApiLease(fakeSql().sql, {
      ...LEASE_ARGS,
      wire: 'anthropic',
      worstCase: modelApiWorstCase(MODEL, 20_000, 8_000, 2),
    }).catch((caught: unknown) => caught);
    // (50,000 − 20,000) / 2 answers.
    expect((refusal as Error).message).toContain(
      'Set max_tokens to 15,000 or less',
    );
  });

  it('refuses one request too many at once, per person or per key, holding nothing', async () => {
    reserve.reserveTurnBudget.mockResolvedValue({
      allowed: false,
      reason: 'busy',
      concurrency: { scope: 'apiKey', running: 8, limit: 8 },
    });
    const refusal = await openModelApiLease(fakeSql().sql, LEASE_ARGS).catch(
      (caught: unknown) => caught,
    );
    expect(refusal).toMatchObject({
      status: 429,
      code: 'MODEL_API_CONCURRENCY_EXCEEDED',
    });
    expect((refusal as InstanceType<typeof ModelApiRefusal>).headers).toEqual({
      'retry-after': '2',
    });
    expect((refusal as Error).message).toContain('This API key already has 8');
    expect(provisioning.provisionSessionGatewayKey).not.toHaveBeenCalled();
  });

  it.each([
    ['gateway', /model gateway cannot serve/],
    ['credential', /provider credential .* cannot be used/],
  ] as const)(
    'releases the hold at once when the %s fails, and says which',
    async (stage, wording) => {
      reserve.reserveTurnBudget.mockResolvedValue({
        allowed: true,
        budgetCents: 4,
      });
      provisioning.provisionSessionGatewayKey.mockRejectedValue(
        new Error('Provider "deepseek" cannot serve this session'),
      );
      provisioning.gatewayProvisioningFailureStage.mockReturnValue(stage);
      const { sql, statements } = fakeSql();
      const error = await openModelApiLease(sql, LEASE_ARGS).catch(
        (caught: unknown) => caught,
      );
      expect(error).toMatchObject({
        status: 503,
        code: 'MODEL_API_UNAVAILABLE',
      });
      expect((error as Error).message).toMatch(wording);
      const close = statements.find((s) => s.text.includes('status = ?'));
      expect(close?.values).toContain('failed');
      expect(
        statements.some((s) => s.text.includes('spend_settled_at_ms = ?')),
      ).toBe(true);
    },
  );

  it('revokes a key it cannot record, and releases the hold', async () => {
    reserve.reserveTurnBudget.mockResolvedValue({
      allowed: true,
      budgetCents: 4,
    });
    gatewayAdmin.revokeVirtualKey.mockResolvedValue(undefined);
    const { sql, statements } = fakeSql([
      { match: 'SET minted_key_id', fail: new Error('connection reset') },
    ]);
    const error = await openModelApiLease(sql, LEASE_ARGS).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ status: 503, code: 'MODEL_API_UNAVAILABLE' });
    expect(gatewayAdmin.revokeVirtualKey).toHaveBeenCalledWith('vk-1');
    expect(
      statements.some((s) => s.text.includes('spend_settled_at_ms = ?')),
    ).toBe(true);
  });
});

describe('spendFactsOf', () => {
  const ending = {
    model: MODEL,
    promptTokens: 2_000,
  };

  it('records a finished answer’s reported usage and its catalog price', () => {
    expect(
      spendFactsOf({
        ...ending,
        outcome: {
          status: 'completed',
          usage: { inputTokens: 1_000_000, outputTokens: 100_000 },
        },
      }),
    ).toEqual({
      floorCents: null,
      // 30c + 12c.
      expectedCents: 42,
      inputTokens: 1_000_000,
      outputTokens: 100_000,
    });
  });

  it('prices a cache read at the cache rate', () => {
    const cached = spendFactsOf({
      model: {
        ...MODEL,
        pricing: { ...MODEL.pricing, cacheReadCentsPerMillion: 3 },
      },
      promptTokens: 0,
      outcome: {
        status: 'completed',
        usage: {
          inputTokens: 1_000_000,
          outputTokens: 0,
          cachedInputTokens: 1_000_000,
        },
      },
    });
    expect(cached.expectedCents).toBe(3);
  });

  it('records nothing for a finished answer that reported no usage', () => {
    expect(
      spendFactsOf({ ...ending, outcome: { status: 'completed' } }),
    ).toEqual({
      floorCents: null,
      expectedCents: null,
      inputTokens: null,
      outputTokens: null,
    });
  });

  it('floors a whole answer that ended early at its prompt: the gateway cancelled it and booked none of it', () => {
    // The prompt estimate: 1M at 30c/M = 30c; a whole answer relays no output
    // before it is complete.
    expect(
      spendFactsOf({
        ...ending,
        promptTokens: 1_000_000,
        outcome: { status: 'cancelled', countedOutputTokens: 0 },
      }),
    ).toEqual({
      floorCents: 30,
      expectedCents: null,
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
  });

  it('floors a stream that ended early at its prompt and the output counted', () => {
    // The prompt estimate: 1M at 30c/M = 30c; 50k counted at 120c/M = 6c.
    expect(
      spendFactsOf({
        ...ending,
        promptTokens: 1_000_000,
        outcome: { status: 'cancelled', countedOutputTokens: 50_000 },
      }),
    ).toMatchObject({
      floorCents: 36,
      inputTokens: 1_000_000,
      outputTokens: 50_000,
    });
    // The vendor's own prompt count wins over the estimate.
    expect(
      spendFactsOf({
        ...ending,
        promptTokens: 1_000_000,
        outcome: {
          status: 'failed',
          usage: { inputTokens: 500_000, outputTokens: 0 },
          countedOutputTokens: 0,
        },
      }).floorCents,
    ).toBe(15);
  });

  it('records nothing for a refusal the gateway answered', () => {
    expect(
      spendFactsOf({ ...ending, outcome: { status: 'failed' } }).floorCents,
    ).toBeNull();
  });

  it('records nothing for a request the caller left before it was sent', () => {
    // The relay reports a request that never left the process without an
    // output count; the same 1M-token prompt ended early after it was sent
    // floors at 30c (above).
    expect(
      spendFactsOf({
        ...ending,
        promptTokens: 1_000_000,
        outcome: { status: 'cancelled' },
      }),
    ).toEqual({
      floorCents: null,
      expectedCents: null,
      inputTokens: null,
      outputTokens: null,
    });
  });
});

/** The rows a settlement reads, as the op row carries them. */
function settlingSql(hints: {
  settleAfter?: number | null;
  floorCents?: number | null;
  expectedCents?: number | null;
  finalizedAt?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}) {
  return fakeSql([
    {
      match: 'settle_after_ms::float8 AS "settleAfter"',
      rows: [
        {
          organizationId: 'org-1',
          kind: 'model-api',
          mintedKeyId: 'vk-1',
          finalizedAt: hints.finalizedAt ?? Date.now(),
          spendSettledAt: null,
          keyRevokedAt: null,
          settleAfter: hints.settleAfter ?? null,
          floorCents: hints.floorCents ?? null,
          expectedCents: hints.expectedCents ?? null,
        },
      ],
    },
    {
      match: 'RETURNING org_id AS "organizationId", kind, model_ref',
      rows: [
        {
          organizationId: 'org-1',
          kind: 'model-api',
          modelRef:
            'deepseek/org-1__deepseek__deepseek-v4-flash/deepseek-v4-flash',
          inputTokens: hints.inputTokens ?? null,
          outputTokens: hints.outputTokens ?? null,
        },
      ],
    },
    {
      match: 'SELECT user_id AS "userId", agent_slug AS "agentSlug"',
      rows: [
        { userId: 'user-1', agentSlug: '__direct_api__', apiKeyId: 'key-1' },
      ],
    },
  ]);
}

function ledgerRows(statements: Statement[]) {
  return statements.filter((s) =>
    s.text.includes('INSERT INTO app.usage_ledger'),
  );
}

describe('settleModelApiOp', () => {
  it('books the gateway’s figure and the relay’s counts under the person, __direct_api__ and the key, then deletes the key', async () => {
    gatewayAdmin.readVirtualKeySpend.mockResolvedValue({
      status: 'ok',
      cents: 3.25,
    });
    gatewayAdmin.revokeVirtualKey.mockResolvedValue(undefined);
    const { sql, statements } = settlingSql({
      expectedCents: 3,
      inputTokens: 1_200,
      outputTokens: 300,
    });

    await settleModelApiOp(sql, LEASE);

    expect(gatewayAdmin.readVirtualKeySpend).toHaveBeenCalledWith('vk-1');
    const ledger = ledgerRows(statements);
    // One increment per period bucket.
    expect(ledger).toHaveLength(3);
    expect(ledger[0]?.values).toEqual(
      expect.arrayContaining([
        'org-1',
        'user-1',
        '__direct_api__',
        'deepseek-v4-flash',
        'deepseek',
        'key-1',
        1_200,
        300,
        1_500,
        3.25,
      ]),
    );
    expect(gatewayAdmin.revokeVirtualKey).toHaveBeenCalledWith('vk-1');
    expect(jobs.addJobInTx).not.toHaveBeenCalled();
  });

  it('books at least the floor a stream that ended early counted', async () => {
    gatewayAdmin.readVirtualKeySpend.mockResolvedValue({
      status: 'ok',
      cents: 0,
    });
    gatewayAdmin.revokeVirtualKey.mockResolvedValue(undefined);
    const { sql, statements } = settlingSql({
      floorCents: 7.5,
      inputTokens: 20_000,
      outputTokens: 500,
    });

    await settleModelApiOp(sql, LEASE);

    expect(ledgerRows(statements)[0]?.values).toEqual(
      expect.arrayContaining([20_000, 500, 7.5]),
    );
    expect(gatewayAdmin.revokeVirtualKey).toHaveBeenCalledWith('vk-1');
  });

  it('keeps the key and retries when a priced answer reads 0 inside the grace', async () => {
    gatewayAdmin.readVirtualKeySpend.mockResolvedValue({
      status: 'ok',
      cents: 0,
    });
    const { sql, statements } = settlingSql({
      expectedCents: 2,
      inputTokens: 100,
      outputTokens: 10,
    });

    await settleModelApiOp(sql, LEASE);

    expect(ledgerRows(statements)).toHaveLength(0);
    expect(gatewayAdmin.revokeVirtualKey).not.toHaveBeenCalled();
    expect(jobs.addJobInTx).toHaveBeenCalledWith(
      sql,
      'sandbox.gateway_key_reconcile',
      {
        organizationId: 'org-1',
        sessionId: 'model-api:key-1',
        execId: 'req-1',
      },
      { startAfter: expect.any(Date) },
    );
  });

  it('books the relay’s figure once the grace has passed and the gateway still reads 0', async () => {
    gatewayAdmin.readVirtualKeySpend.mockResolvedValue({
      status: 'ok',
      cents: 0,
    });
    gatewayAdmin.revokeVirtualKey.mockResolvedValue(undefined);
    const { sql, statements } = settlingSql({
      expectedCents: 2,
      finalizedAt: Date.now() - 11 * 60_000,
      inputTokens: 100,
      outputTokens: 10,
    });

    await settleModelApiOp(sql, LEASE);

    expect(ledgerRows(statements)[0]?.values).toEqual(
      expect.arrayContaining([100, 10, 2]),
    );
  });

  it('does not read the spend of a request closed as stale before its lifetime has passed', async () => {
    const { sql } = settlingSql({ settleAfter: Date.now() + 60_000 });

    await settleModelApiOp(sql, LEASE);

    expect(gatewayAdmin.readVirtualKeySpend).not.toHaveBeenCalled();
    expect(gatewayAdmin.revokeVirtualKey).not.toHaveBeenCalled();
    expect(jobs.addJobInTx).toHaveBeenCalled();
  });

  it('hands a settlement the gateway could not answer to the reconcile job', async () => {
    gatewayAdmin.readVirtualKeySpend.mockResolvedValue({
      status: 'unavailable',
    });
    const { sql } = settlingSql({});

    await settleModelApiOp(sql, LEASE);

    expect(gatewayAdmin.revokeVirtualKey).not.toHaveBeenCalled();
    expect(jobs.addJobInTx).toHaveBeenCalled();
  });
});

describe('closeModelApiLease', () => {
  it('closes a finished answer with its facts and settles it shortly after', async () => {
    vi.useFakeTimers();
    gatewayAdmin.readVirtualKeySpend.mockResolvedValue({
      status: 'ok',
      cents: 1,
    });
    gatewayAdmin.revokeVirtualKey.mockResolvedValue(undefined);
    const { sql, statements } = settlingSql({ inputTokens: 10 });

    closeModelApiLease(sql, LEASE, {
      model: MODEL,
      promptTokens: 10,
      outcome: {
        status: 'completed',
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    const close = statements.find((s) => s.text.includes('floor_cents = ?'));
    expect(close?.values).toEqual(expect.arrayContaining(['completed', 10, 5]));
    expect(close?.text).not.toContain('settle_after_ms');
    expect(gatewayAdmin.readVirtualKeySpend).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(gatewayAdmin.readVirtualKeySpend).toHaveBeenCalledWith('vk-1');
  });

  it('settles a whole answer the caller abandoned just as soon, at its floor: the gateway cancelled the vendor call', async () => {
    vi.useFakeTimers();
    gatewayAdmin.readVirtualKeySpend.mockResolvedValue({
      status: 'ok',
      cents: 0,
    });
    gatewayAdmin.revokeVirtualKey.mockResolvedValue(undefined);
    const { sql, statements } = settlingSql({ floorCents: 30 });

    closeModelApiLease(sql, LEASE, {
      model: MODEL,
      promptTokens: 1_000_000,
      outcome: { status: 'cancelled', countedOutputTokens: 0 },
    });
    await vi.advanceTimersByTimeAsync(0);
    const close = statements.find((s) => s.text.includes('floor_cents = ?'));
    // 1M prompt tokens at 30c/M, no output relayed.
    expect(close?.values).toEqual(
      expect.arrayContaining(['cancelled', 30, 1_000_000, 0]),
    );

    await vi.advanceTimersByTimeAsync(2_000);
    expect(gatewayAdmin.readVirtualKeySpend).toHaveBeenCalledWith('vk-1');
    // The gateway read 0; the floor is what lands in the ledger.
    expect(ledgerRows(statements)[0]?.values).toEqual(
      expect.arrayContaining([30]),
    );
    expect(jobs.addJobInTx).not.toHaveBeenCalled();
  });
});

describe('closeStaleModelApiOps', () => {
  it('closes only running model-endpoint ops silent past the staleness window, reading their spend no sooner than a whole answer’s lifetime', async () => {
    const { sql, statements } = fakeSql([
      { match: 'RETURNING exec_id', rows: [{ execId: 'req-9' }] },
    ]);
    const now = 1_700_000_000_000;
    await expect(closeStaleModelApiOps(sql, now)).resolves.toBe(1);
    const update = statements[0];
    expect(update?.text).toContain("status = 'failed'");
    expect(update?.text).toContain(
      'settle_after_ms = greatest(started_at_ms + ?',
    );
    expect(update?.text).toContain("kind = ? AND status = 'running'");
    expect(update?.values).toEqual(
      expect.arrayContaining([
        660_000,
        'model-api',
        now - MODEL_API_OP_STALE_MS,
      ]),
    );
  });
});

describe('assertModelApiBudgetRoom', () => {
  it('passes a caller with room, and refuses one at a cap before anything is paid', async () => {
    budget.findBudgetViolation.mockResolvedValue(null);
    await expect(
      assertModelApiBudgetRoom(fakeSql().sql, {
        organizationId: 'org-1',
        userId: 'user-1',
        apiKeyId: 'key-1',
      }),
    ).resolves.toBeUndefined();

    budget.findBudgetViolation.mockResolvedValue({
      scope: 'org',
      code: 'REQUEST_LIMIT',
      period: 'daily',
      used: 10,
      limit: 10,
      reason: 'x',
      resetsAt: Date.now() + 60_000,
    });
    const refusal = await assertModelApiBudgetRoom(fakeSql().sql, {
      organizationId: 'org-1',
      userId: 'user-1',
      apiKeyId: 'key-1',
    }).catch((caught: unknown) => caught);
    expect(refusal).toMatchObject({ status: 429, code: 'BUDGET_EXCEEDED' });
    expect(
      (refusal as InstanceType<typeof ModelApiRefusal>).headers['retry-after'],
    ).toBeDefined();
  });
});
