'use node';

/**
 * Turning text into vectors, with the model named explicitly.
 *
 * Three things are deliberate here.
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
 *
 * **The server's capacity is stated, and shared.** A self-hosted server may
 * compute one request at a time and make the others wait, so how many
 * requests Tale sends at once and how long it waits for each are facts about
 * that server, stated next to the model (`maxConcurrentRequests`,
 * `minTokensPerSecond`). The bound is held per organization and model across
 * every embedder in the process, and a request's timeout covers the queue it
 * may wait in as well as its own tokens — a timeout sized from its own
 * tokens alone abandoned queued work the server was about to finish, and the
 * retries piled more work onto the same queue.
 */

import {
  KNOWLEDGE_DEFAULT_MAX_CONCURRENT_REQUESTS,
  type KnowledgeEmbeddingConfig,
} from '@tale/shared/schemas/knowledge';
import OpenAI from 'openai';
import PQueue from 'p-queue';

import { logger } from '../../../lib/knowledge/logger';
import type { QueryEmbedder } from '../../../lib/knowledge/retrieve';
import type { EmbeddingModel } from '../../../lib/knowledge/types';
import type { ActionCtx } from '../lib/ctx';
import { resolveProvidersForOrgId } from '../lib/providers/org_providers';
import { resolveProviderCredential } from '../provider_credentials/resolve_credential';
import { assertVectorWidth } from './dimensions';

/** Texts per request. Providers cap batch size — Z.ai's embedding-3 refuses
 * more than 64 inputs outright (error 1214, raised before anything is
 * billed), the tightest cap among the shipped catalogs — and a smaller batch
 * also caps how much work one failure throws away. */
export const MAX_BATCH = 64;

const RETRIES = 3;
const RETRY_BASE_MS = 1000;

/** The longest pause a busy server may ask for (`Retry-After`) that a request
 * waits out while holding its slot. A server that asks for more is left
 * alone: the request fails, and its caller's own slower retry — the
 * indexing job's backoff — decides when to come back. */
const MAX_SERVER_ASKED_PAUSE_MS = 60_000;

/**
 * The least any provider call gets. A flat minute used to be every call's
 * budget, and it cut requests a self-hosted server was about to answer: one
 * that computes one request at a time answered a request queued behind three
 * full batches after two minutes, and every retry of the abandoned request
 * joined the same queue.
 */
export const EMBED_REQUEST_TIMEOUT_MIN_MS = 60_000;

/**
 * The most any call gets — and every call's budget while the model states no
 * throughput floor, since nothing then says how long the server's queue may
 * take: the budget of one `rag.index_file` job attempt. The SDK's own
 * default was ten minutes with two internal retries, which let one batch
 * outlive the job while pg-boss re-ran it beside the first handler (two
 * indexers per document). The SDK's retries stay off, this module's loop is
 * the ONE retry policy, and when the job's budget ends first pg-boss aborts
 * the indexing run (`EmbedOptions.signal`), which cancels the call; the
 * retry resumes after the last stored slice.
 */
export const EMBED_REQUEST_TIMEOUT_MAX_MS = 15 * 60_000;

/**
 * The most a search query gets — for each request, and for the whole search
 * including its wait for a slot and any pause between attempts. A query runs
 * inside a chat turn's tool call, which does not move the turn's heartbeat,
 * and the chat generation watchdog fails a turn whose heartbeat stood still
 * for `CHAT_GENERATION_STALE_MS` (ten minutes) as "interrupted by a
 * restart". Half of that window leaves the turn time to report the search's
 * own error instead; `domains/chat/watchdogs.test.ts` holds the ratio.
 */
export const EMBED_QUERY_TIMEOUT_MAX_MS = 5 * 60_000;

/** What a request serves: a search query a person waits on, or a batch of an
 * indexing run or a website scan. It decides the lane priority and the
 * ceiling. */
export type EmbedKind = 'query' | 'batch';

/** What a request that may be queued with this one is assumed to weigh: a
 * full batch of 64 texts of 1,024 tokens (a chunk of Tale's size runs about
 * 700–1,000 tokens). */
const QUEUED_REQUEST_TOKENS = MAX_BATCH * 1_024;

/** Head-room over the estimated work: network, a model that has to load,
 * a pass that runs long. */
const TIMEOUT_MARGIN = 1.5;

