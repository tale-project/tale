# syntax=docker/dockerfile:1.26@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# Tale Session Manager Dockerfile — a Vite SPA and a Bun server that drives
# headless Camoufox (Firefox) browsers.
#
# Build (from the repo root; the context is the whole repository):
#   docker build -f services/session-manager/Dockerfile -t tale-session-manager .
#
# Run it ON YOUR OWN MACHINE, published on the loopback only:
#   docker run -d --name session-manager \
#     -p 127.0.0.1:3004:3004 \
#     -v session-manager-data:/data \
#     tale-session-manager
# then open http://localhost:3004.
#
#   * There is NO LOGIN. Whoever reaches the port can open every session, read
#     the secrets in the vault and drive the browsers, so the port is published
#     on 127.0.0.1 only: `-p 3004:3004` would offer it to the whole network. To
#     reach it from other machines, put a reverse proxy that authenticates in
#     front of it and name the address people use in the Host allow-list below.
#   * The server answers only requests whose `Host` is 127.0.0.1, localhost or
#     the bind address on its own port (that blocks DNS rebinding), and a
#     state-changing request must not come from another origin. Publish the
#     port under another number (`-p 127.0.0.1:8080:3004`) or put a proxy in
#     front, and name the addresses the browser shows, `host:port` exactly as in
#     the address bar, comma separated:
#       -e SESSION_MANAGER_ALLOWED_HOSTS=localhost:8080,127.0.0.1:8080
#   * /data is the volume: the database (proxy passwords and secrets, private to
#     the app user), every session's profile and, in /data/camoufox, the Camoufox
#     browser (1.3 GB) and the GeoIP database. The first start downloads them in
#     the background, about 700 MB (the page shows that it is under way, and the
#     container is healthy meanwhile). Without the volume every new container
#     downloads them again. To keep them out of the backups of /data, mount a
#     second volume and point CAMOUFOX_INSTALL_DIR at it:
#       -v session-manager-browser:/camoufox -e CAMOUFOX_INSTALL_DIR=/camoufox
#     A bind mount must be writable by uid 1001, the `app` user:
#     chown 1001:1001 <host directory>.
#   * The first start saves the 624 MB archive in /tmp and reads it into memory
#     to unpack it (the peak is about 1.3 GB), then keeps 1.3 GB in the volume:
#     give the container 2 GB of memory (3 GB when /tmp is in memory) and /tmp
#     1 GB. Each running session is a Firefox of its own, about 1 GB on a heavy
#     page.
#   * `docker stop` closes the browsers; a session reopens its tabs when it is
#     started again.
#   * Each session's browser reaches the web through that session's proxy. A
#     proxy on the Docker host is `host.docker.internal` (on Linux add
#     `--add-host=host.docker.internal:host-gateway`).
#   * The browsers run in Firefox's own headless mode, without an X server, which
#     has no WebGL: a page that asks for a WebGL context gets none, whatever GPU
#     the session's fingerprint names.
#   * The server writes only to /data, /tmp and its home directory, so a stricter
#     run works too:
#       docker run ... --read-only --cap-drop=ALL --security-opt no-new-privileges \
#         --tmpfs /tmp:size=1g,mode=1777 --tmpfs /home/app:uid=1001,gid=1001,mode=700
#
# Environment, all optional: PORT (3004), SESSION_MANAGER_HOST (the bind address,
# 0.0.0.0 here), SESSION_MANAGER_DATA_DIR (/data), CAMOUFOX_INSTALL_DIR
# (<data dir>/camoufox), SESSION_MANAGER_ALLOWED_HOSTS, SESSION_MANAGER_BLOCK_WEBRTC.

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS bun-bin

# ============================================================================
# Stage 1: workspace deps
# ============================================================================
FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587 AS workspace-deps
COPY --from=bun-bin /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
# The root package.json's `patchedDependencies` (patches/README.md): `bun install`
# refuses to run without the patch files, and they must reach the installed packages.
COPY patches/ ./patches/
# `bun install` resolves the WHOLE workspace, not just this service: the root
# manifest names `services/sandbox-runtime/daemon` explicitly and every
# `workspace:*` dependency has to resolve, so every workspace manifest is
# copied — the same set `services/ui-docs` copies. Three alone fail with
# `error: Workspace not found "services/sandbox-runtime/daemon"`.
COPY packages/e2e/package.json ./packages/e2e/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY packages/marketing-ui/package.json ./packages/marketing-ui/
COPY services/platform/package.json ./services/platform/
COPY services/db/package.json ./services/db/
COPY services/proxy/package.json ./services/proxy/
COPY services/sandbox/package.json ./services/sandbox/
COPY services/sandbox-runtime/daemon/package.json ./services/sandbox-runtime/daemon/
COPY services/web/package.json ./services/web/
COPY services/docs/package.json ./services/docs/
COPY services/ui-docs/package.json ./services/ui-docs/
COPY services/session-manager/package.json ./services/session-manager/
COPY tools/cli/package.json ./tools/cli/
COPY tools/plop/package.json ./tools/plop/
COPY tools/opengrep/package.json ./tools/opengrep/

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && HUSKY=0 bun install

