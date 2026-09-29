/**
 * A model-endpoint request's spend through the managed-turn machinery: the
 * hold it reserves (the key holder measured with the key, the op stamped
 * with the person, `__direct_api__` and the key), the budget refusal in the
 * chat lane's words, the gateway key minted for this one model, and the
 * settlement that books the gateway's figure and the relayed usage into the
 * ledger under the person and the key before the key is deleted.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const reserve = vi.hoisted(() => ({ reserveTurnBudget: vi.fn() }));
vi.mock('../sandbox/turn-budget.ts', () => reserve);

const provisioning = vi.hoisted(() => ({
  provisionSessionGatewayKey: vi.fn(),
}));
vi.mock(
  '../../core/node_only/sandbox/gateway_provisioning.ts',
  () => provisioning,
);

const gatewayAdmin = vi.hoisted(() => ({
  readVirtualKeySpend: vi.fn(),
  revokeVirtualKey: vi.fn(),
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

const {
  closeStaleModelApiOps,
  MODEL_API_OP_STALE_MS,
  modelApiHoldCents,
  openModelApiLease,
  settleModelApiLease,
} = await import('./metering.ts');
const { ModelApiRefusal } = await import('./wire.ts');

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(answers: Array<{ match: string; rows: unknown[] }> = []) {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    const hit = answers.find((answer) => text.includes(answer.match));
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

const LEASE_ARGS = {
  organizationId: 'org-1',
  userId: 'user-1',
  apiKeyId: 'key-1',
  requestId: 'req-1',
  wire: 'openai' as const,
  model: MODEL,
  holdCents: 4,
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
});

describe('modelApiHoldCents', () => {
  it('holds the prompt plus the output cap at the catalog price, rounded up', () => {
    // 100k in at 30c/M = 3c, 8k out (the model's own cap) at 120c/M = 0.96c.
    expect(modelApiHoldCents(MODEL, 100_000, 50_000)).toBe(4);
    expect(modelApiHoldCents(MODEL, 100_000, 1_000)).toBe(4);
  });

  it('holds the output cap once for every answer the request asks for', () => {
    // 100k in at 30c/M = 3c, 3 × 8k out at 120c/M = 2.88c.
    expect(modelApiHoldCents(MODEL, 100_000, undefined, 3)).toBe(6);
  });

  it('holds a cent for a model the catalog prices at nothing', () => {
    const { pricing: _pricing, ...unpriced } = MODEL;
    expect(modelApiHoldCents(unpriced, 1_000_000, 4_096)).toBe(1);
  });
});

describe('openModelApiLease', () => {
  it('reserves under the key holder with the key, mints a key for this model alone, and stamps it', async () => {
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
    expect(provisioning.provisionSessionGatewayKey).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        allowedModels: [
          expect.objectContaining({ anthropicHarnessLane: true }),
        ],
      }),
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

  it('releases the hold at once when the gateway cannot serve the model', async () => {
    reserve.reserveTurnBudget.mockResolvedValue({
      allowed: true,
      budgetCents: 4,
    });
    provisioning.provisionSessionGatewayKey.mockRejectedValue(
      new Error('Provider "deepseek" cannot serve this session'),
    );
    const { sql, statements } = fakeSql();
    const error = await openModelApiLease(sql, LEASE_ARGS).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ status: 503, code: 'MODEL_API_UNAVAILABLE' });
    const close = statements.find((s) => s.text.includes('status = ?'));
    expect(close?.values).toContain('failed');
    expect(
      statements.some((s) => s.text.includes('spend_settled_at_ms = ?')),
    ).toBe(true);
  });
});

describe('settleModelApiLease', () => {
  const LEASE = {
    organizationId: 'org-1',
    sessionId: 'model-api:key-1',
    execId: 'req-1',
    token: 'sk-bf-1',
    keyId: 'vk-1',
    gatewayModel: 'org-1__deepseek__deepseek-v4-flash/deepseek-v4-flash',
  };

  function settlingSql() {
    return fakeSql([
      {
        match: 'RETURNING org_id AS "organizationId", kind, model_ref',
        rows: [
          {
            organizationId: 'org-1',
            kind: 'model-api',
            modelRef:
              'deepseek/org-1__deepseek__deepseek-v4-flash/deepseek-v4-flash',
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

  it('books the gateway’s figure and the relayed usage under the person, __direct_api__ and the key, then deletes the key', async () => {
    gatewayAdmin.readVirtualKeySpend.mockResolvedValue({
      status: 'ok',
      cents: 3.25,
    });
    gatewayAdmin.revokeVirtualKey.mockResolvedValue(undefined);
    const { sql, statements } = settlingSql();

    await settleModelApiLease(sql, LEASE, {
      inputTokens: 1_200,
      outputTokens: 300,
    });

    expect(gatewayAdmin.readVirtualKeySpend).toHaveBeenCalledWith('vk-1');
    const ledger = statements.filter((s) =>
      s.text.includes('INSERT INTO app.usage_ledger'),
    );
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
    expect(
      statements.some((s) => s.text.includes('SET key_revoked_at_ms')),
    ).toBe(true);
    expect(jobs.addJobInTx).not.toHaveBeenCalled();
  });

  it('hands a settlement the gateway could not answer to the reconcile job', async () => {
    gatewayAdmin.readVirtualKeySpend.mockResolvedValue({
      status: 'unavailable',
    });
    const { sql } = settlingSql();

    await settleModelApiLease(sql, LEASE, undefined);

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
});

describe('closeStaleModelApiOps', () => {
  it('closes only running model-endpoint ops silent past the staleness window', async () => {
    const { sql, statements } = fakeSql([
      { match: 'RETURNING exec_id', rows: [{ execId: 'req-9' }] },
    ]);
    const now = 1_700_000_000_000;
    await expect(closeStaleModelApiOps(sql, now)).resolves.toBe(1);
    const update = statements[0];
    expect(update?.text).toContain("status = 'failed'");
    expect(update?.text).toContain("kind = ? AND status = 'running'");
    expect(update?.values).toEqual(
      expect.arrayContaining(['model-api', now - MODEL_API_OP_STALE_MS]),
    );
  });
});
