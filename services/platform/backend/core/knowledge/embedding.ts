'use node';

/**
 * Turning text into vectors, with the model named explicitly.
 *
 * Two things are deliberate here.
 *
 * **The model is configuration, not a default.** An organization states which
 * provider credential authorizes the calls, which model tag to send, and — most
 * importantly — how wide the vectors are. Nothing is inferred from the model
 * name. A guessed width is right for the tags we happen to know and silently
 * wrong for a new one, a self-hosted model, or a provider that truncates on
 * request; and the damage is invisible, because writes succeed and only
 * retrieval quality collapses. An organization with no embedding configuration
 * gets a refusal that says what to configure, never a guess.
 *
 * **The credential comes from the one credential path.** Secrets are resolved
 * by `resolveProviderCredential`, the same seam chat and the sandbox use, so
 * API keys, deployment env references, and broker tokens all behave identically
 * here and there is no second place where a stored secret is decrypted.
 *
 * The resolved key stays inside this module: it is passed to the SDK and never
 * returned, logged, or attached to an error.
 */

import OpenAI from 'openai';

import { logger } from '../../../lib/knowledge/logger';
import type { QueryEmbedder } from '../../../lib/knowledge/retrieve';
import type { EmbeddingModel } from '../../../lib/knowledge/types';
import type { KnowledgeEmbeddingConfig } from '../../../lib/shared/schemas/knowledge';
import type { ActionCtx } from '../lib/ctx';
import { resolveProvidersForOrgId } from '../lib/providers/org_providers';
import { resolveProviderCredential } from '../provider_credentials/resolve_credential';
import { assertVectorWidth } from './dimensions';

/** Texts per request. Providers cap batch size, and a smaller batch also caps
 * how much work one failure throws away. */
export const MAX_BATCH = 128;

/** Concurrent requests in flight. Enough to keep indexing moving, low enough
 * not to trip a provider's rate limit on the first large document. */
const MAX_CONCURRENCY = 3;

const RETRIES = 3;
const RETRY_BASE_MS = 1000;

/** Raised when an organization has not said which embedding model to use. */
export class EmbeddingNotConfigured extends Error {
  constructor(orgSlug: string) {
    super(
      `Organization "${orgSlug}" has no embedding model configured, so its knowledge cannot be indexed or searched. Configure one — provider, model, and the exact vector width — before using knowledge.`,
    );
    this.name = 'EmbeddingNotConfigured';
  }
}

/**
 * Embeds text with an organization's configured model.
 *
 * Satisfies the retrieval core's {@link QueryEmbedder} seam, so retrieval never
 * learns which provider is behind it.
 */
export class Embedder implements QueryEmbedder {
  readonly model: EmbeddingModel;
  private readonly client: OpenAI;
  private inFlight = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(model: EmbeddingModel, apiKey: string) {
    this.model = model;
    this.client = new OpenAI({
      apiKey,
      ...(model.baseUrl !== undefined && { baseURL: model.baseUrl }),
    });
  }

  get dimensions(): number {
    return this.model.dimensions;
  }

  /** Embed one query. */
  async embed(text: string): Promise<readonly number[]> {
    const [vector] = await this.embedAll([text]);
    return vector ?? [];
  }

