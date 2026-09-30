#!/bin/sh
# services/sandbox-llm-gateway/docker-entrypoint.sh
#
# Container-level bootstrap for the sandbox LLM gateway: hands the gateway its
# setup token, then `exec`s the upstream image's own entrypoint unchanged.
#
# The gateway creates its first admin account only for a request that carries
# the setup token it was started with (BIFROST_SETUP_TOKEN), so nobody who can
# reach a fresh gateway can claim it first. The platform creates that account
# on its first provision with the admin password it shares with this
# container, and presents that same password as the token
# (services/platform/backend/core/node_only/sandbox/llm_gateway_admin.ts). So
# the token is the password, always: a BIFROST_SETUP_TOKEN set on the
# container is a value the platform never sends, and a fresh gateway would
# refuse the platform's bootstrap (403) forever, so it is replaced, with a
# notice. Every Tale deployment already gives this container that password
# (`tale deploy` and the Kubernetes manifests pass the whole environment), so
# none needs a new secret. The gateway stops reading the token once its admin
# account exists.
#
# The password is read like the platform reads it: the current name whenever
# it is set, else the pre-rename LLM_GATEWAY_ADMIN_PASSWORD. The gateway trims
# the token as the platform trims the password, and with an empty token it
# creates no admin account for anyone.

set -eu

setup_token="${SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD-${LLM_GATEWAY_ADMIN_PASSWORD-}}"
if [ -n "${BIFROST_SETUP_TOKEN:-}" ] && [ "$BIFROST_SETUP_TOKEN" != "$setup_token" ]; then
  echo "sandbox-llm-gateway: ignoring BIFROST_SETUP_TOKEN: the setup token is always the admin password (SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD), which the platform presents" >&2
fi
BIFROST_SETUP_TOKEN="$setup_token"
export BIFROST_SETUP_TOKEN

exec /app/docker-entrypoint.sh "$@"
