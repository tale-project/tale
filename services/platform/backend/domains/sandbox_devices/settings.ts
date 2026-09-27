import type { SandboxDeviceRelay } from '../../../lib/shared/schemas/sandbox-devices.ts';
import {
  basePath,
  canonicalOrigin,
} from '../../core/lib/helpers/public_origin.ts';

/**
 * What this deployment tells a device — at join, with every ticket (where to
 * dial, which release) and when `tale sandbox update` asks (the relay
 * addresses) — all derived from settings the deployment already has, so
 * connecting a device needs no new configuration:
 *
 * - the Tale site the device reaches (`SITE_URL` + `BASE_PATH`);
 * - where it dials the hub: the proxy publishes the spawner's device door at
 *   `/sandbox/tunnel` under that base (`SANDBOX_DEVICE_TUNNEL_URL` overrides
 *   it, e.g. a development hub on its own port);
 * - the addresses its sessions call, which the device answers and relays:
 *   the SAME values the platform hands sessions on the server
 *   (`SANDBOX_HTTP_API_BASE_URL`, `EXTERNAL_AGENT_GATEWAY_URL`);
 * - the release it must run (`TALE_VERSION`) and where release images live.
 */

export function deviceServerUrl(): string {
  return `${canonicalOrigin() ?? 'http://localhost:3000'}${basePath()}`;
}

export function deviceTunnelUrl(): string {
  const explicit = process.env.SANDBOX_DEVICE_TUNNEL_URL?.trim();
  const url = new URL(explicit || `${deviceServerUrl()}/sandbox/tunnel`);
  // A device dials a WebSocket; the same address written as http(s) is meant.
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol === 'http:') url.protocol = 'ws:';
  return url.toString();
}

export function deviceRelays(): SandboxDeviceRelay[] {
  return [
    {
      name: 'api',
      url: (
        process.env.SANDBOX_HTTP_API_BASE_URL ?? 'http://backend-api:3005'
      ).replace(/\/+$/, ''),
    },
    {
      name: 'gateway',
      url: (
        process.env.EXTERNAL_AGENT_GATEWAY_URL ??
        'http://sandbox-llm-gateway:8080'
      ).replace(/\/+$/, ''),
    },
  ];
}

export function deviceServerVersion(): string {
  return process.env.TALE_VERSION?.trim() || 'dev';
}

export function deviceImageRegistry(): string {
  return (
    process.env.SANDBOX_DEVICE_IMAGE_REGISTRY?.trim() ||
    process.env.GHCR_REGISTRY?.trim() ||
    'ghcr.io/tale-project/tale'
  );
}
