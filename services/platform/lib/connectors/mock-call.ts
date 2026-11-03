/**
 * Runs a connector action's mock: the one place both executors' mock calls go
 * through — the in-process run's `ConnectorLike.mock`, which the registry
 * builds, and the dispatcher's mock mode, which the durable run reaches — so
 * the two cannot answer differently.
 *
 * A mock is a deterministic function of its input, run in the code runner's
 * data-only sandbox. An action that keeps the run's own state (`mockState`,
 * CONN-R36) is a function of its input and of what the run wrote before: its
 * body also has `state` in scope, a copy of its connector's state (`null`
 * before the run wrote any), and returns `{ output, state }`, since nothing
 * else crosses the sandbox. A write that declares itself `idempotent` is
 * answered from the run's record when its key repeats, without running the
 * body, as its live action answers a repeated key.
 */

import type { ConnectorAction } from '@tale/shared/schemas/connectors';

import type { FailureCause } from '../engine/core/record/failure';
import { codeRunner } from '../engine/core/runner';
import type { MockCall } from '../engine/core/slots';
import { RunMockState } from '../engine/core/walk/mock-state';
import { ConnectorError } from './errors';

/** Mock bodies are pure data reshaping; a generous ceiling still bounds a
 * runaway loop without failing a legitimately large fixture. */
export const MOCK_TIMEOUT_MS = 2000;

/** A mock call whose state would outgrow its connector's cap, with its cause
 * in the run record's words. */
export class MockStateRefusal extends ConnectorError {
  readonly failure: FailureCause;

  constructor(
    connector: string,
    action: string,
    sizes: { bytes: number; limit: number },
  ) {
    const nodeType = `${connector}.${action}`;
    const message = `the ${nodeType} mock would grow the run's own state of ${connector} to ${sizes.bytes} bytes, more than the ${sizes.limit} a mock run keeps per connector, so it kept nothing`;
    super('MOCK_STATE_TOO_LARGE', message, {
      connector,
      action,
      hint: 'keep less in the state: drop what later calls do not read, or run fewer calls in one test',
    });
    this.failure = {
      reason: 'CONNECTOR_MOCK_STATE_TOO_LARGE',
      params: { connector, action: nodeType, detail: message },
    };
  }
}

/**
 * Answer one call of `action` (of the connector `connector`, its catalog slug)
 * with its mock. `call` brings the run's own state and the call's key; without
 * it a mock keeps nothing past the call.
 *
 * Throws what the body throws, an `Error` for a return a mock that keeps the
 * state may not give, and a {@link MockStateRefusal} for a state over the cap.
 */
export async function runMock(
  connector: string,
  action: ConnectorAction,
  input: unknown,
  call?: MockCall,
): Promise<unknown> {
  if (action.mockState !== true) {
    return codeRunner().runBody(
      action.mock,
      { input },
      { timeoutMs: MOCK_TIMEOUT_MS },
    );
  }
  const state = call?.state ?? new RunMockState();
  const key =
    action.effects === 'write' && action.idempotent === true
      ? call?.idempotencyKey
      : undefined;
  if (key !== undefined) {
    const recorded = state.answered(connector, key);
    if (recorded !== undefined) return recorded.output;
  }
  const returned = await codeRunner().runBody(
    action.mock,
    { input, state: state.state(connector) },
    { timeoutMs: MOCK_TIMEOUT_MS },
  );
  const { output, next } = statefulReturn(returned, action.effects === 'write');
  if (next !== undefined || key !== undefined) {
    const kept = state.write(connector, {
      ...(next !== undefined && { state: next }),
      ...(key !== undefined && { answer: { key, output } }),
    });
    if (!kept.kept) throw new MockStateRefusal(connector, action.name, kept);
  }
  return output;
}

/** The output and the next state a mock that keeps the state returned. */
function statefulReturn(
  returned: unknown,
  writes: boolean,
): { output: unknown; next: unknown } {
  if (
    typeof returned !== 'object' ||
    returned === null ||
    Array.isArray(returned) ||
    !('output' in returned) ||
    returned.output === undefined
  ) {
    throw new Error(
      'a mock that keeps the run’s state returns { output, state }, and this one returned no output',
    );
  }
  const unknown = Object.keys(returned).filter(
    (name) => name !== 'output' && name !== 'state',
  );
  if (unknown.length > 0) {
    throw new Error(
      `a mock that keeps the run’s state returns { output, state }, and this one also returned ${unknown.join(', ')}`,
    );
  }
  const next = 'state' in returned ? returned.state : undefined;
  if (!writes && next !== undefined) {
    throw new Error(
      'a read changes nothing, so its mock returns no state: only a write’s mock returns the next state',
    );
  }
  return { output: returned.output, next };
}
