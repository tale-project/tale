// Device connect tickets — how the hub knows which organization a dialling
// device belongs to without holding the platform's device registry.
//
// The platform owns the registry: it checks a device's long-lived secret
// against its database and answers a short-lived ticket signed with a key
// derived from SANDBOX_TOKEN, the secret the platform and the spawner already
// share (and that never leaves the deployment). The hub verifies the ticket on
// the WebSocket upgrade and on every in-band renewal, so a device the
// organization removed is cut off within one ticket lifetime even if the
// platform's disconnect call never arrived.
//
//   ticket = "tdt1." + b64url(JSON{d, o, i, e}) + "." + hex(HMAC-SHA256(
//              SANDBOX_TOKEN, "device-ticket-v1:" + b64url(JSON)))
//
// The platform mints the same string in
// services/platform/backend/domains/sandbox_devices/ticket.ts; both suites pin
// one test vector so the two sides cannot drift.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { ID_ALPHABET_RE, ORG_ID_ALPHABET_RE } from '../wire.ts';

const TICKET_PREFIX = 'tdt1';
const SIGNING_DOMAIN = 'device-ticket-v1:';
/** The platform mints 15-minute tickets; refuse anything claiming longer. */
const MAX_TICKET_LIFETIME_MS = 60 * 60 * 1000;

export interface DeviceTicket {
  deviceId: string;
  organizationId: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

export type TicketVerification =
  | { ok: true; ticket: DeviceTicket }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

function signature(payload: string, token: string): string {
  return createHmac('sha256', token)
    .update(`${SIGNING_DOMAIN}${payload}`)
    .digest('hex');
}

/** Mint a ticket. The platform is the production minter; this twin exists for
 * the tests and the parity vector. */
export function mintDeviceTicket(ticket: DeviceTicket, token: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      d: ticket.deviceId,
      o: ticket.organizationId,
      i: ticket.issuedAtMs,
      e: ticket.expiresAtMs,
    }),
  ).toString('base64url');
  return `${TICKET_PREFIX}.${payload}.${signature(payload, token)}`;
}

export function verifyDeviceTicket(
  presented: string,
  token: string,
  nowMs: number = Date.now(),
): TicketVerification {
  const parts = presented.split('.');
  if (parts.length !== 3 || parts[0] !== TICKET_PREFIX) {
    return { ok: false, reason: 'malformed' };
  }
  const payload = parts[1] ?? '';
  const presentedSignature = parts[2] ?? '';
  if (!/^[A-Za-z0-9_-]{1,1024}$/.test(payload)) {
    return { ok: false, reason: 'malformed' };
  }
  const expected = Buffer.from(signature(payload, token), 'utf8');
  const actual = Buffer.from(presentedSignature, 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'bad_signature' };
  }
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (claims === null || typeof claims !== 'object') {
    return { ok: false, reason: 'malformed' };
  }
  const d: unknown = Reflect.get(claims, 'd');
  const o: unknown = Reflect.get(claims, 'o');
  const i: unknown = Reflect.get(claims, 'i');
  const e: unknown = Reflect.get(claims, 'e');
  if (
    typeof d !== 'string' ||
    !ID_ALPHABET_RE.test(d) ||
    typeof o !== 'string' ||
    !ORG_ID_ALPHABET_RE.test(o) ||
    typeof i !== 'number' ||
    typeof e !== 'number' ||
    !Number.isFinite(i) ||
    !Number.isFinite(e) ||
    e <= i ||
    e - i > MAX_TICKET_LIFETIME_MS
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (nowMs >= e) return { ok: false, reason: 'expired' };
  return {
    ok: true,
    ticket: {
      deviceId: d,
      organizationId: o,
      issuedAtMs: i,
      expiresAtMs: e,
    },
  };
}
