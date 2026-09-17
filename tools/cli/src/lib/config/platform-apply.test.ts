import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { KNOWLEDGE_EMBEDDING_KEPT_KEYS } from '@tale/shared/schemas/knowledge';

import { preconditionError } from '../../utils/fail';
import { writeDeploymentBundle } from '../deployment/bundle';
import {
  provisionDeploymentConfiguration,
  verifyNativeConfigurationProof,
} from '../deployment/configuration';
import type { ProvisionContext } from '../deployment/identity';
import { writePrivateJson } from '../state/private-files';
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
      if (url.pathname === '/api/app/provider-credentials' && method === 'GET')
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
      if (url.pathname === '/api/app/provider-credentials')
        id = `provider-credential/${payload!.providerSlug}/${encodeURIComponent(String(payload!.name))}`;
      else if (url.pathname.startsWith('/api/app/provider-credentials/')) {
        const credentialId = url.pathname.slice(
          '/api/app/provider-credentials/'.length,
        );
        id = [...entries].find(([, entry]) => entry.id === credentialId)![0];
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
        // The platform's own rule for the settings the form does not carry
        // (`writeKnowledgeEmbedding`): a save that omits one keeps the
        // stored value, an explicit null clears it, a value sets it.
        const next: Record<string, unknown> = { ...fields };
        const stored = (current?.config ?? {}) as Record<string, unknown>;
        for (const key of KNOWLEDGE_EMBEDDING_KEPT_KEYS) {
          const kept =
            fields[key] === null ? undefined : (fields[key] ?? stored[key]);
          if (kept === undefined) delete next[key];
          else next[key] = kept;
        }
        config = next;
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
  test('pending embedding recovery honors cleared and preserved similarity floors after a lost response', async () => {
    for (const floor of [null, undefined]) {
      const configuration = parsePlatformConfiguration({
        schemaVersion: 1,
        resources: [
          {
            kind: 'knowledge-embedding',
            config: {
              providerSlug: 'local-embedding',
              model: 'New-embedding',
              dimensions: 1536,
              baseUrl: 'https://models.example.invalid/v1',
              ...(floor === null ? { minSimilarity: null } : {}),
            },
          },
        ],
      });
      const f = await fixture(configuration);
      f.mutate('knowledge-embedding', {
        ...configuration.resources[0]!.config,
        model: 'Previous-embedding',
        minSimilarity: 0.25,
      });
      const originalPlan = await planPlatformConfiguration(
        configuration,
        f.client,
      );
      f.controls.lost = 'knowledge-embedding';
      await expect(
        applyPlatformConfiguration(
          configuration,
          originalPlan,
          f.client,
          f.receipt,
        ),
      ).rejects.toThrow('stopped');
      const retained = JSON.parse(await readFile(f.receipt, 'utf8'));
      const next = parsePlatformConfiguration({
        schemaVersion: 1,
        resources: [
          {
            ...configuration.resources[0],
            config: {
              ...configuration.resources[0]!.config,
              baseUrl: 'https://corrected.example.invalid/v1',
            },
          },
        ],
      });
      const proof = await applyPlatformConfiguration(
        next,
        await planPlatformConfiguration(next, f.client),
        f.client,
        f.receipt,
        { supersedesPendingPlan: valueHash(originalPlan) },
      );
      const deploymentBundleSha256 = 'b'.repeat(64);
      expect(
        verifyNativeConfigurationProof(
          { ...proof, deploymentBundleSha256 },
          next,
          deploymentBundleSha256,
          f.client.target.organizationId,
          f.client.target.organizationSlug,
          f.client.target.origin,
        ).resources[0]?.configurationSha256,
      ).toBe(valueHash(next.resources[0]!.config));
      expect(proof.resources[0]?.observedConfigurationSha256).toBe(
        valueHash(f.entries.get('knowledge-embedding')?.config),
      );
      expect(JSON.parse(await readFile(f.receipt, 'utf8'))).toMatchObject({
        phase: 'ready',
        superseded: [retained],
      });
      expect(f.entries.get('knowledge-embedding')?.config).toEqual({
        ...next.resources[0]!.config,
        ...(floor === null ? {} : { minSimilarity: 0.25 }),
        minSimilarity: floor === null ? undefined : 0.25,
      });
      expect(f.writes).toEqual(['knowledge-embedding', 'knowledge-embedding']);
    }
  });

  test('a reviewed replacement recovers a partial plan and retains its evidence across retries', async () => {
    const f = await fixture(ordinary());
    const originalPlan = await planPlatformConfiguration(
      f.configuration,
      f.client,
    );
    f.controls.lost = 'branding';
    await expect(
      applyPlatformConfiguration(
        f.configuration,
        originalPlan,
        f.client,
        f.receipt,
      ),
    ).rejects.toThrow('stopped');
    const original = JSON.parse(await readFile(f.receipt, 'utf8'));
    const changed = ordinary();
    changed.resources[0] = {
      kind: 'branding',
      config: { accentColor: '#993366' },
    };
    const plan = await planPlatformConfiguration(changed, f.client);
    for (const supersedesPendingPlan of [undefined, 'f'.repeat(64)]) {
      const before = await readFile(f.receipt, 'utf8');
      const writes = [...f.writes];
      await expect(
        applyPlatformConfiguration(changed, plan, f.client, f.receipt, {
          supersedesPendingPlan,
        }),
      ).rejects.toThrow('retained');
      expect(await readFile(f.receipt, 'utf8')).toBe(before);
      expect(f.writes).toEqual(writes);
    }
    const options = { supersedesPendingPlan: valueHash(originalPlan) };
    f.controls.lost = 'branding';
    await expect(
      applyPlatformConfiguration(changed, plan, f.client, f.receipt, options),
    ).rejects.toThrow('stopped');
    expect(JSON.parse(await readFile(f.receipt, 'utf8'))).toMatchObject({
      phase: 'pending',
      superseded: [original],
    });
    await applyPlatformConfiguration(
      changed,
      plan,
      f.client,
      f.receipt,
      options,
    );
    const writes = [...f.writes];
    await applyPlatformConfiguration(
      changed,
      await planPlatformConfiguration(changed, f.client),
      f.client,
      f.receipt,
      options,
    );
    expect(f.writes).toEqual(writes);
    expect(JSON.parse(await readFile(f.receipt, 'utf8'))).toMatchObject({
      phase: 'ready',
      superseded: [original],
    });
    if (process.platform !== 'win32')
      expect((await stat(f.receipt)).mode & 0o777).toBe(0o600);
  });

  test('pending replacement refuses concurrent edits, omitted resources and another target without mutation', async () => {
    for (const fault of ['edit', 'omit', 'target'] as const) {
      const f = await fixture(ordinary());
      const originalPlan = await planPlatformConfiguration(
        f.configuration,
        f.client,
      );
      f.controls.lost = 'branding';
      await expect(
        applyPlatformConfiguration(
          f.configuration,
          originalPlan,
          f.client,
          f.receipt,
        ),
      ).rejects.toThrow();
      const changed = ordinary();
      changed.resources[0] = {
        kind: 'branding',
        config: { accentColor: '#993366' },
      };
      if (fault === 'edit') f.mutate('branding', { accentColor: '#000000' });
      if (fault === 'omit') changed.resources.pop();
      if (fault === 'target')
        f.client.target.organizationId = 'foreign-organization';
      const plan = await planPlatformConfiguration(changed, f.client);
      const before = await readFile(f.receipt, 'utf8');
      const writes = [...f.writes];
      await expect(
        applyPlatformConfiguration(changed, plan, f.client, f.receipt, {
          supersedesPendingPlan: valueHash(originalPlan),
        }),
      ).rejects.toThrow();
      expect(await readFile(f.receipt, 'utf8')).toBe(before);
      expect(f.writes).toEqual(writes);
    }
  });
  for (const mode of ['migration', 'recovery'] as const)
    test.skipIf(process.platform === 'win32')(
      `managed deployment carries reviewed ${mode} into native configuration readback`,
      async () => {
        const f = await fixture(ordinary());
        const stateDirectory = dirname(f.receipt);
        const receipt = join(stateDirectory, 'configuration.json');
        const originalPlan = await planPlatformConfiguration(
          f.configuration,
          f.client,
        );
        if (mode === 'recovery') f.controls.lost = 'branding';
        const initial = applyPlatformConfiguration(
          f.configuration,
          originalPlan,
          f.client,
          receipt,
        );
        if (mode === 'recovery') {
          await expect(initial).rejects.toThrow('stopped');
          f.configuration.resources[0] = {
            kind: 'branding',
            config: { accentColor: '#993366' },
          };
        } else await initial;
        const writes = [...f.writes];
        const origin =
          mode === 'migration'
            ? 'https://renamed.example.invalid'
            : f.client.target.origin;
        const migrateOriginFrom =
          mode === 'migration' ? f.client.target.origin : undefined;
        const directory = join(stateDirectory, 'bundle');
        for (const [file, bytes] of [
          ['cli/tale', 'synthetic executable'],
          ['runtime/runtime.json', '{}'],
          ['runtime/compose.yml', 'services: {}'],
        ]) {
          const target = join(directory, file!);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, bytes!, {
            mode: file === 'cli/tale' ? 0o755 : 0o644,
          });
        }
        await writeDeploymentBundle(directory, {
          schemaVersion: 1,
          kind: 'tale-deployment',
          cli: { revision: 'c'.repeat(40), path: 'cli/tale' },
          spec: {
            schemaVersion: 1,
            name: 'example-native',
            stateDirectory: '/opt/example',
            composeProject: 'tale',
            runtime: { revision: 'c'.repeat(40), platform: 'linux/amd64' },
            origin,
            tlsMode: 'external',
            environment: {},
            identity: {
              email: 'operator@example.invalid',
              slug: f.client.target.organizationSlug,
              name: 'Example Office',
              ssoEnabled: false,
              bootstrap: 'fresh',
              migrateOriginFrom,
              nativeClients: [],
            },
            configuration: f.configuration,
            ...(mode === 'recovery'
              ? { supersedesPendingConfigurationPlan: valueHash(originalPlan) }
              : {}),
            configs: [],
          },
        });
        const context: ProvisionContext = {
          origin,
          migrateOriginFrom,
          baseUrl: 'http://127.0.0.1:3005',
          stateDirectory,
          organization: {
            id: f.client.target.organizationId,
            slug: f.client.target.organizationSlug,
          },
          user: { id: 'operator-example' },
          headers: () => new Headers(),
          request: async (path, method, body) =>
            Response.json(await f.client.request(path, method, body)),
          requireJson: (response) => response.json(),
        };
        const result = await provisionDeploymentConfiguration(
          directory,
          context,
        );
        expect(result).toMatchObject({
          configured: true,
          target: { ...f.client.target, origin },
        });
        expect(JSON.parse(await readFile(receipt, 'utf8'))).toMatchObject({
          phase: 'ready',
          plan: { target: { ...f.client.target, origin } },
        });
        if (mode === 'migration') expect(f.writes).toEqual(writes);
        else
          expect(
            JSON.parse(await readFile(receipt, 'utf8')).superseded[0].plan,
          ).toEqual(originalPlan);
        const completedWrites = [...f.writes];
        await provisionDeploymentConfiguration(directory, context);
        expect(f.writes).toEqual(completedWrites);
      },
    );

  // Four complete apply passes fsync every resource receipt. Keep real disk
  // persistence without racing Bun's 5 s default on Windows CI storage.
  test('reviewed hostname migration preserves native configuration and its organization binding', async () => {
    const f = await fixture();
    await applyPlatformConfiguration(
      f.configuration,
      await planPlatformConfiguration(f.configuration, f.client),
      f.client,
      f.receipt,
    );
    const before = JSON.parse(await readFile(f.receipt, 'utf8'));
    const writes = [...f.writes];
    const entries = structuredClone(f.entries);
    const migrateOriginFrom = f.client.target.origin;
    f.client.target = {
      ...f.client.target,
      origin: 'https://renamed.example.invalid',
    };
    const target = { ...f.client.target };
    const plan = await planPlatformConfiguration(f.configuration, f.client);
    for (const from of [undefined, 'https://foreign.example.invalid'])
      await expect(
        applyPlatformConfiguration(f.configuration, plan, f.client, f.receipt, {
          migrateOriginFrom: from,
        }),
      ).rejects.toThrow('retained');
    for (const change of [
      { organizationId: 'foreign-id' },
      { organizationSlug: 'foreign-office' },
    ]) {
      f.client.target = { ...target, ...change };
      await expect(
        applyPlatformConfiguration(
          f.configuration,
          await planPlatformConfiguration(f.configuration, f.client),
          f.client,
          f.receipt,
          { migrateOriginFrom },
        ),
      ).rejects.toThrow('retained');
    }
    f.client.target = target;
    await writePrivateJson(f.receipt, { ...before, phase: 'pending' });
    await expect(
      applyPlatformConfiguration(f.configuration, plan, f.client, f.receipt, {
        migrateOriginFrom,
      }),
    ).rejects.toThrow('retained');
    await writePrivateJson(f.receipt, before);
    const result = await applyPlatformConfiguration(
      f.configuration,
      plan,
      f.client,
      f.receipt,
      { migrateOriginFrom },
    );
    expect(result.target).toEqual(target);
    expect(JSON.parse(await readFile(f.receipt, 'utf8'))).toMatchObject({
      phase: 'ready',
      plan: { target },
    });
    await applyPlatformConfiguration(
      f.configuration,
      plan,
      f.client,
      f.receipt,
      { migrateOriginFrom },
    );
    expect(f.writes).toEqual(writes);
    expect(f.entries).toEqual(entries);
    f.client.target = { ...target, origin: migrateOriginFrom };
    await applyPlatformConfiguration(
      f.configuration,
      await planPlatformConfiguration(f.configuration, f.client),
      f.client,
      f.receipt,
      { migrateOriginFrom: target.origin },
    );
    expect(
      JSON.parse(await readFile(f.receipt, 'utf8')).plan.target.origin,
    ).toBe(migrateOriginFrom);
    expect(f.writes).toEqual(writes);
  }, 30_000);

  test('origin migration cannot replace a missing configuration receipt', async () => {
    const f = await fixture();
    await expect(
      applyPlatformConfiguration(
        f.configuration,
        await planPlatformConfiguration(f.configuration, f.client),
        f.client,
        f.receipt,
        { migrateOriginFrom: 'https://old.example.invalid' },
      ),
    ).rejects.toThrow('retained native configuration receipt');
    expect(f.writes).toEqual([]);
  });

  test('an interrupted configuration migration resumes its exact plan at the new origin', async () => {
    const f = await fixture(ordinary());
    await applyPlatformConfiguration(
      f.configuration,
      await planPlatformConfiguration(f.configuration, f.client),
      f.client,
      f.receipt,
    );
    const migrateOriginFrom = f.client.target.origin;
    f.client.target = {
      ...f.client.target,
      origin: 'https://renamed.example.invalid',
    };
    const next = parsePlatformConfiguration({
      schemaVersion: 1,
      resources: [
        { kind: 'branding', config: { accentColor: '#224466' } },
        {
          kind: 'governance',
          key: 'session_idle_timeout',
          config: { enabled: true, idleTimeoutMinutes: 60 },
        },
      ],
    });
    const plan = await planPlatformConfiguration(next, f.client);
    f.controls.lost = 'governance/session_idle_timeout';
    await expect(
      applyPlatformConfiguration(next, plan, f.client, f.receipt, {
        migrateOriginFrom,
      }),
    ).rejects.toThrow('stopped');
    const pending = JSON.parse(await readFile(f.receipt, 'utf8'));
    expect(pending).toMatchObject({
      phase: 'pending',
      plan: { target: f.client.target },
    });
    const writes = [...f.writes];
    const result = await applyPlatformConfiguration(
      next,
      pending.plan,
      f.client,
      f.receipt,
      { migrateOriginFrom },
    );
    expect(result.configured).toBe(true);
    expect(f.writes).toEqual(writes);
    expect(JSON.parse(await readFile(f.receipt, 'utf8')).phase).toBe('ready');
  });
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

  test('changes only the serving limits of an organization that already has a corpus', async () => {
    const model = {
      providerSlug: 'local-embedding',
      model: 'Example-embedding',
      dimensions: 1024,
      baseUrl: 'https://models.example.invalid/v1',
    };
    const declare = (config: object) =>
      parsePlatformConfiguration({
        schemaVersion: 1,
        resources: [{ kind: 'knowledge-embedding', config }],
      });
    const limits = declare({
      ...model,
      maxConcurrentRequests: 2,
      minTokensPerSecond: 750,
    });
    const f = await fixture(limits);
    f.mutate('knowledge-embedding', { ...model, minSimilarity: 0.5 });
    f.controls.documents = true;
    f.controls.websites = true;

    const plan = await planPlatformConfiguration(limits, f.client);
    expect(plan.resources[0]).toMatchObject({
      action: 'update',
      effects: ['embedding-configuration'],
    });
    await applyPlatformConfiguration(limits, plan, f.client, f.receipt);
    expect(f.entries.get('knowledge-embedding')?.config).toEqual({
      ...model,
      minSimilarity: 0.5,
      maxConcurrentRequests: 2,
      minTokensPerSecond: 750,
    });
    expect(
      (await readPlatformConfiguration(limits, f.client)).resources[0]?.matches,
    ).toBe(true);

    // Clearing a limit is still only a limit change…
    const cleared = declare({ ...model, minTokensPerSecond: null });
    await applyPlatformConfiguration(
      cleared,
      await planPlatformConfiguration(cleared, f.client),
      f.client,
      join(dirname(f.receipt), 'cleared.json'),
    );
    expect(f.entries.get('knowledge-embedding')?.config).toEqual({
      ...model,
      minSimilarity: 0.5,
      maxConcurrentRequests: 2,
    });
    // …while a different model on the same corpus is not.
    await expect(
      planPlatformConfiguration(
        declare({
          ...model,
          model: 'Other-embedding',
          minTokensPerSecond: 750,
        }),
        f.client,
      ),
    ).rejects.toThrow('document corpus');
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
        path === '/api/app/provider-credentials' &&
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

  test('addresses the provider-credentials collection without a trailing slash', async () => {
    // The Hono backend serves the collection at `/api/app/provider-credentials`;
    // a trailing slash is a 404. Only the per-credential address keeps a segment
    // after the slash. Reading, creating and reading back a credential must use
    // the slashless collection route.
    const f = await fixture();
    const paths: string[] = [];
    const request = f.client.request;
    f.client.request = async (path, method, body) => {
      paths.push(path);
      return request(path, method, body);
    };
    const plan = await planPlatformConfiguration(f.configuration, f.client);
    await applyPlatformConfiguration(
      f.configuration,
      plan,
      f.client,
      f.receipt,
    );
    const collection = paths.filter((path) =>
      path.startsWith('/api/app/provider-credentials'),
    );
    expect(collection).toContain('/api/app/provider-credentials');
    expect(collection).not.toContain('/api/app/provider-credentials/');
    expect(
      collection.every(
        (path) =>
          path === '/api/app/provider-credentials' ||
          /^\/api\/app\/provider-credentials\/[^/]+$/.test(path),
      ),
    ).toBe(true);
  });
});