/**
 * A conservative token count for a request, from its characters alone — no
 * tokenizer here knows every model a server may run, and over-counting only
 * lengthens a wait while under-counting abandons work the server would
 * finish.
 *
 * Per UTF-16 unit: an ASCII digit, an ASCII punctuation mark or symbol, and
 * any non-ASCII unit count as a token each (tokenizers split numbers digit
 * by digit and seldom merge punctuation, accented letters or CJK); up to
 * three other ASCII characters — letters and whitespace — share one. Each
 * text adds two for the model's own markers. Prose in German, French or
 * English comes out 1.2–1.5 times its real count, a table of figures about
 * even.
 */
export function estimateEmbeddingTokens(texts: readonly string[]): number {
  let total = 0;
  for (const text of texts) {
    let own = 0;
    let shared = 0;
    for (let i = 0; i < text.length; i++) {
      if (countsAsOwnToken(text.charCodeAt(i))) own++;
      else shared++;
    }
    total += own + Math.ceil(shared / 3) + 2;
  }
  return total;
}

/** Non-ASCII, or printable ASCII that is not a letter: digits, punctuation,
 * symbols. Letters, whitespace and control characters share tokens. */
function countsAsOwnToken(code: number): boolean {
  return (
    code >= 0x80 ||
    (code >= 0x21 && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) ||
    (code >= 0x7b && code <= 0x7e)
  );
}

/**
 * How long one request of `tokens` (see {@link estimateEmbeddingTokens}) may
 * take before it is abandoned.
 *
 * Without `minTokensPerSecond`: the ceiling — {@link EMBED_QUERY_TIMEOUT_MAX_MS}
 * for a search query, {@link EMBED_REQUEST_TIMEOUT_MAX_MS} for a batch.
 * Nothing says how fast the server works through its queue, and a request
 * cut shorter than a queued one can take is the failure this module exists
 * to avoid.
 *
 * With it: queue wait plus compute. The server computes one request at a
 * time and makes the others wait, so a request may sit behind everything it
 * shares the server with — the other `maxConcurrentRequests − 1` requests
 * this process may have in flight, and `maxConcurrentRequests` more from
 * other clients (another Tale process with the same bound).
 * Each of those counts as at least a full batch, and as at least this
 * request's own size (the same bound then holds for a server that
 * interleaves passes instead). That work plus the request's own tokens,
 * at the stated rate, times {@link TIMEOUT_MARGIN}; never under
 * {@link EMBED_REQUEST_TIMEOUT_MIN_MS}, never over the ceiling. A small
 * request gets the whole queue allowance: its wait does not shrink with its
 * size.
 */
export function embeddingRequestTimeoutMs(
  tokens: number,
  model: Pick<EmbeddingModel, 'maxConcurrentRequests' | 'minTokensPerSecond'>,
  kind: EmbedKind = 'batch',
): number {
  const ceiling =
    kind === 'query'
      ? EMBED_QUERY_TIMEOUT_MAX_MS
      : EMBED_REQUEST_TIMEOUT_MAX_MS;
  const rate = model.minTokensPerSecond;
  if (rate === undefined) return ceiling;
  const bound =
    model.maxConcurrentRequests ?? KNOWLEDGE_DEFAULT_MAX_CONCURRENT_REQUESTS;
  const queued = (2 * bound - 1) * Math.max(tokens, QUEUED_REQUEST_TOKENS);
  const ms = Math.ceil(((tokens + queued) * TIMEOUT_MARGIN * 1000) / rate);
  return Math.min(ceiling, Math.max(EMBED_REQUEST_TIMEOUT_MIN_MS, ms));
}

/**
 * One lane per organization, endpoint and model, shared by every embedder
 * in this process — each indexing job, website scan and search builds its
 * own embedder, and a bound kept per embedder let five jobs put fifteen
 * requests on a server sized for three. The organization is part of the key
 * because a lane is a queue callers wait in, and nothing one organization
 * does may hold up another's; organizations that share one server divide its
 * capacity through their own bounds.
 *
 * p-queue keeps a lane first come, first served within a priority (search
 * queries before batches, see `QUERY_PRIORITY`), drops a caller that
 * gives up while waiting, and frees a slot however the work ends. No
 * p-queue `timeout` is set: it would free the slot while the request still
 * ran.
 *
 * A lane admits no more requests than the lowest bound any live request was
 * made under. Embedders keep the configuration they were built from — an
 * indexing run or a website scan for as long as it lasts — so a lowered
 * bound applies at once, and a raised one once no request made under the
 * lower one is waiting or in flight. A lane is forgotten once no caller
 * holds or awaits it.
 */
