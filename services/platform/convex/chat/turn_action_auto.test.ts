/**
 * The Auto path through `executeTurn`: the selection resolves to a concrete
 * (provider, model) pair BEFORE the access check, an unresolvable Auto is an
 * explicit refusal (never a silent fallback), and the recorded message rows
 * carry only the resolved model — the mode has no persisted spelling.
 *
 * `resolveChatModel` itself is unit-tested in
 * `convex/lib/providers/resolve_chat_model.test.ts`; here it is mocked so
 * these tests pin the GLUE: what executeTurn does with a pick, a refusal,
 * and a malformed selection.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ModelCall } from '../../lib/chat/turn';
import type {
  ModelCatalogEntry,
  ProviderDefinition,
} from '../../lib/shared/schemas/providers';
import type { Id } from '../_generated/dataModel';
import { getProviderCatalog } from '../lib/providers/catalog_fetch';
import { resolveProvidersForOrgId } from '../lib/providers/org_providers';
import { resolveChatModel } from '../lib/providers/resolve_chat_model';
import schema from '../schema';
import { executeTurn } from './turn_action';

vi.mock('../lib/providers/resolve_chat_model', () => ({
  resolveChatModel: vi.fn(),
}));
// `resolveModel` (the explicit-id lookup executeTurn runs AFTER Auto
// resolution) walks the org's connectors; both seams are mocked so the
// completed path stays inside convexTest — the Better Auth org-slug
// component behind `resolveProvidersForOrgId` does not exist here.
vi.mock('../lib/providers/org_providers', () => ({
  resolveProvidersForOrgId: vi.fn(),
}));
vi.mock('../lib/providers/catalog_fetch', () => ({
  getProviderCatalog: vi.fn(),
}));
const mockedResolve = vi.mocked(resolveChatModel);
const mockedProviders = vi.mocked(resolveProvidersForOrgId);
const mockedCatalog = vi.mocked(getProviderCatalog);

const ANTHROPIC_ENTRY: ModelCatalogEntry = {
  id: 'claude-haiku-4-5',
  provider: 'anthropic',
  tags: ['chat'],
  supportsTools: true,
  supportsVision: true,
  contextWindow: 200_000,
  maxOutputTokens: 64_000,
  pricing: { inputCentsPerMillion: 100, outputCentsPerMillion: 500 },
};

function armConnectorWorld(): void {
  mockedProviders.mockResolvedValue([
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal provider shape; resolveModel reads name + catalog only
    {
      name: 'anthropic',
      displayName: 'Anthropic',
      apiFormat: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      catalog: { source: 'static' },
      auth: [{ method: 'api-key' }],
    } as unknown as ProviderDefinition,
  ]);
  mockedCatalog.mockResolvedValue([ANTHROPIC_ENTRY]);
}

const TEST_DIR_FROM_CONVEX_ROOT = 'chat';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

type T = TestConvex<typeof schema>;

const ORG = 'org_auto';
const USER = 'user_auto';

/** A fake model, so the completed path never talks to a provider. */
const answeringModel: ModelCall = async function* answeringModel() {
  yield {
    text: 'Answered.',
    usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
  };
};

