// Wire-protocol enums + literals shared between server.ts, spawn.ts, and
// the response builder. Mirrors `services/platform/convex/sandbox/wire.ts`
// on the Convex side — the spawner cannot import from Convex (different
// runtime, different package), so this is a parallel file. Both ends must
// stay in sync; the platform side carries a compile-time `satisfies`
// assertion (see `convex/node_only/sandbox/helpers/spawner_client.ts`)
// that asserts these literals are a subset of the Convex `sandboxRunStatusLiterals`
// / `sandboxErrorCodeLiterals` / `sandboxPhaseEventLiterals` arrays, so a
// drift on either side fails the CI typecheck.

// `sandboxRunStatusLiterals` lives only on the Convex side
// (`services/platform/convex/sandbox/wire.ts`) — the spawner never emits a
// run-status string, only phase events + a final result with one of three
// terminal `status` values (`completed | failed | cancelled`). Kept off
// this file deliberately so unused-export sweeps stay clean.

export const sandboxErrorCodeLiterals = [
  'TIMEOUT',
  'OOM',
  'EGRESS_DENIED',
  'INSTALL_FAILED',
  'PACKAGE_NOT_FOUND',
  'QUOTA_EXCEEDED',
  'RUNTIME_ERROR',
  'SPAWNER_UNAVAILABLE',
  'CANCELLED',
  'INPUT_REJECTED',
] as const;

export type SandboxErrorCode = (typeof sandboxErrorCodeLiterals)[number];

export const sandboxPhaseEventLiterals = [
  'preparing',
  'installing',
  'running',
  'completed',
] as const;

export type SandboxPhaseEvent = (typeof sandboxPhaseEventLiterals)[number];

export const sandboxLanguageLiterals = ['python', 'node'] as const;
export type SandboxLanguage = (typeof sandboxLanguageLiterals)[number];

// Stable id alphabet for executionId (Convex doc id + base32-ish dev ids).
// Used by both the server route regex and the spawn-time argv assertions.
// Centralized so widening one side doesn't drift from the other (commit
// e9211127d widened spawn.ts + docker-args.ts but missed the cancel route).
export const ID_ALPHABET_RE = /^[a-zA-Z0-9_-]{1,64}$/;
export const ORG_ID_ALPHABET_RE = /^[a-zA-Z0-9_-]{1,128}$/;
