/** Typed/env confirmation gate for wiping local Convex dev data. Pure — no I/O. */

export const DESTROY_LOCAL_CONVEX_PHRASE = 'delete local convex';

export const DESTROY_LOCAL_CONVEX_ENV = 'TALE_CONFIRM_DESTROY_LOCAL_CONVEX';
export const DESTROY_LOCAL_CONVEX_ENV_VALUE = 'delete-local-convex';

export interface DestroyLocalConvexGate {
  isTty: boolean;
  typedAnswer: string | null;
  env: NodeJS.ProcessEnv;
}

export function canDestroyLocalConvex(
  gate: DestroyLocalConvexGate,
): { ok: true } | { ok: false; reason: string } {
  if (gate.isTty) {
    const typed = gate.typedAnswer?.trim() ?? '';
    if (typed === DESTROY_LOCAL_CONVEX_PHRASE) return { ok: true };
    return {
      ok: false,
      reason: `Type the exact phrase "${DESTROY_LOCAL_CONVEX_PHRASE}" to confirm.`,
    };
  }
  if (gate.env[DESTROY_LOCAL_CONVEX_ENV] === DESTROY_LOCAL_CONVEX_ENV_VALUE) {
    return { ok: true };
  }
  return {
    ok: false,
    reason:
      `Non-interactive run refused. Set ${DESTROY_LOCAL_CONVEX_ENV}=${DESTROY_LOCAL_CONVEX_ENV_VALUE} only when a human explicitly approved wiping local Convex dev data.`,
  };
}
