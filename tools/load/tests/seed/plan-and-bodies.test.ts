import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  KNOWLEDGE_VECTOR_WIDTHS,
  knowledgeEmbeddingWriteSchema,
} from '@tale/shared/schemas/knowledge';
import {
  providerCredentialCreateSchema,
  providerDefinitionSchema,
  providerEnvironmentCredentialSchema,
} from '@tale/shared/schemas/providers';

import { loadPlanSchema, type PlanOrganization } from '../../src/plan.ts';
import { EMBEDDING_WIDTHS, parseSeedOptions } from '../../src/seed/options.ts';
import {
  embeddingBodyFor,
  pickChatModel,
  providerCredentialBodyFor,
  providerDefinitionFor,
} from '../../src/seed/organizations.ts';
import { populationFor } from '../../src/seed/population.ts';
import {
  buildPlan,
  readPlan,
  writePlanAtomic,
} from '../../src/seed/run-seed.ts';

const options = parseSeedOptions({
  target: 'http://127.0.0.1:4105/',
  users: 300,
  orgSize: 50,
  megaOrgSize: 100,
});

describe('request bodies the seed sends', () => {
  test('the provider definition is a valid org-custom definition', () => {
    for (const catalogSource of ['models-endpoint', 'none'] as const) {
      const definition = providerDefinitionFor({
        ...options.provider,
        catalogSource,
      });
      const parsed = providerDefinitionSchema.safeParse(definition);
      expect(parsed.success).toBe(true);
      // The save path re-parses and requires the name to match the path.
      expect(parsed.data?.name).toBe(options.provider.slug);
    }
  });

  test('the env credential passes the create door and the env-credential schema', () => {
    for (const catalogSource of ['models-endpoint', 'none'] as const) {
      const body = providerCredentialBodyFor({
        ...options.provider,
        catalogSource,
      });
      expect(providerCredentialCreateSchema.safeParse(body).success).toBe(true);
      expect(providerEnvironmentCredentialSchema.safeParse(body).success).toBe(
        true,
      );
    }
    const none = providerCredentialBodyFor({
      ...options.provider,
      catalogSource: 'none',
    });
    expect(none.modelAllowlist).toEqual([options.provider.chatModel]);
  });

  test('the embedding body passes the write schema', () => {
    expect(
      knowledgeEmbeddingWriteSchema.safeParse(
        embeddingBodyFor(options.provider),
      ).success,
    ).toBe(true);
  });

  test('the local vector-width list matches the platform', () => {
    expect([...EMBEDDING_WIDTHS]).toEqual([...KNOWLEDGE_VECTOR_WIDTHS]);
  });

  test('the chat model prefers the configured id from the mock provider', () => {
    const provider = { slug: 'loadmock', chatModel: 'load-chat-fast' };
    expect(
      pickChatModel(
        [
          { id: 'gpt-x', providerSlug: 'openai' },
          { id: 'load-chat-slow', providerSlug: 'loadmock' },
          { id: 'load-chat-fast', providerSlug: 'loadmock' },
        ],
        provider,
      ),
    ).toBe('load-chat-fast');
    expect(
      pickChatModel(
        [{ id: 'load-chat-slow', providerSlug: 'loadmock' }],
        provider,
      ),
    ).toBe('load-chat-slow');
    expect(
      pickChatModel(
        [{ id: 'load-chat-fast', providerSlug: 'other' }],
        provider,
      ),
    ).toBeNull();
  });
});

describe('the plan file', () => {
  const population = populationFor({
    runId: 'abcd1234',
    emailDomain: options.emailDomain,
    password: 'Aa1!aaaaaaaaaaaa',
    sessionsMinted: true,
    users: options.users,
    orgSize: options.orgSize,
    megaOrgSize: options.megaOrgSize,
  });
  const orgs: PlanOrganization[] = [6, 0, 3].map((index) => ({
    index,
    id: `org-${index}`,
    slug: `load-abcd1234-o${index}`,
    name: `Org ${index}`,
    ownerIndex: index === 6 ? 0 : index * 50,
    projectId: `project-${index}`,
    providerSlug: 'loadmock',
    modelId: index === 3 ? null : 'load-chat-fast',
  }));
  let dir = '';

  afterAll(async () => {
    if (dir !== '') await rm(dir, { recursive: true, force: true });
  });

  test('a dry-built plan validates and lists organizations in index order', () => {
    const plan = buildPlan({
      population,
      target: options.target,
      provider: options.provider,
      organizations: orgs,
      createdAt: new Date('2026-10-08T12:00:00Z'),
    });
    expect(loadPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.target).toBe('http://127.0.0.1:4105');
    expect(plan.organizations.count).toBe(6);
    expect(plan.organizations.list.map((org) => org.index)).toEqual([0, 3, 6]);
    expect(plan.provider?.envName).toBe('TALE_PROVIDER_KEY_LOADMOCK');
  });

  test('the plan is written atomically and reads back equal', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tale-load-seed-'));
    const file = path.join(dir, 'nested', 'plan.json');
    const plan = buildPlan({
      population,
      target: options.target,
      provider: options.provider,
      organizations: orgs,
      createdAt: new Date('2026-10-08T12:00:00Z'),
    });
    await writePlanAtomic(file, plan);
    expect(await readPlan(file)).toEqual(plan);
    expect((await readFile(file, 'utf8')).endsWith('\n')).toBe(true);
  });
});
