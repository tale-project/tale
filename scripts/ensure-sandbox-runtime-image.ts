#!/usr/bin/env bun
/*
  Build the sandbox *runtime* image (`tale-sandbox-runtime:latest`) on demand,
  but only when it is missing locally — a prestep of `docker:dev`.

  Why this exists: `docker:dev` runs `docker compose up --build`, which builds
  every compose *service*. But the per-execution sandbox runtime is NOT a compose
  service — it is the image the `sandbox` spawner `docker run`s at runtime (one
  ephemeral container per /v1/execute call or agent session), referenced only as
  the spawner's `SANDBOX_RUNTIME_IMAGE` default. compose never sees it, so
  `--build` never builds it. On a fresh checkout the image is absent and the first
  Claude-Code / agent message 502s with `Unable to find image
  'tale-sandbox-runtime:latest' locally` — it is not a public image, so the
  implicit `docker pull` also fails ("pull access denied").

  `tale deploy` sidesteps this by pulling + re-tagging the CI-built image from
  GHCR (tools/cli/src/lib/actions/deploy.ts); local dev has no such step, so we
  build from source here. Idempotent and cheap on the hot path: when the image
  already exists this is a sub-second `docker image inspect`, so `docker:dev`
  stays lightweight. Set SANDBOX_RUNTIME_FORCE_BUILD=1 to rebuild even when
  present.

  Build flags mirror CI (.github/workflows/build.yml) and the tag `tale deploy`
  applies: context = repo root, `-f services/sandbox-runtime/Dockerfile` (which
  also activates services/sandbox-runtime/Dockerfile.dockerignore), tagged
  tale-sandbox-runtime:latest — the spawner's SANDBOX_RUNTIME_IMAGE default.
*/
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';

import { doneLine, errorLine, infoLine } from '@tale/shared/tux';

const IMAGE = 'tale-sandbox-runtime:latest';
const DOCKERFILE = 'services/sandbox-runtime/Dockerfile';
const repoRoot = join(import.meta.dir, '..');

const force = ['1', 'true', 'yes'].includes(
  (process.env.SANDBOX_RUNTIME_FORCE_BUILD ?? '').toLowerCase(),
);

// `docker image inspect` exits 0 iff the image is present locally. A non-zero
// `.error` means docker itself could not be spawned (not installed / not on
// PATH) — fail loudly rather than silently attempting a build that cannot run.
function imageExists(): boolean {
  const probe = spawnSync('docker', ['image', 'inspect', IMAGE], {
    stdio: 'ignore',
  });
  if (probe.error) {
    errorLine(
      `Cannot run docker (${probe.error.message}). Install Docker and retry.`,
    );
    process.exit(1);
  }
  return probe.status === 0;
}

if (!force && imageExists()) {
  infoLine(`Sandbox runtime image ${IMAGE} present — skipping build.`);
  process.exit(0);
}

infoLine(
  force
    ? `Rebuilding sandbox runtime image ${IMAGE} (SANDBOX_RUNTIME_FORCE_BUILD set)…`
    : `Sandbox runtime image ${IMAGE} missing — building it once (a few minutes on first run)…`,
);

const build = spawnSync(
  'docker',
  ['build', '-t', IMAGE, '-f', DOCKERFILE, '.'],
  { cwd: repoRoot, stdio: 'inherit' },
);
if (build.error) {
  errorLine(
    `Cannot run docker (${build.error.message}). Install Docker and retry.`,
  );
  process.exit(1);
}
if (build.status !== 0) {
  errorLine(
    `Failed to build ${IMAGE} (docker build exited ${build.status ?? 'on a signal'}).`,
  );
  process.exit(build.status ?? 1);
}

doneLine(`Built ${IMAGE}.`);
