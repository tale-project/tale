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
ARG CURSOR_AGENT_VERSION=2026.03.20-44cb435
ARG HERMES_AGENT_VERSION=0.18.0
ARG GEMINI_CLI_VERSION=0.49.0
ARG CODEX_VERSION=0.142.5
ARG PI_CODING_AGENT_VERSION=0.80.3
ARG OPENCLAW_VERSION=2026.6.11
ARG PLAYWRIGHT_MCP_VERSION=0.0.41
ARG GH_VERSION=2.62.0
ARG PILLOW_VERSION=12.3.0
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
      # Live browser view (read-only mirror). INERT unless the session is
      # launched with TALE_BROWSER_CDP=1 (operator flag SANDBOX_BROWSER_VIEW):
      # Xvfb gives the headed Chromium a virtual display, x11vnc mirrors it
      # view-only, and the fonts keep rendered pages legible. The CDP (9222)
      # and VNC (5900) endpoints the entrypoint binds are LOOPBACK-ONLY
      # (127.0.0.1) and the session container publishes NO ports — they are
      # never EXPOSE'd and only reachable from inside the container.
      xvfb \
      x11vnc \
      fonts-liberation \
      fonts-noto-core \
      # CJK + emoji so real-world pages (e.g. google.com.hk, any non-Latin
      # site) render glyphs instead of tofu boxes in the live browser view.
      fonts-noto-cjk \
      fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f \
    && ln -sf /usr/local/bin/python3 /usr/local/bin/python \
    && ln -sf "$(command -v fdfind)" /usr/local/bin/fd

