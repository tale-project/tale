// @vitest-environment node

import { createHmac } from 'node:crypto';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashOpaqueToken } from '../../core/lib/opaque_token.ts';

const { hubDevices, hubDisconnect } = vi.hoisted(() => ({
  hubDevices: vi.fn(),
  hubDisconnect: vi.fn(),
}));

vi.mock('../../core/node_only/sandbox/helpers/session_client.ts', () => ({
  sandboxDevices: hubDevices,
  sandboxDeviceDisconnect: hubDisconnect,
}));

import {
  createJoinToken,
  getJoinTokenStatus,
  grantTicket,
  joinDevice,
  leaveDevice,
  listDevices,
  releaseRemovedDevices,
  removeDevice,
  SANDBOX_DEVICE_JOIN_MARKER,
  SANDBOX_DEVICE_SECRET_MARKER,
  SandboxDeviceError,
} from './service.ts';

/**
 * The credential contract behind "Add device": the join token and the
 * device secret each leave the service exactly once and only their hashes
 * land in rows; a join token works once; the organization always comes from
 * the credential; a removed device's secret mints no ticket; the list merges
 * the hub's live view into the registry.
 */

interface Captured {
  text: string;
  values: unknown[];
}

function auditChainAnswers(text: string): object[] | undefined {
  if (text.startsWith('SELECT last_hash AS "lastHash"')) {
    return [{ lastHash: '', lastTs: 0 }];
  }
  if (text.startsWith('INSERT INTO app.audit_logs')) return [{ id: 'audit-1' }];
  return undefined;
}

function fakeSql(
  answer: (text: string, values: unknown[]) => object[] | undefined,
) {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    return Promise.resolve(
      auditChainAnswers(text) ??
        answer(text, values) ??
        (text.startsWith('INSERT INTO app.sandbox_device_join_tokens')
          ? [{ id: 'jt-1' }]
          : []),
    );
  };
  const begin = async (cb: (tx: unknown) => Promise<unknown>) => cb(sqlObject);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  const sqlObject = Object.assign(tag, {
    begin,
    json: (value: unknown) => value,
  }) as unknown as Sql;
  return { sql: sqlObject, queries };
}

const AUDIT_ACTIONS = new Set([
  'sandbox_device_join_token_created',
  'sandbox_device_connected',
  'sandbox_device_removed',
]);

/** The action names the audit rows carry (the resource type rides the same
 * INSERT and is deliberately not counted). */
const auditActions = (queries: Captured[]): unknown[] =>
  queries
    .filter((q) => q.text.startsWith('INSERT INTO app.audit_logs'))
    .flatMap((q) =>
      q.values.filter((v) => typeof v === 'string' && AUDIT_ACTIONS.has(v)),
    );

const ACTOR = { userId: 'admin-1', email: 'admin@example.test' };
const PLATFORM = { os: 'linux', arch: 'x64', cpus: 8, memoryBytes: 1024 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SANDBOX_TOKEN', 'service-test-token');
  vi.stubEnv('SITE_URL', 'https://acme.tale.dev/');
  vi.stubEnv('TALE_VERSION', '0.5.60');
  hubDisconnect.mockResolvedValue({ disconnected: true, placementsDropped: 0 });
});
afterEach(() => vi.unstubAllEnvs());

