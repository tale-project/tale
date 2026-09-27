/**
 * Sandbox devices over real Postgres and the real HTTP doors: an admin mints
 * a connect command, a machine joins with it (once), mints connect tickets
 * with its own secret, shows up live in the settings list, and is removed —
 * after which its secret mints nothing and the hub was told to cut it. The
 * spawner's device hub is a stub answering the two routes the platform calls.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import type { Sql } from 'postgres';
import { z } from 'zod';

function overrideEnv(vars: Record<string, string>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

export async function checkSandboxDevices(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const token = `itest-devices-${randomUUID()}`;
  let liveDeviceId: string | null = null;
  const disconnects: string[] = [];
  const hub = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const url = req.url ?? '';
    if (req.method === 'GET' && url.startsWith('/v1/devices?')) {
      res.end(
        JSON.stringify({
          hub: true,
          devices:
            liveDeviceId === null
              ? []
              : [
                  {
                    deviceId: liveDeviceId,
                    connectedAtMs: Date.now(),
                    version: '0.5.99',
                    compatible: true,
                    maxSessions: 3,
                    sessions: { running: 1, starting: 0 },
                    resources: null,
                    platform: { os: 'linux', arch: 'x64' },
                    update: {
                      state: 'idle',
                      targetVersion: null,
                      error: null,
                      atMs: null,
                    },
                  },
                ],
        }),
      );
      return;
    }
    const disconnect = /^\/v1\/devices\/([^/]+)\/disconnect$/.exec(url);
    if (req.method === 'POST' && disconnect?.[1]) {
      disconnects.push(disconnect[1]);
      res.end(JSON.stringify({ disconnected: true, placementsDropped: 0 }));
      return;
    }
    res.statusCode = 404;
    res.end('{"error":"not_found"}');
  });
  await new Promise<void>((resolve) => {
    hub.listen(0, '127.0.0.1', resolve);
  });
  const address = hub.address();
  const port =
    address !== null && typeof address === 'object' ? address.port : 0;
  const restoreEnv = overrideEnv({
    SANDBOX_URL: `http://127.0.0.1:${port}`,
    SANDBOX_TOKEN: token,
    TALE_VERSION: '0.5.99',
  });
  // Plain-object headers, so a call's own headers merge over the defaults.
  type JsonInit = Omit<RequestInit, 'headers'> & {
    headers?: Record<string, string>;
  };
  const app = (route: string, init: JsonInit = {}) =>
    fetch(`${base}${route}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        cookie: ctx.cookie,
        origin: base,
        ...init.headers,
      },
    });
  const door = (route: string, init: JsonInit = {}) =>
    fetch(`${base}/api/sandbox-devices${route}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
    });
  const sha256 = (value: string) =>
    createHash('sha256').update(value).digest('hex');

  try {
    // 1. "Add device": a one-hour join token, stored as a hash only.
    const minted = await app(
      `/api/app/sandbox-devices/join-tokens?orgId=${ctx.orgId}`,
      { method: 'POST' },
    );
    const joinToken = z
      .object({
        token: z.string(),
        expiresAt: z.number(),
        serverUrl: z.string(),
      })
      .safeParse(await minted.json());
    const tokenRows = joinToken.success
      ? await sql<{ n: string }[]>`
          SELECT count(*)::text AS n FROM app.sandbox_device_join_tokens
          WHERE org_id = ${ctx.orgId} AND token_hash = ${sha256(joinToken.data.token)}
        `
      : [];
    record(
      'sandbox devices: an admin mints a single-use connect command',
      minted.status === 201 &&
        joinToken.success &&
        joinToken.data.token.startsWith('tsdj_') &&
        tokenRows[0]?.n === '1',
      `status=${minted.status} stored=${tokenRows[0]?.n ?? 'none'}`,
    );
    if (!joinToken.success) return;

    // 2. The machine joins — once.
    const joinBody = JSON.stringify({
      token: joinToken.data.token,
      name: 'itest-box',
      maxSessions: 2,
      platform: { os: 'linux', arch: 'x64', cpus: 4 },
    });
    const joined = await door('/join', { method: 'POST', body: joinBody });
    const device = z
      .object({
        deviceId: z.string(),
        deviceSecret: z.string(),
        organizationId: z.string(),
        tunnelUrl: z.string(),
        relays: z.array(z.object({ name: z.string(), url: z.string() })),
      })
      .safeParse(await joined.json());
    const replay = await door('/join', { method: 'POST', body: joinBody });
    const replayBody = z
      .object({ code: z.string() })
      .safeParse(await replay.json());
    const secretRows = device.success
      ? await sql<{ secretHash: string; createdBy: string }[]>`
          SELECT secret_hash AS "secretHash", created_by AS "createdBy"
          FROM app.sandbox_devices WHERE id = ${device.data.deviceId}
        `
      : [];
    record(
      'sandbox devices: a join token enrols one device and never another',
      joined.status === 201 &&
        device.success &&
        device.data.organizationId === ctx.orgId &&
        device.data.deviceSecret.startsWith('tsd_') &&
        device.data.tunnelUrl.endsWith('/sandbox/tunnel') &&
        device.data.relays.length === 2 &&
        secretRows[0]?.secretHash === sha256(device.data.deviceSecret) &&
        secretRows[0].createdBy === ctx.userId &&
        replay.status === 401 &&
        replayBody.success &&
        replayBody.data.code === 'JOIN_TOKEN_INVALID',
      `join=${joined.status} replay=${replay.status}`,
    );
    if (!device.success) return;
    const bearer = { authorization: `Bearer ${device.data.deviceSecret}` };

    // 3. The device's spawner mints a ticket the hub can verify.
    const ticketed = await door('/ticket', {
      method: 'POST',
      headers: bearer,
      body: JSON.stringify({ version: '0.5.99', maxSessions: 3 }),
    });
    const ticket = z
      .object({ ticket: z.string(), serverVersion: z.string() })
      .safeParse(await ticketed.json());
    const [, payload = '', signature = ''] = ticket.success
      ? ticket.data.ticket.split('.')
      : [];
    const claims: unknown = payload
      ? JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      : null;
    const reported = await sql<
      { version: string | null; maxSessions: number | null }[]
    >`
      SELECT version, max_sessions AS "maxSessions"
      FROM app.sandbox_devices WHERE id = ${device.data.deviceId}
    `;
    record(
      'sandbox devices: a device secret mints a ticket naming its own device and organization',
      ticketed.status === 200 &&
        ticket.success &&
        ticket.data.serverVersion === '0.5.99' &&
        signature ===
          createHmac('sha256', token)
            .update(`device-ticket-v1:${payload}`)
            .digest('hex') &&
        claims !== null &&
        typeof claims === 'object' &&
        Reflect.get(claims, 'd') === device.data.deviceId &&
        Reflect.get(claims, 'o') === ctx.orgId &&
        reported[0]?.version === '0.5.99' &&
        reported[0].maxSessions === 3,
      `status=${ticketed.status}`,
    );

    // 4. The settings list merges the hub's live view.
    liveDeviceId = device.data.deviceId;
    const listed = await app(`/api/app/sandbox-devices?orgId=${ctx.orgId}`);
    const list = z
      .object({
        hub: z.string(),
        devices: z.array(
          z.object({ id: z.string(), status: z.string(), name: z.string() }),
        ),
      })
      .safeParse(await listed.json());
    const self = await door('/self', { headers: bearer });
    const selfBody = z
      .object({
        organizationId: z.string(),
        connected: z.boolean(),
        // What `tale sandbox update` lays out when the operator moved them.
        relays: z.array(z.object({ name: z.string(), url: z.string() })),
      })
      .safeParse(await self.json());
    record(
      'sandbox devices: the settings list and the device agree it is online',
      listed.status === 200 &&
        list.success &&
        list.data.hub === 'available' &&
        list.data.devices.some(
          (d) =>
            d.id === device.data.deviceId &&
            d.status === 'online' &&
            d.name === 'itest-box',
        ) &&
        selfBody.success &&
        selfBody.data.organizationId === ctx.orgId &&
        selfBody.data.connected &&
        selfBody.data.relays.length === 2,
      `list=${listed.status} self=${self.status}`,
    );

    // 5. Removal: the secret stops working and the hub is told.
    const unknown = await app(
      `/api/app/sandbox-devices/${randomUUID()}?orgId=${ctx.orgId}`,
      { method: 'DELETE' },
    );
    const removed = await app(
      `/api/app/sandbox-devices/${device.data.deviceId}?orgId=${ctx.orgId}`,
      { method: 'DELETE' },
    );
    liveDeviceId = null;
    const after = await door('/ticket', {
      method: 'POST',
      headers: bearer,
      body: JSON.stringify({ version: '0.5.99' }),
    });
    const audits = await sql<{ action: string }[]>`
      SELECT action FROM app.audit_logs
      WHERE org_id = ${ctx.orgId} AND action LIKE 'sandbox_device_%'
    `;
    const actions = new Set(audits.map((a) => a.action));
    // The hub confirmed the release, so the watchdog owes it nothing.
    const released = await sql<{ releasedAt: string | null }[]>`
      SELECT hub_released_at_ms::text AS "releasedAt"
      FROM app.sandbox_devices WHERE id = ${device.data.deviceId}
    `;
    record(
      'sandbox devices: a removed device mints nothing and the hub cuts it',
      unknown.status === 404 &&
        removed.status === 200 &&
        after.status === 401 &&
        disconnects.includes(device.data.deviceId) &&
        released[0]?.releasedAt !== null &&
        released[0]?.releasedAt !== undefined &&
        actions.has('sandbox_device_join_token_created') &&
        actions.has('sandbox_device_connected') &&
        actions.has('sandbox_device_removed'),
      `unknown=${unknown.status} removed=${removed.status} ticketAfter=${after.status} released=${released[0]?.releasedAt ?? 'no'} audits=${[...actions].join(',')}`,
    );
  } finally {
    restoreEnv();
    await new Promise<void>((resolve) => {
      hub.close(() => resolve());
    });
  }
}