interface Lane {
  readonly queue: PQueue;
  /** How many live requests were made under each bound. */
  readonly bounds: Map<number, number>;
}

/**
 * The most texts one request may carry per lane (organization, endpoint and
 * model), once the provider has said so (see {@link batchCapFrom}). Learned
 * from the first refusal and kept for the process's lifetime — apart from the
 * lanes themselves, which come and go with their queues — so every later
 * document on the same provider starts below the cap instead of paying the
 * refused request again.
 */
const batchCaps = new Map<string, number>();

/** The batch cap a lane has learned, else the shipped default. */
function laneBatchCap(key: string): number {
  return batchCaps.get(key) ?? MAX_BATCH;
}

function rememberBatchCap(key: string, cap: number): void {
  batchCaps.set(key, Math.min(batchCaps.get(key) ?? cap, cap));
}

/**
 * A 400 that names the request's batch as too large. OpenAI-compatible
 * providers cap the inputs per embedding call well under the shipped
 * `MAX_BATCH` — DashScope's compatible mode at 10 or 25 depending on the
 * model, spelled "batch size is invalid, it should not be larger than 25" —
 * and a document with more chunks than that could never index. The number
 * the message names is the cap; a message that names none halves the batch.
 */
const BATCH_TOO_LARGE =
  /batch[ _]?size|too many inputs|input array|array too long/i;
const BATCH_CAP_NUMBER =
  /(?:larger than|greater than|at most|exceed(?:s|ed)?|maximum(?: of)?|max(?: of)?|limit(?: of| is)?)\D{0,12}(\d+)/i;

function batchCapFrom(err: unknown, sent: number): number | undefined {
  if (!(err instanceof OpenAI.APIError) || err.status !== 400) return undefined;
  if (sent <= 1 || !BATCH_TOO_LARGE.test(err.message)) return undefined;
  const named = Number.parseInt(
    BATCH_CAP_NUMBER.exec(err.message)?.[1] ?? '',
    10,
  );
  const cap =
    Number.isFinite(named) && named >= 1 && named < sent
      ? named
      : Math.floor(sent / 2);
  return cap >= 1 ? cap : undefined;
}

const lanes = new Map<string, Lane>();

/** A search query's place in a lane: a person is waiting on it, while a
 * batch is a backlog. The query takes the next free slot ahead of queued
 * batches and never interrupts one in flight. */
const QUERY_PRIORITY = 1;
const BATCH_PRIORITY = 0;

async function inLane<T>(
  key: string,
  bound: number,
  options: { readonly signal?: AbortSignal; readonly priority: number },
  work: () => Promise<T>,
): Promise<T> {
  let lane = lanes.get(key);
  if (lane === undefined) {
    lane = { queue: new PQueue({ concurrency: bound }), bounds: new Map() };
    lanes.set(key, lane);
  }
  lane.bounds.set(bound, (lane.bounds.get(bound) ?? 0) + 1);
  applyLowestBound(lane);
  try {
    return await lane.queue.add(work, options);
  } finally {
    const left = (lane.bounds.get(bound) ?? 1) - 1;
    if (left > 0) lane.bounds.set(bound, left);
    else lane.bounds.delete(bound);
    if (lane.bounds.size > 0) applyLowestBound(lane);
    else if (lanes.get(key) === lane) lanes.delete(key);
  }
}

function applyLowestBound(lane: Lane): void {
  const lowest = Math.min(...lane.bounds.keys());
  if (lane.queue.concurrency !== lowest) lane.queue.concurrency = lowest;
}

/** Raised when an organization has not said which embedding model to use. */
export class EmbeddingNotConfigured extends Error {
  constructor(orgSlug: string) {
    super(
      `Organization "${orgSlug}" has no embedding model configured, so its knowledge cannot be indexed or searched. Configure one — provider, model, and the exact vector width — before using knowledge.`,
    );
    this.name = 'EmbeddingNotConfigured';
  }
}

export interface EmbedderOptions {
  /** The organization whose in-flight bound this embedder shares. */
  readonly organizationId?: string;
}

