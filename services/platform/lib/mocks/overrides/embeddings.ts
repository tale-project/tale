/**
 * Embeddings override. The knowledge-db schema stores `vector(1536)`;
 * Prism serves the spec's example — a one-element vector — which Postgres
 * rejects at insert ("expected 1536 dimensions, not 1"), so document
 * indexing can never succeed against the Prism route. This override serves
 * real-shaped embeddings: 1536 dimensions, deterministic per input text
 * (re-runs are byte-stable, and distinct texts land distinct vectors, so
 * similarity search over the mock corpus stays meaningful).
 */

export const EMBEDDING_DIMENSIONS = 1536;

export function isEmbeddingsRoute(method: string, pathname: string): boolean {
  return method === 'POST' && pathname === '/v1/embeddings';
}

/** FNV-1a — a tiny, stable string hash to seed the per-text generator. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — deterministic PRNG; quality is irrelevant, stability isn't. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function embeddingFor(text: string): number[] {
  const next = mulberry32(fnv1a(text));
  const vector = new Array<number>(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    vector[i] = next() * 2 - 1;
  }
  return vector;
}

/** Recursive JSON value — the only thing a JSON body can yield. Parsing via
 *  `JSON.parse` (which yields `any`, freely assignable to this union) keeps
 *  every downstream read type-safe without an unsafe assertion. */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export async function handleEmbeddings(request: Request): Promise<Response> {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(await request.text());
  } catch (error) {
    console.warn('[mocks] embeddings: unparseable body', error);
    return Response.json(
      { error: { message: 'invalid JSON body' } },
      { status: 400 },
    );
  }
  const body =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed
      : {};
  const inputs =
    typeof body.input === 'string'
      ? [body.input]
      : Array.isArray(body.input)
        ? body.input.map(String)
        : [''];
  // The OpenAI Node SDK defaults to `encoding_format: 'base64'` and decodes
  // the payload as packed little-endian Float32 bytes — serving it a float
  // array quarters the dimension count (1536 numbers read as 1536 bytes →
  // 384 floats). Honour the requested format.
  const wantsBase64 = body.encoding_format === 'base64';
  const model = typeof body.model === 'string' ? body.model : 'mock-embedding';
  console.log(
    `[mocks] embeddings (inputs=${inputs.length}, model=${model}, format=${wantsBase64 ? 'base64' : 'float'})`,
  );
  return Response.json({
    object: 'list',
    model,
    data: inputs.map((text, index) => {
      const vector = embeddingFor(text);
      return {
        object: 'embedding',
        index,
        embedding: wantsBase64
          ? Buffer.from(new Float32Array(vector).buffer).toString('base64')
          : vector,
      };
    }),
    usage: {
      prompt_tokens: inputs.length * 8,
      total_tokens: inputs.length * 8,
    },
  });
}
