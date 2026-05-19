# Tale Sandbox Runtime
#
# Executed inside an ephemeral container per `code_run` tool call.
# See /home/larry/.claude/plans/presentation-generation-from-prompts-delightful-aho.md §3
#
# Layers: python:3.12-slim-bookworm + uv + Node 24 + fontconfig (for Pillow).
# Runs as uid 65534 under --read-only with all caps dropped; spawner forces
# these via `docker run` flags but the image baseline matches.
#
# TODO: pin all FROM lines to @sha256 once a Renovate/Dependabot rule is in
# place. Plan calls for digest pinning; we ship tag pins to unblock bootstrap.

ARG VERSION=dev

FROM python:3.12-slim-bookworm

# Runtime additions only — fontconfig + DejaVu so Pillow/matplotlib render
# text correctly, jq so the entrypoint can read packages.json/options.json,
# ca-certificates for HTTPS to pypi/npm via the egress proxy.
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-dejavu-core \
      fontconfig \
      ca-certificates \
      jq \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

# uv — fast Python package installer/resolver. See https://github.com/astral-sh/uv
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv

# Node 24 LTS. Copy /usr/local from node:24-bookworm-slim into /opt/node.
COPY --from=node:24-bookworm-slim /usr/local /opt/node

ENV PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Default user is nobody; spawner pins --user 65534:65534 to make this
# explicit at the runtime call site.
USER 65534:65534

WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]
