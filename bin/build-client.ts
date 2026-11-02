// Client build chains (Docker, workspace scripts and local preview) advance
// only when the build PROCESS exits. Keep the calling service as the cwd so
// Vite selects its own config and output paths. `bun --bun vite build`
// occasionally never exits after a successful build, and the silent hang
// starves the chain until the webServer timeout with zero tests run.
// Building through the JS API and exiting explicitly removes the implicit
// exit from the chain: `build()` resolves only after every plugin's
// `closeBundle`, so the PWA artifacts are already on disk when the exit
// fires. The exit itself needs Bun ≥ 1.4.1 — earlier Bun ran rolldown's
// N-API finalizers and cleanup hooks inside `process.exit()`, and the
// evidence places CI's remaining stalls there (pinned in
// `.github/actions/setup-turbo/action.yml` and Docker images). The line after `build()`
// resolves puts any future stall on one side of the exit or the other.

import { build } from 'vite';

try {
  await build();
} catch (error) {
  console.error(error);
  process.exit(1);
}
console.info('[build-client] build resolved, exiting 0');
process.exit(0);
