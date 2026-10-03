import { isIP } from 'node:net';

import { usageError } from '../../utils/fail';

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
      'Example: tale dev --host tale.localhost --port 8443',
    );
  }
  const authority = ipVersion === 6 ? `[${hostname}]` : hostname;
  const url = new URL(`https://${authority}:${port}`);
  if (!ipVersion && url.hostname !== hostname) {
    throw usageError(
      `Invalid --host "${host}": use a full hostname or IP address`,
    );
  }
  const siteUrl = url.origin;
  return { host: hostname, port, siteUrl };
}