describe('createJoinToken', () => {
  it('answers the plaintext once and stores only its hash', async () => {
    const { sql, queries } = fakeSql((text) =>
      text.startsWith('SELECT count(*)') ? [{ count: '0' }] : undefined,
    );
    const created = await createJoinToken(sql, {
      organizationId: 'org_a',
      actor: ACTOR,
    });
    expect(created.token.startsWith(SANDBOX_DEVICE_JOIN_MARKER)).toBe(true);
    expect(created.id).toBe('jt-1');
    expect(created.serverUrl).toBe('https://acme.tale.dev');
    expect(created.expiresAt - Date.now()).toBeGreaterThan(59 * 60_000);
    const insert = queries.find((q) =>
      q.text.startsWith('INSERT INTO app.sandbox_device_join_tokens'),
    );
    expect(insert?.values).toContain(await hashOpaqueToken(created.token));
    expect(JSON.stringify(queries)).not.toContain(created.token);
    expect(auditActions(queries)).toEqual([
      'sandbox_device_join_token_created',
    ]);
  });

  it('refuses past the live-token ceiling and without a sandbox service', async () => {
    const { sql } = fakeSql((text) =>
      text.startsWith('SELECT count(*)') ? [{ count: '20' }] : undefined,
    );
    await expect(
      createJoinToken(sql, { organizationId: 'org_a', actor: ACTOR }),
    ).rejects.toMatchObject({ code: 'JOIN_TOKEN_LIMIT', status: 409 });
    vi.stubEnv('SANDBOX_TOKEN', '');
    await expect(
      createJoinToken(sql, { organizationId: 'org_a', actor: ACTOR }),
    ).rejects.toMatchObject({ code: 'SANDBOX_NOT_CONFIGURED', status: 503 });
  });
});

describe('getJoinTokenStatus', () => {
  it.each([null, 'device-1'])(
    'reads only the creator’s own organization-scoped grant: %s',
    async (deviceId) => {
      const { sql, queries } = fakeSql(() => [{ deviceId }]);
      await expect(
        getJoinTokenStatus(sql, {
          organizationId: 'org_a',
          tokenId: 'jt-1',
          actor: ACTOR,
        }),
      ).resolves.toEqual({ deviceId });
      expect(queries).toEqual([
        {
          text: 'SELECT device_id AS "deviceId" FROM app.sandbox_device_join_tokens WHERE id = $? AND org_id = $? AND created_by = $?',
          values: ['jt-1', 'org_a', ACTOR.userId],
        },
      ]);
    },
  );

  it('does not disclose missing, foreign or another administrator’s grant', async () => {
    const { sql } = fakeSql(() => []);
    await expect(
      getJoinTokenStatus(sql, {
        organizationId: 'org_a',
        tokenId: 'other-grant',
        actor: ACTOR,
      }),
    ).rejects.toMatchObject({ code: 'JOIN_TOKEN_NOT_FOUND', status: 404 });
  });
});

describe('joinDevice', () => {
  it('spends the token once and answers the device secret with everything the device needs', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.includes('FROM app.sandbox_device_join_tokens')) {
        return [{ id: 'jt-1', orgId: 'org_a', createdBy: 'admin-1' }];
      }
      if (text.startsWith('SELECT count(*)')) return [{ count: '0' }];
      if (text.startsWith('INSERT INTO app.sandbox_devices')) {
        return [{ id: 'dev-1' }];
      }
      return undefined;
    });
    const joined = await joinDevice(sql, {
      token: 'tsdj_abc12345',
      name: ' studio ',
      maxSessions: 4,
      platform: PLATFORM,
    });
    expect(joined).toMatchObject({
      deviceId: 'dev-1',
      organizationId: 'org_a',
      name: 'studio',
      serverUrl: 'https://acme.tale.dev',
      serverVersion: '0.5.60',
      tunnelUrl: 'wss://acme.tale.dev/sandbox/tunnel',
      relays: [
        { name: 'api', url: 'http://backend-api:3005' },
        { name: 'gateway', url: 'http://sandbox-llm-gateway:8080' },
      ],
      registry: 'ghcr.io/tale-project/tale',
    });
    expect(joined.deviceSecret.startsWith(SANDBOX_DEVICE_SECRET_MARKER)).toBe(
      true,
    );
    const insert = queries.find((q) =>
      q.text.startsWith('INSERT INTO app.sandbox_devices'),
    );
    expect(insert?.values).toContain(
      await hashOpaqueToken(joined.deviceSecret),
    );
    expect(JSON.stringify(queries)).not.toContain(joined.deviceSecret);
    const spend = queries.find((q) =>
      q.text.startsWith('UPDATE app.sandbox_device_join_tokens'),
    );
    expect(spend?.values).toContain('dev-1');
    expect(auditActions(queries)).toEqual(['sandbox_device_connected']);
    // The token lookup only ever matches an unspent, unexpired row.
    const lookup = queries.find((q) =>
      q.text.includes('FROM app.sandbox_device_join_tokens'),
    );
    expect(lookup?.text).toContain('used_at_ms IS NULL');
    expect(lookup?.text).toContain('FOR UPDATE');
  });

  it('refuses a spent, expired or unknown token', async () => {
    const { sql, queries } = fakeSql(() => undefined);
    await expect(
      joinDevice(sql, {
        token: 'tsdj_spent000',
        name: 'x',
        maxSessions: 1,
        platform: PLATFORM,
      }),
    ).rejects.toMatchObject({ code: 'JOIN_TOKEN_INVALID', status: 401 });
    expect(
      queries.some((q) => q.text.startsWith('INSERT INTO app.sandbox_devices')),
    ).toBe(false);
  });

  it('refuses past the per-organization device ceiling', async () => {
    const { sql } = fakeSql((text) => {
      if (text.includes('FROM app.sandbox_device_join_tokens')) {
        return [{ id: 'jt-1', orgId: 'org_a', createdBy: 'admin-1' }];
      }
      if (text.startsWith('SELECT count(*)')) return [{ count: '50' }];
      return undefined;
    });
    await expect(
      joinDevice(sql, {
        token: 'tsdj_abc12345',
        name: 'x',
        maxSessions: 1,
        platform: PLATFORM,
      }),
    ).rejects.toMatchObject({ code: 'DEVICE_LIMIT' });
  });
});

