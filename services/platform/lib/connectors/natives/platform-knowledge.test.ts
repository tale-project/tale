import { describe, expect, it, vi } from 'vitest';

import type { NativeConnectorContext } from '../dispatcher';
import { ConnectorError } from '../errors';
import {
  knowledgeNatives,
  type KnowledgeRunRefusal,
  type WorkflowKnowledgeSearch,
} from './platform-knowledge';

const HIT = {
  text: 'Refunds on annual plans take ten working days.',
  title: 'Refund policy',
  source: 'documents' as const,
  documentId: 'doc_refunds',
  score: 0.031,
  similarity: 0.78,
};

const RUN_STEP = {
  kind: 'workflow',
  runId: 'run_7',
  nodeId: 'related',
} as const;

/** A call as the executor makes it — by default, a step of run `run_7`;
 * `null` for a call that names no caller at all. */
function stepOf(
  caller: NativeConnectorContext['caller'] | null = RUN_STEP,
): NativeConnectorContext {
  return {
    organizationId: 'org_1',
    credentialId: 'platform',
    authMethod: 'platform',
    ...(caller !== null && { caller }),
  } as NativeConnectorContext;
}

function searchWith(
  answer: Awaited<ReturnType<WorkflowKnowledgeSearch['search']>>,
) {
  const search = vi.fn<WorkflowKnowledgeSearch['search']>(() =>
    Promise.resolve(answer),
  );
  const native = knowledgeNatives({ search })['knowledge.search'];
  return { search, native };
}

async function refusalOf(promise: Promise<unknown>): Promise<ConnectorError> {
  const caught = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(ConnectorError);
  return caught as ConnectorError;
}

describe('knowledge.search', () => {
  it('searches as the run the step belongs to, with the defaults filled in [CONN-R20]', async () => {
    const { search, native } = searchWith({ ok: true, hits: [HIT] });
    await expect(native({ query: 'refund window' }, stepOf())).resolves.toEqual(
      { hits: [HIT] },
    );
    expect(search).toHaveBeenCalledWith({
      organizationId: 'org_1',
      runId: 'run_7',
      query: 'refund window',
      corpus: 'all',
      limit: 5,
    });
  });

  it('passes a folder and a corpus on as given', async () => {
    const { search, native } = searchWith({ ok: true, hits: [] });
    await native(
      {
        query: 'notice period',
        corpus: 'documents',
        limit: 3,
        folder: '/Policies/',
      },
      stepOf(),
    );
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        corpus: 'documents',
        limit: 3,
        folder: '/Policies/',
      }),
    );
  });

  it.each([
    ['a person', { kind: 'user', userId: 'user_1' } as const],
    ['the system', { kind: 'system', reason: 'sweep' } as const],
    ['nobody', null],
  ])(
    'refuses a call made by %s, which has no run to search as [CONN-R20]',
    async (_who, caller) => {
      const { search, native } = searchWith({ ok: true, hits: [HIT] });
      const refusal = await refusalOf(
        native({ query: 'refund window' }, stepOf(caller)),
      );
      expect(refusal.code).toBe('CALLER_UNKNOWN');
      expect(search).not.toHaveBeenCalled();
    },
  );

  it.each([
    { query: '' },
    { query: 'x'.repeat(2001) },
    { query: 'refunds', limit: 0 },
    { query: 'refunds', limit: 21 },
    { query: 'refunds', corpus: 'mail' },
    { query: 'refunds', scope: 'org' },
  ])('refuses input outside the declared bounds: %j', async (input) => {
    const { search, native } = searchWith({ ok: true, hits: [] });
    const refusal = await refusalOf(native(input, stepOf()));
    expect(refusal.code).toBe('INPUT_INVALID');
    expect(search).not.toHaveBeenCalled();
  });

  it.each<[KnowledgeRunRefusal, string, Record<string, unknown>]>([
    [{ kind: 'not_configured' }, 'KNOWLEDGE_NOT_CONFIGURED', {}],
    [
      { kind: 'unavailable', detail: 'the provider answered 503' },
      'KNOWLEDGE_UNAVAILABLE',
      { detail: 'the provider answered 503' },
    ],
    [
      {
        kind: 'budget',
        detail: "This project's monthly cost limit is used up.",
      },
      'BUDGET_EXCEEDED',
      { detail: "This project's monthly cost limit is used up." },
    ],
  ])(
    'fails a refused search with its cause: %j [CONN-R21]',
    async (refusal, reason, params) => {
      const { native } = searchWith({ ok: false, refusal });
      const error = await refusalOf(native({ query: 'refunds' }, stepOf()));
      expect(error).toMatchObject({
        connector: 'knowledge',
        action: 'search',
        failure: { reason, params },
      });
      expect(error.hint).toBeTruthy();
    },
  );

  it('fails a run that acts nowhere without claiming a cause it cannot name', async () => {
    const { native } = searchWith({ ok: false, refusal: { kind: 'no_scope' } });
    const error = await refusalOf(native({ query: 'refunds' }, stepOf()));
    expect(error.code).toBe('LIVE_BODY_FAILED');
    expect(error).not.toHaveProperty('failure');
  });
});
