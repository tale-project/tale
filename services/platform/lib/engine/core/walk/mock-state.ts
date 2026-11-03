/**
 * The run's own state in mock mode (AUTO-R81): one JSON value per connector
 * per run, which the mocks of an action that keeps it (`mockState`) read and
 * write, and the record of the answers its idempotent writes gave, by key.
 *
 * The outermost run creates one and shares it with the automations it calls;
 * it is never shared between runs, and ends with the run. The durable stepper
 * commits its snapshot to the run's checkpoints with each step's outcome, so a
 * resumed step sees what the steps before it wrote.
 *
 * Pure data and no IO: both walkers and the connector door hold it.
 */

import { jsonBytes } from '../../../shared/utils/json-bytes';
import { MOCK_STATE_MAX_BYTES } from './limits';

/** One connector's part of a run's state: the value its mocks keep (`null`
 * before the run wrote any) and the answers its idempotent writes gave, by
 * idempotency key. */
export interface ConnectorMockState {
  state: unknown;
  answers: Record<string, unknown>;
}

/** A run's state by connector: the JSON a durable run checkpoints. */
export type MockStateSnapshot = Record<string, ConnectorMockState>;

/** What `write` did: kept the change, or kept nothing because the
 * connector's part would outgrow the cap (`bytes` is the size it would
 * have had). */
export type MockStateWrite =
  | { kept: true }
  | { kept: false; bytes: number; limit: number };

export class RunMockState {
  readonly #parts = new Map<string, ConnectorMockState>();
  #revision = 0;

  constructor(snapshot: MockStateSnapshot = {}) {
    for (const [connector, part] of Object.entries(snapshot)) {
      this.#parts.set(connector, copyJson(part));
    }
  }

  /** A copy of the connector's state: `null` before the run wrote any. */
  state(connector: string): unknown {
    return copyJson(this.#parts.get(connector)?.state ?? null);
  }

  /** The answer a write under this key gave the first time, when the run
   * recorded one. */
  answered(connector: string, key: string): { output: unknown } | undefined {
    const answers = this.#parts.get(connector)?.answers;
    if (answers === undefined || !Object.hasOwn(answers, key)) return undefined;
    return { output: copyJson(answers[key]) };
  }

  /** Keeps the connector's next state (absent keeps the one it has, `null`
   * clears it) and the answer a write gave under its key; or keeps nothing,
   * when the connector's part would outgrow `MOCK_STATE_MAX_BYTES`. */
  write(
    connector: string,
    change: { state?: unknown; answer?: { key: string; output: unknown } },
  ): MockStateWrite {
    const before = this.#parts.get(connector) ?? { state: null, answers: {} };
    const next: ConnectorMockState = {
      state: change.state === undefined ? before.state : change.state,
      answers:
        change.answer === undefined
          ? before.answers
          : { ...before.answers, [change.answer.key]: change.answer.output },
    };
    const bytes = jsonBytes(next);
    if (bytes > MOCK_STATE_MAX_BYTES) {
      return { kept: false, bytes, limit: MOCK_STATE_MAX_BYTES };
    }
    this.#parts.set(connector, copyJson(next));
    this.#revision++;
    return { kept: true };
  }

  /** How many writes the state kept since it was created: a holder that
   * commits it compares this with what it last committed. */
  get revision(): number {
    return this.#revision;
  }

  /** A copy of the whole state, by connector. */
  snapshot(): MockStateSnapshot {
    return copyJson(Object.fromEntries(this.#parts));
  }
}

/** Reads a stored snapshot back: `undefined` when `value` is none (an
 * object of `{ state, answers }` parts, `answers` an object). */
export function readMockStateSnapshot(
  value: unknown,
): MockStateSnapshot | undefined {
  if (!isPlainObject(value)) return undefined;
  const snapshot: MockStateSnapshot = {};
  for (const [connector, part] of Object.entries(value)) {
    if (!isPlainObject(part) || !('state' in part)) return undefined;
    if (!isPlainObject(part.answers)) return undefined;
    snapshot[connector] = { state: part.state, answers: part.answers };
  }
  return snapshot;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A deep copy as JSON holds it, so no holder shares a value with another. */
function copyJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
