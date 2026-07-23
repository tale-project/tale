/**
 * test_workflow: run a workflow's attached acceptance tests against the
 * deterministic mocks. Tests are first-class in the document itself because
 * authors that verify against tests before shipping measurably (roughly
 * twice as often) land working workflows — the fast feedback loop is the
 * product.
 */

import { execute } from '../core/execute';
import type { Workflow } from '../core/types';

/** Deep-equality serialization independent of key order. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the object check above
    const record = v as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export interface TestReport {
  passed: number;
  failed: number;
  results: Array<{ name: string; pass: boolean; message?: string }>;
}

export interface MissingTests {
  error: string;
  hint?: string;
}

export async function runWorkflowTests(
  wf: Workflow,
): Promise<TestReport | MissingTests> {
  const tests = wf.tests ?? [];
  if (tests.length === 0) {
    return {
      error: 'the workflow has no tests',
      hint: 'add a top-level tests: [{name, input, expect: {output?, effects?}}] block',
    };
  }
  const results: TestReport['results'] = [];
  let passed = 0;
  for (const t of tests) {
    const r = await execute(wf, { input: t.input, mode: 'mock' });
    let pass = r.status === 'success';
    let message = pass
      ? undefined
      : `run ${r.status}: ${r.error?.message ?? 'validation failed'}`;
    if (
      pass &&
      t.expect?.output !== undefined &&
      stableStringify(r.output) !== stableStringify(t.expect.output)
    ) {
      pass = false;
      message = `output mismatch — expected ${JSON.stringify(t.expect.output)} but got ${JSON.stringify(r.output)}`;
    }
    if (pass && t.expect?.effects) {
      for (const exp of t.expect.effects) {
        const hit = r.effects.some(
          (e) =>
            e.integration === exp.integration &&
            (exp.input === undefined ||
              stableStringify(e.input) === stableStringify(exp.input)),
        );
        if (!hit) {
          pass = false;
          message = `expected effect ${exp.integration}${exp.input ? ` with input ${JSON.stringify(exp.input)}` : ''} did not occur (actual: ${r.effects.map((e) => e.integration).join(', ') || 'none'})`;
          break;
        }
      }
    }
    if (pass) passed++;
    results.push({ name: t.name, pass, ...(message && { message }) });
  }
  return { passed, failed: tests.length - passed, results };
}