export interface EmbedOptions {
  /**
   * The caller has given up — an indexing job pg-boss cancelled at its
   * budget or on shutdown. A request still waiting for a slot leaves the
   * queue unsent, one in flight is cancelled, and no retry follows.
   */
  readonly signal?: AbortSignal;
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
  private readonly lane: string;

  constructor(
    model: EmbeddingModel,
    apiKey: string,
    options: EmbedderOptions = {},
  ) {
    this.model = model;
    this.lane = JSON.stringify([
      options.organizationId ?? '',
      model.baseUrl ?? '',
      model.model,
    ]);
    this.client = new OpenAI({
      apiKey,
      ...(model.baseUrl !== undefined && { baseURL: model.baseUrl }),
      timeout: EMBED_REQUEST_TIMEOUT_MAX_MS,
      // `request()` below retries the failures worth retrying; the SDK
      // retrying the same classes underneath it multiplied both the wait
      // and the load on a rate-limited provider.
      maxRetries: 0,
    });
  }

  get dimensions(): number {
    return this.model.dimensions;
  }

  /** Embed one search query — ahead of queued batches in the lane, and
   * never longer than {@link EMBED_QUERY_TIMEOUT_MAX_MS} in all. */
  async embed(text: string): Promise<readonly number[]> {
    const [vector] = await this.embedTexts([text], {}, 'query');
    return vector ?? [];
  }

  /**
   * Embed many texts, in batches.
   *
   * Every returned vector is checked against the configured width before it
   * reaches a caller: a provider that quietly ignores the requested dimensions
   * would otherwise poison the corpus one batch at a time.
   */
  async embedAll(
    texts: readonly string[],
    options: EmbedOptions = {},
  ): Promise<number[][]> {
    return this.embedTexts(texts, options, 'batch');
  }

