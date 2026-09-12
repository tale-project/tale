import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { preconditionError } from '../../utils/fail';
import {
  applyPlatformConfiguration,
  planPlatformConfiguration,
  readPlatformConfiguration,
} from './platform-apply';
import type { PlatformConfigurationClient } from './platform-client';
import { platformConfigurationFixture } from './platform-fixture';
import { parsePlatformConfiguration, resourceId } from './platform-model';
import { valueHash } from './releases/identity';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

/** Stateful native API contract fixture: independent files, opaque preimages,
 * side effects and lost replies. Backend route suites own the actual services. */
async function fixture(
  configuration = platformConfigurationFixture(),
  organization = 'example-office',
) {
  const directory = await mkdtemp(join(tmpdir(), 'tale-platform-config-'));
  directories.push(directory);
  const entries = new Map<
    string,
    { config: unknown; hash: string; id?: string }
  >();
  let serial = 0;
  const mutate = (id: string, config: unknown) => {
    const prior = entries.get(id);
    entries.set(id, {
      config: structuredClone(config),
      hash: valueHash({ config, serial: ++serial }),
      ...(id.startsWith('provider-credential/')
        ? { id: prior?.id ?? `credential-${serial}` }
        : {}),
    });
  };
  const writes: string[] = [];
  const controls = {
    fail: '',
    lost: '',
    documents: false,
    hiddenDocuments: false,
    websites: false,
    wrongCatalog: false,
    forbidden: false,
    afterWrite: (_id: string) => {},
  };
  const client: PlatformConfigurationClient = {
    target: {
      origin: 'https://native.example.invalid',
      organizationId: `${organization}-id`,
      organizationSlug: organization,
    },
    request: async (path, method = 'GET', body) => {
      const url = new URL(path, 'https://native.example.invalid');
      const payload = body as Record<string, unknown> | undefined;
      if (controls.forbidden) throw preconditionError('HTTP 403');
      if (url.pathname === '/api/app/documents/approx-count')
        return {
          count: controls.documents || controls.hiddenDocuments ? 1 : 0,
        };
      if (url.pathname === '/api/app/websites/count')
        return { count: controls.websites ? 1 : 0 };
      if (url.pathname === '/api/app/documents/paginated')
        return {
          page: controls.documents ? [{}] : [],
          isDone: !controls.documents,
        };
      if (url.pathname.endsWith('/catalog')) {
        const name = url.pathname.split('/').at(-2);
        const resource = configuration.resources.find(
          (entry) => entry.kind === 'provider' && entry.config.name === name,
        );
        return {
          models:
            resource?.kind === 'provider'
              ? resource.expectedModels?.map((model) =>
                  Object.assign({}, model, {
                    id: controls.wrongCatalog ? 'Unexpected-model' : model.id,
                  }),
                )
              : [],
        };
      }
      let id: string;
      if (url.pathname === '/api/app/provider-credentials/' && method === 'GET')
        return {
          credentials: [...entries]
            .filter(([key]) => key.startsWith('provider-credential/'))
            .map(([, entry]) =>
              Object.assign({}, entry.config, {
                id: entry.id,
                createdAt: 1,
                updatedAt: 2,
                hash: entry.hash,
                maskedPreview: 'never-return-this',
              }),
            ),
        };
      if (url.pathname.startsWith('/api/app/provider-credentials/')) {
        const credentialId = url.pathname.slice(
          '/api/app/provider-credentials/'.length,
        );
        if (credentialId)
          id = [...entries].find(([, entry]) => entry.id === credentialId)![0];
        else
          id = `provider-credential/${payload!.providerSlug}/${encodeURIComponent(String(payload!.name))}`;
      } else if (url.pathname.startsWith('/api/app/providers/definitions/'))
        id = `provider/${url.pathname.split('/').at(-1)}`;
      else if (url.pathname.startsWith('/api/app/governance/policies/'))
        id = `governance/${url.pathname.split('/').at(-1)}`;
      else if (url.pathname.startsWith('/api/app/branding/')) id = 'branding';
      else if (url.pathname === '/api/app/knowledge/embedding')
        id = 'knowledge-embedding';
      else if (url.pathname === '/api/app/deployment/config') id = 'deployment';
      else throw new Error(`Unexpected fixture API: ${path}`);
      const current = entries.get(id);
      if (method === 'GET') {
        if (id.startsWith('governance/'))
          return {
            policy: current
              ? { key: id.split('/')[1], config: current.config }
              : null,
            hash: current?.hash ?? null,
          };
        return {
          config:
            current?.config ?? (id === 'deployment' ? { version: 1 } : null),
          hash: current?.hash ?? null,
          canEdit: true,
        };
      }
      if (payload!.expectedHash !== (current?.hash ?? null))
        throw preconditionError('CONFIG_VERSION_CONFLICT');
      if (controls.fail === id) throw new Error('private native refusal text');
      const { expectedHash: _expected, ...fields } = payload!;
      let config = fields.config ?? fields;
      if (id.startsWith('provider-credential/'))
        config = {
          endpointUrl: null,
          modelAllowlist: null,
          status: 'active',
          isDefault: true,
          ...(current?.config as object | undefined),
          ...fields,
        };
      if (id === 'knowledge-embedding') {
        // The platform's own floor rule (`writeKnowledgeEmbedding`): a
        // save that omits `minSimilarity` keeps the stored value, an
        // explicit null clears it, a number sets it.
        const { minSimilarity: declared, ...rest } = fields as {
          minSimilarity?: number | null;
        } & Record<string, unknown>;
        const stored = (
          current?.config as { minSimilarity?: number } | undefined
        )?.minSimilarity;
        const floor =
          declared === undefined
            ? stored
            : declared === null
              ? undefined
              : declared;
        config = {
          ...rest,
          ...(floor === undefined ? {} : { minSimilarity: floor }),
        };
      }
      mutate(id, config);
      writes.push(id);
      controls.afterWrite(id);
      if (controls.lost === id) {
        controls.lost = '';
        throw new Error('private lost response');
      }
      return id === 'knowledge-embedding'
        ? { ok: true, requeued: 0 }
        : { ok: true };
    },
  };
  return {
    configuration,
    client,
    entries,
    controls,
    mutate,
    writes,
    receipt: join(directory, 'receipt.json'),
  };
}

