// Heavy-phase leases. Before a session starts a phase that will press the
// host — a dependency install, an image build, a full test suite — it asks for
// a lease, and the spawner grants one only while the host can take the phase
// (host-admission.ts decides): pressure judged conservatively, at most a few
// such phases at once, and room on disk and in memory for what each phase is
// expected to add beside the others still running. A lease ends on its
// release, at its expiry, or with its session (a stop, reap, destroy or a
// container that died), whichever comes first.
//
// The table lives in the spawner's memory: a restart drops every lease. That
// is bounded — each would have expired within two hours at most, and while
// the host is pressed the next phase is held all the same — and no session's
// running work depends on its lease, only the start of the next phase.

import { ORG_ID_ALPHABET_RE } from './wire.ts';

const GIB = 1024 ** 3;

export const HEAVY_LEASE_CLASS = 'heavy';
/** What a phase is expected to write when its caller does not say: a
 * dependency tree or a build's output. */
export const DEFAULT_PREDICTED_GROWTH_BYTES = 2 * GIB;
/** What a phase is expected to hold in memory beyond its session's own. */
export const DEFAULT_LEASE_MEMORY_BYTES = GIB;
export const DEFAULT_LEASE_TTL_MS = 30 * 60_000;
const MIN_LEASE_TTL_MS = 60_000;
const MAX_LEASE_TTL_MS = 2 * 60 * 60_000;
const MAX_LEASE_LABEL_LENGTH = 120;

export interface HeavyLease {
  id: string;
  sessionId: string;
  organizationId: string;
  class: typeof HEAVY_LEASE_CLASS;
  label: string | null;
  predictedGrowthBytes: number;
  memoryBytes: number;
  acquiredAtMs: number;
  expiresAtMs: number;
}

/** A validated `POST /v1/sessions/:id/leases` body. */
export interface HeavyLeaseRequest {
  organizationId: string;
  label: string | null;
  predictedGrowthBytes: number;
  memoryBytes: number;
  ttlMs: number;
}

function byteCount(
  body: Record<string, unknown>,
  field: 'predictedGrowthBytes' | 'memoryBytes',
  fallback: number,
): number | string {
  const value = body[field];
  if (value === undefined || value === null) return fallback;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : `${field} must be a whole number of bytes, 0 or more`;
}

/** Validate a lease request body; every field but the organization and the
 * class has a default. */
export function parseHeavyLeaseRequest(
  body: unknown,
): { ok: true; value: HeavyLeaseRequest } | { ok: false; error: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'the body must be a JSON object' };
  }
  const fields = Object.fromEntries(Object.entries(body));
  const organizationId = fields.organizationId;
  if (
    typeof organizationId !== 'string' ||
    !ORG_ID_ALPHABET_RE.test(organizationId)
  ) {
    return { ok: false, error: 'organizationId is missing or malformed' };
  }
  if (fields.class !== HEAVY_LEASE_CLASS) {
    return { ok: false, error: `class must be '${HEAVY_LEASE_CLASS}'` };
  }
  const label = fields.label ?? null;
  if (
    label !== null &&
    (typeof label !== 'string' || label.length > MAX_LEASE_LABEL_LENGTH)
  ) {
    return {
      ok: false,
      error: `label must be a string of at most ${MAX_LEASE_LABEL_LENGTH} characters`,
    };
  }
  const predictedGrowthBytes = byteCount(
    fields,
    'predictedGrowthBytes',
    DEFAULT_PREDICTED_GROWTH_BYTES,
  );
  if (typeof predictedGrowthBytes === 'string') {
    return { ok: false, error: predictedGrowthBytes };
  }
  const memoryBytes = byteCount(
    fields,
    'memoryBytes',
    DEFAULT_LEASE_MEMORY_BYTES,
  );
  if (typeof memoryBytes === 'string') return { ok: false, error: memoryBytes };
  const ttlMs = fields.ttlMs ?? DEFAULT_LEASE_TTL_MS;
  if (
    typeof ttlMs !== 'number' ||
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < MIN_LEASE_TTL_MS ||
    ttlMs > MAX_LEASE_TTL_MS
  ) {
    return {
      ok: false,
      error: `ttlMs must be a whole number from ${MIN_LEASE_TTL_MS} to ${MAX_LEASE_TTL_MS}`,
    };
  }
  return {
    ok: true,
    value: { organizationId, label, predictedGrowthBytes, memoryBytes, ttlMs },
  };
}

/** What the active leases hold together. */
export interface LeasesOutstanding {
  count: number;
  growthBytes: number;
  memoryBytes: number;
}

/** The spawner's leases, by id. Expired leases are dropped on every read,
 * and by the session sweep. */
export class HeavyLeases {
  private readonly leases = new Map<string, HeavyLease>();

  constructor(
    /** SANDBOX_HEAVY_LEASES_MAX: the most heavy phases at once. */
    readonly max: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Every active lease, oldest first. */
  active(): HeavyLease[] {
    this.sweep();
    return [...this.leases.values()];
  }

  outstanding(): LeasesOutstanding {
    let growthBytes = 0;
    let memoryBytes = 0;
    const active = this.active();
    for (const lease of active) {
      growthBytes += lease.predictedGrowthBytes;
      memoryBytes += lease.memoryBytes;
    }
    return { count: active.length, growthBytes, memoryBytes };
  }

  summary(): { active: number; max: number } {
    return { active: this.active().length, max: this.max };
  }

  /** Record a lease the caller has decided to grant. */
  grant(sessionId: string, request: HeavyLeaseRequest): HeavyLease {
    const acquiredAtMs = this.now();
    const lease: HeavyLease = {
      id: crypto.randomUUID(),
      sessionId,
      organizationId: request.organizationId,
      class: HEAVY_LEASE_CLASS,
      label: request.label,
      predictedGrowthBytes: request.predictedGrowthBytes,
      memoryBytes: request.memoryBytes,
      acquiredAtMs,
      expiresAtMs: acquiredAtMs + request.ttlMs,
    };
    this.leases.set(lease.id, lease);
    return lease;
  }

  /** End one active lease of the session and organization; false when no
   * such lease is active (never granted, expired, or already ended). */
  release(sessionId: string, leaseId: string, organizationId: string): boolean {
    this.sweep();
    const lease = this.leases.get(leaseId);
    if (
      lease === undefined ||
      lease.sessionId !== sessionId ||
      lease.organizationId !== organizationId
    )
      return false;
    this.leases.delete(leaseId);
    return true;
  }

  /** End every lease of a session that is gone; how many ended. */
  releaseSession(sessionId: string): number {
    let released = 0;
    for (const [id, lease] of this.leases) {
      if (lease.sessionId !== sessionId) continue;
      this.leases.delete(id);
      released += 1;
    }
    return released;
  }

  /** An organization's active leases, of one session when named. */
  list(organizationId: string, sessionId?: string): HeavyLease[] {
    return this.active().filter(
      (lease) =>
        lease.organizationId === organizationId &&
        (sessionId === undefined || lease.sessionId === sessionId),
    );
  }

  /** Drop the expired leases; how many went. */
  sweep(): number {
    const now = this.now();
    let dropped = 0;
    for (const [id, lease] of this.leases) {
      if (lease.expiresAtMs > now) continue;
      this.leases.delete(id);
      dropped += 1;
    }
    return dropped;
  }
}
