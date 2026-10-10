# Tale Sandbox Runtime
#
# One image, two dispatches (entrypoint.sh):
#   1. Persistent session (`daemon`): a long-lived container running runnerd
#      under tini, with coding agents (Claude Code, OpenCode) driven over the
#      runnerd HTTP API. Agent sessions run as the `agent` user (uid 10001) —
#      non-root is load-bearing (Claude Code refuses
#      --dangerously-skip-permissions as root); `default`-profile sessions
#      (run_code, crawler renders) run as uid 65534 under --read-only with all
#      caps dropped (the spawner forces these).
#   2. `egress-sidecar`: the K8s transparent-egress native sidecar (redsocks).
#
# Layers: python:3.12-slim-bookworm + uv + Node 24 + fontconfig (Pillow) +
# the pinned coding-agent CLIs (claude, opencode, hermes, gemini, codex, pi,
# openclaw, qwen, cursor) + gh + Playwright/Chromium + ripgrep/fd/git + the
# hash-locked Python and Node libraries of the builtin document skills. Every
# harness the platform registry marks managed must have its exec binary
# here — the image conformance test walks the registry.
#
# Every host downloads and stores each layer whose bytes change, so the
# layout keeps a release's change to the layers it touched:
#   - The OS chain (tooling-base) runs from the largest, stablest apt sets to
#     the small everyday tools, so adding a tool rebuilds one small layer.
#     Environment variables live in the runtime stage, below every install.
#   - The harnesses, the browser and the document libraries install in stages
#     that never descend from tooling-base (harness-base holds just Node and
#     the download tools) and arrive as `COPY --link` layers: an OS change does
#     not reinstall them, and one of them changing re-ships only its own layer.

# --- daemon build stage: bundle runnerd to a single Node-target file --------
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS daemon-build
WORKDIR /build
COPY services/sandbox-runtime/daemon/ ./
RUN bun build --target=node src/main.ts --outfile /runnerd.mjs \
    && bun build --target=node src/lazy-docker-entry.ts --outfile /lazy-docker.mjs

# Gemini's system settings must be immutable and root-owned. Derive them
# from the platform's existing harness interpreter, without a package install.
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS gemini-settings-build
WORKDIR /build
COPY services/platform/lib/harnesses/ services/platform/lib/harnesses/
COPY configs/platform/system/harnesses/gemini/harness.yml configs/platform/system/harnesses/gemini/harness.yml
COPY services/sandbox-runtime/build-gemini-settings.ts services/sandbox-runtime/build-gemini-settings.ts
RUN bun services/sandbox-runtime/build-gemini-settings.ts /gemini-settings

