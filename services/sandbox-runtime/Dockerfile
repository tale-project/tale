# Tale Sandbox Runtime
#
# Two roles from ONE image (sessions plan — single-image decision):
#   1. One-shot /v1/execute: ephemeral container per `artifact_run`, runs as
#      uid 65534 under --read-only, all caps dropped (spawner forces these).
#   2. Persistent session (`daemon` entrypoint dispatch): long-lived container
#      running runnerd as PID 1, with coding agents (Claude Code, OpenCode)
#      driven over the runnerd HTTP API. Session containers run as the `agent`
#      user (uid 10001) — non-root is load-bearing (Claude Code refuses
#      --dangerously-skip-permissions as root).
#
# Layers: python:3.12-slim-bookworm + uv + Node 24 + fontconfig (Pillow) +
# pinned claude/opencode/gh + Playwright/Chromium + ripgrep/fd/git.

# --- daemon build stage: bundle runnerd to a single Node-target file --------
FROM oven/bun:1 AS daemon-build
WORKDIR /build
COPY services/sandbox-runtime/daemon/ ./
RUN bun build --target=node src/main.ts --outfile /runnerd.mjs

# --- runtime image ----------------------------------------------------------
FROM python:3.12-slim-bookworm

# Pinned agent + tool versions (sessions plan — upgrade = bump ARG + rebuild).
# 2.x required: the claude_code adapter passes --include-partial-messages,
# which 1.0.x rejects (exit 1 before the agent even starts).
ARG CLAUDE_CODE_VERSION=2.1.173
ARG OPENCODE_VERSION=1.17.3
ARG PLAYWRIGHT_MCP_VERSION=0.0.41
ARG GH_VERSION=2.62.0
ARG TARGETARCH

# Runtime additions — fontconfig + DejaVu so Pillow/matplotlib render text,
# jq for the one-shot entrypoint, ca-certificates for HTTPS to pypi/npm via
# the egress proxy, bash for user `.sh` steps (Debian slim ships only dash),
# and the coding-agent tooling: git/ripgrep/fd/curl/procps for the session
# role, plus the Playwright system libraries (Chromium needs them to launch
# headless — installed here because read-only-root + non-root can't add them
# at runtime).
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-dejavu-core \
      fontconfig \
      ca-certificates \
      jq \
      bash \
      git \
      ripgrep \
      fd-find \
      curl \
      procps \
      unzip \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
      libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
      libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f \
    && ln -sf /usr/local/bin/python3 /usr/local/bin/python \
    && ln -sf "$(command -v fdfind)" /usr/local/bin/fd

# uv — fast Python package installer/resolver. See https://github.com/astral-sh/uv
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv

# Node 24 LTS. Copy /usr/local from node:24-bookworm-slim into /opt/node.
COPY --from=node:24-bookworm-slim /usr/local /opt/node

# bun — many JS/TS projects (Tale included) use it for install/test/scripts, so
# an in-sandbox coding agent needs it on PATH. Reuse the daemon-build stage's
# already-pulled oven/bun image (Debian/glibc, matches this base); bun is a
# single self-contained binary. `bunx` is just bun with a subcommand.
COPY --from=daemon-build /usr/local/bin/bun /usr/local/bin/bun
RUN ln -sf /usr/local/bin/bun /usr/local/bin/bunx

ENV PATH=/opt/agents/bin:/opt/node/bin:/usr/local/bin:/usr/bin:/bin
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
# Playwright browsers in a world-readable global path (the agent user reads
# them; read-only root means no per-session download — the MCP runs with
# --isolated so its profile stays in memory and never writes here). Telemetry
# off.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
ENV CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

# --- coding-agent CLIs (pinned) ---------------------------------------------
# Claude Code + Playwright MCP via npm into /opt/agents (on PATH above).
RUN npm install -g --prefix /opt/agents \
      @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
      @playwright/mcp@${PLAYWRIGHT_MCP_VERSION} \
    && npm cache clean --force

# Chromium for Playwright MCP (system deps already apt-installed above) —
# resolved against the MCP's OWN bundled playwright so the browser revision
# always matches what the MCP resolves at runtime (npx would fetch the latest
# registry playwright, whose revision drifts from the bundled one). Download +
# extract via curl/unzip — see install-playwright-browsers.sh for why the
# bundled downloader itself is not used. Loud failure on purpose: a missing
# or non-executable browser is a broken image.
# PLAYWRIGHT_DOWNLOAD_HOST: optional CDN mirror for the browser download
# (e.g. https://cdn.npmmirror.com/binaries/playwright); empty = official CDN.
ARG PLAYWRIGHT_DOWNLOAD_HOST=""
COPY services/sandbox-runtime/install-playwright-browsers.sh /tmp/install-playwright-browsers.sh
RUN PLAYWRIGHT_DOWNLOAD_HOST="${PLAYWRIGHT_DOWNLOAD_HOST}" \
      sh /tmp/install-playwright-browsers.sh \
      /opt/agents/lib/node_modules/@playwright/mcp/node_modules/.bin/playwright chromium \
    && node -e "const fs=require('fs'); const p=require('/opt/agents/lib/node_modules/@playwright/mcp/node_modules/playwright-core'); fs.accessSync(p.chromium.executablePath(), fs.constants.X_OK)" \
    && rm /tmp/install-playwright-browsers.sh