const ordinary = () =>
  parsePlatformConfiguration({
    schemaVersion: 1,
    resources: [
      { kind: 'branding', config: { accentColor: '#336699' } },
      {
        kind: 'governance',
        key: 'session_idle_timeout',
        config: { enabled: true, idleTimeoutMinutes: 45 },
      },
    ],
  });

describe('one general native configuration lifecycle', () => {
  test.each(['example-office', 'another-client'])(
    '%s: plans and applies ordinary settings, policies and providers, then replays without writes',
    async (organization) => {
      const f = await fixture(undefined, organization);
      const plan = await planPlatformConfiguration(f.configuration, f.client);
      expect(f.writes).toEqual([]);
      expect(plan.resources.map((entry) => entry.scope)).toContain('instance');
      expect(plan.resources.map((entry) => entry.id)).toContain('branding');
      expect(JSON.stringify(plan)).not.toMatch(
        /cookie|secret|models.example.invalid/,
      );
      const applied = await applyPlatformConfiguration(
        f.configuration,
        plan,
        f.client,
        f.receipt,
      );
      expect(applied.configured).toBe(true);
      expect(applied.target.organizationSlug).toBe(organization);
      expect(applied.resources).toHaveLength(f.configuration.resources.length);
      expect(f.writes.slice(0, 3)).toEqual([
        'provider/private-reasoning',
        'provider/private-vision',
        'provider/private-embedding',
      ]);
      // Windows stat exposes no POSIX owner/group permission bits.
      if (process.platform !== 'win32')
        expect((await stat(f.receipt)).mode & 0o777).toBe(0o600);
      const writeCount = f.writes.length;
      expect(
        (
          await applyPlatformConfiguration(
            f.configuration,
            plan,
            f.client,
            f.receipt,
          )
        ).unchanged,
      ).toBe(true);
      expect(f.writes).toHaveLength(writeCount);
      const read = await readPlatformConfiguration(f.configuration, f.client);
      expect(read.resources.every((resource) => resource.matches)).toBe(true);
      expect(JSON.stringify(read)).not.toContain('never-return-this');
    },
  );

  test('updates an existing ordinary setting through a newly reviewed plan', async () => {
    const f = await fixture(ordinary());
    await applyPlatformConfiguration(
      f.configuration,
      await planPlatformConfiguration(f.configuration, f.client),
      f.client,
      f.receipt,
    );
    const next = ordinary();
    const branding = next.resources.find((entry) => entry.kind === 'branding')!;
    branding.config.accentColor = '#112233';
    const plan = await planPlatformConfiguration(next, f.client);
    expect(
      plan.resources.find((entry) => entry.id === 'branding')?.action,
    ).toBe('update');
    const before = f.writes.length;
    await applyPlatformConfiguration(next, plan, f.client, f.receipt);
    expect(f.writes.slice(before)).toEqual(['branding']);
    expect(f.entries.get('branding')?.config).toEqual({
      accentColor: '#112233',
    });
  });

  test('speaks the platform’s three ways about the embedding floor: a number sets it, an omitted one keeps it, null clears it', async () => {
    // The platform keeps a stored `minSimilarity` when a save omits it and
    // clears it only on an explicit null, so the declaration must be able
    // to say "leave it", "set it" and "clear it" — and converge on each.
    const embedding = () =>
      platformConfigurationFixture().resources.find(
        (entry) => entry.kind === 'knowledge-embedding',
      )!;
    const declaring = (config: object) =>
      parsePlatformConfiguration({
        schemaVersion: 1,
        resources: [{ kind: 'knowledge-embedding', config }],
      });
    const f = await fixture(declaring(embedding().config));
    // An operator set the floor by hand, in the file.
    f.mutate('knowledge-embedding', {
      ...embedding().config,
      minSimilarity: 0.55,
    });

    // Omitted: the stored floor is not the declaration's concern.
    const kept = await planPlatformConfiguration(f.configuration, f.client);
    expect(kept.resources[0]?.action).toBe('unchanged');
    expect(kept.resources[0]?.effects).toEqual([]);
    expect(
      (await readPlatformConfiguration(f.configuration, f.client)).resources[0]
        ?.matches,
    ).toBe(true);

    // A number: set exactly, and converge on it.
    const raised = declaring({ ...embedding().config, minSimilarity: 0.6 });
    const raisePlan = await planPlatformConfiguration(raised, f.client);
    expect(raisePlan.resources[0]?.action).toBe('update');
    expect(raisePlan.resources[0]?.effects).toEqual([
      'embedding-configuration',
    ]);
    await applyPlatformConfiguration(raised, raisePlan, f.client, f.receipt);
    expect(f.entries.get('knowledge-embedding')?.config).toEqual({
      ...embedding().config,
      minSimilarity: 0.6,
    });

    // Null: the one way to clear a floor the file holds.
    const cleared = declaring({ ...embedding().config, minSimilarity: null });
    const clearPlan = await planPlatformConfiguration(cleared, f.client);
    expect(clearPlan.resources[0]?.action).toBe('update');
    const before = f.writes.length;
    await applyPlatformConfiguration(cleared, clearPlan, f.client, f.receipt);
    expect(f.writes.slice(before)).toEqual(['knowledge-embedding']);
    expect(f.entries.get('knowledge-embedding')?.config).toEqual(
      embedding().config,
    );
    // …and it converges: the same declaration replays without a write.
    expect(
      (await planPlatformConfiguration(cleared, f.client)).resources[0]?.action,
    ).toBe('unchanged');
    expect(
      (await readPlatformConfiguration(cleared, f.client)).resources[0]
        ?.matches,
    ).toBe(true);
  });

  test('rejects a stale native setting before writing any resource', async () => {
    const f = await fixture(ordinary());
    const plan = await planPlatformConfiguration(f.configuration, f.client);
    f.mutate('governance/session_idle_timeout', {
      enabled: true,
      idleTimeoutMinutes: 60,
    });
    await expect(
      applyPlatformConfiguration(f.configuration, plan, f.client, f.receipt),
    ).rejects.toThrow('changed since planning');
    expect(f.writes).toEqual([]);
  });

  test.each([
    'declaration',
    'organization',
    'origin',
    'resource',
    'desired-hash',
  ])('rejects a plan bound to another %s', async (kind) => {
    const f = await fixture(ordinary());
    const plan = await planPlatformConfiguration(f.configuration, f.client);
    if (kind === 'declaration') plan.configurationSha256 = 'f'.repeat(64);
    if (kind === 'organization') plan.target.organizationId = 'foreign-id';
    if (kind === 'origin') plan.target.origin = 'https://other.example.invalid';
    if (kind === 'resource') plan.resources.reverse();
    if (kind === 'desired-hash')
      plan.resources[0]!.desiredSha256 = 'f'.repeat(64);
    await expect(
      applyPlatformConfiguration(f.configuration, plan, f.client, f.receipt),
    ).rejects.toThrow('differs');
    expect(f.writes).toEqual([]);
  });

  test('retains partial application and recovers a lost response without duplicating a write', async () => {
    const f = await fixture(ordinary());
    const plan = await planPlatformConfiguration(f.configuration, f.client);
    f.controls.lost = 'governance/session_idle_timeout';
    await expect(
      applyPlatformConfiguration(f.configuration, plan, f.client, f.receipt),
    ).rejects.toThrow('after 1 verified');
    const pending = JSON.parse(await readFile(f.receipt, 'utf8'));
    expect(pending.phase).toBe('pending');
    expect(pending.verified.map((entry: { id: string }) => entry.id)).toEqual([
      'branding',
    ]);
    expect(JSON.stringify(pending)).not.toContain('private');
    const prior = [...f.writes];
    expect(
      (
        await applyPlatformConfiguration(
          f.configuration,
          plan,
          f.client,
          f.receipt,
        )
      ).configured,
    ).toBe(true);
    expect(f.writes).toEqual(prior);
  });

  test('does not replace an unfinished operation with a different declaration', async () => {
    const f = await fixture(ordinary());
    const plan = await planPlatformConfiguration(f.configuration, f.client);
    f.controls.fail = 'governance/session_idle_timeout';
    await expect(
      applyPlatformConfiguration(f.configuration, plan, f.client, f.receipt),
    ).rejects.toThrow('stopped');
    const next = ordinary();
    next.resources.pop();
    await expect(
      applyPlatformConfiguration(
        next,
        await planPlatformConfiguration(next, f.client),
        f.client,
        f.receipt,
      ),
    ).rejects.toThrow('retained');
    expect(f.writes).toEqual(['branding']);
  });

  test('detects edits after preflight and preserves the unverified remainder', async () => {
    const f = await fixture(ordinary());
    const plan = await planPlatformConfiguration(f.configuration, f.client);
    f.controls.afterWrite = (id) => {
      if (id === 'branding')
        f.mutate('governance/session_idle_timeout', {
          enabled: false,
          idleTimeoutMinutes: 30,
        });
    };
    await expect(
      applyPlatformConfiguration(f.configuration, plan, f.client, f.receipt),
    ).rejects.toThrow('changed since planning');
    expect(f.writes).toEqual(['branding']);
    expect(JSON.parse(await readFile(f.receipt, 'utf8')).phase).toBe('pending');
  });

  test('refuses embedding changes with an existing corpus before provider or policy writes', async () => {
    const f = await fixture();
    f.controls.documents = true;
    await expect(
      planPlatformConfiguration(f.configuration, f.client),
    ).rejects.toThrow('document corpus');
    expect(f.writes).toEqual([]);
  });

  test('refuses embedding changes when project or team documents are absent from the visible hub', async () => {
    const f = await fixture();
    f.controls.hiddenDocuments = true;
    expect(
      await f.client.request('/api/app/documents/paginated?numItems=1'),
    ).toEqual({ page: [], isDone: true });
    await expect(
      planPlatformConfiguration(f.configuration, f.client),
    ).rejects.toThrow('document corpus');
    expect(f.writes).toEqual([]);
  });

  test('refuses embedding changes with an existing website corpus', async () => {
    const f = await fixture();
    f.controls.websites = true;
    await expect(
      planPlatformConfiguration(f.configuration, f.client),
    ).rejects.toThrow('corpus');
    expect(f.writes).toEqual([]);
  });

  test('a catalog mismatch never becomes a ready configuration receipt', async () => {
    const f = await fixture();
    const plan = await planPlatformConfiguration(f.configuration, f.client);
    f.controls.wrongCatalog = true;
    await expect(
      applyPlatformConfiguration(f.configuration, plan, f.client, f.receipt),
    ).rejects.toThrow('catalog differs');
    expect(JSON.parse(await readFile(f.receipt, 'utf8')).phase).toBe('pending');
    expect(f.writes).toEqual(['provider/private-reasoning']);
  });

  test('native permissions remain authoritative', async () => {
    const f = await fixture(ordinary());
    f.controls.forbidden = true;
    await expect(
      planPlatformConfiguration(f.configuration, f.client),
    ).rejects.toThrow('403');
    expect(f.writes).toEqual([]);
  });

  test('final whole-set readback detects a later native side effect', async () => {
    const f = await fixture(ordinary());
    const plan = await planPlatformConfiguration(f.configuration, f.client);
    f.controls.afterWrite = (id) => {
      if (id.startsWith('governance/'))
        f.mutate('branding', { accentColor: '#000000' });
    };
    await expect(
      applyPlatformConfiguration(f.configuration, plan, f.client, f.receipt),
    ).rejects.toThrow('did not converge');
    expect(JSON.parse(await readFile(f.receipt, 'utf8')).phase).toBe('pending');
  });

  test('refuses to adopt a non-environment credential', async () => {
    const f = await fixture();
    const resource = f.configuration.resources.find(
      (entry) => entry.kind === 'provider-credential',
    )!;
    f.mutate(resourceId(resource), {
      ...resource.config,
      authMethod: 'api-key',
      envName: null,
    });
    await expect(
      planPlatformConfiguration(f.configuration, f.client),
    ).rejects.toThrow('authentication method');
    expect(f.writes).toEqual([]);
  });

  test('refuses ambiguous native credential names without writing settings', async () => {
    const f = await fixture();
    const resource = f.configuration.resources.find(
      (entry) => entry.kind === 'provider-credential',
    )!;
    f.mutate(resourceId(resource), resource.config);
    const request = f.client.request;
    f.client.request = async (path, method, body) => {
      const result = await request(path, method, body);
      if (
        path === '/api/app/provider-credentials/' &&
        (!method || method === 'GET')
      ) {
        const view = result as { credentials: Record<string, unknown>[] };
        return {
          credentials: [
            ...view.credentials,
            Object.assign({}, view.credentials[0], {
              id: 'another-credential',
            }),
          ],
        };
      }
      return result;
    };
    await expect(
      planPlatformConfiguration(f.configuration, f.client),
    ).rejects.toThrow('ambiguous');
    expect(f.writes).toEqual([]);
  });

  test('a new default requires an explicit update of the previous credential', async () => {
    const f = await fixture();
    const desired = f.configuration.resources.find(
      (entry) => entry.kind === 'provider-credential',
    )!;
    const old = {
      ...desired,
      config: { ...desired.config, name: 'Previous default' },
    };
    f.mutate(resourceId(old), old.config);
    await expect(
      planPlatformConfiguration(f.configuration, f.client),
    ).rejects.toThrow('explicit declaration');
    expect(f.writes).toEqual([]);
    f.configuration.resources.push({
      ...old,
      config: { ...old.config, isDefault: false },
    });
    const plan = await planPlatformConfiguration(f.configuration, f.client);
    const result = await applyPlatformConfiguration(
      f.configuration,
      plan,
      f.client,
      f.receipt,
    );
    expect(result.configured).toBe(true);
    expect(f.writes.indexOf(resourceId(old))).toBeLessThan(
      f.writes.indexOf(resourceId(desired)),
    );
    const readback = await readPlatformConfiguration(f.configuration, f.client);
    expect(readback.resources.every((resource) => resource.matches)).toBe(true);
  });

  test('a default introduced after planning cannot be silently demoted', async () => {
    const f = await fixture();
    const desired = f.configuration.resources.find(
      (entry) => entry.kind === 'provider-credential',
    )!;
    const plan = await planPlatformConfiguration(f.configuration, f.client);
    f.controls.afterWrite = (id) => {
      if (id === 'provider/private-reasoning') {
        const other = {
          ...desired,
          config: { ...desired.config, name: 'Concurrent default' },
        };
        f.mutate(resourceId(other), other.config);
      }
    };
    await expect(
      applyPlatformConfiguration(f.configuration, plan, f.client, f.receipt),
    ).rejects.toThrow('explicit declaration');
    expect(f.writes.every((id) => id.startsWith('provider/'))).toBe(true);
    expect(JSON.parse(await readFile(f.receipt, 'utf8')).phase).toBe('pending');
  });
});
