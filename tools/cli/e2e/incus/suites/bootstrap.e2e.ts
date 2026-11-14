// bootstrap: `tale incus bootstrap` makes the node the contract describes,
// over the administrator's socket, once; from then on only the restricted
// certificate it made is used, and it reaches its own project alone
// (design 15.5, D-31).

import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { IncusApiError } from '@tale/incus/api';

import {
  bootstrapped,
  cli,
  expectCode,
  incus,
  jsonOf,
  loadLab,
  paths,
  prepared,
  record,
  stackClient,
} from '../harness';

setDefaultTimeout(60 * 60_000);
const lab = loadLab();
const at = paths(lab);

/** The digest-pinned proxy image of release 1, from the lab's registry: the
 * check's probe helper runs it before the stack has pulled its own. */
function probeImage(): string {
  const runtime = JSON.parse(
    readFileSync(join(prepared(lab, 1), 'runtime', 'runtime.json'), 'utf8'),
  ) as { images: { repository: string; digest: string }[] };
  const proxy = runtime.images.find((image) =>
    image.repository.endsWith('/tale-proxy'),
  );
  if (proxy === undefined) throw new Error('The bundle has no proxy image.');
  return `${proxy.repository}@${proxy.digest}`;
}

const source = () => [
  '--spec',
  at.spec(1),
  '--compose',
  join(prepared(lab, 1), 'runtime', 'compose.yml'),
];

describe('bootstrap', () => {
  test('the contract names the lab: the project, its bridge and the mirrored registry', () => {
    const contract = jsonOf<{
      kind: string;
      project: { name: string; config: Record<string, string> };
      network: { name: string };
      registries: string[];
    }>(expectCode(cli(lab, ['incus', 'contract', ...source()]), 0));
    expect(contract.kind).toBe('tale.incus.node-contract');
    expect(contract.project.name).toBe(lab.name);
    expect(contract.project.config.restricted).toBe('true');
    expect(contract.network.name).toBe(lab.name);
    // Tale's images come from the lab's registry, which stands in for ghcr.io.
    expect(contract.registries).toContain(lab.registry);
    expect(contract.registries).not.toContain('ghcr.io');
  });

  test('makes the project, the bridges, the trust entries and the credentials', () => {
    const run = bootstrapped(lab);
    if (run !== null) {
      const said = `${run.stdout}${run.stderr}`;
      expect(said).toContain(`create project ${lab.name}`);
      expect(said).toContain(`create network ${lab.name}`);
      record(lab, 'bootstrap', { bootstrapMs: run.ms });
    }
    const project = incus(lab, ['project', 'get', lab.name, 'restricted']);
    expect(project.stdout.trim()).toBe('true');
    expect(
      incus(lab, ['project', 'get', lab.name, 'restricted.images.servers'])
        .stdout.trim()
        .split(','),
    ).toContain(lab.registry);
    expect(incus(lab, ['network', 'show', lab.name]).code).toBe(0);
    expect(
      incus(lab, ['config', 'trust', 'list', '--format', 'csv']).stdout,
    ).toContain(`tale-${lab.name}`);
    for (const name of ['incus', 'sandbox-incus']) {
      expect(statSync(join(at.state, name)).mode & 0o777).toBe(0o700);
      expect(statSync(join(at.state, name, 'client.key')).mode & 0o777).toBe(
        0o600,
      );
    }
  });

  test('a second bootstrap changes nothing', () => {
    const run = expectCode(
      cli(lab, ['incus', 'bootstrap', ...source(), '--yes'], {
        prefix: lab.root,
      }),
      0,
    );
    expect(`${run.stdout}${run.stderr}`).toContain(
      'The node already holds what the contract needs.',
    );
  });

  test('tale incus check reads the node back with the restricted certificate', () => {
    const run = cli(lab, [
      '--json',
      'incus',
      'check',
      ...source(),
      '--probe-image',
      probeImage(),
    ]);
    const report = jsonOf<{
      data?: { ok: boolean; findings: { level: string; sentence: string }[] };
    }>(run);
    const findings = report.data?.findings ?? [];
    record(lab, 'bootstrap', {
      checkMs: run.ms,
      checkFindings: findings.map((finding) => finding.sentence),
    });
    expect(findings.filter((finding) => finding.level === 'refusal')).toEqual(
      [],
    );
    expect(run.code).toBe(0);
  });

  test('the restricted certificate reaches its own project alone', async () => {
    const client = await stackClient(lab);
    const projects = (await client.sync('GET', '/1.0/projects')) as string[];
    expect(projects.map((path) => path.split('/').at(-1))).toEqual([lab.name]);
    const refused = await client
      .sync('POST', '/1.0/projects', { json: { name: `${lab.name}-x` } })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(refused).toBeInstanceOf(IncusApiError);
    // Another project's instances are not refused but withheld: the list
    // the certificate reads of it is empty, whatever the project holds, and
    // across every project it sees its own alone.
    expect(
      await client.sync('GET', '/1.0/instances', {
        query: { project: 'default' },
      }),
    ).toEqual([]);
    const everywhere = (await client.sync('GET', '/1.0/instances', {
      query: { 'all-projects': 'true' },
    })) as string[];
    expect(
      everywhere.filter((path) => !path.endsWith(`?project=${lab.name}`)),
    ).toEqual([]);
  });
});
