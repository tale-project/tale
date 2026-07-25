/**
 * `knowledge.search` — the automation node that retrieves from the
 * organization's knowledge.
 *
 * Retrieval reaches an automation exactly two ways: this node, and the chat
 * capability. Nothing injects knowledge into a prompt on its own. Automatic
 * injection was removed deliberately — it spent context on every turn whether
 * or not the question needed it, it made an agent's answer depend on a
 * retrieval the author never wrote down, and there was no way to see from a
 * automation what it had actually read. A node makes retrieval a step: visible in
 * the document, addressable by later nodes, and testable.
 *
 * The node registers exactly like a connector action does, through the engine's
 * `registerNodeType` seam, so the engine core never learns that knowledge
 * exists — it sees one more entry in its node-type table.
 *
 *  - `outputKind: 'structured'` — the result is a shape later nodes path into
 *    (`nodes.lookup.output.hits[0].text`).
 *  - `hasEffect: false` — searching changes nothing outside the platform, so a
 *    run never records an effect for it and it is never gated behind an
 *    approval.
 *  - a deterministic MOCK — the authoring loop must work with no database at
 *    all. The mock derives its hits from the input, so the same automation
 *    produces the same run every time and an acceptance test can state the
 *    expected output.
 *
 * The live backend is INSTALLED, not imported: retrieval needs an organization,
 * a resolved database pool, and a credential, none of which belong in the
 * engine. A host binds a backend to the organization a run belongs to and
 * installs it; with none installed the node runs its mock rather than inventing
 * an answer.
 */

import { registerNodeType, type IntegrationLike } from '../engine/core/slots';
import { DEFAULT_LIMIT, MAX_LIMIT } from './retrieve';
import type { KnowledgeQuery, KnowledgeResult } from './types';

/** How an automation addresses the node. */
export const KNOWLEDGE_SEARCH_NODE_TYPE = 'knowledge.search';

/** The node's input, after the engine has resolved its templates. */
export interface KnowledgeSearchInput extends KnowledgeQuery {
  readonly query: string;
}

/** One hit as an automation sees it — the retrieval shape, flattened to the
 * fields an author would path into. */
export interface KnowledgeSearchHit {
  readonly text: string;
  readonly title: string | null;
  readonly ref: string;
  readonly url: string | null;
  readonly corpus: string;
  readonly score: number;
}

export interface KnowledgeSearchOutput {
  readonly hits: readonly KnowledgeSearchHit[];
  readonly count: number;
  /** False when the search ran without a full-text index — the answer is
   * dense-only. Surfaced so an automation can tell a degraded search from a
   * healthy one. */
  readonly fullText: boolean;
}

/**
 * The live backend seam. A host installs one bound to the organization whose
 * automation is running; the node itself never sees an organization id, so there
 * is no argument through which an automation could address another tenant's
 * corpus.
 */
export interface KnowledgeSearchBackend {
  search(input: KnowledgeSearchInput): Promise<KnowledgeResult>;
}

let backend: KnowledgeSearchBackend | null = null;

/** Install (or clear, with `null`) the live backend for this process. */
export function setKnowledgeSearchBackend(
  next: KnowledgeSearchBackend | null,
): void {
  backend = next;
}

export function knowledgeSearchBackend(): KnowledgeSearchBackend | null {
  return backend;
}

const INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      minLength: 1,
      description: 'What to look for, in the words a person would use.',
    },
    corpus: {
      type: 'string',
      enum: ['documents', 'web', 'all'],
      description:
        "Which knowledge to search: uploaded documents, crawled web pages, or both. Default 'all'.",
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_LIMIT,
      description: `Hits to return (default ${DEFAULT_LIMIT}).`,
    },
    refs: {
      type: 'array',
      items: { type: 'string' },
      description: 'Restrict to these document ids.',
    },
    folder: {
      type: 'string',
      description: 'Restrict to a folder and everything beneath it.',
    },
    minSimilarity: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description:
        'Drop vector matches below this cosine similarity before ranking.',
    },
  },
  required: ['query'],
  additionalProperties: false,
};

