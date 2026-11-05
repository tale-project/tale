#!/usr/bin/env bun
/*
  The development fleet: the backend (hot-reloaded) and the Vite dev server in
  front of it. Vite serves the app with hot module replacement and forwards
  `/api` (and the live view's WebSocket) and `/mcp` to the backend, which
  `vite.config.ts` points at the port below. Ctrl+C stops both; so does either
  of them exiting.
*/

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_PORT } from '../backend/config.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VITE_PORT = DEFAULT_PORT;
const BACKEND_PORT = VITE_PORT + 200;

/**
 * The oldest Bun the fleet works on. On Bun 1.3 Vite's proxy, which runs under
 * Bun here, answers the live view's WebSocket handshake and then passes no
 * message either way: the page of a session stays at "Connecting to the
 * browser" and nothing in it responds. The root `package.json` pins 1.4.2; the
 * platform's setup check holds the same floor
 * (`services/platform/scripts/setup-check.ts`).
 */
const MIN_BUN = '1.4.1';
if (Bun.semver.order(Bun.version, MIN_BUN) < 0) {
  console.error(
    `[dev] Bun ${Bun.version} is older than ${MIN_BUN}: the live view of a session would never connect through the dev server. Upgrade Bun (\`bun upgrade\`) and start again.`,
  );
  process.exit(1);
}

// Both run on the Bun that runs this script, the one checked above, whatever
// else `bun` names on the PATH.
const children = [
  {
    name: 'backend',
    command: [process.execPath, '--hot', 'server.ts'],
    env: {
      PORT: String(BACKEND_PORT),
      // The browser addresses the app through Vite's port.
      SESSION_MANAGER_ALLOWED_HOSTS: [
        `localhost:${VITE_PORT}`,
        `127.0.0.1:${VITE_PORT}`,
      ].join(','),
    },
  },
  {
    name: 'vite',
    command: [process.execPath, '--bun', 'vite'],
    env: { SESSION_MANAGER_BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}` },
  },
].map(({ name, command, env }) => ({
  name,
  process: Bun.spawn(command, {
    cwd: root,
    env: { ...process.env, ...env },
    stdout: 'inherit',
    stderr: 'inherit',
  }),
}));

let stopping = false;

function stop(code: number): never {
  if (!stopping) {
    stopping = true;
    for (const { process: child } of children) child.kill();
  }
  process.exit(code);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

// Either one ending ends the fleet: a dev server without its backend only
// shows errors.
await Promise.race(
  children.map(async ({ name, process: child }) => {
    const code = await child.exited;
    if (!stopping) console.error(`[dev] ${name} exited with code ${code}`);
    return code;
  }),
).then((code) => stop(code));
