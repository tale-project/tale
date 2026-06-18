import type { ReasoningCapabilityConfig } from '../../lib/shared/schemas/providers';

/**
 * Why this lives at the `fetch` boundary: the `@ai-sdk/openai-compatible`
 * adapter serializes the output cap as the wire field `max_tokens`
 * unconditionally, and `providerOptions` (the other extension point) is spread
 * onto the wire AND deny-listed against reserved keys — so it cannot rename
 * `max_tokens`. The injected `fetch` is the only place the final body exists as
 * a JSON string, so a parse → mutate → re-stringify pass here is the one
 * mechanism that can rewrite reserved wire fields without leaking config to the
 * provider. Paired with `createCompatibleProvider` in `resolve_model.ts`.
 */

/** Declarative request-body transform; see `requestBodyMapSchema`. */
export interface RequestBodyMap {
  rename?: Record<string, string>;
  remove?: string[];
}

/** The subset of resolved model data the wire transform reads. */
export interface WireTransformModelData {
  requestBodyMap?: RequestBodyMap;
  reasoning?: ReasoningCapabilityConfig;
}

/**
 * Merge a provider-default `requestBodyMap` with a per-model one, mirroring
 * `mergeModelLevel`'s precedence (model wins): `rename` sub-keys merge, `remove`
 * arrays replace wholesale. Returns `undefined` when nothing remains. Typed for
 * the precise shape so resolvers stay cast-free.
 */
export function mergeRequestBodyMap(
  providerLevel: RequestBodyMap | undefined,
  modelLevel: RequestBodyMap | undefined,
): RequestBodyMap | undefined {
  if (!providerLevel && !modelLevel) return undefined;
  const rename = { ...providerLevel?.rename, ...modelLevel?.rename };
  const remove = modelLevel?.remove ?? providerLevel?.remove;
  const out: RequestBodyMap = {};
  if (Object.keys(rename).length > 0) out.rename = rename;
  if (remove && remove.length > 0) out.remove = remove;
  return Object.keys(out).length === 0 ? undefined : out;
}

type FetchFn = (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
) => Promise<Response>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Apply, in order: (1) the operator's `requestBodyMap` — `rename` then `remove`;
 * (2) a reasoning-model default that renames any residual `max_tokens` to
 * `max_completion_tokens`. Pure: returns a shallow copy, never mutates `body`.
 *
 * The reasoning default fires only when the model is flagged reasoning AND the
 * operator hasn't already remapped `max_tokens` — `modelData.reasoning` is set
 * only when an operator declares the reasoning knob or the catalog reports
 * reasoning support, so a plain chat model (e.g. gpt-4o) is never touched.
 */
export function transformRequestBody(
  body: Record<string, unknown>,
  modelData: WireTransformModelData,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };

  // Layer 1 — operator overlay. Rename first so an explicit `remove` can still
  // drop the renamed-to field if desired.
  const rename = modelData.requestBodyMap?.rename;
  if (rename) {
    for (const [from, to] of Object.entries(rename)) {
      if (from === to) continue;
      if (Object.prototype.hasOwnProperty.call(out, from)) {
        out[to] = out[from];
        delete out[from];
      }
    }
  }
  const remove = modelData.requestBodyMap?.remove;
  if (remove) {
    for (const key of remove) delete out[key];
  }

  // Layer 2 — reasoning default (OpenAI / Azure reasoning deployments reject
  // `max_tokens` and require `max_completion_tokens`).
  if (
    modelData.reasoning &&
    Object.prototype.hasOwnProperty.call(out, 'max_tokens') &&
    !Object.prototype.hasOwnProperty.call(out, 'max_completion_tokens')
  ) {
    out.max_completion_tokens = out.max_tokens;
    delete out.max_tokens;
  }

  return out;
}

/**
 * Wrap `fetch` so the outgoing JSON body passes through `transformRequestBody`.
 * Only string JSON bodies are transformed — multipart/transcription bodies are
 * non-string `FormData` and pass through untouched (same assumption as
 * `createDebugFetch`). An optional `innerFetch` (e.g. the wire-debug logger) is
 * composed so it observes and forwards the TRANSFORMED body.
 *
 * Returns the inner/global fetch unchanged when there is nothing to do, so a
 * model with no `requestBodyMap` and no reasoning flag adds zero overhead.
 */
export function createWireTransformFetch(
  modelData: WireTransformModelData,
  innerFetch?: FetchFn,
): FetchFn {
  const hasWork =
    modelData.reasoning !== undefined ||
    modelData.requestBodyMap?.rename !== undefined ||
    modelData.requestBodyMap?.remove !== undefined;
  if (!hasWork) return innerFetch ?? fetch;

  return async (input, init) => {
    const next = transformInit(init, modelData);
    return (innerFetch ?? fetch)(input, next);
  };
}

function transformInit(
  init: RequestInit | undefined,
  modelData: WireTransformModelData,
): RequestInit | undefined {
  if (!init || typeof init.body !== 'string') return init;
  let parsed: unknown;
  try {
    parsed = JSON.parse(init.body);
  } catch {
    return init; // non-JSON string body — leave untouched
  }
  if (!isPlainObject(parsed)) return init;
  return {
    ...init,
    body: JSON.stringify(transformRequestBody(parsed, modelData)),
  };
}
