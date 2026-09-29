#!/bin/sh
# services/sandbox-llm-gateway/docker-entrypoint.sh
#
# Container-level bootstrap for the sandbox LLM gateway: hands the gateway its
# setup token, then `exec`s the upstream image's own entrypoint unchanged.
#
# The gateway creates its first admin account only for a request that carries
# the setup token it was started with (BIFROST_SETUP_TOKEN), so nobody who can
# reach a fresh gateway can claim it first. The platform creates that account
# on its first provision, with the admin password it shares with this
# container, so the password is the token: a fresh gateway accepts its admin
# only from a holder of the credential it will be managed with. Every Tale
# deployment already gives this container that password (`tale deploy` and the
# Kubernetes manifests pass the whole environment), so none needs a new secret.
# An explicit BIFROST_SETUP_TOKEN wins. The gateway stops reading the token
# once its admin account exists.
#
# The password is read like the platform reads it (the pre-rename
# LLM_GATEWAY_ADMIN_PASSWORD still counts), so the token is always the value
# the platform sends.

set -eu

if [ -z "${BIFROST_SETUP_TOKEN:-}" ]; then
  BIFROST_SETUP_TOKEN="${SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD:-${LLM_GATEWAY_ADMIN_PASSWORD:-}}"
  export BIFROST_SETUP_TOKEN
fi

exec /app/docker-entrypoint.sh "$@"