# --- document conversion toolchain (Office / PDF) ---------------------------
# Binaries the bundled document skills (builtin-configs/skills/*) and any agent
# asked to read/convert .docx/.xlsx/.pptx/.pdf shell out to. These CANNOT come
# in via the per-execution `uv pip install` path (that only provides Python
# *libraries* into /user/.runtime/deps/python — see entrypoint.sh install_python),
# so the OS-level tools must be baked here:
#   libreoffice-writer/calc/impress — faithful Office→PDF conversion (docx,
#       xlsx, pptx) and xlsx formula recalc via `soffice --headless`. Install
#       just these three apps (they pull libreoffice-core/common + ure as hard
#       Depends); --no-install-recommends skips Base/Draw/Math, Java and the GUI
#       stack we never use. This is what unblocks the pptx skill's render path.
#   poppler-utils — `pdftoppm` rasterizes the intermediate (or any) PDF to
#       images for the thumbnail / visual-QA loop; `pdftotext` extracts PDF text.
#   pandoc — clean .docx → markdown/text extraction (handles tracked changes);
#       the tool the official docx skill uses for reading.
# Deliberately NOT installed: gcc / libc6-dev for office/soffice.py's AF_UNIX
# LD_PRELOAD shim. Tale runs the default Docker / RuntimeDefault seccomp profile
# (docker-args.ts: apparmor=docker-default, no custom seccomp; k8s-pod-spec.ts:
# seccompProfile RuntimeDefault), which permits AF_UNIX sockets — so the skill's
# _needs_shim() is always false here and the shim (the only thing that would
# need a compiler at runtime) never builds. No reason to ship a C toolchain in
# this hardened image.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer \
      libreoffice-calc \
      libreoffice-impress \
      poppler-utils \
      pandoc \
    && rm -rf /var/lib/apt/lists/*

# --- LaTeX (XeTeX) for publication-grade PDF -------------------------------
# Gives `pandoc -o out.pdf --pdf-engine=xelatex` a real TeX engine, so PDFs get
# a genuine `--toc`, page numbers, running headers/footers, a title page and
# full font/margin control — instead of the brittle render-then-stitch route
# (LibreOffice/fitz) the agent otherwise falls back to. A separate layer from
# the Office/PDF block above: it's a large, self-contained concern that caches
# independently. Kept to the XeTeX subset pandoc's default template needs, NOT
# the multi-GB full `texlive` meta-package:
#   texlive-xetex             — the `xelatex` engine (Unicode/OpenType native).
#   texlive-latex-recommended — the core package set the default template loads.
#   texlive-fonts-recommended — Latin Modern / TeX Gyre fonts that template uses.
#   texlive-lang-chinese      — xeCJK / ctex so the Chinese workspace docs
#       (e.g. *-zh-CN.md) typeset instead of dropping to tofu. The CJK *fonts*
#       (Noto CJK) are already baked above for the live browser, so this adds
#       only the macro packages; it also pulls texlive-latex-extra, handy for
#       richer templates (fancyhdr, mdframed, …).
#   lmodern                   — Latin Modern `lmodern.sty`. Pandoc's default
#       LaTeX template does `\usepackage{lmodern}`, but it's only a *Recommends*
#       of texlive-latex-recommended, so `--no-install-recommends` drops it and
#       every `pandoc --pdf-engine=xelatex` then dies with "lmodern.sty not
#       found". Pull it explicitly (the one Recommends we actually need).
RUN apt-get update && apt-get install -y --no-install-recommends \
      texlive-xetex \
      texlive-latex-recommended \
      texlive-fonts-recommended \
      texlive-lang-chinese \
      lmodern \
    && rm -rf /var/lib/apt/lists/*

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
# them; the baked browsers mean no per-session download — the MCP runs with
# --isolated so its profile stays in memory). The directory itself is made
# sticky-writable after install (see below) so the MCP's `browser_install`
# tool — which an agent may call defensively even though the browser is
# already present — can create its `__dirlock`/`.links` bookkeeping and
# fast-exit as a no-op, instead of hanging for minutes retrying the lock and
# then failing EACCES (which cascades into a redundant `playwright install`
# download). The browser binaries stay root-owned and read-only. Telemetry
# off.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
ENV CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
# Maximum reasoning effort by DEFAULT for the in-sandbox coding agent (drives
# adaptive thinking at full depth on Opus-class models; a model without effort
# support just ignores it). This lives in the daemon's process env, which the
# exec manager uses as the LOWEST-precedence floor (`{ ...process.env,
# ...envStore.resolve(req.env) }`), so a user-supplied CLAUDE_CODE_EFFORT_LEVEL
# in the session env or per-exec overlay still wins. Deliberately NOT placed in
# managed-settings.json — that layer is highest-precedence and would make the
# default impossible to override.
ENV CLAUDE_CODE_EFFORT_LEVEL=max
# Apply max effort even when the gateway hands Claude Code a model id it does NOT
# recognise as effort-capable. CC's built-in capability check matches exact names
# (`claude-opus-4-8`, …); a gateway-aliased id (e.g. `anthropic/claude-opus-4-8`)
# falls through and silently drops effort. This forces it on for any model.
ENV CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1
# Force-enable dynamic workflows ("ultracode") + subagent orchestration. The
# feature is otherwise gated by a server/plan flag (tengu_workflows_enabled) that
# does not resolve in the headless sandbox, so the agent would report "Ultracode
# needs dynamic workflows enabled". Adaptive "ultrathinking" needs NO flag — it is
# on by default on Opus-class models and driven to full depth by max effort; we
# simply never set CLAUDE_CODE_DISABLE_THINKING / CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING.
ENV CLAUDE_CODE_WORKFLOWS=1
# Output-token ceiling per request. Claude Code gives ids it RECOGNISES
# (claude-fable-5, claude-opus-4-8, …) 64K output under a `[1m]` 1M-context
# window, but an id it does not recognise falls back to a conservative 32K —
# and the shipped default model is exactly such an id (the rolling
# `~anthropic/claude-fable-latest` alias). Pin the floor to the same 64K the
# recognised flagships already get (smoke-verified on 2.1.173: the value lands
# verbatim as the request's max_tokens). Deliberately NOT higher — >64K at 1M
# context is unverified against live upstreams. Same overridable-floor
# semantics as CLAUDE_CODE_EFFORT_LEVEL above.
ENV CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000

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
    && chmod 1777 /opt/ms-playwright \
    && rm /tmp/install-playwright-browsers.sh

# --- visual-aspect-analyzer builtin skill -----------------------------------
# Bake the visual-aspect-analyzer skill (a Bun/TypeScript visual-regression
# tool) into the image so a sandbox agent runs it with zero setup: the
# entrypoint symlinks every `/opt/agents/skills/*/` into the session's
# `${CLAUDE_CONFIG_DIR}/skills`, so an agent whose config lists it (`skills:
# [visual-aspect-analyzer]`) discovers and runs it in place. Copied from its
# `configs/platform/custom/skills/` source workspace — the dockerignore keeps
# node_modules out (deps install fresh below); guides, src, and tests all ship,
# so `bun run e2e` works in the sandbox.
#
# It does NOT install a second Playwright/Chromium: only its own pngjs runtime
# dep is installed (--production skips the dev-only playwright/happy-dom/tsc),
# and `playwright` + `playwright-core` are symlinked to the copies the MCP
# already installed above (@playwright/mcp bundles full playwright — the version
# the skill targets). require.resolve locates them so the link survives npm
# hoisting, and reusing that install means the skill reuses the MCP's
# already-downloaded Chromium revision (no second ~150 MB browser).
COPY configs/platform/custom/skills/visual-aspect-analyzer /opt/agents/skills/visual-aspect-analyzer
RUN cd /opt/agents/skills/visual-aspect-analyzer \
    && bun install --production \
    && MCP=/opt/agents/lib/node_modules/@playwright/mcp \
    && ln -sfn "$(node -p "require('path').dirname(require.resolve('playwright/package.json',{paths:['$MCP']}))")" node_modules/playwright \
    && ln -sfn "$(node -p "require('path').dirname(require.resolve('playwright-core/package.json',{paths:['$MCP']}))")" node_modules/playwright-core \
    && node -e "const fs=require('fs'); const p=require('/opt/agents/skills/visual-aspect-analyzer/node_modules/playwright'); fs.accessSync(p.chromium.executablePath(), fs.constants.X_OK)"

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

