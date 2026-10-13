/**
 * The bench a run is given on the wire: the stand-ins a test or a step test
 * gives it (simulated outputs and failures), the narrower scope of a step
 * test, and how much of it a door takes. The engine owns what a bench means
 * (`lib/engine/core/execute/bench.ts`, which also decides which nodes it may
 * name and how its scopes combine); these schemas read it at the boundary.
 *
 * Nothing here reaches the engine, so the MCP tool inventory — which every
 * settings page lists — can take its arguments from it.
 */

import { z } from 'zod';

import { jsonBytes } from '../utils/json-bytes';

/**
 * What a bench may carry, at a door that takes one: one simulated output
 * (as UTF-8 JSON), a whole bench — every stand-in of a test or a step
 * test — and one simulated failure's message, which the document check
 * holds to the same length.
 */
export const BENCH_LIMITS = {
  mockBytes: 65_536,
  benchBytes: 524_288,
  failureChars: 2_000,
} as const;

/** The longest node id the grammar allows (`^[a-z][a-z0-9_]{0,49}$`). */
const NODE_ID_MAX = 50;

const count = z.number().int().nonnegative();

/** Simulated outputs, by node id. */
export const mocksSchema = z.record(z.string(), z.json());

/** Simulated failures — the message each node fails with — by node id. */
export const failuresSchema = z.record(
  z.string(),
  z.string().max(BENCH_LIMITS.failureChars),
);

/** The bench a run is given: a test's stand-ins, and a step test's scope.
 * Which nodes it may name, and how its scopes combine, the engine's bench
 * plan decides (`planBench`), with a refusal of its own for each. */
export const runBenchSchema = z.strictObject({
  mocks: mocksSchema.optional(),
  failures: failuresSchema.optional(),
  upTo: z.string().max(NODE_ID_MAX).optional(),
  only: z.string().max(NODE_ID_MAX).optional(),
  item: count.optional(),
  test: z
    .strictObject({ name: z.string(), index: count.optional() })
    .optional(),
});

/**
 * The part of a bench past what a door takes: one stand-in's output past
 * {@link BENCH_LIMITS.mockBytes} (`node` names it), or the whole bench past
 * {@link BENCH_LIMITS.benchBytes}; null when it fits. One rule for every door
 * that takes a bench — the app's, a coding agent's.
 */
export function benchOversize(bench: {
  mocks?: Record<string, unknown> | undefined;
}): { node?: string; limitBytes: number } | null {
  if (jsonBytes(bench) > BENCH_LIMITS.benchBytes) {
    return { limitBytes: BENCH_LIMITS.benchBytes };
  }
  for (const [node, mock] of Object.entries(bench.mocks ?? {})) {
    if (jsonBytes(mock) > BENCH_LIMITS.mockBytes) {
      return { node, limitBytes: BENCH_LIMITS.mockBytes };
    }
  }
  return null;
}
