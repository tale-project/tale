import type { SandboxDeviceJoinAnswer, SandboxDeviceRelay } from './config';

/**
 * The CLI's side of the platform's machine door (`/api/sandbox-devices`):
 * trade a join token for the device's credential, ask how the device looks
 * from the server, and remove it. The device's own spawner uses the same
 * door for its connect tickets.
 */

export class SandboxDeviceServerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'SandboxDeviceServerError';
  }
}

/** The server's own answer that the organization removed this device — a
 * 401 for a missing header (a proxy stripping it) is not. */
export function deviceWasRemoved(err: unknown): boolean {
  return (
    err instanceof SandboxDeviceServerError &&
    err.status === 401 &&
    err.code === 'DEVICE_REVOKED'
  );
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

async function call(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new SandboxDeviceServerError(
      `could not reach ${new URL(url).origin}: ${err instanceof Error ? err.message : String(err)}`,
      0,
      null,
    );
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = null;
  }
  if (!res.ok) {
    const field = (key: string): unknown =>
      body !== null && typeof body === 'object'
        ? Reflect.get(body, key)
        : undefined;
    const message = field('error');
    const code = field('code');
    throw new SandboxDeviceServerError(
      typeof message === 'string'
        ? message
        : `the server answered ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      res.status,
      typeof code === 'string' ? code : null,
    );
  }
  return body;
}

function door(serverUrl: string, path: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/api/sandbox-devices${path}`;
}

function isJoinAnswer(value: unknown): value is SandboxDeviceJoinAnswer {
  if (value === null || typeof value !== 'object') return false;
  const get = (key: string): unknown => Reflect.get(value, key);
  return (
    typeof get('deviceId') === 'string' &&
    typeof get('deviceSecret') === 'string' &&
    typeof get('organizationId') === 'string' &&
    typeof get('serverVersion') === 'string' &&
    typeof get('registry') === 'string' &&
    Array.isArray(get('relays'))
  );
}

export async function joinSandboxDevice(
  serverUrl: string,
  input: {
    token: string;
    name: string;
    maxSessions: number;
    platform: {
      os: string;
      arch: string;
      cpus: number | null;
      memoryBytes: number | null;
      dockerVersion: string | null;
    };
  },
  fetchImpl: FetchLike = fetch,
): Promise<SandboxDeviceJoinAnswer> {
  const body = await call(fetchImpl, door(serverUrl, '/join'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!isJoinAnswer(body)) {
    throw new SandboxDeviceServerError(
      'the server answered the join without the device credentials — is this a Tale site?',
      200,
      null,
    );
  }
  return body;
}

export interface SandboxDeviceSelf {
  deviceId: string;
  name: string;
  organizationId: string;
  organizationName: string | null;
  connected: boolean;
  lastSeenAt: number | null;
  serverVersion: string;
  /** The addresses the server hands its sessions now (null from a server
   * that does not say). */
  relays: SandboxDeviceRelay[] | null;
}

function readRelays(value: unknown): SandboxDeviceRelay[] | null {
  if (!Array.isArray(value)) return null;
  const relays: SandboxDeviceRelay[] = [];
  for (const entry of value) {
    const name: unknown =
      entry !== null && typeof entry === 'object'
        ? Reflect.get(entry, 'name')
        : undefined;
    const url: unknown =
      entry !== null && typeof entry === 'object'
        ? Reflect.get(entry, 'url')
        : undefined;
    if ((name !== 'api' && name !== 'gateway') || typeof url !== 'string') {
      return null;
    }
    relays.push({ name, url });
  }
  return relays;
}

export async function describeSandboxDevice(
  serverUrl: string,
  deviceSecret: string,
  fetchImpl: FetchLike = fetch,
): Promise<SandboxDeviceSelf> {
  const body = await call(fetchImpl, door(serverUrl, '/self'), {
    headers: { authorization: `Bearer ${deviceSecret}` },
  });
  const get = (key: string): unknown =>
    body !== null && typeof body === 'object'
      ? Reflect.get(body, key)
      : undefined;
  const lastSeenAt = get('lastSeenAt');
  const organizationName = get('organizationName');
  return {
    deviceId: String(get('deviceId') ?? ''),
    name: String(get('name') ?? ''),
    organizationId: String(get('organizationId') ?? ''),
    organizationName:
      typeof organizationName === 'string' ? organizationName : null,
    connected: get('connected') === true,
    lastSeenAt: typeof lastSeenAt === 'number' ? lastSeenAt : null,
    serverVersion: String(get('serverVersion') ?? ''),
    relays: readRelays(get('relays')),
  };
}

export async function leaveSandboxDevice(
  serverUrl: string,
  deviceSecret: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await call(fetchImpl, door(serverUrl, '/self'), {
    method: 'DELETE',
    headers: { authorization: `Bearer ${deviceSecret}` },
  });
}