# Cursor Agent CLI (pinned). downloads.cursor.com serves versioned tarballs;
# do NOT use cursor.com/install (non-reproducible + auto-update).
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) CUR_ARCH=x64 ;; \
      arm64) CUR_ARCH=arm64 ;; \
      *) echo "unsupported arch ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/cursor-agent.tar.gz \
      "https://downloads.cursor.com/lab/${CURSOR_AGENT_VERSION}/linux/${CUR_ARCH}/agent-cli-package.tar.gz"; \
    mkdir -p /opt/agents/bin /opt/agents/cursor; \
    tar -xzf /tmp/cursor-agent.tar.gz -C /opt/agents/cursor --strip-components=1; \
    ln -sf ../cursor/cursor-agent /opt/agents/bin/agent; \
    rm /tmp/cursor-agent.tar.gz; \
    /opt/agents/bin/agent --version

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

# Hermes Agent (pinned PyPI wheel) + Tale NDJSON wrapper for sandbox runs.
RUN pip install --no-cache-dir "hermes-agent==${HERMES_AGENT_VERSION}" \
    && hermes --version
COPY services/sandbox-runtime/tale-hermes-run /usr/local/bin/tale-hermes-run
RUN chmod +x /usr/local/bin/tale-hermes-run

# Gemini CLI (pinned npm, into /opt/agents like Claude Code) + Tale wrapper
# that stages per-exec settings/context before the headless run.
RUN npm install -g --prefix /opt/agents "@google/gemini-cli@${GEMINI_CLI_VERSION}" \
    && npm cache clean --force \
    && gemini --version
