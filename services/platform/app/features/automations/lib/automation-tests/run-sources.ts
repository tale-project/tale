/**
 * Where a test run's input can start from: a test's input, with the
 * outputs, failures and scenarios the test stands in for; a recent run's
 * input; the input the bound trigger hands a run; nothing; or a
 * placeholder for each field the input schema requires. The run dialog
 * offers them in a menu, and choosing one replaces the input.
 */

import { jsonNormalize } from '@tale/ui/data/stable-stringify';

import type { Json } from '@/lib/engine/core/types';

import { missingRequiredFields, placeholderFor } from '../fixed-input';
import { readTestForm } from './test-form';

/** What stands in for steps in a test, as a try sends it. */
export interface SourceBench {
  mocks?: Record<string, Json>;
  failures?: Record<string, string>;
  /** The scenario of its connector action each node answers with, by
   * name. */
  scenarios?: Record<string, string>;
}

/** A stand-in output as JSON: what the test's document holds. */
function asJson(value: unknown): Json {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- jsonNormalize answers plain JSON data, as JSON.parse does
  return (jsonNormalize(value) ?? null) as Json;
}

/** One place to start from. */
export type RunInputSource =
  | {
      kind: 'test';
      id: string;
      label: string;
      input: unknown;
      /** The test's stand-ins, when it has any. */
      bench?: SourceBench;
    }
  | {
      kind: 'run';
      id: string;
      label: string;
      /** The run whose input is read once it is chosen. */
      runId: string;
    }
  | {
      kind: 'trigger' | 'empty' | 'required';
      id: string;
      label: string;
      input: unknown;
    };

/** A source as the dialog remembers it between openings: a test by its
 * name (its place may change), a run as the newest one, the rest by kind. */
export function sourceMemoryOf(source: RunInputSource): string {
  if (source.kind === 'test') return `test:${source.label}`;
  return source.kind;
}

/** The source `memory` names, when the list still has one like it. */
export function rememberedSource(
  sources: readonly RunInputSource[],
  memory: string | null,
): RunInputSource | undefined {
  if (memory === null) return undefined;
  return sources.find((source) => sourceMemoryOf(source) === memory);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The scenario a test picks for each node, by name: the form shows
 * none, and a pick that is not a name is left to the test's own checks. */
function scenariosOf(test: unknown): Record<string, string> {
  if (!isRecord(test) || !isRecord(test.scenarios)) return {};
  return Object.fromEntries(
    Object.entries(test.scenarios).flatMap(([node, name]) =>
      typeof name === 'string' ? [[node, name] as const] : [],
    ),
  );
}

/** What a test stands in for, as a try sends it; none without stand-ins. */
export function benchOfTest(test: unknown): SourceBench | undefined {
  const form = readTestForm(test);
  const mocks = Object.fromEntries(
    form.mocks.map(([node, output]) => [node, asJson(output)]),
  );
  const failures = Object.fromEntries(form.failures);
  const scenarios = scenariosOf(test);
  const bench: SourceBench = {
    ...(Object.keys(mocks).length > 0 && { mocks }),
    ...(Object.keys(failures).length > 0 && { failures }),
    ...(Object.keys(scenarios).length > 0 && { scenarios }),
  };
  return Object.keys(bench).length === 0 ? undefined : bench;
}

/** An input with a typed placeholder for each field `schema` requires. */
export function requiredInput(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return Object.fromEntries(
    missingRequiredFields(schema, {}).map((field) => [
      field.name,
      placeholderFor(field.type),
    ]),
  );
}

/**
 * Every place the input can start from, in the menu's order: the tests
 * (each with its own name, or the words for an unnamed one), the recent
 * runs, the trigger's input, then nothing and the required fields. A test
 * without an input starts from an empty one, as it runs.
 */
export function runInputSources(args: {
  tests: readonly unknown[];
  runs: ReadonlyArray<{ id: string; label: string }>;
  trigger: { label: string; input: unknown } | null;
  schema: Record<string, unknown> | undefined;
  words: {
    unnamedTest: (number: number) => string;
    empty: string;
    required: string;
  };
}): RunInputSource[] {
  const { tests, runs, trigger, schema, words } = args;
  const fromTests = tests.map((test, index): RunInputSource => {
    const form = readTestForm(test);
    const source: Extract<RunInputSource, { kind: 'test' }> = {
      kind: 'test',
      id: `test:${index}`,
      label: form.name.trim() === '' ? words.unnamedTest(index + 1) : form.name,
      input: isRecord(test) && Object.hasOwn(test, 'input') ? form.input : {},
    };
    const bench = benchOfTest(test);
    if (bench !== undefined) source.bench = bench;
    return source;
  });
  const fromRuns = runs.map((run): RunInputSource => ({
    kind: 'run',
    id: `run:${run.id}`,
    label: run.label,
    runId: run.id,
  }));
  const required = requiredInput(schema);
  return [
    ...fromTests,
    ...fromRuns,
    ...(trigger === null
      ? []
      : [
          {
            kind: 'trigger' as const,
            id: 'trigger',
            label: trigger.label,
            input: trigger.input,
          },
        ]),
    { kind: 'empty', id: 'empty', label: words.empty, input: {} },
    ...(Object.keys(required).length === 0
      ? []
      : [
          {
            kind: 'required' as const,
            id: 'required',
            label: words.required,
            input: required,
          },
        ]),
  ];
}