  /**
   * One call's batches succeed or fail together. The first batch to fail
   * stops the others — a queued one leaves the lane unsent, a running one is
   * cancelled, and the server drops work whose client disconnected — so no
   * slot is held for vectors nobody will store. Its error is the one the
   * caller sees; the aborts of the batches it stopped never replace it. A
   * search also stops at its ceiling, wherever it is, with the timeout error
   * a slow provider call raises.
   *
   * The batches run on a signal of their own that follows the caller's: the
   * SDK leaves a listener on every signal it is handed, and an indexing job
   * hands every slice the same long-lived job signal.
   */
  private async embedTexts(
    texts: readonly string[],
    options: EmbedOptions,
    kind: EmbedKind,
  ): Promise<number[][]> {
    options.signal?.throwIfAborted();
    if (texts.length === 0) return [];
    const batches: string[][] = [];
    const cap = laneBatchCap(this.lane);
    for (let i = 0; i < texts.length; i += cap) {
      batches.push(texts.slice(i, i + cap));
    }
    const stop = new AbortController();
    const signal =
      options.signal === undefined
        ? stop.signal
        : AbortSignal.any([options.signal, stop.signal]);
    const ceiling =
      kind === 'query'
        ? new DOMException('The search reached its ceiling', 'TimeoutError')
        : undefined;
    const deadline =
      ceiling === undefined
        ? undefined
        : setTimeout(() => stop.abort(ceiling), EMBED_QUERY_TIMEOUT_MAX_MS);
    // The first failure is recorded where it happens: a batch stopped while
    // running settles with the stop's abort, whatever its own request did.
    const first: { failure?: { readonly error: unknown } } = {};
    const fail = (error: unknown): void => {
      if (first.failure !== undefined) return;
      first.failure = { error };
      stop.abort();
    };
    try {
      const settled = await Promise.allSettled(
        batches.map(async (batch) => {
          try {
            return await this.embedBatch(batch, signal, kind, fail);
          } catch (error) {
            fail(error);
            throw error;
          }
        }),
      );
      if (first.failure !== undefined) {
        if (
          ceiling !== undefined &&
          stop.signal.reason === ceiling &&
          options.signal?.aborted !== true
        ) {
          throw new OpenAI.APIConnectionTimeoutError({
            message: `The embedding server did not answer the search within ${EMBED_QUERY_TIMEOUT_MAX_MS / 60_000} minutes.`,
          });
        }
        throw first.failure.error;
      }
      return settled.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : [],
      );
    } finally {
      clearTimeout(deadline);
    }
  }

  private async embedBatch(
    batch: readonly string[],
    signal: AbortSignal,
    kind: EmbedKind,
    fail: (error: unknown) => void,
  ): Promise<number[][]> {
    // An empty or whitespace-only text has no meaning to embed and some
    // providers reject it outright, so those positions are filled with a zero
    // vector and the rest of the batch is sent.
    const sendable: { index: number; text: string }[] = [];
    for (const [index, text] of batch.entries()) {
      if (text.trim() !== '') sendable.push({ index, text });
    }
    const filled: number[][] = batch.map(() => this.zeros());
    if (sendable.length === 0) return filled;

    // The slot is held for the whole batch, retries included: a batch that
    // gave its slot up between attempts would rejoin the queue at its end.
    // A failure stops the other batches while this one still holds its
    // slot — the lane hands a freed slot on at once, and it must not go to
    // a batch that is about to be stopped.
    const texts = sendable.map((entry) => entry.text);
    const vectors = await inLane(
      this.lane,
      this.model.maxConcurrentRequests ??
        KNOWLEDGE_DEFAULT_MAX_CONCURRENT_REQUESTS,
      {
        signal,
        priority: kind === 'query' ? QUERY_PRIORITY : BATCH_PRIORITY,
      },
      async () => {
        try {
          return await this.request(texts, signal, kind);
        } catch (error) {
          // The provider refused the batch as too large: learn its cap for
          // the lane and send this batch again in parts, inside the slot it
          // already holds. Any other failure stops the call as before.
          const cap = batchCapFrom(error, texts.length);
          if (cap === undefined) {
            fail(error);
            throw error;
          }
          rememberBatchCap(this.lane, cap);
          console.info(
            `[knowledge] the embedding provider caps a request at ${cap} text(s) for "${this.model.model}"; sending ${texts.length} in parts`,
          );
          try {
            const parts: number[][] = [];
            for (let i = 0; i < texts.length; i += cap) {
              parts.push(
                ...(await this.request(texts.slice(i, i + cap), signal, kind)),
              );
            }
            return parts;
          } catch (inner) {
            fail(inner);
            throw inner;
          }
        }
      },
    );
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
  }

  /** One provider call, retried on the failures that are worth retrying. */
  private async request(
    texts: readonly string[],
    signal: AbortSignal,
    kind: EmbedKind,
  ): Promise<number[][]> {
    const timeout = embeddingRequestTimeoutMs(
      estimateEmbeddingTokens(texts),
      this.model,
      kind,
    );
    let lastError: unknown;
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      signal.throwIfAborted();
      try {
        const response = await this.client.embeddings.create(
          {
            model: this.model.model,
            input: [...texts],
            dimensions: this.model.dimensions,
            // Stated explicitly because the SDK otherwise asks for base64 and
            // then base64-decodes whatever comes back WITHOUT checking that it
            // is a string. An OpenAI-compatible provider that ignores the
            // parameter (Z.ai does) answers with a plain float array, which
            // that decoder turns into a short vector of zeros — 256 of them for
            // a 1024-wide request (observed 2026-09-06). The width check below
            // caught it, but only because the garbage happened to be the wrong
            // length; asking for floats makes the response unambiguous.
            encoding_format: 'float',
          },
          { timeout, signal },
        );
        const vectors: number[][] = [];
        for (const item of response.data) vectors.push(item.embedding);
        return vectors;
      } catch (err) {
        lastError = err;
        if (signal.aborted || !isRetryable(err) || attempt === RETRIES - 1) {
          throw err;
        }
        const asked = serverAskedPauseMs(err);
        if (asked !== undefined && asked > MAX_SERVER_ASKED_PAUSE_MS) throw err;
        const delay = Math.max(
          RETRY_BASE_MS * 2 ** attempt + Math.random() * 500,
          asked ?? 0,
        );
        logger.warn(
          `the embedding request failed (attempt ${attempt + 1} of ${RETRIES}), retrying`,
        );
        await sleep(delay, signal);
      }
    }
    throw lastError;
  }

  private zeros(): number[] {
    return new Array<number>(this.model.dimensions).fill(0);
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
      ...(args.config.maxConcurrentRequests !== undefined && {
        maxConcurrentRequests: args.config.maxConcurrentRequests,
      }),
      ...(args.config.minTokensPerSecond !== undefined && {
        minTokensPerSecond: args.config.minTokensPerSecond,
      }),
    },
    secret,
    { organizationId: args.organizationId },
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