# ============================================================================
# Stage 2: builder — the page
# ============================================================================
FROM workspace-deps AS builder
WORKDIR /app

COPY tsconfig.base.json ./
COPY tsconfig.dom.json ./
COPY packages/ui ./packages/ui
# The page's inputs, and nothing else: the server's sources (`backend/`,
# `server.ts`) are copied straight into the runner, so an edit to them leaves
# this stage — the slow one — cached.
COPY services/session-manager/package.json \
     services/session-manager/tsconfig.json \
     services/session-manager/vite.config.ts \
     services/session-manager/vite-env.d.ts \
     services/session-manager/index.html \
     services/session-manager/postcss.config.mjs \
     services/session-manager/tailwind.config.ts \
     services/session-manager/tsr.config.json \
     ./services/session-manager/
COPY services/session-manager/types ./services/session-manager/types
COPY services/session-manager/public ./services/session-manager/public
COPY services/session-manager/messages ./services/session-manager/messages
COPY services/session-manager/lib ./services/session-manager/lib
COPY services/session-manager/app ./services/session-manager/app
COPY services/session-manager/scripts/prerender-boot-shell.ts \
     services/session-manager/scripts/font-preloads.ts \
     ./services/session-manager/scripts/

ENV NODE_ENV=production
WORKDIR /app/services/session-manager
# The page, then its boot shell and the preloads of its first fonts baked into
# `dist/index.html` (the frame of the app as the first paint): the same steps as
# `bun run build`.
RUN bun --bun ../../packages/ui/bin/build-client.ts \
    && bun scripts/prerender-boot-shell.ts
WORKDIR /app

# ============================================================================
# Stage 3: runtime-deps — the server's node_modules
# ============================================================================
# The server cannot be bundled into one file the way `services/web` and
# `services/docs` are: camoufox-js, fingerprint-generator and playwright-core
# read data files from their own install directory (the browser pin, the
# WebGL and territory databases, the Bayesian networks), camoufox-js runs its
# own CLI (`camoufox fetch`) from there, and playwright-core needs optional
# packages that are not installed. They stay real packages, and the server
# runs from source like the platform's does (`bun server.ts`).
#
# `bun install --production --filter @tale/session-manager` is no way to get
# them: the workspace depends on @tale/ui, whose dependency tree (mermaid,
# codemirror, shiki, ...) would add 1000 packages and 850 MB for a server that
# imports eleven of its files. So this stage copies the closure of the
# service's own production dependencies out of the install above: the exact
# versions the lockfile pins, patches included (zod's, `patches/README.md`).
FROM workspace-deps AS runtime-deps
WORKDIR /app

# Which package directories to copy is decided the way Node resolves them: the
# requiring package's own node_modules first, then every parent's. A package
# nested inside another travels with it.
COPY <<'EOF' /tmp/copy-closure.mjs
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

// <installed node_modules> <target node_modules> <package to start from>
// [dependency to leave out...]
const [source, target, start, ...skipped] = process.argv.slice(2);
const copies = new Map();
const visited = new Set();

function find(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dir === dirname(source)) return null;
  }
}

function visit(directory) {
  if (visited.has(directory)) return;
  visited.add(directory);
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  for (const field of ['dependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      // The workspace's own packages are linked, not installed.
      if (skipped.includes(name) || range.startsWith('workspace:')) continue;
      const found = find(name, directory);
      if (found === null) {
        // Optional: built for another platform than this install's.
        if (field === 'optionalDependencies') continue;
        throw new Error(`${name}, needed by ${pkg.name}, is not installed`);
      }
      const inside = relative(source, found);
      if (inside.startsWith('..')) {
        copies.set(name, found);
      } else {
        const [first, second] = inside.split('/');
        const top = first.startsWith('@') ? `${first}/${second}` : first;
        copies.set(top, join(source, top));
      }
      visit(found);
    }
  }
}

visit(start);
for (const [name, directory] of copies) {
  mkdirSync(dirname(join(target, name)), { recursive: true });
  cpSync(directory, join(target, name), {
    recursive: true,
    verbatimSymlinks: true,
  });
}
console.log(`${copies.size} packages copied to ${target}`);
EOF

