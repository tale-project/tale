// @vitest-environment node

/**
 * The composer's model listing asked for each shipped provider's default
 * credential one by one — a dozen reads, some twice — on every app boot.
 * The shim handlers answer them from one read per organization for as
 * long as they live (one request, one turn).
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { credentialShimHandlers } from './service.ts';

type Statement = { text: string; values: unknown[] };

function recordingSql(
  answer: (
    text: string,
    values: unknown[],
  ) => unknown[] | Error | Promise<unknown[]>,
) {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    const result = answer(text, values);
    return result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve(result);
  };
  const sql = Object.assign(tag, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: sql as unknown as Sql, statements };
}

const ROWS = [
  {
    _id: 'cred-openai',
    organizationId: 'org-1',
    providerSlug: 'openai',
    authMethod: 'api-key',
    name: 'OpenAI',
    encryptedData: null,
    envName: null,
    endpointUrl: null,
    modelAllowlist: null,
    status: 'active',
  },
  {
    _id: 'cred-mistral',
    organizationId: 'org-1',
    providerSlug: 'mistral',
    authMethod: 'env',
    name: 'Mistral',
    encryptedData: null,
    envName: 'MISTRAL_KEY',
    endpointUrl: null,
    modelAllowlist: ['mistral-large'],
    status: 'active',
  },
];

const DEFAULT = 'provider_credentials/queries:getDefaultCredentialInternal';
const FAILURE = 'provider_credentials/mutations:recordBrokerFailureInternal';

function lookup(
  handlers: ReturnType<typeof credentialShimHandlers>,
  providerSlug: string,
  organizationId = 'org-1',
) {
  const handler = handlers[DEFAULT];
  if (!handler) throw new Error('no default-credential handler');
  return handler({ organizationId, providerSlug });
}

const isDefaultsRead = (s: Statement) =>
  s.text.includes('FROM app.provider_credentials') &&
  s.text.includes('is_default');

describe('default credential reads in one shim', () => {
  it('answers every provider of an organization from one read', async () => {
    const { sql, statements } = recordingSql(() => ROWS);
    const handlers = credentialShimHandlers(sql);
    expect(await lookup(handlers, 'openai')).toMatchObject({
      _id: 'cred-openai',
      encryptedData: undefined,
      envName: undefined,
    });
    expect(await lookup(handlers, 'mistral')).toMatchObject({
      _id: 'cred-mistral',
      envName: 'MISTRAL_KEY',
      modelAllowlist: ['mistral-large'],
    });
    expect(await lookup(handlers, 'anthropic')).toBeNull();
    expect(await lookup(handlers, 'openai')).toMatchObject({
      _id: 'cred-openai',
    });
    expect(statements.filter(isDefaultsRead)).toHaveLength(1);
    expect(statements[0]?.values).toContain('org-1');
  });

  it('reads each organization once, and a new shim reads again', async () => {
    const otherRow = {
      ...ROWS[0],
      _id: 'cred-org-2-openai',
      organizationId: 'org-2',
      name: 'Other organization',
      endpointUrl: 'https://org-2.example.com/v1',
      modelAllowlist: ['org-2-model'],
    };
    const { sql, statements } = recordingSql((_text, values) =>
      values.includes('org-2') ? [otherRow] : ROWS,
    );
    const handlers = credentialShimHandlers(sql);
    const [first, mistral, other] = await Promise.all([
      lookup(handlers, 'openai'),
      lookup(handlers, 'mistral'),
      lookup(handlers, 'openai', 'org-2'),
    ]);
    expect(first).toMatchObject({
      _id: 'cred-openai',
      organizationId: 'org-1',
      name: 'OpenAI',
      endpointUrl: undefined,
      modelAllowlist: undefined,
    });
    expect(mistral).toMatchObject({
      _id: 'cred-mistral',
      organizationId: 'org-1',
    });
    expect(other).toMatchObject({
      _id: otherRow._id,
      organizationId: otherRow.organizationId,
      name: otherRow.name,
      endpointUrl: otherRow.endpointUrl,
      modelAllowlist: otherRow.modelAllowlist,
    });
    expect(await lookup(handlers, 'openai')).toEqual(first);
    expect(await lookup(handlers, 'openai', 'org-2')).toEqual(other);
    expect(await lookup(handlers, 'mistral', 'org-2')).toBeNull();
    expect(statements.filter(isDefaultsRead)).toHaveLength(2);
    await lookup(credentialShimHandlers(sql), 'openai');
    expect(statements.filter(isDefaultsRead)).toHaveLength(3);
  });

  it('a broker write in the same shim drops the read', async () => {
    let rows: unknown[] = ROWS;
    const refreshed = {
      ...ROWS[0],
      _id: 'cred-openai-refreshed',
      organizationId: 'org-1',
      providerSlug: 'openai',
      authMethod: 'api-key',
      name: 'Rotated OpenAI',
      encryptedData: null,
      envName: null,
      endpointUrl: null,
      modelAllowlist: ['refreshed-model'],
      status: 'active',
    };
    const { sql, statements } = recordingSql(() => rows);
    const handlers = credentialShimHandlers(sql);
    expect(await lookup(handlers, 'openai')).toMatchObject({
      _id: 'cred-openai',
    });
    rows = [refreshed];
    // Refused by its own schema, but only after the read was dropped.
    expect(() => handlers[FAILURE]?.({})).toThrow();
    expect(await lookup(handlers, 'openai')).toMatchObject({
      _id: refreshed._id,
      name: refreshed.name,
      modelAllowlist: refreshed.modelAllowlist,
    });
    expect(await lookup(handlers, 'mistral')).toBeNull();
    expect(statements.filter(isDefaultsRead)).toHaveLength(2);
  });

  it('does not remember a failed read', async () => {
    let fail = true;
    const { sql, statements } = recordingSql(() =>
      fail ? new Error('connection reset') : ROWS,
    );
    const handlers = credentialShimHandlers(sql);
    await expect(lookup(handlers, 'openai')).rejects.toThrow(
      'connection reset',
    );
    fail = false;
    expect(await lookup(handlers, 'openai')).toMatchObject({
      _id: 'cred-openai',
    });
    expect(statements.filter(isDefaultsRead)).toHaveLength(2);
  });

  it('an older rejected read cannot evict a newer generation', async () => {
    let rejectOld: (error: Error) => void = () => {
      throw new Error('old read has not started');
    };
    const oldRead = new Promise<unknown[]>((_resolve, reject) => {
      rejectOld = reject;
    });
    const refreshed = {
      ...ROWS[0],
      _id: 'cred-new-generation',
      organizationId: 'org-1',
      providerSlug: 'openai',
      name: 'New generation',
      modelAllowlist: ['new-model'],
    };
    let reads = 0;
    const { sql, statements } = recordingSql(() => {
      reads += 1;
      return reads === 1 ? oldRead : [refreshed];
    });
    const handlers = credentialShimHandlers(sql);
    const oldLookup = lookup(handlers, 'openai');
    // Attach the rejection observer before deliberately rejecting the old read.
    const oldFailure = expect(oldLookup).rejects.toThrow(
      'old connection reset',
    );
    expect(statements.filter(isDefaultsRead)).toHaveLength(1);
    expect(() => handlers[FAILURE]?.({})).toThrow();
    const newLookup = lookup(handlers, 'openai');
    expect(statements.filter(isDefaultsRead)).toHaveLength(2);
    const current = await newLookup;
    expect(current).toMatchObject({
      _id: 'cred-new-generation',
      organizationId: 'org-1',
      name: 'New generation',
      modelAllowlist: ['new-model'],
    });
    rejectOld(new Error('old connection reset'));
    await oldFailure;
    expect(await lookup(handlers, 'openai')).toEqual(current);
    expect(statements.filter(isDefaultsRead)).toHaveLength(2);
  });
});
