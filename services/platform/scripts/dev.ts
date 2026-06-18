#!/usr/bin/env bun
/*
  Thin entry point for the LOCAL dev orchestrator. The orchestration lives in
  `./dev-engine` (`runDevFleet`); this shim stays at `scripts/dev.ts` because
  turbo `@tale/platform#dev`, playwright's webServer, and the root
  `scripts/dev.ts` supervisor all spawn this exact path. Guarded by
  `import.meta.main` so importing the engine elsewhere never auto-starts the fleet.
*/

import { errorLine } from '@tale/shared/tux';

import { runDevFleet } from './dev-engine';

if (import.meta.main) {
  runDevFleet().catch((err: unknown) => {
    errorLine(
      `Orchestrator error: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}
