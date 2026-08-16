// The Playwright webServer chains client build → preview with `&&`, so the
// chain advances only when the build PROCESS exits. `bun --bun vite build`
// occasionally never exits after a successful build — a dangling handle in
// the rolldown/PWA-plugin pipeline keeps the event loop alive — and the
// silent hang starves the chain until the webServer timeout with zero tests
// run. Building through the JS API and exiting explicitly makes process
// exit a certainty instead of an event-loop accident: `build()` resolves
// only after every plugin's `closeBundle`, so the PWA artifacts are already
// on disk when the exit fires.

import { build } from 'vite';

try {
  await build();
} catch (error) {
  console.error(error);
  process.exit(1);
}
process.exit(0);
