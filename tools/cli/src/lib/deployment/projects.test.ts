import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProvisionContext } from './identity';
import type { DeploymentSpec } from './model';
import { resolveDeploymentProjects } from './projects';

const target: DeploymentSpec['configs'][number] = {
  repository: 'https://github.com/example/north',
  revision: 'a'.repeat(40),
  client: 'north',
  descriptor: 'tale/client.json',
  automation: 'document-desk',
  project: { key: 'NORTH', name: 'North document desk' },
  skillOwner: 'operator',
};
type Project = {
  id: string;
  organizationId: string;
  name: string;
  key: string;
  externalItemId: string | null;
  createdBy: string;
  archivedAt: string | null;
};
async function fixture(
  body: (f: ReturnType<typeof makeFixture>) => Promise<void>,
) {
  const f = makeFixture();
  try {
    await body(f);
  } finally {
    await f.server.stop(true);
    rmSync(f.root, { force: true, recursive: true });
  }
}
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'tale-project-intent-'));
  const projects: Project[] = [];
  let creates = 0;
  let lost = false;
  let unaccepted = false;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      expect(url.pathname).toBe('/api/app/projects');
      expect(url.searchParams.get('orgId')).toBe('org-north');
      if (request.method === 'GET') {
        expect(url.searchParams.get('includeArchived')).toBe('true');
        return Response.json({ projects });
      }
      expect(request.method).toBe('POST');
      const body = (await request.json()) as {
        key: string;
        name: string;
        externalItemId: string;
      };
      const pending = JSON.parse(
        readFileSync(join(root, 'private', `project-${body.key}.json`), 'utf8'),
      );
      expect(pending.phase).toBe('pending');
      expect(pending.externalItemId).toBe(body.externalItemId);
      expect(body).toEqual({
        key: target.project!.key,
        name: target.project!.name,
        externalItemId: 'tale-deployment:north-native:project:NORTH',
      });
      creates++;
      if (!unaccepted)
        projects.push({
          id: 'new-native-project',
          organizationId: 'org-north',
          ...body,
          createdBy: 'operator-north',
          archivedAt: null,
        });
      return lost || unaccepted
        ? new Response('unavailable', { status: 503 })
        : Response.json({ projectId: 'new-native-project' });
    },
  });
  const context: ProvisionContext = {
    baseUrl: 'http://127.0.0.1:3005',
    origin: 'https://native.example.org',
    organization: { id: 'org-north', slug: 'north' },
    user: { id: 'operator-north' },
    headers: () => new Headers({ cookie: 'synthetic-session' }),
    request: (path, method = 'GET', body) =>
      fetch(new URL(path, server.url), {
        method,
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    requireJson: async (response) => {
      if (!response.ok) throw new Error('native-unavailable');
      return response.json();
    },
  };
  return {
    root,
    server,
    context,
    projects,
    creates: () => creates,
    loseResponse: () => {
      lost = true;
    },
    noAcceptance: () => {
      unaccepted = true;
    },
  };
}

test('native symbolic projects create once with exact source identity and preserve existing projects', async () =>
  fixture(async (f) => {
    const old: Project = {
      id: 'original-project',
      organizationId: 'org-north',
      key: 'OLD',
      name: 'Original',
      externalItemId: null,
      createdBy: 'old-owner',
      archivedAt: null,
    };
    f.projects.push(old);
    const configs = [
      target,
      { ...target, client: 'south' },
      { ...target, project: undefined, projectId: old.id },
    ];
    const first = await resolveDeploymentProjects(
      f.context,
      configs,
      'north-native',
      f.root,
    );
    expect(first).toEqual(['new-native-project', 'new-native-project', old.id]);
    const bytes = readFileSync(join(f.root, 'private/project-NORTH.json'));
    expect(JSON.parse(bytes.toString()).phase).toBe('ready');
    expect(
      await resolveDeploymentProjects(
        f.context,
        configs,
        'north-native',
        f.root,
      ),
    ).toEqual(first);
    expect(f.creates()).toBe(1);
    expect(f.projects[0]).toEqual(old);
    expect(readFileSync(join(f.root, 'private/project-NORTH.json'))).toEqual(
      bytes,
    );
  }));

test('accepted project response loss recovers native ID without issuing another create', async () =>
  fixture(async (f) => {
    f.loseResponse();
    await expect(
      resolveDeploymentProjects(f.context, [target], 'north-native', f.root),
    ).rejects.toThrow('retained intent');
    expect(
      JSON.parse(
        readFileSync(join(f.root, 'private/project-NORTH.json'), 'utf8'),
      ).phase,
    ).toBe('pending');
    expect(
      await resolveDeploymentProjects(
        f.context,
        [target],
        'north-native',
        f.root,
      ),
    ).toEqual(['new-native-project']);
    expect(f.creates()).toBe(1);
  }));

test('a later project write cannot hide drift in an earlier resolved target', async () =>
  fixture(async (f) => {
    const request = f.context.request;
    f.context.request = async (path, method, body) => {
      if (method === 'POST' && (body as { key: string }).key === 'SOUTH') {
        f.projects[0]!.archivedAt = '2026-09-11T00:00:00Z';
        f.projects.push({
          id: 'south-project',
          organizationId: 'org-north',
          createdBy: 'operator-north',
          archivedAt: null,
          ...(body as { key: string; name: string; externalItemId: string }),
        });
        return Response.json({ projectId: 'south-project' });
      }
      return request(path, method, body);
    };
    await expect(
      resolveDeploymentProjects(
        f.context,
        [
          target,
          {
            ...target,
            automation: 'second-desk',
            project: { key: 'SOUTH', name: 'South document desk' },
          },
        ],
        'north-native',
        f.root,
      ),
    ).rejects.toThrow('changed');
  }));

test('unaccepted project request remains a review hold and retains its intent', async () =>
  fixture(async (f) => {
    f.noAcceptance();
    await expect(
      resolveDeploymentProjects(f.context, [target], 'north-native', f.root),
    ).rejects.toThrow();
    const bytes = readFileSync(join(f.root, 'private/project-NORTH.json'));
    await expect(
      resolveDeploymentProjects(f.context, [target], 'north-native', f.root),
    ).rejects.toThrow('uncertain');
    expect(f.creates()).toBe(1);
    expect(readFileSync(join(f.root, 'private/project-NORTH.json'))).toEqual(
      bytes,
    );
  }));

test('conflicting later targets and same-name foreign projects refuse before writes', async () =>
  fixture(async (f) => {
    f.projects.push({
      id: 'foreign',
      organizationId: 'org-other',
      key: 'SOUTH',
      name: 'Other',
      externalItemId: null,
      createdBy: 'other',
      archivedAt: null,
    });
    await expect(
      resolveDeploymentProjects(
        f.context,
        [target, { ...target, project: undefined, projectId: 'foreign' }],
        'north-native',
        f.root,
      ),
    ).rejects.toThrow('organization');
    expect(readdirSync(f.root)).toEqual([]);
    f.projects[0] = {
      ...f.projects[0],
      key: 'NORTH',
      name: 'North document desk',
      organizationId: 'org-north',
    };
    await expect(
      resolveDeploymentProjects(f.context, [target], 'north-native', f.root),
    ).rejects.toThrow('conflicts');
    expect(f.creates()).toBe(0);
  }));

test('retained project archive, external identity and operator drift refuse without rewriting', async () =>
  fixture(async (f) => {
    await resolveDeploymentProjects(
      f.context,
      [target],
      'north-native',
      f.root,
    );
    const original = { ...f.projects[0] };
    const bytes = readFileSync(join(f.root, 'private/project-NORTH.json'));
    for (const change of [
      { archivedAt: '2026-01-01' },
      { createdBy: 'other' },
      { externalItemId: 'foreign' },
      { id: 'replacement' },
      { name: 'Reassigned' },
    ]) {
      f.projects[0] = { ...original, ...change };
      await expect(
        resolveDeploymentProjects(f.context, [target], 'north-native', f.root),
      ).rejects.toThrow();
      expect(readFileSync(join(f.root, 'private/project-NORTH.json'))).toEqual(
        bytes,
      );
    }
    expect(f.creates()).toBe(1);
  }));
