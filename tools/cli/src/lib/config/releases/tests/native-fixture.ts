import { expect } from 'bun:test';
import { readFileSync } from 'node:fs';

import { parse } from 'yaml';

import { unpack } from '../archive';
import { presentationOf } from '../compiler';
import type { DeployOptions } from '../deploy';
import type { LoadedRelease } from '../model';

export async function nativeServer(
  release: LoadedRelease,
  options: DeployOptions,
) {
  const { manifest, installation } = release;
  const entries = await unpack(release.bytes);
  const prefix = `${manifest.automationName}/`;
  const entryBytes = (name: string) =>
    entries.find((entry) => entry.path === prefix + name)!.bytes;
  const document = parse(entryBytes('workflow.yml').toString());
  const metadata = parse(entryBytes('automation.yml').toString());
  const faults = new Set<string>();
  const state = {
    faults,
    requests: [] as { path: string; method: string }[],
    uploads: 0,
    skillUploads: 0,
    skillCreates: 0,
    imports: 0,
    deploys: 0,
    deployed: 0,
    exists: false,
    installed: new Set<string>(),
  };
  const stored = new Map<string, string>();
  options.fetchImpl = async (url, init) => {
    const name = url.pathname;
    const body =
      typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    const method = init.method!;
    state.requests.push({ path: name, method });
    expect(url.searchParams.get('orgId')).toBe(options.orgId);
    expect((init.headers as Record<string, string>).cookie).toBe(
      options.cookie,
    );
    expect((init.headers as Record<string, string>).origin).toBe(
      options.origin ?? options.url,
    );
    expect(init.redirect).toBe('error');
    if (faults.has('invalidResponse')) return Response.json([]);
    if (faults.has('httpFailure'))
      return Response.json({ error: 'secret error body' }, { status: 503 });
    if (name === '/api/auth/get-session')
      return Response.json({
        user: {
          id: faults.has('wrongOwner')
            ? 'wrong_native_owner'
            : manifest.skillOwnerUserId,
        },
      });
    if (name === '/api/app/files/upload') {
      const skill = url.searchParams.get('purpose') === 'skill_bundle';
      if (skill) {
        const artifact = installation!.skills.find((item) =>
          item.bytes.equals(Buffer.from(init.body as Uint8Array)),
        )!;
        expect(artifact).toBeDefined();
        state.skillUploads++;
        const storageId = `skill-${state.skillUploads}`;
        stored.set(storageId, artifact.slug);
        return Response.json({
          storageId: faults.has('missingStorage') ? '' : storageId,
        });
      }
      expect(
        Buffer.from(init.body as Uint8Array).equals(
          installation!.workflow.bytes,
        ),
      ).toBe(true);
      state.uploads++;
      return Response.json({ storageId: `workflow-${state.uploads}` });
    }
    if (name === '/api/app/skills/upload') {
      expect(Object.keys(body)).toEqual(['storageId']);
      const slug = stored.get(body.storageId)!;
      state.installed.add(slug);
      state.skillCreates++;
      if (faults.delete('loseCreation'))
        throw new Error('creation response lost');
      if (faults.has('conflictDifferent')) faults.add('corruptFile');
      return Response.json({
        ok: !faults.has('conflictDifferent') && !faults.has('conflictSame'),
        status: 'needs_confirm',
        slug,
      });
    }
    if (name === '/api/app/automations/upload') {
      expect(body).toEqual({
        projectId: options.projectId,
        storageId: `workflow-${state.uploads}`,
      });
      state.imports++;
      if (faults.has('workflowConflict'))
        return Response.json({ ok: false, status: 'needs_confirm' });
      state.exists = true;
      if (faults.delete('loseUpload')) throw new Error('upload response lost');
      if (faults.has('driftDuringImport')) faults.add('corruptFile');
      return Response.json({
        ok: true,
        name: faults.has('wrongName')
          ? 'foreign-automation'
          : manifest.automationName,
        version: 7,
        warnings: faults.has('warnings') ? ['review required'] : [],
        skills: faults.has('skillWrite')
          ? [{ slug: manifest.skillSlugs[0] }]
          : [],
      });
    }
    if (name.endsWith('/deploy')) {
      if (faults.has('failDeploy'))
        return Response.json({ error: 'private body' }, { status: 503 });
      expect(body.version).toBe(7);
      state.deployed = 7;
      state.deploys++;
      return Response.json({
        name: manifest.automationName,
        version: faults.has('wrongDeploy') ? 8 : 7,
      });
    }
    if (name.endsWith('/projects'))
      return Response.json({
        projectIds: faults.has('missingBinding')
          ? []
          : [options.projectId, 'preserved-other-project'],
      });
    if (name === '/api/app/automations/listing')
      return Response.json({
        automations: [
          {
            name: manifest.automationName,
            deployedVersion: state.deployed,
            projectIds: [options.projectId],
            taskContract: faults.has('wrongTask')
              ? {}
              : metadata.subjects?.task,
          },
        ],
      });
    if (name === `/api/app/automations/${manifest.automationName}`) {
      if (!state.exists) return Response.json({}, { status: 404 });
      return Response.json({
        name: manifest.automationName,
        version: 7,
        deployedVersion: state.deployed,
        document: faults.has('wrongWorkflow') ? {} : document,
        settings: metadata.settings,
        presentation: {
          ...presentationOf(metadata),
          ...(faults.has('changedPresentation')
            ? { description: 'foreign edit' }
            : {}),
        },
        testsPassed: !faults.has('failedTests'),
      });
    }
    for (const slug of manifest.requiredExternalSkills ?? [])
      if (name === `/api/app/skills/${slug}`)
        return faults.has('missingExternal')
          ? Response.json({}, { status: 404 })
          : Response.json({ skill: { slug, files: [] } });
    for (const slug of manifest.skillSlugs) {
      if (name === `/api/app/skills/${slug}`) {
        if (!state.installed.has(slug))
          return Response.json({}, { status: 404 });
        const files = manifest.skillFiles
          .filter((file) => file.slug === slug)
          .map((file) => ({ path: file.path }));
        return Response.json({
          skill: {
            slug,
            files: faults.has('unexpectedFile')
              ? [...files, { path: 'extra.py' }]
              : files,
          },
        });
      }
      if (name.startsWith(`/api/app/skills/${slug}/assets/`)) {
        if (faults.has('missingAsset'))
          return Response.json({}, { status: 404 });
        const file = name
          .split('/assets/')[1]!
          .split('/')
          .map(decodeURIComponent)
          .join('/');
        const content = faults.has('corruptFile')
          ? Buffer.from('changed')
          : entryBytes(`skills/${slug}/${file}`);
        return Response.json({
          asset: { path: file, contentBase64: content.toString('base64') },
        });
      }
    }
    throw new Error(`unexpected request ${name}`);
  };
  return state;
}
export function receiptBytes(options: DeployOptions): Buffer {
  return readFileSync(options.receiptPath!);
}
