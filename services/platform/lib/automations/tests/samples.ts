/**
 * The inputs a new test starts from when it is written from a trigger: the
 * input that trigger would hand a run (`triggerInputSample`), at a fixed
 * moment rather than now — so a test written from it holds the same input
 * every time it runs, and two people writing one get the same test.
 *
 * Pure: no clock, no I/O — the app bundles it.
 */

import type { Json } from '../../engine/core/types';
import { triggerInputSample } from '../trigger-input';

/** The moment a sample trigger fires at in a test: Monday 5 January 2026,
 * 09:00 UTC. */
export const TEST_SAMPLE_EPOCH = Date.UTC(2026, 0, 5, 9, 0);

/**
 * The input a trigger would hand a run, as a test's input: a schedule
 * firing at {@link TEST_SAMPLE_EPOCH}, a webhook delivering its sample
 * payload, an event carrying its example payload — over the trigger's fixed
 * input, whose fields the trigger's own fields win over. Null for a kind no
 * trigger starts, or an event trigger that names no event the platform
 * raises: there is nothing to sample.
 */
export function triggerTestInput(trigger: {
  kind: string;
  event?: string | null;
  input?: Readonly<Record<string, unknown>> | null;
}): Json | null {
  const sample = triggerInputSample(trigger, TEST_SAMPLE_EPOCH);
  if (sample === null) return null;
  const input: unknown = JSON.parse(JSON.stringify(sample.input));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse of JSON text is plain JSON
  return input as Json;
}
