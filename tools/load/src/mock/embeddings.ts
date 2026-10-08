/**
 * `POST /v1/embeddings`: deterministic, unit-norm vectors.
 *
 * A text's vector is seeded from the SHA-256 of the text, so the same text
 * always embeds to the same vector (re-indexing is byte-stable and a search
 * for a stored chunk's exact text finds it), distinct texts land nearly
 * orthogonal, and the requested `dimensions` are honoured. `encoding_format:
 * 'base64'` answers packed little-endian float32, which is what the OpenAI
 * SDK decodes when it is not told to ask for floats.
 */

import { createHash } from 'node:crypto';
import type { ServerResponse } from 'node:http';

import type { MockContext } from './context.ts';
import { errorReply, faultLabel, sampleFault } from './faults.ts';
import { ResponseStream, sendJson } from './http.ts';
import {
  createRandomFromWords,
  lognormalFromMedianP95,
  normal,
} from './random.ts';
import { estimateTokens } from './tokens.ts';

export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
export const MAX_EMBEDDING_DIMENSIONS = 8192;
/** Inputs one request may carry, as OpenAI caps them. */
export const MAX_EMBEDDING_INPUTS = 2048;
/** Extra latency per additional input, as a share of the sampled latency. */
const PER_INPUT_LATENCY_SHARE = 0.01;
/** Decimal places a float vector keeps on the wire. */
const FLOAT_SCALE = 1e9;

/** The unit vector of `text` in `dimensions` dimensions. */
export function embeddingVector(
  text: string,
  dimensions: number,
): Float64Array {
  const digest = createHash('sha256').update(text).digest();
  const random = createRandomFromWords(
    digest.readUInt32LE(0),
    digest.readUInt32LE(4),
    digest.readUInt32LE(8),
    digest.readUInt32LE(12),
  );
  const vector = new Float64Array(dimensions);
  let squares = 0;
  for (let i = 0; i < dimensions; i++) {
    const value = normal(random, 0, 1);
    vector[i] = value;
    squares += value * value;
  }
  const norm = Math.sqrt(squares) || 1;
  for (let i = 0; i < dimensions; i++) vector[i] = (vector[i] ?? 0) / norm;
  return vector;
}

/** `vector` as packed little-endian float32, base64-encoded. */
export function encodeBase64(vector: Float64Array): string {
  const bytes = Buffer.allocUnsafe(vector.length * 4);
  for (let i = 0; i < vector.length; i++) {
    bytes.writeFloatLE(vector[i] ?? 0, i * 4);
  }
  return bytes.toString('base64');
}

/** The JSON array text of `vector`, rounded to nine decimals. */
function floatArrayJson(vector: Float64Array): string {
  const parts = new Array<string>(vector.length);
  for (let i = 0; i < vector.length; i++) {
    parts[i] = String(Math.round((vector[i] ?? 0) * FLOAT_SCALE) / FLOAT_SCALE);
  }
  return `[${parts.join(',')}]`;
}

/** The texts of an `input`: a string, strings, or token-id arrays. */
function readInputs(input: unknown): string[] | null {
  if (typeof input === 'string') return [input];
  if (!Array.isArray(input) || input.length === 0) return null;
  if (input.every((item) => typeof item === 'number')) {
    return [JSON.stringify(input)];
  }
  const texts: string[] = [];
  for (const item of input) {
    if (typeof item === 'string') texts.push(item);
    else if (Array.isArray(item)) texts.push(JSON.stringify(item));
    else return null;
  }
  return texts;
}

/** Serve one `POST /v1/embeddings`; `body` is the parsed JSON. */
export async function handleEmbeddings(
  ctx: MockContext,
  res: ServerResponse,
  body: Record<string, unknown>,
  arrivedAt: number,
  badRequest: (message: string) => void,
): Promise<void> {
  const inputs = readInputs(body.input);
  if (inputs === null) {
    badRequest("'input' must be a string or a non-empty array");
    return;
  }
  if (inputs.length > MAX_EMBEDDING_INPUTS) {
    badRequest(`'input' carries more than ${MAX_EMBEDDING_INPUTS} entries`);
    return;
  }
  const requested = body.dimensions;
  const dimensions =
    requested === undefined ? DEFAULT_EMBEDDING_DIMENSIONS : requested;
  if (
    typeof dimensions !== 'number' ||
    !Number.isInteger(dimensions) ||
    dimensions < 1 ||
    dimensions > MAX_EMBEDDING_DIMENSIONS
  ) {
    badRequest(
      `'dimensions' must be an integer in [1, ${MAX_EMBEDDING_DIMENSIONS}]`,
    );
    return;
  }
  const base64 = body.encoding_format === 'base64';
  const model = typeof body.model === 'string' ? body.model : 'load-embed';

  const random = ctx.requestRandom();
  const fault = sampleFault(random, ctx.options, {});
  const stream = new ResponseStream(res);
  if (fault.kind === 'http') {
    ctx.metrics.recordFault(faultLabel(fault) ?? 'http');
    const reply = errorReply(
      'openai',
      fault.status,
      ctx.options.retryAfterSeconds,
    );
    sendJson(res, reply.status, reply.body, reply.headers);
    return;
  }
  const latency =
    lognormalFromMedianP95(
      random,
      ctx.options.embeddingLatencyMedianMs,
      ctx.options.embeddingLatencyP95Ms,
    ) *
      (1 + PER_INPUT_LATENCY_SHARE * (inputs.length - 1)) +
    (fault.kind === 'stall' ? fault.ms : 0);
  if (fault.kind === 'stall') ctx.metrics.recordFault('stall');
  await stream.sleep(latency - (performance.now() - arrivedAt));
  if (stream.closed) return;

  let tokens = 0;
  const items: string[] = [];
  for (let index = 0; index < inputs.length; index++) {
    const text = inputs[index] ?? '';
    tokens += estimateTokens(text);
    const vector = embeddingVector(text, dimensions);
    const embedding = base64
      ? JSON.stringify(encodeBase64(vector))
      : floatArrayJson(vector);
    items.push(
      `{"object":"embedding","index":${index},"embedding":${embedding}}`,
    );
  }
  ctx.metrics.addEmbeddingInputs(inputs.length);
  ctx.metrics.addPromptTokens(tokens, 0);
  const payload = `{"object":"list","data":[${items.join(',')}],"model":${JSON.stringify(model)},"usage":{"prompt_tokens":${tokens},"total_tokens":${tokens}}}`;
  if (res.headersSent || res.destroyed) return;
  res.writeHead(200, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
