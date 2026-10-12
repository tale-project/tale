// The suites directory, lab.sh and the workflow each name the suites, and a
// suite one of them does not know proves nothing (no step runs it) or fails a
// run an hour in (a step runs what is gone). This keeps the three in step, and
// keeps the workflow's own promises: a draft is held, a dispatch can name its
// runner and its suites, and each suite leaves its output behind the moment it
// ends.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { parse } from 'yaml';

const HERE = import.meta.dir;
const REPO = resolve(HERE, '../../../..');
const LAB = join(HERE, 'lab.sh');

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${what} is not a mapping`);
  return value;
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`${what} is not a string`);
  return value;
}

const document = record(
  parse(
    readFileSync(join(REPO, '.github/workflows/sandbox-incus-e2e.yml'), 'utf8'),
  ),
  'the workflow',
);
const job = record(record(document.jobs, 'jobs').incus, 'the incus job');
const steps: Record<string, unknown>[] = (() => {
  const raw: unknown = job.steps;
  if (!Array.isArray(raw)) throw new Error('the job has no steps');
  return raw.map((step: unknown) => record(step, 'a step'));
})();

// `on` is a YAML 1.1 boolean in some parsers: both spellings are read.
const triggers = record(document.on ?? document.true, 'the triggers');

const directory = readdirSync(join(HERE, 'suites'))
  .filter((file) => file.endsWith('.e2e.ts'))
  .map((file) => file.replace(/\.e2e\.ts$/, ''))
  .toSorted();

const declared = (() => {
  const match = /^readonly SUITES=\(([^)]*)\)$/m.exec(
    readFileSync(LAB, 'utf8'),
  );
  if (match?.[1] === undefined) throw new Error('lab.sh declares no SUITES');
  return match[1].trim().split(/\s+/);
})();

/** The suites the workflow runs, in its order, with the step that runs each. */
const runs = steps.flatMap((step, index) => {
  const run = typeof step.run === 'string' ? step.run : '';
  const match = /\.\/e2e\/incus\/suites\/([a-z]+)\.e2e\.ts/.exec(run);
  return match?.[1] === undefined ? [] : [{ name: match[1], step, index }];
});

describe('the suites', () => {
  test('lab.sh declares the suites of the directory, and the workflow runs them in its order', () => {
    expect([...declared].toSorted()).toEqual(directory);
    expect(runs.map((entry) => entry.name)).toEqual(declared);
  });

  test('each suite runs after the lab came up, whatever an earlier suite did, only when chosen', () => {
    for (const { name, step } of runs) {
      const condition = text(step.if, `the if of ${name}`);
      expect(condition).toContain('!cancelled()');
      expect(condition).toContain("steps.lab.outcome == 'success'");
      expect(condition).toContain(`steps.pick.outputs.${name} == 'true'`);
      // The output goes to a log the next step keeps, and a failed suite fails the step.
      const run = text(step.run, `the run of ${name}`);
      expect(run).toContain('set -euo pipefail');
      expect(run).toContain(`"$INCUS_E2E_DIR/logs/${name}.log"`);
    }
  });

  test('each suite leaves its output behind the moment it ends', () => {
    for (const { name, step, index } of runs) {
      const upload = steps[index + 1];
      if (upload === undefined) throw new Error(`nothing follows ${name}`);
      expect(text(upload.uses, `the uses after ${name}`)).toStartWith(
        'actions/upload-artifact@',
      );
      expect(text(upload.if, `the if after ${name}`)).toBe(
        text(step.if, `the if of ${name}`),
      );
      const withs = record(upload.with, `the with after ${name}`);
      expect(withs.name).toBe(
        `suite-${name}-\${{ github.run_id }}-\${{ github.run_attempt }}`,
      );
    }
  });

  test('the choice of suites is read by lab.sh from the environment, never from the script text', () => {
    const pick = steps.find((step) => step.id === 'pick');
    if (pick === undefined) throw new Error('no step with the id pick');
    const run = text(pick.run, 'the run of pick');
    expect(run).not.toContain('${{');
    expect(run).toContain('lab.sh suites "$SUITES"');
    expect(record(pick.env, 'the env of pick').SUITES).toBe(
      '${{ inputs.suites }}',
    );
    const pickIndex = steps.indexOf(pick);
    for (const { index } of runs) expect(index).toBeGreaterThan(pickIndex);
  });

  test('a dispatch can choose the suites, and the input names every one of them', () => {
    const dispatch = record(triggers.workflow_dispatch, 'workflow_dispatch');
    const suites = record(
      record(dispatch.inputs, 'the inputs').suites,
      'the suites input',
    );
    expect(suites.default).toBe('all');
    const description = text(suites.description, 'the suites description');
    for (const name of declared) expect(description).toContain(name);
  });
});

describe('lab.sh suites', () => {
  function pick(choice?: string) {
    const run = Bun.spawnSync(
      ['bash', LAB, 'suites', ...(choice === undefined ? [] : [choice])],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    return {
      code: run.exitCode,
      out: run.stdout.toString().trim().split('\n'),
      err: run.stderr.toString(),
    };
  }

  test('no choice, empty and "all" run everything', () => {
    const everything = declared.map((name) => `${name}=true`);
    expect(pick().out).toEqual(everything);
    expect(pick('').out).toEqual(everything);
    expect(pick('all').out).toEqual(everything);
  });

  test('a list picks those, with spaces and stray commas forgiven', () => {
    const { code, out } = pick(' pool, docker ,');
    expect(code).toBe(0);
    expect(out).toEqual(
      declared.map((name) => `${name}=${name === 'pool' || name === 'docker'}`),
    );
  });

  test('a name it does not know fails the run at once, naming the choices', () => {
    const { code, err } = pick('pool,lifecycles');
    expect(code).not.toBe(0);
    expect(err).toContain("unknown suite 'lifecycles'");
    for (const name of declared) expect(err).toContain(name);
  });
});

describe('the workflow', () => {
  test('a draft pull request is held, and an un-drafted one runs it', () => {
    const pullRequest = record(triggers.pull_request, 'pull_request');
    expect(pullRequest.types).toContain('ready_for_review');
    expect(text(job.if, 'the if of the job')).toContain(
      'github.event.pull_request.draft != true',
    );
  });

  test('a pull request runs on the hosted runner; a dispatch names its runner', () => {
    expect(text(job['runs-on'], 'runs-on')).toBe(
      "${{ inputs.runner || 'ubuntu-latest' }}",
    );
    const dispatch = record(triggers.workflow_dispatch, 'workflow_dispatch');
    const runner = record(
      record(dispatch.inputs, 'the inputs').runner,
      'the runner input',
    );
    const options: unknown = runner.options;
    expect(options).toContain(runner.default);
    expect(options).toContain('ubuntu-latest');
  });
});
