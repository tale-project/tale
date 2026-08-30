/**
 * The dev-boot readiness gates, as DATA tagged with severity + timeout.
 *
 * Severity is the load-bearing distinction: a HARD gate failing aborts the boot
 * (throws); a SOFT gate failing only degrades (warn + continue). A soft→hard slip
 * on the auth gate is the documented cold-start-auth-recovery failure — it would
 * strand the WS unauthenticated — so the mapping is pinned here as data and
 * asserted by a test, and the orchestrator reads its timeouts from this table so
 * the contract has exactly one source.
 *
 * node-only by location; pure data.
 */

export type GateSeverity = 'hard' | 'soft';

export interface GateSpec {
  readonly name: string;
  readonly severity: GateSeverity;
  readonly timeoutMs: number;
}

export const DEV_GATES = {
  /** App port must be free before the slow work (Vite has no fallback). */
  port: { name: 'assertPortFree', severity: 'hard', timeoutMs: 1_000 },
  /** The backend must accept TCP — nothing works without it. */
  backendTcp: {
    name: 'wait-on backend tcp',
    severity: 'hard',
    timeoutMs: 180_000,
  },
  /** LLM gateway is best-effort — pure frontend work survives without it. */
  llmGateway: {
    name: 'sandbox-llm-gateway',
    severity: 'soft',
    timeoutMs: 30_000,
  },
  /** Auth HTTP readiness — SOFT on purpose: the client retries; a hard fail here
   *  would abort the boot and strand the WS (cold-start-auth-recovery). */
  authOk: { name: '/api/auth/ok', severity: 'soft', timeoutMs: 90_000 },
  /** Vite bind announce — informational; the app is up regardless. */
  viteBind: { name: 'vite bind', severity: 'soft', timeoutMs: 180_000 },
} as const satisfies Record<string, GateSpec>;

/** A HARD gate failure fails the fleet; a SOFT one degrades (warn + continue). */
export function gateFailureMode(severity: GateSeverity): 'fail' | 'degrade' {
  return severity === 'hard' ? 'fail' : 'degrade';
}