describe('grantTicket', () => {
  const device = {
    id: 'dev-1',
    orgId: 'org_a',
    name: 'studio',
    platform: PLATFORM,
    version: '0.5.60',
    maxSessions: 4,
    createdBy: 'admin-1',
    createdAt: 1,
    lastSeenAt: Date.now(),
  };

  it("mints a ticket the hub can verify, naming the secret's own device and organization", async () => {
    const { sql } = fakeSql((text) =>
      text.includes('FROM app.sandbox_devices') ? [device] : undefined,
    );
    const grant = await grantTicket(sql, 'tsd_secret0000', {
      version: '0.5.60',
      maxSessions: 4,
    });
    const [prefix, payload = '', signature] = grant.ticket.split('.');
    expect(prefix).toBe('tdt1');
    expect(signature).toBe(
      createHmac('sha256', 'service-test-token')
        .update(`device-ticket-v1:${payload}`)
        .digest('hex'),
    );
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(claims).toMatchObject({ d: 'dev-1', o: 'org_a' });
    expect(claims.e - claims.i).toBe(15 * 60_000);
    expect(grant.tunnelUrl).toBe('wss://acme.tale.dev/sandbox/tunnel');
    expect(grant.serverVersion).toBe('0.5.60');
  });

  it('stamps what the device reported, at most once a minute', async () => {
    const fresh = fakeSql((text) =>
      text.includes('FROM app.sandbox_devices') ? [device] : undefined,
    );
    await grantTicket(fresh.sql, 'tsd_secret0000', {
      version: '0.5.60',
      maxSessions: 4,
    });
    expect(
      fresh.queries.some((q) =>
        q.text.startsWith('UPDATE app.sandbox_devices'),
      ),
    ).toBe(false);
    const stale = fakeSql((text) =>
      text.includes('FROM app.sandbox_devices')
        ? [{ ...device, lastSeenAt: Date.now() - 5 * 60_000 }]
        : undefined,
    );
    await grantTicket(stale.sql, 'tsd_secret0000', {
      version: '0.5.61',
      maxSessions: 6,
      platform: PLATFORM,
    });
    const update = stale.queries.find((q) =>
      q.text.startsWith('UPDATE app.sandbox_devices'),
    );
    expect(update?.values).toContain('0.5.61');
    expect(update?.values).toContain(6);
  });

  it('a removed or unknown secret mints nothing', async () => {
    const { sql } = fakeSql(() => undefined);
    await expect(
      grantTicket(sql, 'tsd_removed000', { version: '0.5.60' }),
    ).rejects.toMatchObject({ code: 'DEVICE_REVOKED', status: 401 });
    // A value that is not a device secret is never even looked up.
    const probe = fakeSql(() => undefined);
    await expect(
      grantTicket(probe.sql, 'tsdj_joinToken', { version: '0.5.60' }),
    ).rejects.toBeInstanceOf(SandboxDeviceError);
    expect(probe.queries).toHaveLength(0);
  });
});