# --- exec shim build stage: the subreaper runnerd runs every exec under -----
# Everything an exec starts stays the shim's descendant, so runnerd ends what
# the exec left even after it moved to a session of its own and dropped the
# exec's tag (daemon/exec-shim/tale-exec-shim.c). Built on the runtime's own
# Debian release, so it links against the same glibc.
FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587 AS exec-shim-build
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/*
COPY services/sandbox-runtime/daemon/exec-shim/tale-exec-shim.c /build/tale-exec-shim.c
RUN gcc -O2 -Wall -Wextra -Werror -o /tale-exec-shim /build/tale-exec-shim.c

# --- harness build base -----------------------------------------------------
# The stages that install a harness, the browser or the document Node
# libraries build on this, never on tooling-base: Node plus the download
# tools, on the same Debian and Python as the runtime. A change to the OS
# chain below then neither reinstalls a harness nor changes its layer.
FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS harness-base
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      unzip \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 /usr/local /opt/node
ENV PATH=/opt/agents/bin:/opt/node/bin:/usr/local/bin:/usr/bin:/bin
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

# Generic document libraries, plus the ones the builtin document skills
# (configs/platform/custom/skills/{docx,pdf,pptx,xlsx}) import, are ready in
# both session profiles without a first-run download, so a deployment whose
# sandbox egress blocks PyPI still gets the skills' full toolchain. Hashes cover
# the complete Python 3.12 dependency graph and both supported Linux
# architectures; binary-only refuses source builds. Hermes builds on
# them, whose pins (PyYAML, Pillow, requests, certifi, cryptography,
# packaging) the lock resolves to, so these bytes are checked on their one
# install and Hermes adds only its own. The vision tool keeps its isolated
# venv. A private prefix holds just the additions; the runtime stage lays
# them over /usr/local as one layer of their own.
FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS document-python-build
ENV PYTHONDONTWRITEBYTECODE=1
COPY services/sandbox-runtime/document-python-requirements.txt /opt/tale/document-python-requirements.txt
RUN python3 -m pip install --no-cache-dir --require-hashes --only-binary=:all: \
      --prefix /opt/tale-document-python \
      -r /opt/tale/document-python-requirements.txt

# The Node libraries the builtin document skills `require()` (docx, pptxgenjs,
# and the icon set pptxgenjs.md renders through react/react-dom/sharp), for the
# same egress-restricted deployments. `npm ci` installs exactly the committed
# lock and checks every tarball against its integrity hash, and
# --ignore-scripts keeps every package's install script from running (none of
# these needs one). NODE_PATH makes them resolvable from any working directory;
# the session entrypoint puts the per-session npm prefix in front of it, so a
# skill's own `npm install -g` still wins over the baked copy.
FROM harness-base AS document-node-build
COPY services/sandbox-runtime/document-node/package.json services/sandbox-runtime/document-node/package-lock.json /opt/tale/document-node/
RUN npm ci --prefix /opt/tale/document-node --ignore-scripts --omit=dev --no-audit --no-fund \
    && npm cache clean --force \
    && NODE_PATH=/opt/tale/document-node/node_modules node -e "for (const m of ['docx', 'pptxgenjs', 'react', 'react-dom/server', 'react-icons/fa', 'sharp']) require(m)"

# --- stable shared toolchain ------------------------------------------------
# Harness pins are declared only in their independent install stages below.
# The apt sets run from the largest and stablest to the smallest and most
# often extended: a change to one rebuilds it and the sets after it.
FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS tooling-base
ARG TARGETARCH

# The python image deletes every stdlib .pyc, and sessions run with a
# read-only root and PYTHONDONTWRITEBYTECODE, so each Python process — the
# harness wrappers, the Playwright MCP launcher, Hermes, every run_code script
# and document skill — would compile the stdlib modules it imports again
# (about 0.1 s for a wrapper, up to a second for a broad import set). Compile
# them once here; hash-based pycs stay valid whatever the file timestamps.
RUN python3 -m compileall -q -j0 --invalidation-mode unchecked-hash \
      -x '/(test|tests|idlelib|turtledemo)/' /usr/local/lib/python3.12

# Fonts and the Playwright system libraries — fontconfig + DejaVu so
# Pillow/matplotlib render text, the libraries Chromium needs to launch
# headless (installed here because read-only-root + non-root can't add them
# at runtime), and ca-certificates + curl for HTTPS to pypi/npm via the egress
# proxy and the engine's signing key below.
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-dejavu-core \
      fontconfig \
      ca-certificates \
      curl \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
      libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
      libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 \
      fonts-liberation \
      fonts-noto-core \
      # CJK + emoji so real-world pages (e.g. google.com.hk, any non-Latin
      # site) render glyphs instead of tofu boxes in screenshots and documents.
      fonts-noto-cjk \
      fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

# --- document conversion toolchain (Office / PDF) ---------------------------
# Binaries the bundled document skills (configs/platform/custom/skills/*) and any agent
# asked to read/convert .docx/.xlsx/.pptx/.pdf shell out to. These CANNOT come
# in via an in-session `pip install` (that only provides Python *libraries*
# into /agent/.runtime/deps/python — see the `daemon` dispatch in entrypoint.sh),
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
#       (Noto CJK) are already baked above for page rendering, so this adds
#       only the macro packages; it also pulls texlive-latex-extra, handy for
#       richer templates (fancyhdr, mdframed, …). texlive-lang-cjk alone would
#       be about 127 MiB smaller, but it cannot replace this: xeCJK loads
#       `ctexhook.sty`, which only the ctex bundle here ships, so without it
#       every xeCJK document (pandoc's CJKmainfont path included) stops with
#       "File `ctexhook.sty' not found" (TeX Live 2022 on bookworm).
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

# --- docker-in-container tooling (sysbox/kata tiers) ------------------------
# Native `docker` / `docker compose` INSIDE a session container. Present in
# every image but INERT unless the session is launched in DinD mode
# (SANDBOX_DOCKER_IN_CONTAINER + a sysbox/kata tier): the binaries are not
# setuid and cannot start a daemon without caps the default/non-DinD profiles
# drop, so adding them does not change the default profile (uid 65534) attack surface.
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
    # Only this strip may fail: its `|| true` is braced, so a failed engine
    # install above still fails the build.
    && { rm -f /etc/systemd/system/multi-user.target.wants/docker.service 2>/dev/null || true; }

# Everyday session tooling, last of the apt sets because it is the one most
# often extended: jq for the hook scripts (tale-steer-hook, tale-plan-gate,
# tale-vision-read-hook), bash for user `.sh` steps, and the coding-agent
# tooling — git/OpenSSH/netcat/ripgrep/fd/procps/unzip for the session role.
RUN apt-get update && apt-get install -y --no-install-recommends \
      jq \
      bash \
      git \
      openssh-client \
      netcat-openbsd \
      ripgrep \
      fd-find \
      procps \
      unzip \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/local/bin/python3 /usr/local/bin/python \
    && ln -sf "$(command -v fdfind)" /usr/local/bin/fd

# subuid/subgid ranges for the agent user. Sysbox handles userns mapping at the
# container boundary; these are here for any rootless inner tooling and are inert
# otherwise.
RUN echo 'agent:100000:65536' >> /etc/subuid \
    && echo 'agent:100000:65536' >> /etc/subgid

# Session role runs as the `agent` user (uid 10001) — a real passwd entry so
# git/ssh have a home + name, and non-root so Claude Code's bypassPermissions
# is allowed. The default profile runs as 65534 (spawner pins --user per
# profile); this is just the named account the session profile selects.
# Absolute paths: the ENV PATH override above drops /usr/sbin.
RUN /usr/sbin/groupadd --gid 10001 agent \
    && /usr/sbin/useradd --uid 10001 --gid 10001 --home-dir /agent/.runtime/home \
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

# --- independent coding-agent and browser installs -------------------------
FROM harness-base AS claude-build
# 2.x required: the claude_code adapter passes --include-partial-messages,
# which 1.0.x rejects (exit 1 before the agent even starts). 2.1.280 is the
# first release that knows Claude Opus 5.5 (2.1.257: Claude Fable 5.1).
ARG CLAUDE_CODE_VERSION=2.1.285
RUN --mount=type=cache,id=tale-sandbox-node-gyp-${TARGETARCH},target=/root/.cache/node-gyp,sharing=locked \
    npm install -g --prefix /opt/agents "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && npm cache clean --force \
    && claude --version

FROM harness-base AS playwright-build
ARG PLAYWRIGHT_MCP_VERSION=0.0.41
RUN --mount=type=cache,id=tale-sandbox-node-gyp-${TARGETARCH},target=/root/.cache/node-gyp,sharing=locked \
    npm install -g --prefix /opt/agents "@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}" \
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
      /opt/agents/lib/node_modules/@playwright/mcp/node_modules/.bin/playwright \
      /opt/tale/playwright-mcp/browser.json \
    && node -e "const fs=require('fs'); const manifest=require('/opt/tale/playwright-mcp/browser.json'); fs.accessSync(manifest.executablePath, fs.constants.X_OK)" \
    && chmod 1777 /opt/ms-playwright \
    && rm /tmp/install-playwright-browsers.sh

# --- visual-aspect-analyzer builtin skill -----------------------------------
# Bake the visual-aspect-analyzer skill (a Bun/TypeScript visual-regression
# tool) into the image so a sandbox agent runs it with zero setup: runnerd
# symlinks every `/opt/agents/skills/*/` into each harness's native user-level
# skill dir (`daemon/src/baked-skills.ts`; README "Built-in skills"), so every
# harness discovers it as its own skill and runs it in place. Copied from its
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
FROM playwright-build AS baked-skills-build
COPY --from=daemon-build /usr/local/bin/bun /usr/local/bin/bun
COPY configs/platform/custom/skills/visual-aspect-analyzer /opt/agents/skills/visual-aspect-analyzer
RUN --mount=type=cache,id=tale-sandbox-skill-bun-${TARGETARCH},target=/root/.bun/install/cache,sharing=locked \
    cd /opt/agents/skills/visual-aspect-analyzer \
    && bun install --production \
    && MCP=/opt/agents/lib/node_modules/@playwright/mcp \
    && ln -sfn "$(node -p "require('path').dirname(require.resolve('playwright/package.json',{paths:['$MCP']}))")" node_modules/playwright \
    && ln -sfn "$(node -p "require('path').dirname(require.resolve('playwright-core/package.json',{paths:['$MCP']}))")" node_modules/playwright-core \
    && node -e "const fs=require('fs'); const manifest=require('/opt/tale/playwright-mcp/browser.json'); fs.accessSync(manifest.executablePath, fs.constants.X_OK)"

# OpenCode standalone binary (pinned). dpkg arch → release asset arch.
FROM harness-base AS opencode-build
ARG OPENCODE_VERSION=1.18.34
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
FROM harness-base AS cursor-build
ARG CURSOR_AGENT_VERSION=2026.10.01-e373342
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
    # The package's two Node single-executable builds (about 265 MB) serve
    # only the macOS computer-use re-exec, which downloads and codesign-checks
    # its own copy under ~/.cursor; `cursor-agent` runs the bundled node.
    rm -f /opt/agents/cursor/cursor-agent-sea /opt/agents/cursor/cursor-agent-worker-sea; \
    rm /tmp/cursor-agent.tar.gz; \
    /opt/agents/bin/agent --version

# gh CLI (pinned) for the issue→PR workflow (GITHUB_TOKEN env auth).
FROM harness-base AS gh-build
ARG GH_VERSION=2.62.0
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

# Hermes shares the locked document libraries: they sit in this stage's
# /usr/local, so pip counts them installed (it does not count packages it
# finds only through PYTHONPATH). A private install prefix contains only
# Hermes's additions; the final COPY restores their ordinary /usr/local
# locations without copying the document bytes again.
FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS hermes-build
COPY --from=document-python-build /opt/tale-document-python/ /usr/local/
ARG HERMES_AGENT_VERSION=0.19.0
RUN pip install --no-cache-dir --prefix /opt/tale-hermes "hermes-agent==${HERMES_AGENT_VERSION}" \
    && PYTHONPATH=/opt/tale-hermes/lib/python3.12/site-packages /opt/tale-hermes/bin/hermes --version

FROM harness-base AS gemini-build
# Since 0.60.0 the CLI requires root-owned system settings and ancestors.
# The build stage derives immutable policy files; the non-root wrapper
# selects one by its settings hash and supplies only per-exec string values
# through env expansion. The harness YAML keeps
# `capabilities.resume: false` until a release carries the resume fix
# (google-gemini/gemini-cli#29365).
ARG GEMINI_CLI_VERSION=0.62.0
RUN --mount=type=cache,id=tale-sandbox-node-gyp-${TARGETARCH},target=/root/.cache/node-gyp,sharing=locked \
    npm install -g --prefix /opt/agents "@google/gemini-cli@${GEMINI_CLI_VERSION}" \
    && npm cache clean --force \
    && gemini --version

# OpenAI Codex CLI (pinned npm). Driven headlessly by the platform's codex
# adapter (`codex exec --json`, config via -c overrides) — no wrapper needed;
# the CLI's native JSONL is the parse contract. Its npm launcher is a Node
# process that stays the native binary's parent for the whole run; `codex` on
# PATH execs the binary directly instead (codex-launcher.in), resolved the way
# that launcher resolves it.
FROM harness-base AS codex-build
ARG CODEX_VERSION=0.160.0
COPY services/sandbox-runtime/codex-launcher.in /tmp/codex-launcher.in
RUN --mount=type=cache,id=tale-sandbox-node-gyp-${TARGETARCH},target=/root/.cache/node-gyp,sharing=locked \
    npm install -g --prefix /opt/agents "@openai/codex@${CODEX_VERSION}" \
    && npm cache clean --force \
    && codex_root="$(realpath /opt/agents/lib/node_modules/@openai/codex)" \
    && codex_bin="$(node -e ' \
         const path = require("path"); \
         const root = process.argv[1]; \
         const req = require("module").createRequire(path.join(root, "bin", "codex.js")); \
         const triple = { x64: "x86_64-unknown-linux-musl", arm64: "aarch64-unknown-linux-musl" }[process.arch]; \
         const pkg = { x64: "@openai/codex-linux-x64", arm64: "@openai/codex-linux-arm64" }[process.arch]; \
         let vendor; \
         try { vendor = path.join(path.dirname(req.resolve(pkg + "/package.json")), "vendor"); } \
         catch { vendor = path.join(root, "vendor"); } \
         console.log(path.join(vendor, triple, "bin", "codex"));' "$codex_root")" \
    && test -x "$codex_bin" \
    # The voice host (about 75 MB with its media libraries) serves only the
    # interactive TUI's realtime voice; the sandbox drives `codex exec`.
    && rm -rf "$(dirname "$codex_bin")/../codex-resources/voice" \
    && sed -e "s|@CODEX_ROOT@|$codex_root|" -e "s|@CODEX_BIN@|$codex_bin|" \
         /tmp/codex-launcher.in > /opt/agents/bin/codex.direct \
    && chmod 755 /opt/agents/bin/codex.direct \
    && mv -f /opt/agents/bin/codex.direct /opt/agents/bin/codex \
    && rm /tmp/codex-launcher.in \
    && codex --version

FROM harness-base AS pi-build
ARG PI_CODING_AGENT_VERSION=1.0.1
RUN --mount=type=cache,id=tale-sandbox-node-gyp-${TARGETARCH},target=/root/.cache/node-gyp,sharing=locked \
    npm install -g --prefix /opt/agents "@earendil-works/pi-coding-agent@${PI_CODING_AGENT_VERSION}" \
    && npm cache clean --force \
    && pi --version

FROM harness-base AS openclaw-build
ARG OPENCLAW_VERSION=2026.9.8
RUN --mount=type=cache,id=tale-sandbox-node-gyp-${TARGETARCH},target=/root/.cache/node-gyp,sharing=locked \
    npm install -g --prefix /opt/agents "openclaw@${OPENCLAW_VERSION}" \
    && npm cache clean --force \
    && openclaw --version

FROM harness-base AS qwen-build
ARG QWEN_CODE_VERSION=0.24.7
RUN --mount=type=cache,id=tale-sandbox-node-gyp-${TARGETARCH},target=/root/.cache/node-gyp,sharing=locked \
    npm install -g --prefix /opt/agents "@qwen-code/qwen-code@${QWEN_CODE_VERSION}" \
    && npm cache clean --force \
    # Qwen vendors ripgrep for every platform; keep this architecture's Linux build.
    && rg_arch="$(case "${TARGETARCH:-amd64}" in arm64) echo arm64 ;; *) echo x64 ;; esac)" \
    && test -d "/opt/agents/lib/node_modules/@qwen-code/qwen-code/vendor/ripgrep/${rg_arch}-linux" \
    && find /opt/agents/lib/node_modules/@qwen-code/qwen-code/vendor/ripgrep -mindepth 1 -maxdepth 1 \
         -type d ! -name "${rg_arch}-linux" -exec rm -rf {} + \
    && qwen --version

# Isolate the vision dependency pin from document tools and every harness.
FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS vision-build
ARG PILLOW_VERSION=12.3.0
RUN python3 -m venv /opt/tale-vision \
    && /opt/tale-vision/bin/pip install --no-cache-dir "Pillow==${PILLOW_VERSION}" \
    && printf '#!/bin/sh\nexec /opt/tale-vision/bin/python -E -s /opt/tale-vision/cli.py "$@"\n' \
       > /usr/local/bin/tale-vision

# --- runtime assembly -------------------------------------------------------
# Each immutable tool export has its own layer. --link keeps unchanged exports
# reusable even when an earlier CLI changes, avoiding multi-GB duplicate layers
# for ordinary harness upgrades. Version ARGs never enter this stage or the
# common apt/document-toolchain RUN cache keys.
FROM tooling-base AS runtime

# uv — fast Python package installer/resolver. See https://github.com/astral-sh/uv
COPY --link --from=ghcr.io/astral-sh/uv:0.5@sha256:7bff3c3776ec467fc1437960f2c469d8beb30f536a6465a3350c647ccd260ec2 /uv /usr/local/bin/uv

# Node 24 LTS. OpenClaw requires at least 24.16.0; pin the verified LTS patch
# so a cached floating image cannot silently leave the upgraded CLI unusable.
COPY --link --from=node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 /usr/local /opt/node
# Its bin links yarn/yarnpkg into /opt/yarn-v1.22.22, which comes along, and
# links nodejs to /usr/local/bin/node, which the RUN below repoints.
COPY --link --from=node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 /opt/yarn-v1.22.22 /opt/yarn-v1.22.22

# bun — many JS/TS projects (Tale included) use it for install/test/scripts, so
# an in-sandbox coding agent needs it on PATH. Reuse the daemon-build stage's
# already-pulled oven/bun image (Debian/glibc, matches this base); bun is a
# single self-contained binary. `bunx` is just bun with a subcommand.
COPY --link --from=daemon-build /usr/local/bin/bun /usr/local/bin/bun
RUN ln -sf /usr/local/bin/bun /usr/local/bin/bunx \
    && ln -sf node /opt/node/bin/nodejs

ENV PATH=/opt/agents/bin:/opt/node/bin:/usr/local/bin:/usr/bin:/bin
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
# Playwright browsers in a world-readable global path (the agent user reads
# them; the baked browsers mean no per-session download — the MCP runs with
# --isolated so its profile stays in memory). The managed MCP launcher answers
# defensive `browser_install` calls from the verified shell metadata. Keep the
# cache directory sticky-writable for ordinary Playwright registry bookkeeping
# and explicit browser installs, while baked binaries stay root-owned and
# read-only. Telemetry off.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
ENV CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
# Maximum reasoning effort by DEFAULT for the in-sandbox coding agent (drives
# adaptive thinking at full depth on Opus-class models; a model without effort
# support just ignores it). Observed on 2.1.283: the request carries
# `output_config.effort: max` for claude-opus-5-5 (whose own default is
# medium), claude-fable-5-1, claude-fable-5 and claude-opus-4-8, and so do
# subagent and background title calls. This lives in the daemon's process
# env, which the exec manager uses as the LOWEST-precedence floor
# (`{ ...process.env, ...envStore.resolve(req.env) }`), so a user-supplied
# CLAUDE_CODE_EFFORT_LEVEL in the session env or per-exec overlay still wins.
# Deliberately NOT placed in managed-settings.json — that layer is
# highest-precedence and would make the default impossible to override.
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
# never set CLAUDE_CODE_DISABLE_THINKING / CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING
# for a Claude model (the exec builder sets them only for a foreign one) — Opus
# 5.5 and the Fable models refuse a disabled `thinking` outright.
ENV CLAUDE_CODE_WORKFLOWS=1
# Output-token ceiling per request. Claude Code gives ids it RECOGNISES
# (claude-fable-5, claude-opus-4-8, …) 64K output under a `[1m]` 1M-context
# window, but an id it does not recognise falls back to a conservative 32K —
# and the shipped default model is exactly such an id (the rolling
# `~anthropic/claude-fable-latest` alias). Pin the floor to the same 64K the
# recognised flagships already get (smoke-verified on 2.1.173, and again on
# 2.1.283 for claude-opus-5-5 and claude-fable-5-1: the value lands verbatim
# as the request's max_tokens). Deliberately NOT higher — >64K at 1M
# context is unverified against live upstreams. Same overridable-floor
# semantics as CLAUDE_CODE_EFFORT_LEVEL above.
ENV CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000

ENV NODE_PATH=/opt/tale/document-node/node_modules

# The builtin document skills' libraries (see their build stages above).
COPY --link --from=document-python-build /opt/tale-document-python/ /usr/local/
COPY --link --from=document-python-build /opt/tale/document-python-requirements.txt /opt/tale/document-python-requirements.txt
COPY --link --from=document-node-build /opt/tale/document-node/ /opt/tale/document-node/

COPY --link --from=claude-build /opt/agents/ /opt/agents/
COPY --link --from=playwright-build /opt/agents/ /opt/agents/
COPY --link --from=opencode-build /opt/agents/ /opt/agents/
COPY --link --from=cursor-build /opt/agents/ /opt/agents/
COPY --link --from=codex-build /opt/agents/ /opt/agents/
COPY --link --from=gemini-build /opt/agents/ /opt/agents/
COPY --link --from=pi-build /opt/agents/ /opt/agents/
COPY --link --from=openclaw-build /opt/agents/ /opt/agents/
COPY --link --from=qwen-build /opt/agents/ /opt/agents/
COPY --link --from=playwright-build /opt/ms-playwright/ /opt/ms-playwright/
COPY --link --from=playwright-build /opt/tale/playwright-mcp/browser.json /opt/tale/playwright-mcp/browser.json
COPY --link --from=baked-skills-build /opt/agents/skills/ /opt/agents/skills/
COPY --link --from=gh-build /usr/local/bin/gh /usr/local/bin/gh
COPY --link --from=hermes-build /opt/tale-hermes/ /usr/local/
COPY --link --from=vision-build /opt/tale-vision/ /opt/tale-vision/
COPY --link --from=vision-build /usr/local/bin/tale-vision /usr/local/bin/tale-vision

COPY --chmod=755 services/sandbox-runtime/tale-hermes-run /usr/local/bin/tale-hermes-run
COPY --chmod=755 services/sandbox-runtime/tale-gemini-run /usr/local/bin/tale-gemini-run
COPY --from=gemini-settings-build /gemini-settings/ /usr/local/share/tale/gemini-settings/
COPY --chmod=755 services/sandbox-runtime/tale-pi-run /usr/local/bin/tale-pi-run
COPY --chmod=755 services/sandbox-runtime/tale-openclaw-run /usr/local/bin/tale-openclaw-run
COPY --chmod=755 services/sandbox-runtime/tale-qwen-run /usr/local/bin/tale-qwen-run

# runnerd — the session control daemon, bundled to a single file in the
# daemon-build stage and run by the image's Node 24 (session mode only) — and
# the subreaper shim it runs every exec under.
COPY --from=daemon-build /runnerd.mjs /usr/local/lib/tale/runnerd.mjs
COPY --from=daemon-build /lazy-docker.mjs /usr/local/lib/tale/lazy-docker.mjs
COPY --from=exec-shim-build /tale-exec-shim /usr/local/bin/tale-exec-shim

# Claude Code managed settings (highest precedence on Linux): disable
# auto-update + telemetry, suppress Claude commit/PR attribution
# (includeCoAuthoredBy:false — the byline is appended by the CLI at
# commit/PR time and a cloned repo's CLAUDE.md can't override a harness
# default; managed scope so a cloned app repo / BYO user can't re-enable
# it), keep transcripts 60 days (cleanupPeriodDays — twice the CLI's 30-day
# default, so a standing session's recent tasks still `--resume`, while the
# store on the org's own /agent volume holds two months of conversations
# rather than a year; a task resumed after its transcript is pruned restarts
# fresh on its preserved files), and register the
# steer hook (mid-turn message injection — hooks merge across settings
# sources, so /agent configs can't shadow it). Two opt-outs keep what newer
# CLIs added out of the sandbox: crossSessionInbound:"refuse" (2.1.224+
# offers every session SendMessage/ListAgents, a channel between concurrent
# execs of separate tasks in one container) and syncClaudeAiSkills/Plugins
# false (2.1.275+ syncs a claude.ai account's own skills and plugins into
# sessions signed in with it — the subscription lane). NOT permission rules —
# those are per-run flags.
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

# Playwright MCP launcher: appends --proxy-server/--proxy-bypass from the
# container's HTTPS_PROXY/NO_PROXY (Chromium ignores the env vars), and answers
# the start of an agent turn (initialize, tools/list, the prompt and resource
# lists) from manifests of the real server's answers, recorded below for the
# argument sets the platform passes (playwright-mcp-args.json, held to
# exec-builder.ts by its test): the server, a Node process holding ~100 MB,
# starts only once the turn first uses the browser. The agent adapters use
# this as the MCP command.
COPY services/sandbox-runtime/tale-playwright-mcp /usr/local/bin/tale-playwright-mcp
COPY services/sandbox-runtime/playwright-mcp-args.json /opt/tale/playwright-mcp/args.json
RUN python3 -Es /usr/local/bin/tale-playwright-mcp --write-manifests /opt/tale/playwright-mcp/args.json

# Connector-dispatch MCP bridge: a dependency-free stdio MCP server the agent
# adapters wire in via --mcp-config. Relays connector({slug,operation,args})
# to the platform's /api/connectors/* endpoints (credentials stay
# server-side). Runs under the image's node (global fetch).
COPY services/sandbox-runtime/tale-connectors-mcp /usr/local/bin/tale-connectors-mcp

# Vision polyfill for a TEXT-ONLY managed agent. `tale-vision-read-hook` is a
# PreToolUse(Read) hook (registered in managed-settings.json, self-gated on
# TALE_VISION_READ_POLYFILL=1 — the platform sets it only for a text-only
# serving model, next to TALE_VISION_MODEL) that (1) transcribes raster Reads
# via the transcriber and (2) denies native PDF Reads — pdftotext when the PDF
# has text, else guide pdftoppm → Read PNG (image path). Native PDF/`file`
# blocks 400 on text-only models (DeepSeek). `tale-vision-transcribe` relays
# images to the platform LLM gateway's vision model using the session virtual
# key (no provider key enters the container). See
# services/platform/lib/harnesses/exec-builder.ts (`vision.env`).
COPY services/sandbox-runtime/tale-vision-transcribe /usr/local/bin/tale-vision-transcribe
COPY services/sandbox-runtime/tale-vision-read-hook /usr/local/bin/tale-vision-read-hook

# Batch vision CLI for in-sandbox code (`run_code` scripts and coding agents):
# analyzes images via the platform LLM gateway with the session virtual key —
# same no-provider-key-in-container lane as tale-vision-transcribe (which stays
# the single-image Read-hook polyfill). Armed (TALE_VISION_MODEL) for every
# managed gateway turn that resolved a vision model, vision-capable serving
# models included — a script's batch transcription is the lane's job. Pillow lives in a dedicated venv and
# the shim runs `python -E -s` so the per-session user deps that entrypoint.sh
# prepends onto PYTHONPATH (/agent/.runtime/deps/python) can never shadow PIL.
COPY services/sandbox-runtime/tale-vision /opt/tale-vision/cli.py

COPY services/sandbox-runtime/docker-entrypoint.sh /docker-entrypoint.sh
COPY services/sandbox-runtime/entrypoint.sh /entrypoint.sh
RUN chmod +x /docker-entrypoint.sh /entrypoint.sh /usr/local/bin/tale-git-credential \
      /usr/local/bin/tale-playwright-mcp /usr/local/bin/tale-connectors-mcp \
      /usr/local/bin/tale-vision-transcribe /usr/local/bin/tale-vision-read-hook \
      /usr/local/bin/tale-vision \
      /usr/local/bin/tale-steer-hook \
      /usr/local/bin/tale-plan-gate

# Default user is nobody; spawner pins --user per profile at the call site
# (65534 default profile, 10001 agent profile).
USER 65534:65534

WORKDIR /agent

ENTRYPOINT ["/docker-entrypoint.sh"]