/** Refusal codes that name the ACCOUNT rather than the request: Z.ai's
 * 1113 (insufficient balance / no resource package) and 1311 (the
 * subscription plan does not include the model), and OpenAI's billing and
 * spend-limit codes. Every one arrives as HTTP 429 or 402 — which reads as
 * "wait and retry" when no wait helps. */
const CREDIT_REFUSAL_CODES: ReadonlySet<string> = new Set([
  '1113',
  '1311',
  'insufficient_quota',
  'billing_hard_limit_reached',
  'billing_not_active',
  'credit_balance_exhausted',
  'insufficient_credits',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
]);

/** The same refusals where a provider sends no stable code: wording that
 * names balance, plan or billing — never a per-minute limit. */
const CREDIT_REFUSAL_MESSAGE =
  /insufficient balance|no resource package|please recharge|subscription plan does not|not included in your (plan|package|subscription)|insufficient[_ ]quota|exceeded your current quota|credit balance|insufficient credits|spend limit|billing|payment required|purchase (more )?credits/i;

/** Whether a provider refusal is about the ACCOUNT — out of balance, over a
 * spend limit, or a plan that excludes the model. Waiting fixes nothing and
 * a retry re-bills the same refusal, so these are excluded from the retry
 * loop and mapped to a stable non-retryable error at the boundaries. */
function isCreditRefusal(err: unknown): boolean {
  if (!(err instanceof OpenAI.APIError)) return false;
  if (err.status === 402) return true;
  if (typeof err.code === 'string' && CREDIT_REFUSAL_CODES.has(err.code)) {
    return true;
  }
  return CREDIT_REFUSAL_MESSAGE.test(err.message);
}

/** A credential the provider rejected (401) or one that may not use the
 * model (403): configuration an admin fixes, never weather to wait out. */
function isCredentialRefusal(err: unknown): boolean {
  return (
    err instanceof OpenAI.AuthenticationError ||
    err instanceof OpenAI.PermissionDeniedError
  );
}

/** How an embedding call failed: `credit` — the provider refused the account
 * (balance, plan, billing); `credential` — it rejected the key or refused
 * it the model; `upstream` — anything else (a rate limit, a 5xx, unreachable,
 * a timeout), worth a later retry. */
export type EmbeddingFailure = 'credit' | 'credential' | 'upstream';

/** Classify an error from the provider call for the callers that turn it
 * into a stable platform code. Null when the error did not come from the
 * provider call at all. */
export function classifyEmbeddingFailure(
  err: unknown,
): EmbeddingFailure | null {
  if (!(err instanceof OpenAI.APIError)) return null;
  if (isCreditRefusal(err)) return 'credit';
  if (isCredentialRefusal(err)) return 'credential';
  return 'upstream';
}

/**
 * Whether sending the request again right away can help without piling work
 * onto the server. A timeout never qualifies: the request was in the
 * server's hands for its whole budget (the SDK reports a connection that
 * never opened as a connection error, well before that), so the server was
 * working through its queue or stuck, and a repeat would only lengthen the
 * queue. A refused or dropped connection, a rate limit and a server error
 * are retried after a pause.
 */
function isRetryable(err: unknown): boolean {
  if (isCreditRefusal(err) || isCredentialRefusal(err)) return false;
  if (err instanceof OpenAI.APIConnectionTimeoutError) return false;
  return (
    err instanceof OpenAI.RateLimitError ||
    err instanceof OpenAI.APIConnectionError ||
    err instanceof OpenAI.InternalServerError
  );
}

/** The pause a busy server asked for, in milliseconds (`retry-after-ms`, or
 * `retry-after` as seconds or an HTTP date); undefined when it named none. */
function serverAskedPauseMs(err: unknown): number | undefined {
  if (!(err instanceof OpenAI.APIError)) return undefined;
  const ms = Number.parseFloat(err.headers?.get('retry-after-ms') ?? '');
  if (Number.isFinite(ms) && ms >= 0) return ms;
  const value = err.headers?.get('retry-after');
  if (value === undefined || value === null || value.trim() === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** The pause between attempts, cut short when the call is stopped — its
 * caller gave up, another batch failed, or a search reached its ceiling.
 * Built on the global timer, which the retry tests' fake clock controls. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      reject(
        new Error('The embedding request was stopped before its next attempt', {
          cause: signal.reason,
        }),
      );
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal.addEventListener('abort', stop, { once: true });
  });
}
