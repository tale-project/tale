import { sameEmbeddingModel } from '@tale/shared/config/platform-resources';
import { knowledgeEmbeddingWriteSchema } from '@tale/shared/schemas/knowledge';
import type { SettingsEffect } from '@tale/shared/schemas/settings-kinds';
import { configurationHash } from '@tale/shared/utils/configuration-hash';

import { approxCountDocumentsForOrg } from '../documents/service.ts';
import {
  identifySingle,
  parseSettingsConfig,
  settingsActor,
  SettingsRefusalError,
} from '../mcp/settings/kit.ts';
import type {
  SettingsContext,
  SettingsKindHandler,
  SettingsResource,
} from '../mcp/settings/registry.ts';
import { countWebsites } from '../websites/service.ts';
import {
  checkKnowledgeEmbedding,
  readKnowledgeEmbeddingView,
  resolveKeptEmbeddingSettings,
} from './admin.ts';
import {
  assertKnowledgeAdmin,
  mayManageKnowledge,
  saveKnowledgeEmbedding,
} from './embedding-save.ts';

/**
 * The organization's embedding model as a settings kind over MCP
 * (`knowledge-embedding`): one resource, read and saved through the writer
 * the Data residency page uses (`embedding-save.ts`), with its gate, its
 * compare-and-set, its audit row and the documents and websites that
 * follow a save.
 *
 * A change of the model itself — provider, credential, model, width or
 * endpoint — is taken only while the knowledge base is empty, as a
 * declaration applied by the CLI takes it: vectors of two models must never
 * meet in one search, and a model of the same width would find the old
 * vectors and compare against them. The similarity floor and the serving
 * limits change at any time.
 */

/** How many documents and websites the organization's knowledge base
 * holds — what a change of the model would leave in another model's
 * vectors. */
async function corpusOf(ctx: SettingsContext) {
  const [documents, websites] = await Promise.all([
    approxCountDocumentsForOrg(ctx.sql, ctx.caller.organizationId),
    countWebsites(ctx.sql, ctx.caller.organizationId),
  ]);
  return { documents, websites };
}

async function readEmbedding(
  ctx: SettingsContext,
): Promise<SettingsResource | null> {
  assertKnowledgeAdmin(ctx.caller.role);
  const view = await readKnowledgeEmbeddingView(ctx.caller.orgSlug);
  if (view.config === null || view.hash === null) return null;
  return { id: null, config: view.config, hash: view.hash };
}

export const knowledgeEmbeddingSettings: SettingsKindHandler = {
  kind: 'knowledge-embedding',
  access: async ({ caller }) => {
    const allowed = mayManageKnowledge(caller.role);
    return { read: allowed, write: allowed };
  },
  identify: identifySingle('knowledge-embedding'),
  list: async (ctx) => {
    const current = await readEmbedding(ctx);
    return { items: current === null ? [] : [current], nextCursor: null };
  },
  read: async (ctx) => readEmbedding(ctx),
  plan: async (ctx, change, current) => {
    assertKnowledgeAdmin(ctx.caller.role);
    parseSettingsConfig(
      knowledgeEmbeddingWriteSchema,
      change.config,
      'the embedding model',
    );
    const written = checkKnowledgeEmbedding(ctx.caller.orgSlug, change.config);
    const view = await readKnowledgeEmbeddingView(ctx.caller.orgSlug);
    const after = resolveKeptEmbeddingSettings(written, view.config);
    const unchanged =
      current !== null &&
      configurationHash(after) === configurationHash(current.config);
    const effects: SettingsEffect[] = [];
    if (!unchanged && !sameEmbeddingModel(after, current?.config ?? null)) {
      const corpus = await corpusOf(ctx);
      if (corpus.documents > 0 || corpus.websites > 0) {
        throw new SettingsRefusalError(
          'EMBEDDING_CORPUS_NOT_EMPTY',
          `the embedding model changes only while the knowledge base is empty; it holds ${corpus.documents} documents and ${corpus.websites} websites`,
          {
            status: 409,
            hint: 'the similarity floor and the serving limits change at any time; for another model, tell the person to change it in Tale, under Settings > Data residency, where what is indexed is queued again',
            data: corpus,
          },
        );
      }
      effects.push('requires-empty-corpus');
    }
    return { after, unchanged, effects };
  },
  apply: async (ctx, change, expectedHash) => {
    await saveKnowledgeEmbedding(
      ctx.sql,
      {
        organizationId: ctx.caller.organizationId,
        orgSlug: ctx.caller.orgSlug,
      },
      change.config,
      expectedHash,
      await settingsActor(ctx),
    );
    return { hash: (await readEmbedding(ctx))?.hash ?? null };
  },
};
