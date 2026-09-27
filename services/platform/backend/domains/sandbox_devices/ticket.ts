import { createHmac } from 'node:crypto';

/**
 * Device connect tickets — the platform's half of the contract the spawner's
 * device hub verifies (services/sandbox/src/devices/ticket.ts):
 *
 *   ticket = "tdt1." + b64url(JSON{d, o, i, e}) + "." + hex(HMAC-SHA256(
 *              SANDBOX_TOKEN, "device-ticket-v1:" + b64url(JSON)))
 *
 * The platform checks a device's secret against its registry and answers a
 * short-lived ticket; the hub trusts the ticket because only the platform and
 * the spawner hold SANDBOX_TOKEN. Both suites pin one test vector so the two
 * sides cannot drift.
 */

export interface DeviceTicketClaims {
  deviceId: string;
  organizationId: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

export function mintDeviceTicket(
  claims: DeviceTicketClaims,
  sandboxToken: string,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      d: claims.deviceId,
      o: claims.organizationId,
      i: claims.issuedAtMs,
      e: claims.expiresAtMs,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', sandboxToken)
    .update(`device-ticket-v1:${payload}`)
    .digest('hex');
  return `tdt1.${payload}.${signature}`;
}
