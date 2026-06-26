#!/usr/bin/env bun
/*
  Emit an in-memory compose override that forwards the host's env vars into the
  platform container — printed to stdout and piped into `docker compose -f -`
  by `docker:dev`. Values flow through the pipe into the container's env at
  create time and never touch disk: no .env file to write, gitignore, or leak.

  Why this exists: compose can interpolate `${VAR}` but cannot glob env-var
  *names*, so there is no declarative way to forward "whatever the developer
  exported" (e.g. a TALE_PROVIDER_KEY_* under any suffix, or a non-prefixed key
  some integration reads). Generating the `environment:` block here closes that
  gap — export a var and it reaches the container on the next `docker:dev` with
  no compose edit.

  Forwards EVERYTHING in process.env except RUNTIME_DENYLIST: a handful of
  OS/shell vars that must reflect the *container's* reality, not the host's.
  Overriding PATH/HOME/NODE_PATH/etc. with host values (which point at host
  paths absent inside the image) breaks command and module resolution and the
  container fails to boot — that is a correctness floor, not a scoping
  preference. Everything else (provider keys, app config, integration secrets)
  is passed straight through.

  Only the platform container is targeted: its entrypoint runs
  sync-convex-env-from-dotenv.ts, which pushes any forwarded
  `TALE_PROVIDER_KEY_*` from process.env into the Convex deployment (where
  secret_resolver.ts reads them).

  Keys and values are emitted via JSON.stringify — valid YAML flow scalars that
  escape quotes/backslashes/newlines, so unusual names or values survive intact.
*/

// OS/shell/runtime vars whose value is meaningful only inside the process that
// owns it. Forwarding the host's copy would shadow the container's own and
// break execution (PATH/NODE_PATH → command & module lookup; HOME/NPM_CONFIG_*
// → tool caches & global bins; HOSTNAME/PWD/SHELL/TERM/etc. → process identity).
const RUNTIME_DENYLIST = new Set([
  'PATH',
  'HOME',
  'HOSTNAME',
  'PWD',
  'OLDPWD',
  'SHLVL',
  'SHELL',
  'TERM',
  'USER',
  'LOGNAME',
  '_',
  'NODE_PATH',
  'NPM_CONFIG_PREFIX',
  'NPM_CONFIG_UPDATE_NOTIFIER',
  'NoDefaultCurrentDirectoryInExePath',
]);

const entries: string[] = [];
for (const [key, value] of Object.entries(process.env)) {
  if (value === undefined) continue;
  if (RUNTIME_DENYLIST.has(key)) continue;
  entries.push(`      ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
}

// An override with no forwarded vars is still valid: emit an empty mapping so
// the YAML parses and compose merges a no-op.
const environment = entries.length > 0 ? entries.join('\n') : '      {}';

process.stdout.write(
  `services:\n` + `  platform:\n` + `    environment:\n` + `${environment}\n`,
);
