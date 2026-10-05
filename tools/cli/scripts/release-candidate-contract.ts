/** Refresh admission metadata while retaining the reviewed required job map.
 * A changed graph still has to pass release-candidate-workflows.test.ts and an
 * Ops semantic-digest review. This never writes Ops policy or dispatches CI. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { parse } from 'yaml';

import releaseContract from '../../../.github/release-candidate-contract.json';

/** Data-only assertions consumed by Ops. Exact keys bind field absence as well
 * as inherited execution defaults. Only workflow/step display names and run
 * bodies are value-unbound; their presence is still part of the reviewed shape.
 * Reviewed-main run bodies remain a separate code-review trust boundary. */
export function admissionAssertions(value: Record<string, unknown>) {
  const jobs = value.jobs as Record<string, Record<string, unknown>>;
  const assertions: {
    path: (string | number)[];
    kind: string;
    expected: unknown;
  }[] = [];
  const bind = (
    path: (string | number)[],
    fields: Record<string, unknown>,
    unbound: string[],
  ) => {
    const keys = Object.keys(fields).toSorted();
    assertions.push({ path, kind: 'keys', expected: keys });
    for (const key of keys)
      if (!unbound.includes(key))
        assertions.push({
          path: [...path, key],
          kind: 'value',
          expected: fields[key],
        });
  };
  bind([], value, ['name', 'jobs']);
  assertions.push({
    path: ['jobs'],
    kind: 'keys',
    expected: Object.keys(jobs).toSorted(),
  });
  for (const id of Object.keys(jobs).toSorted()) {
    const job = jobs[id]!;
    bind(['jobs', id], job, ['steps']);
    const steps = job.steps as Record<string, unknown>[] | undefined;
    for (const [index, step] of (steps ?? []).entries())
      bind(['jobs', id, 'steps', index], step, ['name', 'run']);
    if (steps)
      assertions.push({
        path: ['jobs', id, 'steps'],
        kind: 'length',
        expected: steps.length,
      });
  }
  return assertions;
}

export async function refreshContract(root: string) {
  const helpers: Record<string, string> = {};
  for (const path of Object.keys(releaseContract.helpers))
    helpers[path] = createHash('sha256')
      .update(await readFile(join(root, path)))
      .digest('hex');
  const sourceWorkflows: Record<string, unknown> = {};
  for (const path of releaseContract.requiredWorkflows) {
    const file = path.split('/').at(-1)!;
    const stem = file.replace(/\.yml$/, '');
    const parsed = parse(await readFile(join(root, path), 'utf8')) as Record<
      string,
      unknown
    >;
    const jobs = parsed.jobs as Record<string, Record<string, unknown>>;
    const triggers = parsed.on as Record<string, unknown>;
    const candidate =
      releaseContract.candidateJobs[
        stem as keyof typeof releaseContract.candidateJobs
      ];
    const prOnly = ['pr-scope', 'ci-ready']
      .filter((id) => jobs[id])
      .map((id) => jobs[id]!.name);
    const candidateSkipped = [
      ...prOnly,
      ...(stem === 'cli' ? ['Attach to release'] : []),
    ];
    const normal = {
      success: candidate.names.filter(
        (name) =>
          ![
            'Candidate source / Resolve source',
            'Candidate gate / Record receipt',
          ].includes(name),
      ),
      skipped: ['Candidate source', 'Candidate gate', ...candidateSkipped],
    };
    sourceWorkflows[file] = {
      events: ['push', 'schedule', 'workflow_dispatch'].filter(
        (event) =>
          Object.hasOwn(triggers, event) &&
          !(stem === 'cli' && event === 'workflow_dispatch'),
      ),
      assertions: admissionAssertions(parsed),
      candidateSkipped,
      normal,
      ...(stem === 'cli'
        ? {
            publication: {
              success: [...normal.success, 'Attach to release'],
              skipped: normal.skipped.filter(
                (name) => name !== 'Attach to release',
              ),
            },
          }
        : {}),
    };
  }
  return { ...releaseContract, helpers, sourceWorkflows };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { write: { type: 'boolean', default: false } },
    strict: true,
  });
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const updated = JSON.stringify(await refreshContract(root), null, 2) + '\n';
  if (values.write)
    await writeFile(
      join(root, '.github/release-candidate-contract.json'),
      updated,
    );
  else {
    const expected = JSON.stringify(releaseContract, null, 2) + '\n';
    if (updated !== expected)
      throw new Error(
        'Release source admission changed: refresh the descriptor with --write, review it, and update the Ops contract digest before activation.',
      );
  }
}