  /**
   * Embed many texts, in batches.
   *
   * Every returned vector is checked against the configured width before it
   * reaches a caller: a provider that quietly ignores the requested dimensions
   * would otherwise poison the corpus one batch at a time.
   */
  async embedAll(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      batches.push(texts.slice(i, i + MAX_BATCH));
    }
    const results = await Promise.all(
      batches.map((batch) => this.embedBatch(batch)),
    );
    return results.flat();
  }

  private async embedBatch(batch: readonly string[]): Promise<number[][]> {
    // An empty or whitespace-only text has no meaning to embed and some
    // providers reject it outright, so those positions are filled with a zero
    // vector and the rest of the batch is sent.
    const sendable: { index: number; text: string }[] = [];
    for (const [index, text] of batch.entries()) {
      if (text.trim() !== '') sendable.push({ index, text });
    }
    const filled: number[][] = batch.map(() => this.zeros());
    if (sendable.length === 0) return filled;

    await this.acquire();
    try {
      const vectors = await this.request(sendable.map((entry) => entry.text));
      for (const [position, entry] of sendable.entries()) {
        const vector = vectors[position];
        if (vector === undefined) continue;
        assertVectorWidth(
          vector,
          this.model.dimensions,
          `the embedding model "${this.model.model}"`,
        );
        filled[entry.index] = vector;
      }
      return filled;
    } finally {
      this.release();
    }
  }

  /** One provider call, retried on the failures that are worth retrying. */
  private async request(texts: readonly string[]): Promise<number[][]> {
    let lastError: unknown;
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      try {
        const response = await this.client.embeddings.create({
          model: this.model.model,
          input: [...texts],
          dimensions: this.model.dimensions,
        });
        const vectors: number[][] = [];
        for (const item of response.data) vectors.push(item.embedding);
        return vectors;
      } catch (err) {
        lastError = err;
        if (!isRetryable(err) || attempt === RETRIES - 1) throw err;
        const delay = RETRY_BASE_MS * 2 ** attempt + Math.random() * 500;
        logger.warn(
          `the embedding request failed (attempt ${attempt + 1} of ${RETRIES}), retrying`,
        );
        await sleep(delay);
      }
    }
    throw lastError;
  }

  private zeros(): number[] {
    return new Array<number>(this.model.dimensions).fill(0);
  }

  private async acquire(): Promise<void> {
    if (this.inFlight < MAX_CONCURRENCY) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.inFlight++;
  }

  private release(): void {
    this.inFlight--;
    this.waiting.shift()?.();
  }
}

/**
 * Build an embedder for an organization from its configuration and its
 * credential.
 *
 * Throws {@link EmbeddingNotConfigured} when no model is configured — knowledge
 * is unusable for that organization until one is, and saying so is better than
 * writing vectors nobody can search.
 */
export async function embedderForOrg(
  ctx: ActionCtx,
  args: {
    readonly organizationId: string;
    readonly orgSlug: string;
    readonly config: KnowledgeEmbeddingConfig | null;
  },
): Promise<Embedder> {
  if (args.config === null) throw new EmbeddingNotConfigured(args.orgSlug);

  const credential = await resolveProviderCredential(ctx, {
    organizationId: args.organizationId,
    providerSlug: args.config.providerSlug,
    ...(args.config.credentialId !== undefined && {
      credentialId: args.config.credentialId,
    }),
  });

  const secret = 'secret' in credential ? credential.secret : credential.token;
  // A per-credential endpoint (an Azure-style deployment) wins over the config's
  // base URL: the credential is what the endpoint belongs to. When neither
  // names one, fall back to the provider CONNECTOR's own base URL — the
  // settings form leaves the endpoint optional (few admins know a provider's
  // API origin by heart), and without this fallback a config without one
  // would silently send its key to the OpenAI SDK's default host.
  const endpoint =
    'endpointUrl' in credential ? credential.endpointUrl : undefined;
  const baseUrl =
    endpoint ??
    args.config.baseUrl ??
    (await connectorBaseUrl(
      ctx,
      args.organizationId,
      args.config.providerSlug,
    ));

  return new Embedder(
    {
      providerSlug: args.config.providerSlug,
      model: args.config.model,
      dimensions: args.config.dimensions,
      ...(baseUrl !== undefined && { baseUrl }),
    },
    secret,
  );
}

/** The provider connector's declared API origin, resolved through the same
 * per-org connector set every other call uses; undefined when the connector
 * is gone or declares none (the SDK default then applies, as before). */
async function connectorBaseUrl(
  ctx: ActionCtx,
  organizationId: string,
  providerSlug: string,
): Promise<string | undefined> {
  try {
    const connectors = await resolveProvidersForOrgId(ctx, organizationId);
    return connectors.find((connector) => connector.name === providerSlug)
      ?.baseUrl;
  } catch (error) {
    console.warn(
      `[knowledge] could not resolve the "${providerSlug}" connector's base URL:`,
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}

function isRetryable(err: unknown): boolean {
  return (
    err instanceof OpenAI.RateLimitError ||
    err instanceof OpenAI.APIConnectionError ||
    err instanceof OpenAI.APIConnectionTimeoutError ||
    err instanceof OpenAI.InternalServerError
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