describe('removeDevice / leaveDevice', () => {
  it('stamps the row, audits, and tells the hub to cut the tunnel', async () => {
    const { sql, queries } = fakeSql((text) =>
      text.includes('FROM app.sandbox_devices')
        ? [{ id: 'dev-1', name: 'studio', revokedAt: null }]
        : undefined,
    );
    await removeDevice(sql, {
      organizationId: 'org_a',
      deviceId: 'dev-1',
      actor: ACTOR,
    });
    const stamp = queries.find((q) =>
      q.text.startsWith('UPDATE app.sandbox_devices SET revoked_at_ms'),
    );
    expect(stamp?.values).toContain('admin-1');
    expect(auditActions(queries)).toEqual(['sandbox_device_removed']);
    expect(hubDisconnect).toHaveBeenCalledWith('dev-1');
  });

  it("another organization's device is not found", async () => {
    const { sql } = fakeSql(() => undefined);
    await expect(
      removeDevice(sql, {
        organizationId: 'org_b',
        deviceId: 'dev-1',
        actor: ACTOR,
      }),
    ).rejects.toMatchObject({ code: 'DEVICE_NOT_FOUND', status: 404 });
    expect(hubDisconnect).not.toHaveBeenCalled();
  });

  it('a hub that cannot be reached does not undo the removal, and stays owed', async () => {
    hubDisconnect.mockRejectedValue(new Error('spawner down'));
    const { sql, queries } = fakeSql((text) =>
      text.includes('FROM app.sandbox_devices')
        ? [{ id: 'dev-1', name: 'studio', revokedAt: null }]
        : undefined,
    );
    await expect(
      removeDevice(sql, {
        organizationId: 'org_a',
        deviceId: 'dev-1',
        actor: ACTOR,
      }),
    ).resolves.toBeUndefined();
    // Not stamped released: the watchdog asks the hub again.
    expect(queries.some((q) => q.text.includes('SET hub_released_at_ms'))).toBe(
      false,
    );
  });

  it('a confirmed release is stamped', async () => {
    const { sql, queries } = fakeSql((text) =>
      text.includes('FROM app.sandbox_devices')
        ? [{ id: 'dev-1', name: 'studio', revokedAt: null }]
        : undefined,
    );
    await removeDevice(sql, {
      organizationId: 'org_a',
      deviceId: 'dev-1',
      actor: ACTOR,
    });
    const stamp = queries.find((q) =>
      q.text.includes('SET hub_released_at_ms'),
    );
    expect(stamp?.values).toContain('dev-1');
  });

  it('the device can remove itself with its own secret', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.includes('WHERE secret_hash')) {
        return [
          {
            id: 'dev-1',
            orgId: 'org_a',
            name: 'studio',
            platform: {},
            version: null,
            maxSessions: 2,
            createdBy: 'admin-1',
            createdAt: 1,
            lastSeenAt: null,
          },
        ];
      }
      if (text.includes('FROM app.sandbox_devices')) {
        return [{ id: 'dev-1', name: 'studio', revokedAt: null }];
      }
      return undefined;
    });
    await leaveDevice(sql, 'tsd_secret0000');
    const stamp = queries.find((q) =>
      q.text.startsWith('UPDATE app.sandbox_devices SET revoked_at_ms'),
    );
    expect(stamp?.values).toContain('device');
    expect(hubDisconnect).toHaveBeenCalledWith('dev-1');
  });
});