async function seedThread(t: T): Promise<Id<'threads'>> {
  return t.run(async (ctx) =>
    ctx.db.insert('threads', {
      organizationId: ORG,
      userId: USER,
      kind: 'direct',
      archived: false,
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

const AUTO_SEND = {
  organizationId: ORG,
  userId: USER,
  userText: 'Refactor the retry loop for me.',
  modelSelection: 'auto',
  sandbox: false,
  locale: 'en',
} as const;

afterEach(() => {
  vi.clearAllMocks();
});

describe('executeTurn — Auto resolution glue', () => {
  it('resolves Auto to a concrete pair and records only that pair', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    armConnectorWorld();
    mockedResolve.mockResolvedValue({
      ok: true,
      pick: {
        providerSlug: 'anthropic',
        modelId: 'claude-haiku-4-5',
        source: 'preferred',
        band: 'standard',
        highStakes: false,
        documentWork: false,
      },
    });

    const outcome = await t.action(async (ctx) =>
      executeTurn(ctx, { ...AUTO_SEND, threadId }, { model: answeringModel }),
    );

    expect(outcome.status).toBe('completed');
    expect(mockedResolve).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      userId: USER,
      promptText: 'Refactor the retry loop for me.',
      requiresVision: false,
      hasDocumentAttachments: false,
    });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('messages')
        .withIndex('by_thread', (q) => q.eq('threadId', threadId))
        .collect(),
    );
    const assistant = rows.find((row) => row.role === 'assistant');
    expect(assistant?.model).toBe('claude-haiku-4-5');
    expect(assistant?.providerSlug).toBe('anthropic');
    // The mode never lands in a row — only the resolved model does.
    expect(rows.every((row) => row.model !== 'auto')).toBe(true);
  });

  it('sees images in the staged attachments', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    mockedResolve.mockResolvedValue({ ok: false, refusal: 'no-vision-model' });

    // The attachment is never validated: an unresolvable Auto refuses first,
    // which is exactly the order under test (resolution precedes the gates).
    const outcome = await t.action(async (ctx) =>
      executeTurn(ctx, {
        ...AUTO_SEND,
        threadId,
        attachments: [
          {
            fileId: 'blob_img',
            fileName: 'shot.png',
            fileType: 'image/png',
            fileSize: 10,
          },
        ],
      }),
    );

    expect(mockedResolve).toHaveBeenCalledWith(
      expect.anything(),
      // An image is vision work, not document work.
      expect.objectContaining({
        requiresVision: true,
        hasDocumentAttachments: false,
      }),
    );
    expect(outcome.status).toBe('refused');
    if (outcome.status === 'refused') {
      expect(outcome.reason).toContain('view images');
    }
  });

  it('sees documents in the staged attachments', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    mockedResolve.mockResolvedValue({ ok: false, refusal: 'no-chat-model' });

    await t.action(async (ctx) =>
      executeTurn(ctx, {
        ...AUTO_SEND,
        threadId,
        userText: 'Fasse mir das Dokument zusammen',
        attachments: [
          {
            fileId: 'blob_doc',
            fileName: 'BGB.pdf',
            fileType: 'application/pdf',
            fileSize: 10,
          },
        ],
      }),
    );

    expect(mockedResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        requiresVision: false,
        hasDocumentAttachments: true,
      }),
    );
  });

  it('reads the trailing user message on a regenerate', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('messages', {
        organizationId: ORG,
        threadId,
        role: 'user',
        parts: [
          { type: 'text', text: 'Analyze the crash, please.' },
          {
            type: 'attachment',
            fileId: 'blob_img',
            name: 'crash.png',
            mediaType: 'image/png',
            sizeBytes: 10,
          },
        ],
        sequence: 1,
        createdAt: 1,
      });
    });
    mockedResolve.mockResolvedValue({ ok: false, refusal: 'no-vision-model' });

    await t.action(async (ctx) =>
      executeTurn(ctx, {
        ...AUTO_SEND,
        threadId,
        userText: '',
        resend: true,
      }),
    );

    expect(mockedResolve).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      userId: USER,
      promptText: 'Analyze the crash, please.',
      requiresVision: true,
      hasDocumentAttachments: false,
    });
  });

  it('sees documents on the trailing message of a regenerate', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('messages', {
        organizationId: ORG,
        threadId,
        role: 'user',
        parts: [
          { type: 'text', text: 'Fasse mir das Dokument zusammen' },
          {
            type: 'attachment',
            fileId: 'blob_doc',
            name: 'BGB.pdf',
            mediaType: 'application/pdf',
            sizeBytes: 10,
          },
        ],
        sequence: 1,
        createdAt: 1,
      });
    });
    mockedResolve.mockResolvedValue({ ok: false, refusal: 'no-chat-model' });

    await t.action(async (ctx) =>
      executeTurn(ctx, {
        ...AUTO_SEND,
        threadId,
        userText: '',
        resend: true,
      }),
    );

    expect(mockedResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        requiresVision: false,
        hasDocumentAttachments: true,
      }),
    );
  });

  it('maps each resolver refusal to an explicit reason', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    const reasons: Record<string, string> = {
      'no-chat-model': 'No chat model is available',
      'no-accessible-model': 'model-access policy',
      'no-vision-model': 'view images',
    };
    for (const [refusal, expected] of Object.entries(reasons)) {
      mockedResolve.mockResolvedValue({
        ok: false,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- iterating the closed refusal set
        refusal: refusal as never,
      });
      const outcome = await t.action(async (ctx) =>
        executeTurn(ctx, { ...AUTO_SEND, threadId }),
      );
      expect(outcome.status).toBe('refused');
      if (outcome.status === 'refused') {
        expect(outcome.reason).toContain(expected);
      }
    }
    // A refusal writes nothing: no user turn, no assistant row.
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('messages')
        .withIndex('by_thread', (q) => q.eq('threadId', threadId))
        .collect(),
    );
    expect(rows).toHaveLength(0);
  });

  it('refuses a call carrying both a model id and Auto', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    const outcome = await t.action(async (ctx) =>
      executeTurn(ctx, { ...AUTO_SEND, threadId, modelId: 'some-model' }),
    );
    expect(outcome.status).toBe('refused');
    if (outcome.status === 'refused') {
      expect(outcome.reason).toContain('not both');
    }
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it('refuses a call carrying neither', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    const { modelSelection: _none, ...rest } = { ...AUTO_SEND, threadId };
    const outcome = await t.action(async (ctx) => executeTurn(ctx, rest));
    expect(outcome.status).toBe('refused');
    if (outcome.status === 'refused') {
      expect(outcome.reason).toContain('A model is required');
    }
    expect(mockedResolve).not.toHaveBeenCalled();
  });
});
