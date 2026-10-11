/**
 * A test's fields as the Setup form edits them: read from the raw test, and
 * written back into it one field at a time. Every key the form has no
 * control for, and every key this build does not know, stays as written,
 * so the form and the YAML edit the same test.
 */

import { pointerTokens } from '@/lib/engine/core/syntax/pointer';
import type { ExpectedNodeState } from '@/lib/engine/core/types';

type RawTest = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** How the output is checked: exactly, the fields listed, or not at all. */
export type OutputMode = 'equals' | 'includes' | 'none';

/** How an expected action's input is checked. */
export type EffectInputMode = 'none' | 'equals' | 'includes';

/** One action the test expects, or expects not to happen. */
export interface EffectRow {
  connector: string;
  node?: string;
  absent: boolean;
  inputMode: EffectInputMode;
  input?: unknown;
}

const NODE_STATES: readonly ExpectedNodeState[] = ['ran', 'skipped', 'failed'];

export function isExpectedNodeState(
  value: unknown,
): value is ExpectedNodeState {
  return NODE_STATES.some((state) => state === value);
}

/** A test's fields as the form shows them. */
export interface TestFormValues {
  name: string;
  description: string;
  /** The run's input; undefined while the test has none. */
  input: unknown;
  /** Node id → the output the test simulates for it, in written order. */
  mocks: ReadonlyArray<readonly [string, unknown]>;
  /** Node id → the message it fails with in this test. */
  failures: ReadonlyArray<readonly [string, string]>;
  output: { mode: OutputMode; value: unknown };
  nodes: ReadonlyArray<readonly [string, ExpectedNodeState]>;
  effects: readonly EffectRow[];
  /** The run must fail — at this node, with this message — or null. */
  failure: { node?: string; message?: string } | null;
}

function expectOf(test: RawTest): Record<string, unknown> {
  return isRecord(test.expect) ? test.expect : {};
}

function effectRowOf(value: unknown): EffectRow | null {
  if (!isRecord(value) || typeof value.connector !== 'string') return null;
  const inputMode: EffectInputMode = Object.hasOwn(value, 'input')
    ? 'equals'
    : Object.hasOwn(value, 'inputIncludes')
      ? 'includes'
      : 'none';
  return {
    connector: value.connector,
    ...(typeof value.node === 'string' && { node: value.node }),
    absent: value.absent === true,
    inputMode,
    ...(inputMode === 'equals' && { input: value.input }),
    ...(inputMode === 'includes' && { input: value.inputIncludes }),
  };
}

/** The test's fields; a field the test writes in a shape the form cannot
 * show reads as empty (the YAML still holds it). */
export function readTestForm(test: unknown): TestFormValues {
  const raw: RawTest = isRecord(test) ? test : {};
  const expect = expectOf(raw);
  const output: TestFormValues['output'] = Object.hasOwn(expect, 'output')
    ? { mode: 'equals', value: expect.output }
    : Object.hasOwn(expect, 'outputIncludes')
      ? { mode: 'includes', value: expect.outputIncludes }
      : { mode: 'none', value: undefined };
  const failure = isRecord(expect.failure)
    ? {
        ...(typeof expect.failure.node === 'string' && {
          node: expect.failure.node,
        }),
        ...(typeof expect.failure.message === 'string' && {
          message: expect.failure.message,
        }),
      }
    : null;
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    input: raw.input,
    mocks: isRecord(raw.mocks) ? Object.entries(raw.mocks) : [],
    failures: isRecord(raw.failures)
      ? Object.entries(raw.failures).flatMap(([node, message]) =>
          typeof message === 'string' ? [[node, message] as const] : [],
        )
      : [],
    output,
    nodes: isRecord(expect.nodes)
      ? Object.entries(expect.nodes).flatMap(([node, state]) =>
          isExpectedNodeState(state) ? [[node, state] as const] : [],
        )
      : [],
    effects: Array.isArray(expect.effects)
      ? expect.effects.flatMap((entry) => {
          const row = effectRowOf(entry);
          return row === null ? [] : [row];
        })
      : [],
    failure,
  };
}

/** `record` with `key` set, or removed when `value` is undefined; the key
 * itself goes once nothing is left under it. */
function setIn(
  record: Readonly<Record<string, unknown>>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...record };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

function withEntry(
  test: RawTest,
  key: 'mocks' | 'failures',
  node: string,
  value: unknown,
): Record<string, unknown> {
  const current = isRecord(test[key]) ? test[key] : {};
  const next = setIn(current, node, value);
  return setIn(test, key, Object.keys(next).length === 0 ? undefined : next);
}

