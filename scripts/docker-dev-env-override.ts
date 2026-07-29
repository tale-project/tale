#!/usr/bin/env bun
/*
  Emit an in-memory compose override that forwards the host's env vars into the
  platform container — printed to stdout and piped into `docker compose -f -`
  by `docker:dev`. Values flow through the pipe into the container's env at
  create time and never touch disk: no .env file to write, gitignore, or leak.

  Why this exists: compose can interpolate `${VAR}` but cannot glob env-var
  *names*, so there is no declarative way to forward "whatever the developer
  exported" (e.g. a TALE_PROVIDER_KEY_* under any suffix, or a non-prefixed key
  some connector reads). Generating the `environment:` block here closes that
  gap — export a var and it reaches the container on the next `docker:dev` with
  no compose edit.

  Forwards EVERYTHING in process.env except RUNTIME_DENYLIST: a handful of
  OS/shell vars that must reflect the *container's* reality, not the host's.
  Overriding PATH/HOME/NODE_PATH/etc. with host values (which point at host
  paths absent inside the image) breaks command and module resolution and the
  container fails to boot — that is a correctness floor, not a scoping
  preference. Everything else (provider keys, app config, connector secrets)
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
  // Temp-dir overrides: a host TMPDIR (e.g. a sandboxed shell's private tmp)
  // does not exist inside the container, so coreutils/Bun that honor it
  // (mktemp in docker-entrypoint.sh, Bun's own tmpfile handling) fail with
  // ENOENT and crash-loop the entrypoint. The container must use its own /tmp.
  'TMPDIR',
  'TMP',
  'TEMP',
  // Host-relative networking vars: their value is meaningful only on the host,
  // never inside the container, so forwarding them breaks container-internal
  // networking — the same correctness floor as PATH/HOME above.
  //   * CONVEX_URL points the host `bun dev` loop at the host-run
  //     convex-local-backend (127.0.0.1:3210); inside the container the convex
  //     service is reached at the compose alias http://convex:3210 (the
  //     entrypoint's own default). A forwarded host value makes 127.0.0.1
  //     resolve to the platform container itself → Convex unreachable.
  //   * HTTP(S)_PROXY/ALL_PROXY point at a host-local proxy (e.g. an xray/v2ray
  //     listener on 127.0.0.1). undici (Node `fetch`, used by `convex env set`
  //     and friends) honors them and routes to 127.0.0.1 *inside* the
  //     container, where nothing listens → `TypeError: fetch failed`. The
  //     platform makes zero proxied outbound, so it never needs them.
  'CONVEX_URL',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'NO_PROXY',
  'no_proxy',
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