COPY services/sandbox-runtime/tale-gemini-run /usr/local/bin/tale-gemini-run
RUN chmod +x /usr/local/bin/tale-gemini-run

# OpenAI Codex CLI (pinned npm). Driven headlessly by the platform's codex
# adapter (`codex exec --json`, config via -c overrides) — no wrapper needed;
# the CLI's native JSONL is the parse contract.
RUN npm install -g --prefix /opt/agents "@openai/codex@${CODEX_VERSION}" \
    && npm cache clean --force \
    && codex --version

# Pi (pinned npm, into /opt/agents like Claude Code) + Tale wrapper that
# stages the per-exec config dir (models.json/settings/APPEND_SYSTEM.md)
# before the headless run.
RUN npm install -g --prefix /opt/agents "@earendil-works/pi-coding-agent@${PI_CODING_AGENT_VERSION}" \
    && npm cache clean --force \
    && pi --version
COPY services/sandbox-runtime/tale-pi-run /usr/local/bin/tale-pi-run
RUN chmod +x /usr/local/bin/tale-pi-run

# OpenClaw (pinned npm, into /opt/agents like Claude Code) + Tale wrapper
# that stages per-exec config/prompt/AGENTS.md and translates the CLI's
# single --json envelope into Tale NDJSON lifecycle events.
RUN npm install -g --prefix /opt/agents "openclaw@${OPENCLAW_VERSION}" \
    && npm cache clean --force \
    && openclaw --version
COPY services/sandbox-runtime/tale-openclaw-run /usr/local/bin/tale-openclaw-run
RUN chmod +x /usr/local/bin/tale-openclaw-run

