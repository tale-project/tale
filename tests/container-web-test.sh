#!/usr/bin/env bash
# =============================================================================
# Tale Web — Container test
# =============================================================================
# Builds, validates, and smoke-tests the marketing site (services/web)
# using its standalone compose files (compose.web.yml + compose.web.test.yml).
#
# Usage:
#   bash tests/container-web-test.sh
# =============================================================================

set -euo pipefail

export STATIC_SITE_NAME=web
export STATIC_SITE_PORT=13001
export STATIC_SITE_SIZE_BUDGET=400

bash "$(dirname "$0")/_static-site-test.sh"
