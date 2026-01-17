# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

# Use official FalkorDB image
# FalkorDB is a Redis-based graph database optimized for GraphRAG
# - Native multi-tenant support (10K+ graphs per instance)
# - Low latency (~140ms p99)
# - Client-server architecture (no file-level locking issues)
# - Combined graph and vector storage via hybrid adapter
FROM falkordb/falkordb:edge

# Re-declare VERSION arg (ARGs don't persist after FROM)
ARG VERSION=dev

# Set version environment variable
ENV TALE_VERSION=${VERSION}

# FalkorDB configuration is done via environment variables in compose.yml
# Default Redis configuration is sufficient for most use cases

# Expose ports:
# - 6379: Redis protocol (RAG service connection)
# - 3000: FalkorDB Browser UI (mapped to 6380 externally in compose.yml)
EXPOSE 6379 3000

# Use the default FalkorDB entrypoint and command
# Data is persisted in /var/lib/falkordb/data volume (configured in compose.yml)