# --- docker-in-container tooling (sysbox/kata tiers) ------------------------
# Native `docker` / `docker compose` INSIDE a session container. Present in
# every image but INERT unless the session is launched in DinD mode
# (SANDBOX_DOCKER_IN_CONTAINER + a sysbox/kata tier): the binaries are not
# setuid and cannot start a daemon without caps the one-shot/non-DinD paths
# drop, so adding them does not change the one-shot (uid 65534) attack surface.
# The session entrypoint starts an inner dockerd only in DinD mode.
#   docker-ce/cli + compose/buildx plugins + containerd = the engine
#   tini       = PID-1 reaper (DinD spawns many short-lived containerd-shims)
#   uidmap     = newuidmap/newgidmap (rootless/userns helpers)
#   fuse-overlayfs + iptables = inner daemon storage + networking fence
#   util-linux = setpriv, to drop dockerd's root back to uid 10001 for runnerd
#   redsocks   = transparent egress: the entrypoint REDIRECTs nested containers'
#                public TCP to redsocks, which tunnels it through the egress
#                proxy — so inner apps reach the internet with NO proxy env (no
#                hijacked localhost/sibling healthchecks)
#   iproute2   = `ip route` — the SESSION transparent-egress path adds a default
#                route via the egress proxy so the kernel will generate (and the
#                nat OUTPUT REDIRECT can then intercept) connections to public IPs.
#                Without a default route, connect() to a public IP on the
#                `--internal` network fails with ENETUNREACH before REDIRECT runs.
# Versions are the live Docker apt-repo stable channel; pin here if a build
# needs to be byte-reproducible.
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      docker-ce \
      docker-ce-cli \
      containerd.io \
      docker-compose-plugin \
      docker-buildx-plugin \
      tini \
      uidmap \
      fuse-overlayfs \
      iptables \
      iproute2 \
      util-linux \
      redsocks \
    && rm -rf /var/lib/apt/lists/* \
    # The image's dockerd is started per-session by the entrypoint in DinD mode,
    # never as a baked service — strip any auto-start unit (no-op without systemd).
    && rm -f /etc/systemd/system/multi-user.target.wants/docker.service 2>/dev/null || true

# subuid/subgid ranges for the agent user. Sysbox handles userns mapping at the
# container boundary; these are here for any rootless inner tooling and are inert
# otherwise.
RUN echo 'agent:100000:65536' >> /etc/subuid \
    && echo 'agent:100000:65536' >> /etc/subgid

# runnerd — the session control daemon, bundled to a single file in the
# daemon-build stage and run by the image's Node 24 (session mode only).
COPY --from=daemon-build /runnerd.mjs /usr/local/lib/tale/runnerd.mjs

# Claude Code managed settings (highest precedence on Linux): disable
# auto-update + telemetry, suppress Claude commit/PR attribution
# (includeCoAuthoredBy:false — the byline is appended by the CLI at
# commit/PR time and a cloned repo's CLAUDE.md can't override a harness
# default; managed scope so a cloned app repo / BYO user can't re-enable
# it), and register the steer hook (mid-turn message injection — hooks
# merge across settings sources, so /user configs can't shadow it). NOT
# permission rules — those are per-run flags.
COPY services/sandbox-runtime/managed-settings.json /etc/claude-code/managed-settings.json

# Steer hook: injects platform-queued user messages into a RUNNING Claude
# Code turn at the next tool-use / stop boundary. Reads the per-exec
# $TALE_STEER_DIR the adapter sets; inert (fast no-op) for every other run.
COPY services/sandbox-runtime/tale-steer-hook /usr/local/bin/tale-steer-hook

# Plan gate: denies ExitPlanMode in every permission mode (hooks evaluate
# before bypassPermissions) so a proposed plan always ends the turn and is
# approved by the user in chat — never self-approved in the sandbox.
COPY services/sandbox-runtime/tale-plan-gate /usr/local/bin/tale-plan-gate

# Git credential helper for the Tier 2 broker (fetches per-operation creds
# from runnerd's local credential endpoint). Installed for the `agent` user
# via the session entrypoint; baked here so it exists read-only.
COPY services/sandbox-runtime/tale-git-credential /usr/local/bin/tale-git-credential

# Playwright MCP launcher shim: appends --proxy-server/--proxy-bypass from the
# container's HTTPS_PROXY/NO_PROXY (Chromium ignores the env vars) and execs
# mcp-server-playwright. The agent adapters use this as the MCP command.
COPY services/sandbox-runtime/tale-playwright-mcp /usr/local/bin/tale-playwright-mcp

# Integration-dispatch MCP bridge: a dependency-free stdio MCP server the agent
# adapters wire in via --mcp-config. Relays integration({slug,operation,args})
# to the platform's /api/integrations/* endpoints (credentials stay
# server-side). Runs under the image's node (global fetch).
COPY services/sandbox-runtime/tale-integrations-mcp /usr/local/bin/tale-integrations-mcp

# Vision polyfill for a TEXT-ONLY managed agent. `tale-vision-read-hook` is a
# PreToolUse(Read) hook (registered in managed-settings.json, self-gated on
# TALE_VISION_MODEL) that (1) transcribes raster Reads via the transcriber and
# (2) denies native PDF Reads — pdftotext when the PDF has text, else guide
# pdftoppm → Read PNG (image path). Native PDF/`file` blocks 400 on text-only
# models (DeepSeek). `tale-vision-transcribe` relays images to the platform LLM
# gateway's vision model using the session virtual key (no provider key enters
# the container). See services/platform/lib/agent-adapters/claude-code/adapter.ts.
COPY services/sandbox-runtime/tale-vision-transcribe /usr/local/bin/tale-vision-transcribe
COPY services/sandbox-runtime/tale-vision-read-hook /usr/local/bin/tale-vision-read-hook

# Batch vision CLI for in-sandbox code (`run_code` scripts and coding agents):
# analyzes images via the platform LLM gateway with the session virtual key —
# same no-provider-key-in-container lane as tale-vision-transcribe (which stays
# the single-image Read-hook polyfill). Pillow lives in a dedicated venv and
# the shim runs `python -E -s` so the per-exec user deps that entrypoint.sh
# prepends onto PYTHONPATH (/user/.runtime/deps/python) can never shadow PIL.
RUN python3 -m venv /opt/tale-vision \
    && /opt/tale-vision/bin/pip install --no-cache-dir "Pillow==${PILLOW_VERSION}" \
    && printf '#!/bin/sh\nexec /opt/tale-vision/bin/python -E -s /opt/tale-vision/cli.py "$@"\n' \
       > /usr/local/bin/tale-vision
COPY services/sandbox-runtime/tale-vision /opt/tale-vision/cli.py

# Human-control MCP bridge: a dependency-free stdio MCP server exposing
# request_human_control({reason}). The agent calls it to hand the live browser
# to a human (CAPTCHA/login/2FA); the platform observes the tool_use, parks the
# turn, and resumes once control is returned. Purely local — no network call.
COPY services/sandbox-runtime/tale-human-control-mcp /usr/local/bin/tale-human-control-mcp

COPY services/sandbox-runtime/docker-entrypoint.sh /docker-entrypoint.sh
COPY services/sandbox-runtime/entrypoint.sh /entrypoint.sh
RUN chmod +x /docker-entrypoint.sh /entrypoint.sh /usr/local/bin/tale-git-credential \
      /usr/local/bin/tale-playwright-mcp /usr/local/bin/tale-integrations-mcp \
      /usr/local/bin/tale-vision-transcribe /usr/local/bin/tale-vision-read-hook \
      /usr/local/bin/tale-vision \
      /usr/local/bin/tale-human-control-mcp \
      /usr/local/bin/tale-steer-hook \
      /usr/local/bin/tale-plan-gate

# Session role runs as the `agent` user (uid 10001) — a real passwd entry so
# git/ssh have a home + name, and non-root so Claude Code's bypassPermissions
# is allowed. The one-shot role still runs as 65534 (spawner pins --user per
# profile); this is just the named account the session profile selects.
# Absolute paths: the ENV PATH override above drops /usr/sbin.
RUN /usr/sbin/groupadd --gid 10001 agent \
    && /usr/sbin/useradd --uid 10001 --gid 10001 --home-dir /user/.runtime/home \
       --shell /bin/bash --no-create-home agent \
    # docker-in-container: the inner dockerd creates /var/run/docker.sock as
    # root:docker (660), so the agent (uid 10001, runs `docker` after the
    # entrypoint drops privileges) must be in the `docker` group to reach it.
    # Inert on non-DinD tiers (no socket exists). The `docker` group is created
    # by the docker-ce install above.
    && /usr/sbin/usermod -aG docker agent

# Pin the account redsocks runs as on the SESSION transparent-egress path to a
# stable uid/gid 10002 — the owner the iptables OUTPUT owner-match RETURN exempts
# (the loop-breaker for redsocks' own upstream CONNECT — see entrypoint.sh
# _install_session_output_redirect / TALE_REDSOCKS_UID). The `redsocks` apt
# package already creates a `redsocks` system user/group at a dynamic uid, so
# MODIFY it to 10002 when present (else create it). 10002 avoids the agent
# (10001) and nobody (65534). No shell/home — it only execs redsocks.
RUN if getent group redsocks >/dev/null; then \
      /usr/sbin/groupmod --gid 10002 redsocks; \
    else \
      /usr/sbin/groupadd --gid 10002 redsocks; \
    fi \
    && if getent passwd redsocks >/dev/null; then \
      /usr/sbin/usermod --uid 10002 --gid 10002 --shell /usr/sbin/nologin redsocks; \
    else \
      /usr/sbin/useradd --uid 10002 --gid 10002 --no-create-home \
        --shell /usr/sbin/nologin redsocks; \
    fi

# Default user is nobody; spawner pins --user per profile at the call site
# (65534 one-shot, 10001 session-agent).
USER 65534:65534

WORKDIR /user

ENTRYPOINT ["/docker-entrypoint.sh"]
