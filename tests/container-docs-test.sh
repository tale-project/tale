#!/usr/bin/env bash
# =============================================================================
# Tale Docs — Container test
# =============================================================================
# Builds, validates, and smoke-tests the documentation site (services/docs)
# using its standalone compose files (compose.docs.yml + compose.docs.test.yml).
#
# Usage:
#   bash tests/container-docs-test.sh
# =============================================================================

set -euo pipefail

export STATIC_SITE_NAME=docs
export STATIC_SITE_PORT=13002
export STATIC_SITE_SIZE_BUDGET=400

bash "$(dirname "$0")/_static-site-test.sh"