const OUTPUT_SIGNATURE =
  '{hits: {text: string, title: string | null, ref: string, url: string | null, corpus: string, score: number}[], count: number, fullText: boolean}';

/**
 * Deterministic mock: two hits derived from the query, so an author can build
 * and test the rest of the automation before any document is indexed.
 *
 * It answers in the SHAPE a real search answers, never with plausible content —
 * the text says it is a placeholder so a mock run can never be mistaken for a
 * grounded one.
 */
export function mockKnowledgeSearch(
  input: KnowledgeSearchInput,
): KnowledgeSearchOutput {
  const corpus = input.corpus ?? 'all';
  const wanted = corpus === 'all' ? ['documents', 'web'] : [corpus];
  const hits: KnowledgeSearchHit[] = [];
  for (const [index, from] of wanted.entries()) {
    hits.push({
      text: `[mock knowledge] a passage about "${input.query}" would appear here.`,
      title: from === 'web' ? 'Example page' : 'Example document',
      ref: from === 'web' ? 'https://example.com/page' : 'mock-document-1',
      url: from === 'web' ? 'https://example.com/page' : null,
      corpus: from,
      // Descending, so an automation that assumes ranked output behaves the same
      // against the mock as against a real search.
      score: Number((1 - index * 0.1).toFixed(2)),
    });
  }
  const limit = input.limit ?? DEFAULT_LIMIT;
  const limited = hits.slice(0, Math.max(1, limit));
  return { hits: limited, count: limited.length, fullText: true };
}

/** Reduce a retrieval result to the node's declared output shape. */
export function toNodeOutput(result: KnowledgeResult): KnowledgeSearchOutput {
  const hits: KnowledgeSearchHit[] = [];
  for (const hit of result.hits) {
    hits.push({
      text: hit.text,
      title: hit.source.title,
      ref: hit.source.ref,
      url: hit.source.url ?? null,
      corpus: hit.corpus,
      score: hit.rerankScore ?? hit.fusedScore,
    });
  }
  return { hits, count: hits.length, fullText: result.diagnostics.bm25 };
}

const integration: IntegrationLike = {
  name: KNOWLEDGE_SEARCH_NODE_TYPE,
  description:
    "Search the organization's knowledge — uploaded documents and crawled web pages — and return the passages that answer the query. Read-only. Keyword and vector search are combined automatically; there is nothing to configure.",
  inputSchema: INPUT_SCHEMA,
  outputSignature: OUTPUT_SIGNATURE,
  exampleInput: {
    query: 'parental leave policy',
    corpus: 'documents',
    limit: 5,
  },
  hasEffect: false,
  tags: ['knowledge', 'search', 'rag'],
  mock: (input) => mockKnowledgeSearch(asInput(input)),
  live: async (input) => {
    const installed = backend;
    if (!installed) {
      // A caller that asked for a real search must never be handed a fabricated
      // one, so this refuses loudly instead of quietly returning the mock.
      throw new Error(
        'no knowledge backend is installed in this deployment — knowledge.search cannot run live',
      );
    }
    return toNodeOutput(await installed.search(asInput(input)));
  },
};

/**
 * Add `knowledge.search` to the engine's node-type table.
 *
 * An explicit call rather than an import side effect: a host decides whether
 * its engine has knowledge, and a test that wants a bare engine gets one.
 * Registration is idempotent.
 */
export function registerKnowledgeSearchNode(): void {
  registerNodeType({
    type: KNOWLEDGE_SEARCH_NODE_TYPE,
    kind: 'integration',
    outputKind: 'structured',
    description: integration.description,
    allowedFields: ['input'],
    requiredFields: ['input'],
    integration,
  });
}

/**
 * Name the node's input shape. The engine has already validated it against
 * `INPUT_SCHEMA` before either behaviour runs, so this only recovers the type.
 */
function asInput(input: unknown): KnowledgeSearchInput {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the engine validates the resolved input against INPUT_SCHEMA before dispatching; this names the shape that validation guarantees
  return input as KnowledgeSearchInput;
}
