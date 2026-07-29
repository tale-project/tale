/**
 * Version-boundary injections: rows/files "born while release X was current",
 * seeded by the versions suite after crossing X's boundary so later
 * migrations meet mid-history data exactly as a long-lived deployment would.
 *
 * EMPTY since the 0.4 baseline reset: the corpus models a fresh 0.4.0
 * deployment and there are no post-baseline releases yet, so nothing can be
 * "born mid-history". The mechanism stays — the first 0.4.x release that
 * both ships a migration AND introduces rows a LATER migration must handle
 * adds its injection here; `versions.test.ts` seeds them at the boundary and
 * `check-migration-corpus` counts their tables as corpus coverage.
 *
 * Two-dot basename keeps this out of the Convex push bundle.
 */

import type { MutationCtx } from '../../../_generated/server';
import type { SeedWorldOrgs } from './seed_db.testkit';

export interface WorldInjection {
  /** The release whose boundary this injection follows (must have a version
   *  checkpoint in `testing/versions/`). */
  readonly afterVersion: string;
  /** Rows that only exist mid-dev-cycle AFTER `afterVersion` (skipped when
   *  the walk's target version IS the boundary — a release-V deployment
   *  never holds them). */
  readonly devCycleOnly?: true;
  /** Tables the injection writes (corpus-coverage accounting). */
  readonly tables: readonly string[];
  readonly seed: (ctx: MutationCtx, orgs: SeedWorldOrgs) => Promise<void>;
  readonly seedFs?: (configRoot: string, orgs: SeedWorldOrgs) => Promise<void>;
}

export const WORLD_INJECTIONS: readonly WorldInjection[] = [];