# Left out, on purpose:
#   * better-sqlite3 (27 MB of C++ sources Bun never compiles, since it runs no
#     install scripts): camoufox-js opens its WebGL database with `bun:sqlite`
#     under Bun and only falls back to it on Node.
#   * the `-musl` builds of impit's native module (Alpine's libc; this is
#     Debian), and declarations and source maps, which nothing reads at run time.
RUN bun /tmp/copy-closure.mjs /app/node_modules /runtime/node_modules \
      /app/services/session-manager better-sqlite3 \
    && find /runtime/node_modules -depth -type d \
      \( -name '*-musl' -o -name '*-musl-*' \) -exec rm -rf {} + \
    && find /runtime/node_modules -type f \
      \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \) -delete

# ============================================================================
# Stage 4: runtime
# ============================================================================
# Bun's slim image is Debian 13 (trixie), so the libraries below carry its names.
FROM oven/bun:1.4.2-slim@sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61 AS runner

ENV NODE_ENV=production \
    PORT=3004 \
    SESSION_MANAGER_HOST=0.0.0.0 \
    SESSION_MANAGER_DATA_DIR=/data \
    DO_NOT_TRACK=1

WORKDIR /app

# What a headless Firefox links against: GTK 3 and the X11 libraries it was
# built with (no X server runs: the browsers have no window), sound, DBus and
# fontconfig — Playwright's list for Firefox on Debian 13, less ffmpeg, which
# Camoufox ships itself; `ldd` finds nothing missing. `procps` is for `ps`: how
# a browser that will not close is found.
RUN apt-get -o Acquire::Retries=3 update && apt-get install -y --no-install-recommends \
      ca-certificates curl procps tini \
      libasound2t64 libatk1.0-0t64 libcairo-gobject2 libcairo2 libdbus-1-3 \
      libdbus-glib-1-2 libfontconfig1 libfreetype6 libgdk-pixbuf-2.0-0 \
      libglib2.0-0t64 libgtk-3-0t64 libharfbuzz0b libpango-1.0-0 \
      libpangocairo-1.0-0 libx11-6 libx11-xcb1 libxcb-shm0 libxcb1 \
      libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
      libxrandr2 libxrender1 libxtst6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 app \
    && useradd --system --uid 1001 --gid app --create-home --home-dir /home/app app \
    && mkdir -p /data /camoufox \
    && chown app:app /data /camoufox

COPY --from=runtime-deps --chown=app:app /runtime/node_modules ./node_modules
# `@tale/ui/server` (the shared server pipeline) is imported from source: the
# workspace package, and the link `node_modules/@tale/ui` that bun makes.
COPY --chown=app:app packages/ui/package.json ./packages/ui/package.json
COPY --chown=app:app packages/ui/src ./packages/ui/src
RUN mkdir -p node_modules/@tale && ln -s ../../packages/ui node_modules/@tale/ui
COPY --from=builder --chown=app:app /app/services/session-manager/dist ./dist
COPY --chown=app:app services/session-manager/package.json ./package.json
COPY --chown=app:app services/session-manager/lib ./lib
COPY --chown=app:app services/session-manager/backend ./backend
COPY --chown=app:app services/session-manager/server.ts ./server.ts
COPY --chown=app:app --chmod=755 services/session-manager/docker-entrypoint.sh ./docker-entrypoint.sh

# Fail the build, not somebody's first session: the browser stack is imported
# when a session starts, not at startup, so a package or file missing from the
# copies above would only show then. Every module of the server is imported
# once here, and the packages that read their own install directory. (Nothing
# is created at CAMOUFOX_INSTALL_DIR, which camoufox-js reads when it loads.)
# `--no-install`: bun fetches a package it cannot find from the registry when no
# node_modules is near the file it runs, and a build has a network.
RUN CAMOUFOX_INSTALL_DIR=/tmp/camoufox bun --no-install --eval \
      "for (const file of new Bun.Glob('backend/**/*.ts').scanSync()) await import('./' + file); for (const name of ['camoufox-js', 'camoufox-js/dist/locale.js', 'camoufox-js/dist/pkgman.js', 'fingerprint-generator', 'playwright-core']) await import(name)"

# Keep VERSION metadata after filesystem layers so version-only builds reuse them.
ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="tale-session-manager" \
      org.opencontainers.image.description="Local manager for isolated Camoufox browser sessions, each with its own profile, fingerprint and proxy" \
      org.opencontainers.image.source="https://github.com/tale-project/tale" \
      org.opencontainers.image.url="https://tale.dev" \
      org.opencontainers.image.documentation="https://docs.tale.dev" \
      org.opencontainers.image.vendor="Tale" \
      org.opencontainers.image.licenses="MIT"
ENV TALE_VERSION=${VERSION}

USER app
EXPOSE 3004
# `/api/health` is answered by the shared server before the Host check, and
# says nothing of the browser: the page reports a download under way.
HEALTHCHECK --interval=30s --timeout=3s CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/docker-entrypoint.sh"]