# OpenCode standalone binary (pinned). dpkg arch → release asset arch.
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) OC_ARCH=x64 ;; \
      arm64) OC_ARCH=arm64 ;; \
      *) echo "unsupported arch ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/opencode.tar.gz \
      "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-${OC_ARCH}.tar.gz"; \
    mkdir -p /opt/agents/bin; \
    tar -xzf /tmp/opencode.tar.gz -C /opt/agents/bin; \
    chmod +x /opt/agents/bin/opencode; \
    rm /tmp/opencode.tar.gz; \
    /opt/agents/bin/opencode --version

# gh CLI (pinned) for the issue→PR workflow (GITHUB_TOKEN env auth).
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) GH_ARCH=amd64 ;; \
      arm64) GH_ARCH=arm64 ;; \
      *) echo "unsupported arch ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/gh.tar.gz \
      "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${GH_ARCH}.tar.gz"; \
    tar -xzf /tmp/gh.tar.gz -C /tmp; \
    mv "/tmp/gh_${GH_VERSION}_linux_${GH_ARCH}/bin/gh" /usr/local/bin/gh; \
    rm -rf /tmp/gh.tar.gz "/tmp/gh_${GH_VERSION}_linux_${GH_ARCH}"; \
    gh --version

# runnerd — the session control daemon, bundled to a single file in the
# daemon-build stage and run by the image's Node 24 (session mode only).
COPY --from=daemon-build /runnerd.mjs /usr/local/lib/tale/runnerd.mjs

# Claude Code managed settings (highest precedence on Linux): disable
# auto-update + telemetry, and register the steer hook (mid-turn message
# injection — hooks merge across settings sources, so /workspace configs
# can't shadow it). NOT permission rules — those are per-run flags.
COPY services/sandbox-runtime/managed-settings.json /etc/claude-code/managed-settings.json

# Steer hook: injects platform-queued user messages into a RUNNING Claude
# Code turn at the next tool-use / stop boundary. Reads the per-exec
# $TALE_STEER_DIR the adapter sets; inert (fast no-op) for every other run.
COPY services/sandbox-runtime/tale-steer-hook /usr/local/bin/tale-steer-hook

# Git credential helper for the Tier 2 broker (fetches per-operation creds
# from runnerd's local credential endpoint). Installed for the `agent` user
# via the session entrypoint; baked here so it exists read-only.
COPY services/sandbox-runtime/tale-git-credential /usr/local/bin/tale-git-credential

# Playwright MCP launcher shim: appends --proxy-server/--proxy-bypass from the
# container's HTTPS_PROXY/NO_PROXY (Chromium ignores the env vars) and execs
# mcp-server-playwright. The agent adapters use this as the MCP command.
COPY services/sandbox-runtime/tale-playwright-mcp /usr/local/bin/tale-playwright-mcp

COPY services/sandbox-runtime/docker-entrypoint.sh /docker-entrypoint.sh
COPY services/sandbox-runtime/entrypoint.sh /entrypoint.sh
RUN chmod +x /docker-entrypoint.sh /entrypoint.sh /usr/local/bin/tale-git-credential \
      /usr/local/bin/tale-playwright-mcp /usr/local/bin/tale-steer-hook

# Session role runs as the `agent` user (uid 10001) — a real passwd entry so
# git/ssh have a home + name, and non-root so Claude Code's bypassPermissions
# is allowed. The one-shot role still runs as 65534 (spawner pins --user per
# profile); this is just the named account the session profile selects.
# Absolute paths: the ENV PATH override above drops /usr/sbin.
RUN /usr/sbin/groupadd --gid 10001 agent \
    && /usr/sbin/useradd --uid 10001 --gid 10001 --home-dir /workspace/.home \
       --shell /bin/bash --no-create-home agent

# Default user is nobody; spawner pins --user per profile at the call site
# (65534 one-shot, 10001 session-agent).
USER 65534:65534

WORKDIR /workspace

ENTRYPOINT ["/docker-entrypoint.sh"]