describe('releaseRemovedDevices', () => {
  it('asks the hub again for every removal it has not confirmed', async () => {
    hubDisconnect
      .mockRejectedValueOnce(new Error('spawner still down'))
      .mockResolvedValueOnce({ disconnected: false, placementsDropped: 3 });
    const { sql, queries } = fakeSql((text) =>
      text.includes('hub_released_at_ms IS NULL ORDER BY')
        ? [{ id: 'dev-1' }, { id: 'dev-2' }]
        : undefined,
    );
    expect(await releaseRemovedDevices(sql)).toBe(1);
    expect(hubDisconnect.mock.calls).toEqual([['dev-1'], ['dev-2']]);
    const stamps = queries.filter((q) =>
      q.text.includes('SET hub_released_at_ms'),
    );
    expect(stamps).toHaveLength(1);
    expect(stamps[0]?.values).toContain('dev-2');
  });

  it('without a sandbox service there is nothing to release from', async () => {
    vi.stubEnv('SANDBOX_TOKEN', '');
    const { sql, queries } = fakeSql((text) =>
      text.includes('hub_released_at_ms IS NULL ORDER BY')
        ? [{ id: 'dev-1' }]
        : undefined,
    );
    expect(await releaseRemovedDevices(sql)).toBe(1);
    expect(hubDisconnect).not.toHaveBeenCalled();
    expect(queries.some((q) => q.text.includes('SET hub_released_at_ms'))).toBe(
      true,
    );
  });
});

describe('listDevices', () => {
  const row = (id: string) => ({
    id,
    orgId: 'org_a',
    name: id,
    platform: PLATFORM,
    version: '0.5.60',
    maxSessions: 2,
    createdBy: 'admin-1',
    createdAt: 1,
    lastSeenAt: 2,
  });
  const live = (deviceId: string, overrides: Record<string, unknown> = {}) => ({
    deviceId,
    connectedAtMs: 5,
    version: '0.5.60',
    compatible: true,
    maxSessions: 2,
    sessions: { running: 1, starting: 0 },
    resources: null,
    platform: PLATFORM,
    update: { state: 'idle', targetVersion: null, error: null, atMs: null },
    ...overrides,
  });

  it('merges the live view: online, updating, outdated, failed, offline', async () => {
    hubDevices.mockResolvedValue({
      hub: true,
      devices: [
        live('on'),
        live('upd', {
          compatible: false,
          update: {
            state: 'updating',
            targetVersion: '0.5.61',
            error: null,
            atMs: 1,
          },
        }),
        live('old', { compatible: false, version: '0.5.59' }),
        live('bad', {
          compatible: false,
          update: {
            state: 'failed',
            targetVersion: '0.5.61',
            error: 'pull denied',
            atMs: 1,
          },
        }),
      ],
    });
    const { sql } = fakeSql(() =>
      ['on', 'upd', 'old', 'bad', 'off'].map((id) => row(id)),
    );
    const view = await listDevices(sql, 'org_a');
    expect(view.hub).toBe('available');
    expect(view.serverVersion).toBe('0.5.60');
    expect(
      Object.fromEntries(view.devices.map((d) => [d.id, d.status])),
    ).toEqual({
      on: 'online',
      upd: 'updating',
      old: 'outdated',
      bad: 'update_failed',
      off: 'offline',
    });
    const off = view.devices.find((d) => d.id === 'off');
    expect(off?.sessions).toBeNull();
    expect(off?.platform).toEqual(PLATFORM);
  });

  it('says why nothing is live', async () => {
    hubDevices.mockRejectedValue(new Error('down'));
    const { sql } = fakeSql(() => [row('a')]);
    expect((await listDevices(sql, 'org_a')).hub).toBe('unavailable');
    hubDevices.mockResolvedValue({ hub: false, devices: [] });
    expect((await listDevices(sql, 'org_a')).hub).toBe('not_configured');
    vi.stubEnv('SANDBOX_TOKEN', '');
    expect((await listDevices(sql, 'org_a')).hub).toBe('not_configured');
  });
});
