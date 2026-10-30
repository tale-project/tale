import { isIP } from 'node:net';

import { usageError } from '../../utils/fail';

/**
 * The origin one run serves instead of `.env`'s HOST and SITE_URL
 * (`tale dev --host/--port`, `tale deploy --host`). An invocation setting of
 * that run: the compose files it generates carry it, `.env` never does.
 */
export interface RunOrigin {
  host: string;
  siteUrl: string;
}

/** A `--host` value as a lowercase hostname or IP, and its URL authority. */
function parseHost(host: string, example: string) {
  const unwrapped = host.replace(/^\[([^\]]+)\]$/, '$1');
  const hostname = (isIP(unwrapped) === 6 ? unwrapped : host).toLowerCase();
  const ipVersion = isIP(hostname);
  const validHostname =
    hostname.length <= 253 &&
    !/^\d+\.\d+\.\d+\.\d+$/.test(hostname) &&
    hostname
      .split('.')
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (!ipVersion && !validHostname) {
    throw usageError(
      `Invalid --host "${host}": expected a hostname or IP address without a protocol, port or path`,
      example,
    );
  }
  const authority = ipVersion === 6 ? `[${hostname}]` : hostname;
  if (!ipVersion && new URL(`https://${authority}`).hostname !== hostname) {
    throw usageError(
      `Invalid --host "${host}": use a full hostname or IP address`,
    );
  }
  return { hostname, authority };
}

/** The local origin is an invocation setting, never a write to production .env. */
export function resolveDevOrigin(host = 'localhost', port = 443) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw usageError(`Invalid --port "${port}": expected 1-65535`);
  }
  if (port === 8003) {
    throw usageError(
      'Invalid --port "8003": this port is reserved for the local sandbox service',
      'Use tale dev --port 8443 instead.',
    );
  }
  const { hostname, authority } = parseHost(
    host,
    'Example: tale dev --host tale.localhost --port 8443',
  );
  const siteUrl = new URL(`https://${authority}:${port}`).origin;
  return { host: hostname, port, siteUrl };
}

/** `tale deploy --host`, checked like `tale dev --host` before anything runs. */
export function resolveDeployHost(host: string): string {
  return parseHost(host, 'Example: tale deploy --host tale.example.com')
    .hostname;
}

/**
 * The SITE_URL a `tale deploy --host` run serves: `.env`'s SITE_URL with the
 * run's host, so the scheme and port the deployment publishes stay as they are.
 */
export function deploySiteUrl(host: string, envSiteUrl?: string): string {
  const url =
    envSiteUrl !== undefined && URL.canParse(envSiteUrl)
      ? new URL(envSiteUrl)
      : undefined;
  const base =
    url && (url.protocol === 'https:' || url.protocol === 'http:')
      ? url
      : new URL('https://localhost');
  base.hostname = isIP(host) === 6 ? `[${host}]` : host;
  return base.origin;
}