function withExpect(
  test: RawTest,
  edit: (expect: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  return { ...test, expect: edit({ ...expectOf(test) }) };
}

/** The test with its name. */
export function withName(test: RawTest, name: string): Record<string, unknown> {
  return { ...test, name };
}

/** The test with its description; an empty one is left out. */
export function withDescription(
  test: RawTest,
  description: string,
): Record<string, unknown> {
  return setIn(
    test,
    'description',
    description.trim() === '' ? undefined : description,
  );
}

/** The test with the run's input; a cleared input is an empty object, as
 * every test has an input. */
export function withInput(
  test: RawTest,
  input: unknown,
): Record<string, unknown> {
  return { ...test, input: input === undefined ? {} : input };
}

/** The test simulating `node`'s output, or no longer (undefined). */
export function withMock(
  test: RawTest,
  node: string,
  output: unknown,
): Record<string, unknown> {
  return withEntry(test, 'mocks', node, output);
}

/** The test making `node` fail with `message`, or no longer (undefined). */
export function withFailure(
  test: RawTest,
  node: string,
  message: string | undefined,
): Record<string, unknown> {
  return withEntry(test, 'failures', node, message);
}

/** The test checking the output as `mode` says, against `value`. */
export function withOutput(
  test: RawTest,
  mode: OutputMode,
  value: unknown,
): Record<string, unknown> {
  return withExpect(test, (expect) => {
    const next = setIn(
      setIn(expect, 'output', undefined),
      'outputIncludes',
      undefined,
    );
    if (mode === 'none') return next;
    // An expectation is a value; one not written yet compares with null
    // until the author writes it.
    return setIn(
      next,
      mode === 'equals' ? 'output' : 'outputIncludes',
      value === undefined ? null : value,
    );
  });
}

/** The test expecting `node` in `state`, or not naming it (undefined). */
export function withNodeState(
  test: RawTest,
  node: string,
  state: ExpectedNodeState | undefined,
): Record<string, unknown> {
  return withExpect(test, (expect) => {
    const nodes = setIn(
      isRecord(expect.nodes) ? expect.nodes : {},
      node,
      state,
    );
    return setIn(
      expect,
      'nodes',
      Object.keys(nodes).length === 0 ? undefined : nodes,
    );
  });
}

function effectEntry(row: EffectRow): Record<string, unknown> {
  return {
    connector: row.connector,
    ...(row.node !== undefined && row.node !== '' && { node: row.node }),
    ...(row.inputMode === 'equals' && {
      input: row.input === undefined ? null : row.input,
    }),
    ...(row.inputMode === 'includes' && {
      inputIncludes: row.input === undefined ? {} : row.input,
    }),
    ...(row.absent && { absent: true }),
  };
}

/** The test with the action at `index` set — or appended when `index` is
 * past the last — or removed (undefined). Keys of an action this build does
 * not know stay as written. */
export function withEffect(
  test: RawTest,
  index: number,
  row: EffectRow | undefined,
): Record<string, unknown> {
  return withExpect(test, (expect) => {
    const effects = Array.isArray(expect.effects) ? [...expect.effects] : [];
    if (row === undefined) {
      effects.splice(index, 1);
    } else {
      const previous: unknown = effects[index];
      const known = new Set([
        'connector',
        'node',
        'input',
        'inputIncludes',
        'absent',
      ]);
      const kept = isRecord(previous)
        ? Object.fromEntries(
            Object.entries(previous).filter(([key]) => !known.has(key)),
          )
        : {};
      effects[Math.min(index, effects.length)] = {
        ...kept,
        ...effectEntry(row),
      };
    }
    return setIn(expect, 'effects', effects.length === 0 ? undefined : effects);
  });
}

/**
 * The test expecting the run to fail — at a node, with a message — or not
 * (null). A run that must fail has no output to compare, so turning it on
 * drops the output's expectation.
 */
export function withMustFail(
  test: RawTest,
  failure: { node?: string; message?: string } | null,
): Record<string, unknown> {
  return withExpect(test, (expect) => {
    if (failure === null) return setIn(expect, 'failure', undefined);
    const cleared = setIn(
      setIn(expect, 'output', undefined),
      'outputIncludes',
      undefined,
    );
    return setIn(cleared, 'failure', {
      ...(failure.node !== undefined &&
        failure.node !== '' && {
          node: failure.node,
        }),
      ...(failure.message !== undefined &&
        failure.message !== '' && {
          message: failure.message,
        }),
    });
  });
}

/**
 * Whether the form has a control for the place `pointer` names in the
 * test at `index` — a field, a node's simulated output, an expectation —
 * so a problem there opens the form; a place it has none for (a key this
 * build does not know, the test as a whole) opens the YAML.
 */
export function formOwnsPlace(pointer: string, index: number): boolean {
  const tokens = pointerTokens(pointer);
  if (tokens[0] !== 'tests' || tokens[1] !== String(index)) return false;
  const [field, key, sub] = tokens.slice(2);
  switch (field) {
    case 'name':
    case 'description':
    case 'input':
      return true;
    case 'mocks':
    case 'failures':
      return key !== undefined;
    case 'expect':
      switch (key) {
        case 'output':
        case 'outputIncludes':
        case 'failure':
          return true;
        case 'nodes':
        case 'effects':
          return sub !== undefined;
        default:
          return false;
      }
    default:
      return false;
  }
}
